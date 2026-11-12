// Flujo seguimiento-recordatorios de n8n, revisión diaria (HU0018, R20 y R21; plan del bloque 11) a través de /internal/*.
// La API decide con los datos (repositories/seguimiento.ts) y n8n coordina y envía por notificacion-multicanal:
// - recordatorio por inactividad (HU0018-1.0): uno por expediente y período (la etapa con su ancla), con la acción
//   pendiente, la fecha límite y el enlace al expediente;
// - caducidad (HU0018-2.0): en una transacción, con el expediente bloqueado y la condición recalculada bajo el bloqueo,
//   devuelve la vacante (fila del grado bloqueada, como R14), cancela las citas reservadas y libera sus cupos, pasa el
//   expediente a `caducado` y reserva el primer intento de los avisos a la familia y al buzón de admisión.
// Avisos con las reglas de ADR-07: una fila por intento, retoma a los 10 min (barrido de cada minuto) y tope de 6 con una
// fila de cierre `fallido`. Los conflictos se lanzan después del COMMIT, para que la fila de cierre quede guardada.
// La campaña DEMO nunca entra (C72). Actor: el sistema.
import { obtenerConfig } from "../config";
import { enTransaccion, obtenerPool } from "../db/pool";
import { ErrorApi } from "../errores";
import { bloquearGradoDeExpediente, devolverVacante } from "../repositories/adjudicacion";
import { bloquearIntentos, insertarIntento } from "../repositories/aviso";
import { bloquearDatosFamilia } from "../repositories/expediente";
import {
  cancelarCitasReservadas,
  leerCaducidad,
  listarAvisosSeguimientoPendientes,
  listarSeguimientoPendiente,
  situacionDe,
  TIPO_CADUCADO_ADMISION,
  TIPO_CADUCADO_FAMILIA,
  TIPO_RECORDATORIO_INACTIVIDAD,
  type EtapaSeguimiento,
  type Plazos,
  type TipoAvisoSeguimiento,
} from "../repositories/seguimiento";
import { avisoAgotado, decidir, MAXIMO_PENDIENTES, MINUTOS_REINTENTO } from "./agendamiento";
import { componerCaducidadAdmision, componerCaducidadFamilia, componerRecordatorioInactividad } from "./avisosSeguimiento";
import { transicionarExpediente } from "./expedientes/transicionarExpediente";
import { codigoExpediente } from "./fichaInscripcion";
import { CAMPANA_DEMO } from "./indicadores";

export const ESTADO_CADUCADO = "caducado";
// Tope del barrido diario: el resto queda para el día siguiente (los datos lo vuelven a entregar).
export const MAXIMO_REVISION_DIARIA = 200;

export interface AvisoSeguimiento {
  id_expediente: number;
  id_notificacion: number;
  tipo_evento: TipoAvisoSeguimiento;
  asunto: string;
  cuerpo: string;
}

export function plazosVigentes(): Plazos {
  const c = obtenerConfig();
  return {
    postulacion: c.PLAZO_POSTULACION_DIAS,
    subsanacion: c.PLAZO_SUBSANACION_DIAS,
    agendamiento: c.PLAZO_AGENDAMIENTO_DIAS,
    reprogramacion: c.PLAZO_REPROGRAMACION_DIAS,
    cuota: c.PLAZO_CUOTA_DIAS,
  };
}

const expedienteNoEncontrado = () => new ErrorApi(404, "EXPEDIENTE_NO_ENCONTRADO", "El expediente no existe");
const caducidadNoCorresponde = () => new ErrorApi(409, "CADUCIDAD_NO_CORRESPONDE", "El expediente no tiene un plazo vencido por caducar");
const recordatorioNoCorresponde = () =>
  new ErrorApi(409, "RECORDATORIO_NO_CORRESPONDE", "El expediente no tiene una acción pendiente sin interacción en las últimas 48 horas");
const recordatorioYaRegistrado = () => new ErrorApi(409, "RECORDATORIO_YA_REGISTRADO", "El aviso de esta etapa ya está registrado o en curso");
const avisoNoCorresponde = () => new ErrorApi(409, "AVISO_NO_CORRESPONDE", "El expediente no tiene ese aviso pendiente");

