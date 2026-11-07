// Texto del aviso de la Carta de Vacante (HU0016-1.0; ADR-19): lo que redacta el colegio va entre corchetes. Lo arma la API
// porque notificacion-multicanal no redacta mensajes. La carta lleva el nombre de un menor y la firma de la Directora: no
// viaja por correo ni por n8n. El aviso lleva solo el enlace al portal, donde se descarga con sesión (D1-A). El cuerpo queda
// en las ejecuciones de error de n8n (C11), así que no lleva datos del menor. Texto plano.
import { obtenerConfig } from "../config";

export const AVISO_CARTA = {
  version: "borrador-1",
  carta: "[Aviso de Carta de Vacante emitida: por definir con el colegio]",
  contacto: "[Datos de contacto de Admisión: por definir con el colegio]",
} as const;

export const urlPanel = () => `${obtenerConfig().FRONTEND_PUBLIC_URL.replace(/\/+$/, "")}/portal/panel`;

export function componerCartaEmitida(d: { nombres: string; campana: string }): { asunto: string; cuerpo: string } {
  return {
    asunto: `Carta de Vacante emitida · Admisión ${d.campana}`,
    cuerpo: [
      `Hola, ${d.nombres}:`,
      "",
      AVISO_CARTA.carta,
      "",
      `La Carta de Vacante ya está emitida. Descárgala en el portal, con tu usuario y contraseña: ${urlPanel()}`,
      "",
      AVISO_CARTA.contacto,
    ].join("\n"),
  };
}
