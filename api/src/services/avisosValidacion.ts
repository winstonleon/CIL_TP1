// Texto del aviso de observaciones de las validaciones (HU0008-2.0, HU0011-2.0 y HU0024-2.0; ADR-19). Lo que redacta el
// colegio va entre corchetes hasta que lo entregue, como el aviso de faltantes de HU0017. Lo arma la API porque
// notificacion-multicanal no redacta mensajes. Lista todas las observaciones vigentes del expediente con su motivo: el
// aviso de una observación nueva incluye las anteriores que siguen abiertas. Los apoderados se nombran por su parentesco,
// nunca por su nombre. El motivo lo escribe el personal y queda en las ejecuciones de error de n8n (C11): riesgo aceptado
// por John (04/11/2026), con el texto de ayuda de G03 y G05. Texto plano.
import { nombreFaltante, urlDerechoAdmision, urlDocumentos } from "./avisosCompletitud";
import { urlPagos } from "./avisosVacante";

export const AVISO_VALIDACION = {
  version: "borrador-1",
  introduccion: "[Aviso de observaciones del expediente: por definir con el colegio]",
  contacto: "[Datos de contacto de Admisión: por definir con el colegio]",
  derecho: "Comprobante del derecho de admisión",
  cuota: "Comprobante de la cuota de ingreso",
} as const;

export function componerObservaciones(d: {
  nombres: string;
  campana: string;
  documentos: { tipo_documento: string; parentesco: string | null; motivo: string }[];
  derecho: string | null; // motivo de la observación del comprobante, si está observado
  cuota?: string | null; // HU0015-2.0: motivo de la observación del comprobante de la cuota
}): { asunto: string; cuerpo: string } {
  const lista = [
    ...d.documentos.map((o) => `- ${nombreFaltante(o)}: ${o.motivo}`),
    ...(d.derecho !== null ? [`- ${AVISO_VALIDACION.derecho}: ${d.derecho}`] : []),
    ...(d.cuota ? [`- ${AVISO_VALIDACION.cuota}: ${d.cuota}`] : []),
  ];
  return {
    asunto: `Observaciones en tu expediente · Admisión ${d.campana}`,
    cuerpo: [
      `Hola, ${d.nombres}:`,
      "",
      AVISO_VALIDACION.introduccion,
      "",
      "Revisamos tu expediente y encontramos estas observaciones:",
      ...lista,
      "",
      ...(d.documentos.length ? [`Reemplaza solo los documentos observados en el portal: ${urlDocumentos()}`] : []),
      ...(d.derecho !== null ? [`Regulariza el pago del derecho de admisión: ${urlDerechoAdmision()}`] : []),
      ...(d.cuota ? [`Regulariza el pago de la cuota de ingreso: ${urlPagos()}`] : []),
      "",
      AVISO_VALIDACION.contacto,
    ].join("\n"),
  };
}
