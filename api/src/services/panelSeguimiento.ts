// Panel de seguimiento de la familia (P04, HU0020; ADR-29). No tiene reglas propias: compone lo que ya deciden R9, HU0017, P07 y
// P08, y las seis etapas del mockup son solo una lectura de esos estados. «En revisión» se deriva: rama `pendiente` con el
// expediente en `en_validacion` (`en_revision` sigue sin uso, ADR-23). Cada acción pendiente lleva a su pantalla (HU0020-2.0) y
// muestra el motivo vigente. La familia solo ve lo que ya se le notificó: Apto y En observación se muestran «En revisión» (D4-A).
// Solo lee: P04 es de la familia y no registra `atencion_*` (ADR-05).
import { obtenerPool } from "../db/pool";
import { EVENTOS_HISTORIAL, historialVisible } from "./historialFamilia";
import { listarHistorial } from "../repositories/auditoria";
import { leerCarta } from "../repositories/carta";
import type { ExpedienteDeFamilia } from "../repositories/expediente";
import { fichaEstaCompleta } from "../repositories/postulante";
import { leerCabecera, observacionesVigentes } from "../repositories/validacion";
import { verificacionVigente } from "./completitud";
import { leerCuota } from "./cuotaIngreso";
import { modoEvaluaciones } from "./evaluaciones";

export type EstadoEtapa = "completado" | "en_revision" | "observado" | "pendiente";
export type EstadoValidacion = "conforme" | "en_revision" | "observado" | "pendiente";

// Hasta qué punto del proceso llegó cada estado (las seis etapas del mockup). Los demás quedan en 0: `caducado` lo revisa HU0018 (C78).
const AVANCE: Readonly<Record<string, number>> = {
  portal_habilitado: 1,
  en_postulacion: 1,
  en_validacion: 2,
  en_evaluacion: 3,
  en_observacion: 4,
  apto: 4,
  no_apto: 5,
  lista_espera: 5,
  vacante_asignada: 5,
  carta_emitida: 6,
};

const AVISO_EVALUACIONES = "Tus evaluaciones se podrán agendar cuando se validen los documentos, el derecho de admisión y la documentación financiera.";

export interface AccionPendiente {
  tipo: "completar" | "subsanar" | "informacion";
  titulo: string;
  motivo?: string;
  destino?: string;
}

// El estado de una validación: una rama abierta en `en_validacion` está «en revisión».
function estadoValidacion(valor: string | null, avance: number): EstadoValidacion {
  if (avance < 2 || valor === null) return "pendiente";
  if (valor === "conforme" || valor === "observado") return valor;
  return avance === 2 ? "en_revision" : "pendiente";
}

// La etapa de una o más validaciones: mientras se validan, manda la peor; pasada la validación, se completó.
function etapaDeValidaciones(valores: EstadoValidacion[], avance: number): EstadoEtapa {
  if (avance < 2) return "pendiente";
  if (avance > 2 || valores.every((v) => v === "conforme")) return "completado";
  return valores.includes("observado") ? "observado" : "en_revision";
}

function etapaCuotaYCarta(estado: string, estadoPago: string | null): EstadoEtapa {
  if (estado === "carta_emitida") return "completado";
  if (estado !== "vacante_asignada") return "pendiente";
  if (estadoPago === "observado") return "observado";
  return estadoPago === null ? "pendiente" : "en_revision";
}

const parentescoDe = (parentesco: string | null) => (parentesco ? ` (${parentesco})` : "");

