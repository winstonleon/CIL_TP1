// Textos de los avisos de la visita guiada (HU0003 y HU0004; ADR-19, A9): confirmación, recordatorio, invitación a
// reprogramar y credenciales del portal. Lo que redacta el colegio va entre corchetes hasta que lo entregue (C39), como
// la carpeta informativa (ADR-18). Los arma la API porque notificacion-multicanal no redacta mensajes. Texto plano.
import { obtenerConfig } from "../config";

export const AVISOS_VISITA = {
  version: "borrador-1",
  confirmacion: "[Confirmación de la visita guiada: por definir con el colegio]",
  recordatorio: "[Recordatorio de la visita guiada: por definir con el colegio]",
  reprogramacion: "[Invitación a reprogramar la visita guiada: por definir con el colegio]",
  credenciales: "[Bienvenida al portal de postulación: por definir con el colegio]",
  contacto: "[Datos de contacto de Admisión: por definir con el colegio]",
  sinDireccion: "[Dirección del colegio]",
} as const;

// «Lugar» de P02 y de los correos: DIRECCION_COLEGIO, o el texto entre corchetes del mockup mientras esté vacía (C39).
export function lugarDeLaVisita(): string {
  return obtenerConfig().DIRECCION_COLEGIO ?? AVISOS_VISITA.sinDireccion;
}

const DIAS = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

// «2026-11-05» → «jueves 5 de noviembre de 2026». La fecha ya es de Lima: se calcula en UTC para no correrla.
export function fechaLarga(fecha: string): string {
  const d = new Date(`${fecha}T00:00:00Z`);
  return `${DIAS[d.getUTCDay()]} ${d.getUTCDate()} de ${MESES[d.getUTCMonth()]} de ${d.getUTCFullYear()}`;
}

// «10:00» → «10:00 a. m.», «12:30» → «12:30 p. m.», como el mockup P02.
export function horaVisible(hora: string): string {
  const [h, m] = hora.split(":").map(Number) as [number, number];
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, "0")} ${h < 12 ? "a. m." : "p. m."}`;
}

export interface DatosVisita {
  nombres: string;
  campana: string;
  fecha: string;
  hora: string;
  asistentes: string;
}

function detalleVisita(d: DatosVisita): string[] {
  return [`Fecha: ${fechaLarga(d.fecha)}`, `Hora: ${horaVisible(d.hora)}`, `Lugar: ${lugarDeLaVisita()}`, `Asistentes: ${d.asistentes}`];
}

// HU0003-1.0: confirmación de la reserva.
export function componerConfirmacion(d: DatosVisita): { asunto: string; cuerpo: string } {
  return {
    asunto: `Visita guiada confirmada · Admisión ${d.campana}`,
    cuerpo: [`Hola, ${d.nombres}:`, "", AVISOS_VISITA.confirmacion, "", ...detalleVisita(d), "", AVISOS_VISITA.contacto].join("\n"),
  };
}

// HU0003-1.0: recordatorio previo a la visita (D4).
export function componerRecordatorio(d: DatosVisita): { asunto: string; cuerpo: string } {
  return {
    asunto: `Recordatorio de tu visita guiada · Admisión ${d.campana}`,
    cuerpo: [`Hola, ${d.nombres}:`, "", AVISOS_VISITA.recordatorio, "", ...detalleVisita(d), "", AVISOS_VISITA.contacto].join("\n"),
  };
}

// HU0004-2.0: invitación a reprogramar, con un enlace de P02 (por comodidad: el de la carpeta vuelve a valer, ADR-18).
export function componerReprogramacion(d: { nombres: string; campana: string; enlaceVisita: string }): { asunto: string; cuerpo: string } {
  return {
    asunto: `Reprograma tu visita guiada · Admisión ${d.campana}`,
    cuerpo: [
      `Hola, ${d.nombres}:`,
      "",
      AVISOS_VISITA.reprogramacion,
      "",
      `Si aún te interesa conocer el colegio, agenda una nueva visita: ${d.enlaceVisita}`,
      "",
      AVISOS_VISITA.contacto,
    ].join("\n"),
  };
}

// HU0004-1.0: credenciales temporales y enlace al portal (D3). La contraseña solo vive en este texto, que la API
// devuelve a n8n y no guarda.
export function componerCredenciales(d: {
  nombres: string;
  campana: string;
  usuario: string;
  contrasena: string;
  urlPortal: string;
}): { asunto: string; cuerpo: string } {
  return {
    asunto: `Acceso al portal de postulación · Admisión ${d.campana}`,
    cuerpo: [
      `Hola, ${d.nombres}:`,
      "",
      AVISOS_VISITA.credenciales,
      "",
      `Portal de postulación: ${d.urlPortal}`,
      `Usuario: ${d.usuario}`,
      `Contraseña temporal: ${d.contrasena}`,
      "",
      "Al ingresar por primera vez, el portal te pedirá crear una contraseña nueva.",
      "Si recibes más de un correo, usa el más reciente.",
      "",
      AVISOS_VISITA.contacto,
    ].join("\n"),
  };
}

// Enlace al portal de familias (cliente portal-familias): la pantalla /portal inicia sesión en Keycloak.
export function urlPortal(): string {
  return `${obtenerConfig().FRONTEND_PUBLIC_URL.replace(/\/+$/, "")}/portal`;
}
