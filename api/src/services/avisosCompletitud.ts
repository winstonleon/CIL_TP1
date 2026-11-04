// Texto del aviso de documentos faltantes (HU0017-2.0; ADR-19 y ADR-22). Lo que redacta el colegio va entre corchetes
// hasta que lo entregue, como los avisos de la visita. Lo arma la API porque notificacion-multicanal no redacta
// mensajes. Los apoderados se nombran por su parentesco, nunca por su nombre: el cuerpo queda en las ejecuciones de
// error de n8n (C11). Texto plano.
import { obtenerConfig } from "../config";

export const AVISO_COMPLETITUD = {
  version: "borrador-1",
  introduccion: "[Aviso de documentos pendientes: por definir con el colegio]",
  contacto: "[Datos de contacto de Admisión: por definir con el colegio]",
  derecho: "Comprobante del derecho de admisión",
} as const;

const base = () => obtenerConfig().FRONTEND_PUBLIC_URL.replace(/\/+$/, "");
export const urlDocumentos = () => `${base()}/portal/documentos`;
export const urlDerechoAdmision = () => `${base()}/portal/pagos/derecho-admision`;

// «Boletas de pago (padre)»: el parentesco solo en los requisitos por apoderado.
export const nombreFaltante = (f: { tipo_documento: string; parentesco: string | null }) =>
  f.parentesco ? `${f.tipo_documento} (${f.parentesco})` : f.tipo_documento;

export function componerFaltantes(d: {
  nombres: string;
  campana: string;
  faltantes: { tipo_documento: string; parentesco: string | null }[];
  faltaDerecho: boolean;
}): { asunto: string; cuerpo: string } {
  const lista = [...d.faltantes.map(nombreFaltante), ...(d.faltaDerecho ? [AVISO_COMPLETITUD.derecho] : [])];
  return {
    asunto: `Documentos pendientes · Admisión ${d.campana}`,
    cuerpo: [
      `Hola, ${d.nombres}:`,
      "",
      AVISO_COMPLETITUD.introduccion,
      "",
      "Para continuar con la postulación falta:",
      ...lista.map((l) => `- ${l}`),
      "",
      `Carga los documentos en el portal: ${urlDocumentos()}`,
      ...(d.faltaDerecho ? [`Registra el derecho de admisión: ${urlDerechoAdmision()}`] : []),
      "",
      "Cuando termines, vuelve a presionar «Confirmar documentos».",
      "",
      AVISO_COMPLETITUD.contacto,
    ].join("\n"),
  };
}
