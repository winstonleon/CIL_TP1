// Verificación automática de completitud (HU0017, R8, ADR-22) para los flujos recepcion-registro y
// verificacion-completitud de n8n, a través de /internal/*. La API decide y n8n orquesta: la regla, el bloqueo, la
// transición y el texto del aviso viven aquí; n8n pide la verificación, ramifica según el resultado y notifica.
// - Completo = cada requisito obligatorio de R7 con un documento vigente y el Pago del derecho de admisión registrado
//   (D2-a). Pasa a en_validacion; estado_documental, estado_financiero y el Pago quedan en `pendiente` (D4-X).
// - Incompleto: se mantiene en en_postulacion (D1-A) y se reserva el aviso de faltantes (ADR-07: una fila por intento,
//   retoma a los 10 min y tope de 6 con una fila de cierre `fallido`).
// - Una sola verificación por confirmación, bajo el bloqueo del expediente (el mismo de la carga y el reemplazo de
//   documentos): repetirla no duplica la transición ni el correo.
import { enTransaccion, obtenerPool, type Consultable } from "../db/pool";
import { ErrorApi } from "../errores";
import { insertarEvento } from "../repositories/auditoria";
import { insertarIntento } from "../repositories/aviso";
import {
  bloquearIntentosFaltantes,
  idUltimaConfirmacion,
  listarVerificacionesPendientes,
  resolverFaltantes,
  TIPO_FALTANTES,
  ultimaVerificacion,
  type Faltante,
} from "../repositories/completitud";
import { listarDocumentosVigentes } from "../repositories/documento";
import { bloquearFichaDeExpediente, leerDatosFamilia } from "../repositories/expediente";
import { leerDerechoAdmision } from "../repositories/pago";
import { requisitosExigidos } from "../repositories/requisito";
import { avisoAgotado, avisoYaRegistrado, decidir, MAXIMO_PENDIENTES, MINUTOS_REGISTRO, MINUTOS_REINTENTO } from "./agendamiento";
import { componerFaltantes } from "./avisosCompletitud";
import { transicionarExpediente } from "./expedientes/transicionarExpediente";

const ESTADO_VERIFICABLE = "en_postulacion";

export type ResultadoVerificacion =
  | { id_expediente: number; resultado: "completo" }
  | { id_expediente: number; resultado: "incompleto"; id_notificacion: number; tipo_evento: string; asunto: string; cuerpo: string };

const noCorresponde = () =>
  new ErrorApi(409, "VERIFICACION_NO_CORRESPONDE", "El expediente no tiene una confirmación de documentos por verificar");

// R7 + R8 con el expediente ya bloqueado.
async function evaluar(db: Consultable, idExpediente: number): Promise<{ faltantes: Faltante[]; derecho: boolean }> {
  // En serie: es el cliente de la transacción.
  const exigidos = await requisitosExigidos(db, idExpediente);
  const vigentes = await listarDocumentosVigentes(db, idExpediente);
  const derecho = await leerDerechoAdmision(db, idExpediente);
  const faltantes = exigidos
    .filter((r) => r.obligatorio && !vigentes.some((d) => d.id_requisito === r.id_requisito && d.id_apoderado === r.id_apoderado))
    .map((r) => ({ id_requisito: r.id_requisito, id_apoderado: r.id_apoderado }));
  return { faltantes, derecho: derecho !== null };
}

async function mensaje(db: Consultable, idExpediente: number, faltantes: Faltante[], faltaDerecho: boolean) {
  const familia = (await leerDatosFamilia(db, idExpediente))!;
  return componerFaltantes({
    nombres: familia.nombres,
    campana: familia.campana_admision,
    faltantes: await resolverFaltantes(db, idExpediente, faltantes),
    faltaDerecho,
  });
}

type Resultado = { resultado: ResultadoVerificacion } | { conflicto: ErrorApi };