export async function leerPanel(e: ExpedienteDeFamilia) {
  const db = obtenerPool();
  const { id_expediente: id, estado } = e;
  const avance = AVANCE[estado] ?? 0;
  const [cabecera, fichaCompleta, observaciones, verificacion, cuota, modo, carta, eventos] = await Promise.all([
    leerCabecera(db, id),
    e.id_postulante ? fichaEstaCompleta(db, e.id_postulante) : false,
    observacionesVigentes(db, id),
    verificacionVigente(db, id),
    leerCuota(e),
    modoEvaluaciones(db, e),
    leerCarta(db, id),
    listarHistorial(db, id, EVENTOS_HISTORIAL),
  ]);
  const validaciones = {
    documental: estadoValidacion(cabecera!.estado_documental, avance),
    financiera: estadoValidacion(cabecera!.estado_financiero, avance),
    derecho: estadoValidacion(cabecera!.estado_derecho, avance),
  };

  const etapas: { clave: string; titulo: string; estado: EstadoEtapa }[] = [
    { clave: "ficha", titulo: "Ficha y cuestionario", estado: fichaCompleta ? "completado" : "pendiente" },
    { clave: "documentos", titulo: "Documentos", estado: etapaDeValidaciones([validaciones.documental], avance) },
    { clave: "pagos", titulo: "Pagos y doc. financiera", estado: etapaDeValidaciones([validaciones.financiera, validaciones.derecho], avance) },
    { clave: "evaluaciones", titulo: "Evaluaciones", estado: avance > 3 ? "completado" : avance === 3 ? "en_revision" : "pendiente" },
    { clave: "resultado", titulo: "Resultado", estado: avance > 4 ? "completado" : avance === 4 ? "en_revision" : "pendiente" },
    { clave: "carta", titulo: "Cuota y carta", estado: etapaCuotaYCarta(estado, cuota.pago?.estado ?? null) },
  ];

  const acciones: AccionPendiente[] = [];
  if (avance === 1 && !fichaCompleta) acciones.push({ tipo: "completar", titulo: "Completa la ficha y el cuestionario", destino: "/portal/ficha" });
  if (estado === "en_postulacion" && fichaCompleta) {
    // Si la última verificación solo encontró que falta el derecho, no hay documentos que cargar.
    const soloFaltaDerecho = verificacion?.faltantes.length === 0 && verificacion.falta_derecho;
    if (!soloFaltaDerecho) acciones.push({ tipo: "completar", titulo: "Carga y confirma tus documentos", destino: "/portal/documentos" });
    if (cabecera!.estado_derecho === null) acciones.push({ tipo: "completar", titulo: "Registra el comprobante del derecho de admisión", destino: "/portal/pagos/derecho-admision" });
  }
  for (const d of observaciones.documentos) {
    const area = d.categoria === "financiero" ? "Tesorería observó tu documentación financiera" : "Secretaría observó un documento";
    acciones.push({ tipo: "subsanar", titulo: `${area}: ${d.tipo_documento}${parentescoDe(d.parentesco)}`, motivo: d.motivo, destino: "/portal/documentos" });
  }
  if (observaciones.derecho) {
    acciones.push({ tipo: "subsanar", titulo: "Tesorería observó tu comprobante del derecho de admisión", motivo: observaciones.derecho, destino: "/portal/pagos/derecho-admision" });
  }
  if (observaciones.cuota) {
    acciones.push({ tipo: "subsanar", titulo: "Tesorería observó el comprobante de tu cuota de ingreso", motivo: observaciones.cuota, destino: "/portal/pagos" });
  }
  if (estado === "en_validacion") {
    if (modo === "agendar") acciones.push({ tipo: "completar", titulo: "Agenda tus evaluaciones", destino: "/portal/evaluaciones" });
    else acciones.push({ tipo: "informacion", titulo: AVISO_EVALUACIONES });
  }
  if (estado === "vacante_asignada" && cuota.aplica) {
    if (cuota.modalidad_editable && cuota.modalidad === null) acciones.push({ tipo: "completar", titulo: "Elige la modalidad de pago de la cuota de ingreso", destino: "/portal/pagos" });
    else if (cuota.registrable) acciones.push({ tipo: "completar", titulo: "Registra el comprobante de la cuota de ingreso", destino: "/portal/pagos" });
    else if (cuota.pago?.estado === "pendiente") acciones.push({ tipo: "informacion", titulo: "Tesorería está conciliando tu comprobante. La Carta de Vacante se emite al conciliarlo." });
  }

  return {
    etapas,
    validaciones,
    acciones,
    historial: historialVisible(eventos),
    carta: { disponible: carta !== null, fecha_emision: carta?.fecha_emision.toISOString() ?? null },
  };
}
