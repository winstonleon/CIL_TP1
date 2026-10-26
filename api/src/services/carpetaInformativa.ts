// Carpeta informativa de admisión (HU0002-1.0, ADR-18): textos del correo y armado del mensaje.
// - El correo lleva un ENLACE a la carpeta (CARPETA_INFORMATIVA_URL), no un adjunto: no depende de Drive (ADR-12).
// - Lo que redacta el colegio va entre corchetes hasta que lo entregue (C33), como la política de privacidad (C29).
// - Lo arma la API porque notificacion-multicanal no redacta mensajes (su contrato) y n8n no tiene la clave del enlace.
import { obtenerConfig } from "../config";
import { crearTokenVisita } from "../crypto/enlaceVisita";

export const CARPETA_INFORMATIVA = {
  version: "borrador-1",
  presentacion: "[Presentación de la carpeta informativa: por definir con el colegio]",
  contacto: "[Datos de contacto de Admisión: por definir con el colegio]",
  sinEnlace: "[Enlace a la carpeta informativa: por definir con el colegio]",
} as const;

export interface DatosCarpeta {
  nombres: string;
  nombreGrado: string;
  campana: string;
  enlaceVisita: string;
  urlCarpeta?: string; // vacía hasta que el colegio entregue la carpeta (C33)
}

// Texto plano: notificacion-multicanal envía el correo con emailFormat "text".
export function componerCarpeta(d: DatosCarpeta): { asunto: string; cuerpo: string } {
  return {
    asunto: `Carpeta informativa · Admisión ${d.campana}`,
    cuerpo: [
      `Hola, ${d.nombres}:`,
      "",
      CARPETA_INFORMATIVA.presentacion,
      "",
      `Grado de interés: ${d.nombreGrado}`,
      `Carpeta informativa: ${d.urlCarpeta ?? CARPETA_INFORMATIVA.sinEnlace}`,
      `Agenda tu visita guiada: ${d.enlaceVisita}`,
      "",
      CARPETA_INFORMATIVA.contacto,
    ].join("\n"),
  };
}

// Enlace de P02 (pantalla de HU0003, C31): ${FRONTEND_PUBLIC_URL}/visita-guiada?t=<token>.
export function enlaceVisita(idExpediente: number): string {
  const base = obtenerConfig().FRONTEND_PUBLIC_URL.replace(/\/+$/, "");
  return `${base}/visita-guiada?t=${crearTokenVisita(idExpediente)}`;
}