// POST /internal/expedientes/:id/verificacion-completitud. Los conflictos se lanzan después del COMMIT: la fila de
// cierre del tope debe quedar guardada aunque la respuesta sea 409.
export async function verificarCompletitud(idExpediente: number): Promise<ResultadoVerificacion> {
  const r = await enTransaccion<Resultado>(async (c) => {
    const bloqueo = await bloquearFichaDeExpediente(c, idExpediente);
    if (!bloqueo) throw new ErrorApi(404, "EXPEDIENTE_NO_ENCONTRADO", "El expediente no existe");
    const confirmacion = await idUltimaConfirmacion(c, idExpediente);
    if (bloqueo.estado !== ESTADO_VERIFICABLE || confirmacion === null) return { conflicto: noCorresponde() };
    const previa = await ultimaVerificacion(c, idExpediente);

    // Confirmación nueva: se verifica una sola vez.
    if (!previa || previa.id_evento < confirmacion) {
      const { faltantes, derecho } = await evaluar(c, idExpediente);
      if (faltantes.length === 0 && derecho) {
        await insertarEvento(c, {
          tipoEvento: "completitud_verificada",
          idExpediente,
          detalle: { resultado: "completo", faltantes: [], derecho_registrado: true },
          horaReal: true,
        });
        await transicionarExpediente(c, {
          idExpediente,
          campo: "estado",
          esperado: ESTADO_VERIFICABLE,
          nuevo: "en_validacion",
          idPersonal: null,
          detalle: { origen: "verificacion_completitud" },
        });
        return { resultado: { id_expediente: idExpediente, resultado: "completo" } };
      }
      const idNotificacion = await insertarIntento(c, { idExpediente, tipoEvento: TIPO_FALTANTES, estadoEnvio: "pendiente" });
      await insertarEvento(c, {
        tipoEvento: "completitud_verificada",
        idExpediente,
        detalle: { resultado: "incompleto", faltantes, derecho_registrado: derecho, id_notificacion: idNotificacion },
        horaReal: true,
      });
      const { asunto, cuerpo } = await mensaje(c, idExpediente, faltantes, !derecho);
      return { resultado: { id_expediente: idExpediente, resultado: "incompleto", id_notificacion: idNotificacion, tipo_evento: TIPO_FALTANTES, asunto, cuerpo } };
    }

    // Confirmación ya verificada: solo queda el aviso de esa verificación (ADR-07), con los faltantes que se registraron.
    if (previa.resultado !== "incompleto" || previa.id_notificacion === null) return { conflicto: noCorresponde() };
    const decision = decidir(
      await bloquearIntentosFaltantes(c, { idExpediente, desde: previa.id_notificacion, minutosReintento: MINUTOS_REINTENTO }),
    );
    if (decision.accion === "cerrado" || decision.accion === "en_curso") return { conflicto: avisoYaRegistrado() };
    if (decision.accion === "agotar") {
      await insertarIntento(c, { idExpediente, tipoEvento: TIPO_FALTANTES, estadoEnvio: "fallido" });
      return { conflicto: avisoAgotado() };
    }
    const idNotificacion = await insertarIntento(c, { idExpediente, tipoEvento: TIPO_FALTANTES, estadoEnvio: "pendiente" });
    const { asunto, cuerpo } = await mensaje(c, idExpediente, previa.faltantes, !previa.derecho_registrado);
    return { resultado: { id_expediente: idExpediente, resultado: "incompleto", id_notificacion: idNotificacion, tipo_evento: TIPO_FALTANTES, asunto, cuerpo } };
  });
  if ("conflicto" in r) throw r.conflicto;
  return r.resultado;
}

// GET /internal/completitud/pendientes: solo ids de expediente; n8n pide cada verificación por separado.
export async function verificacionesPendientes(): Promise<{ expedientes: { id_expediente: number }[] }> {
  const ids = await listarVerificacionesPendientes(obtenerPool(), {
    minutosRegistro: MINUTOS_REGISTRO,
    minutosReintento: MINUTOS_REINTENTO,
    limite: MAXIMO_PENDIENTES,
  });
  return { expedientes: ids.map((id_expediente) => ({ id_expediente })) };
}

// P06 (ajuste 3): el resultado de la verificación de la última confirmación, con los faltantes por tipo de documento y
// parentesco. null si la última confirmación aún no se verificó (o nunca hubo una).
export async function verificacionVigente(db: Consultable, idExpediente: number) {
  const [v, confirmacion] = await Promise.all([ultimaVerificacion(db, idExpediente), idUltimaConfirmacion(db, idExpediente)]);
  if (!v || confirmacion === null || v.id_evento < confirmacion) return null;
  return {
    resultado: v.resultado,
    verificado_en: v.fecha_hora.toISOString(),
    faltantes: await resolverFaltantes(db, idExpediente, v.faltantes),
    falta_derecho: !v.derecho_registrado,
  };
}
