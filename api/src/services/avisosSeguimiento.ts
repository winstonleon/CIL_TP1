// Textos de los avisos del seguimiento programado (HU0018; ADR-19): recordatorio por inactividad (R20) y caducidad (R21),
// a la familia y al buzón de admisión. Lo que redacta el colegio va entre corchetes hasta que lo entregue. Los arma la API
// porque notificacion-multicanal no redacta mensajes. El cuerpo queda en las ejecuciones de error de n8n (C11): no lleva
// datos del menor ni el motivo de una observación, solo la acción pendiente, la fecha límite y el enlace. Texto plano.
import { obtenerConfig } from "../config";
import type { EtapaSeguimiento } from "../repositories/seguimiento";

export const AVISOS_SEGUIMIENTO = {
  version: "borrador-1",
  recordatorio: "[Recordatorio de acción pendiente: por definir con el colegio]",
  caducidad: "[Aviso de postulación caducada: por definir con el colegio]",
  caducidadAdmision: "[Aviso al personal de admisión de un expediente caducado: por definir con el colegio]",
  contacto: "[Datos de contacto de Admisión: por definir con el colegio]",
} as const;

// La acción pendiente de cada etapa, para el correo y para P04.
export const ACCION_DE_ETAPA: Readonly<Record<EtapaSeguimiento, string>> = {
  postulacion: "completar la ficha de inscripción, cargar tus documentos y registrar el derecho de admisión",
  subsanacion: "subsanar las observaciones de tu expediente",
  agendamiento: "agendar tus evaluaciones",
  reprogramacion: "reprogramar tu evaluación académica",
  cuota: "registrar el comprobante de la cuota de ingreso",
};

export const ETAPA_VISIBLE: Readonly<Record<EtapaSeguimiento, string>> = {
  postulacion: "Postulación (ficha, documentos y derecho de admisión)",
  subsanacion: "Subsanación de observaciones",
  agendamiento: "Agendamiento de las evaluaciones",
  reprogramacion: "Reprogramación de la evaluación académica",
  cuota: "Cuota de ingreso",
};

const urlPanel = () => `${obtenerConfig().FRONTEND_PUBLIC_URL.replace(/\/+$/, "")}/portal/panel`;

// Fecha en días de Lima, p. ej. «14/11/2026».
export const fechaLima = (d: Date) =>
  new Intl.DateTimeFormat("es-PE", { timeZone: "America/Lima", day: "2-digit", month: "2-digit", year: "numeric" }).format(d);

// HU0018-1.0: la acción pendiente, la fecha límite de la etapa y el enlace directo al expediente.
export function componerRecordatorioInactividad(d: { nombres: string; campana: string; etapa: EtapaSeguimiento; vence: Date }) {
  return {
    asunto: `Tienes una acción pendiente · Admisión ${d.campana}`,
    cuerpo: [
      `Hola, ${d.nombres}:`,
      "",
      AVISOS_SEGUIMIENTO.recordatorio,
      "",
      `Acción pendiente: ${ACCION_DE_ETAPA[d.etapa]}.`,
      `Fecha límite: ${fechaLima(d.vence)}. Si vence sin completarla, tu postulación caducará.`,
      `Tu expediente: ${urlPanel()}`,
      "",
      AVISOS_SEGUIMIENTO.contacto,
    ].join("\n"),
  };
}

// HU0018-2.0, a la familia.
export function componerCaducidadFamilia(d: { nombres: string; campana: string; etapa: EtapaSeguimiento | null; vence: Date | null }) {
  const plazo = d.etapa ? `Venció el plazo para ${ACCION_DE_ETAPA[d.etapa]}${d.vence ? ` (${fechaLima(d.vence)})` : ""}.` : "Venció el plazo de la etapa.";
  return {
    asunto: `Postulación caducada · Admisión ${d.campana}`,
    cuerpo: [
      `Hola, ${d.nombres}:`,
      "",
      AVISOS_SEGUIMIENTO.caducidad,
      "",
      `${plazo} Tu postulación caducó y se liberaron el cupo o la vacante que tenía reservados.`,
      `Puedes ver tu expediente en el portal: ${urlPanel()}`,
      "",
      AVISOS_SEGUIMIENTO.contacto,
    ].join("\n"),
  };
}

// HU0018-2.0, al buzón del personal de admisión (CORREO_ADMISION): solo el código del expediente y la etapa (C11).
export function componerCaducidadAdmision(d: { codigo: string; campana: string; etapa: EtapaSeguimiento | null }) {
  return {
    asunto: `Expediente caducado ${d.codigo} · Admisión ${d.campana}`,
    cuerpo: [
      AVISOS_SEGUIMIENTO.caducidadAdmision,
      "",
      `El expediente ${d.codigo} caducó por vencimiento del plazo.`,
      `Etapa: ${d.etapa ? ETAPA_VISIBLE[d.etapa] : "[sin etapa registrada]"}.`,
      "Se liberaron el cupo o la vacante que tenía reservados.",
    ].join("\n"),
  };
}