// GET /internal/seguimiento/pendientes (revisión diaria): solo ids.
export async function seguimientoPendiente() {
  const r = await listarSeguimientoPendiente(obtenerPool(), plazosVigentes(), MAXIMO_REVISION_DIARIA);
  return {
    caducidades: r.caducidades.map((id_expediente) => ({ id_expediente })),
    recordatorios: r.recordatorios.map((id_expediente) => ({ id_expediente })),
  };
}

// GET /internal/seguimiento/avisos-pendientes (cada minuto): los intentos por retomar.
export async function avisosSeguimientoPendientes() {
  const avisos = await listarAvisosSeguimientoPendientes(obtenerPool(), plazosVigentes(), {
    minutosReintento: MINUTOS_REINTENTO,
    limite: MAXIMO_PENDIENTES,
  });
  return { avisos };
}

type Resultado<T> = { ok: T } | { conflicto: ErrorApi };
const resolver = <T>(r: Resultado<T>): T => {
  if ("conflicto" in r) throw r.conflicto;
  return r.ok;
};

// POST /internal/expedientes/:id/caducidad (HU0018-2.0, R21). Orden de bloqueo: expediente, grado (si tenía la vacante),
// horarios y citas: el mismo de la adjudicación (R14) y de «Confirmar citas» (HU0009), así no hay interbloqueos.
export async function caducarExpediente(idExpediente: number): Promise<{ id_expediente: number; avisos: AvisoSeguimiento[] }> {
  const plazos = plazosVigentes();
  return enTransaccion(async (c) => {
    const familia = await bloquearDatosFamilia(c, idExpediente);
    if (!familia) throw expedienteNoEncontrado();
    const s = await situacionDe(c, plazos, idExpediente);
    if (!s?.caduca) throw caducidadNoCorresponde();

    let vacanteDevuelta = false;
    if (familia.estado === "vacante_asignada") {
      const grado = (await bloquearGradoDeExpediente(c, idExpediente))!;
      await devolverVacante(c, grado.id_grado);
      vacanteDevuelta = true;
    }
    const citas = await cancelarCitasReservadas(c, idExpediente);
    const idFamilia = await insertarIntento(c, { idExpediente, tipoEvento: TIPO_CADUCADO_FAMILIA, estadoEnvio: "pendiente" });
    const idAdmision = await insertarIntento(c, { idExpediente, tipoEvento: TIPO_CADUCADO_ADMISION, estadoEnvio: "pendiente" });
    await transicionarExpediente(c, {
      idExpediente,
      campo: "estado",
      esperado: familia.estado,
      nuevo: ESTADO_CADUCADO,
      idPersonal: null,
      detalle: {
        motivo: "plazo_vencido",
        etapa: s.etapa,
        plazo_dias: plazos[s.etapa],
        vence: s.vence.toISOString(),
        vacante_devuelta: vacanteDevuelta,
        citas_canceladas: citas.canceladas,
        citas_con_cupo_devuelto: citas.cupos_devueltos,
        id_notificacion: idFamilia,
        id_notificacion_admision: idAdmision,
      },
    });
    const datos = { nombres: familia.nombres, campana: familia.campana_admision, etapa: s.etapa, vence: s.vence };
    return {
      id_expediente: idExpediente,
      avisos: [
        { id_expediente: idExpediente, id_notificacion: idFamilia, tipo_evento: TIPO_CADUCADO_FAMILIA, ...componerCaducidadFamilia(datos) },
        {
          id_expediente: idExpediente,
          id_notificacion: idAdmision,
          tipo_evento: TIPO_CADUCADO_ADMISION,
          ...componerCaducidadAdmision({ codigo: codigoExpediente(familia.campana_admision, idExpediente), campana: familia.campana_admision, etapa: s.etapa }),
        },
      ],
    };
  });
}

