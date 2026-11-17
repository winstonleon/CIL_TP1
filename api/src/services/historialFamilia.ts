// Historial del panel de seguimiento (P04, HU0020-1.0; ADR-29). Es una LISTA BLANCA: cada evento visible de la bitácora se
// traduce a un texto fijo, y lo que no está aquí se omite. `detalle` nunca llega al cliente: la respuesta es solo fecha y texto.
// Los actores van por área, nunca por nombre. No aparecen conclusiones, observaciones de las evaluaciones, ni el motivo de una
// observación (va en «Acciones pendientes»). Apto y En observación no se nombran: la familia solo ve lo que ya se le notificó
// (D4-A; ADR-25, D3-A). Textos por confirmar con el colegio (C76).
import type { EventoHistorial } from "../repositories/auditoria";
import { DERECHO_ADMISION } from "./configuracion";

export const EVENTOS_HISTORIAL = [
  "transicion_estado",
  "atencion_fin",
  "documentos_confirmados",
  "completitud_verificada",
  "subsanacion_registrada",
  "cita_reprogramada",
  "cuota_registrada",
] as const;

export const TRANSICIONES: Readonly<Record<string, string>> = {
  portal_habilitado: "Se habilitó tu acceso al portal",
  en_postulacion: "Iniciaste la ficha de inscripción",
  en_validacion: "Expediente completo: pasó a revisión de secretaría",
  en_evaluacion: "Confirmaste las citas de tus evaluaciones",
  vacante_asignada: "Se otorgó la vacante",
  lista_espera: "Tu postulante pasó a la lista de espera",
  no_apto: "El proceso de admisión concluyó",
  carta_emitida: "Se emitió la Carta de Vacante",
  caducado: "Tu postulación caducó por vencimiento del plazo", // HU0018-2.0 (C78): ya se le notificó
};

export const DECISIONES: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  validacion_documental: { conforme: "Secretaría dio conformidad a tus documentos", observado: "Secretaría observó un documento" },
  documentacion_financiera: { conforme: "Tesorería validó la documentación financiera", observado: "Tesorería observó la documentación financiera" },
  derecho_admision: {
    conforme: `Tesorería validó el derecho de admisión (S/ ${DERECHO_ADMISION})`,
    observado: `Tesorería observó el derecho de admisión (S/ ${DERECHO_ADMISION})`,
  },
  cuota_ingreso: { conforme: "Tesorería concilió la cuota de ingreso", observado: "Tesorería observó la cuota de ingreso" },
};

// El texto del evento, o null si la familia no debe verlo.
export function textoDeEvento(e: EventoHistorial): string | null {
  switch (e.tipo_evento) {
    case "transicion_estado":
      return e.campo === "estado" && e.estado_nuevo ? (TRANSICIONES[e.estado_nuevo] ?? null) : null;
    case "atencion_fin":
      return DECISIONES[(e.item === "pago" ? e.tipo_pago : e.item) ?? ""]?.[e.decision ?? ""] ?? null;
    case "documentos_confirmados":
      return e.documentos === null ? "Cargaste tus documentos" : `Cargaste ${e.documentos} ${e.documentos === "1" ? "documento" : "documentos"}`;
    case "completitud_verificada":
      return e.resultado === "incompleto" ? "Tu expediente aún está incompleto" : null;
    case "subsanacion_registrada":
      return e.item === "pago" ? "Subsanaste un comprobante" : "Subsanaste un documento";
    case "cita_reprogramada":
      return "Reprogramaste una cita";
    case "cuota_registrada":
      return "Registraste el comprobante de la cuota de ingreso";
    default:
      return null;
  }
}

export function historialVisible(eventos: EventoHistorial[]): { fecha: string; texto: string }[] {
  return eventos.flatMap((e) => {
    const texto = textoDeEvento(e);
    return texto ? [{ fecha: e.fecha_hora.toISOString(), texto }] : [];
  });
}
