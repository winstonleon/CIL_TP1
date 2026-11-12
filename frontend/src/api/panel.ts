// Llamadas de P04 (HU0020 y HU0016) a /familia/expedientes/:id. Pasan por el cliente único llamarApi con el cliente `portal`
// (rules/frontend.md). La carta se descarga con el token: la API no publica ninguna URL del almacenamiento (ADR-21 y ADR-28).
import { llamarApi } from "./cliente";
import { respuesta } from "./respuesta";

export type EstadoEtapa = "completado" | "en_revision" | "observado" | "pendiente";
export type EstadoValidacion = "conforme" | "en_revision" | "observado" | "pendiente";

export interface Etapa {
  clave: string;
  titulo: string;
  estado: EstadoEtapa;
}

export interface AccionPendiente {
  tipo: "completar" | "subsanar" | "informacion";
  titulo: string;
  motivo?: string;
  destino?: string;
}

export interface PanelSeguimiento {
  etapas: Etapa[];
  validaciones: { documental: EstadoValidacion; financiera: EstadoValidacion; derecho: EstadoValidacion };
  acciones: AccionPendiente[];
  historial: { fecha: string; texto: string }[];
  carta: { disponible: boolean; fecha_emision: string | null };
  // HU0018-2.0 (C78): la postulación caducó por vencimiento del plazo; null si no.
  caducidad?: { fecha: string | null; accion: string | null } | null;
}

export async function leerPanel(id: number): Promise<PanelSeguimiento> {
  return respuesta(await llamarApi("portal", `/familia/expedientes/${id}/panel`));
}

export async function descargarCarta(id: number): Promise<Blob> {
  const res = await llamarApi("portal", `/familia/expedientes/${id}/carta`);
  if (!res.ok) await respuesta(res);
  return res.blob();
}