// POST /internal/expedientes/:id/recordatorio-inactividad (HU0018-1.0, R20), y la retoma del mismo aviso. Un solo
// recordatorio por período: sus intentos son las filas del tipo con fecha_envio ≥ el ancla de la etapa.
export async function reservarRecordatorioInactividad(idExpediente: number): Promise<AvisoSeguimiento> {
  const plazos = plazosVigentes();
  const r = await enTransaccion<Resultado<AvisoSeguimiento>>(async (c) => {
    const familia = await bloquearDatosFamilia(c, idExpediente);
    if (!familia) throw expedienteNoEncontrado();
    const s = await situacionDe(c, plazos, idExpediente);
    if (!s || s.caduca) return { conflicto: recordatorioNoCorresponde() };
    const tipoEvento = TIPO_RECORDATORIO_INACTIVIDAD;
    const decision = decidir(await bloquearIntentos(c, { idExpediente, tipoEvento, ancla: s.ancla, minutosReintento: MINUTOS_REINTENTO }));
    if (decision.accion === "cerrado" || decision.accion === "en_curso") return { conflicto: recordatorioYaRegistrado() };
    if (decision.accion === "nuevo" && !s.recordar) return { conflicto: recordatorioNoCorresponde() };
    if (decision.accion === "agotar") {
      await insertarIntento(c, { idExpediente, tipoEvento, estadoEnvio: "fallido" });
      return { conflicto: avisoAgotado() };
    }
    const idNotificacion = await insertarIntento(c, { idExpediente, tipoEvento, estadoEnvio: "pendiente" });
    const mensaje = componerRecordatorioInactividad({ nombres: familia.nombres, campana: familia.campana_admision, etapa: s.etapa, vence: s.vence });
    return { ok: { id_expediente: idExpediente, id_notificacion: idNotificacion, tipo_evento: tipoEvento, ...mensaje } };
  });
  return resolver(r);
}

// POST /internal/expedientes/:id/aviso-seguimiento { tipo_evento } (retoma de cada minuto). La caducidad es final: todas las
// filas del tipo son de ella.
export async function reservarAvisoSeguimiento(idExpediente: number, tipo: TipoAvisoSeguimiento): Promise<AvisoSeguimiento> {
  if (tipo === TIPO_RECORDATORIO_INACTIVIDAD) return reservarRecordatorioInactividad(idExpediente);
  const r = await enTransaccion<Resultado<AvisoSeguimiento>>(async (c) => {
    const familia = await bloquearDatosFamilia(c, idExpediente);
    if (!familia) throw expedienteNoEncontrado();
    const caducidad = await leerCaducidad(c, idExpediente);
    if (familia.estado !== ESTADO_CADUCADO || !caducidad || familia.campana_admision === CAMPANA_DEMO) return { conflicto: avisoNoCorresponde() };
    const decision = decidir(await bloquearIntentos(c, { idExpediente, tipoEvento: tipo, ancla: new Date(0), minutosReintento: MINUTOS_REINTENTO }));
    if (decision.accion === "cerrado" || decision.accion === "en_curso" || decision.accion === "nuevo") return { conflicto: avisoNoCorresponde() };
    if (decision.accion === "agotar") {
      await insertarIntento(c, { idExpediente, tipoEvento: tipo, estadoEnvio: "fallido" });
      return { conflicto: avisoAgotado() };
    }
    const idNotificacion = await insertarIntento(c, { idExpediente, tipoEvento: tipo, estadoEnvio: "pendiente" });
    const etapa = caducidad.etapa as EtapaSeguimiento | null;
    const mensaje =
      tipo === TIPO_CADUCADO_FAMILIA
        ? componerCaducidadFamilia({ nombres: familia.nombres, campana: familia.campana_admision, etapa, vence: caducidad.vence ? new Date(caducidad.vence) : null })
        : componerCaducidadAdmision({ codigo: codigoExpediente(familia.campana_admision, idExpediente), campana: familia.campana_admision, etapa });
    return { ok: { id_expediente: idExpediente, id_notificacion: idNotificacion, tipo_evento: tipo, ...mensaje } };
  });
  return resolver(r);
}
