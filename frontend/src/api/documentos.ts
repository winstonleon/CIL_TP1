// Llamadas de P06 (HU0006) a /familia/expedientes/:id/documentos. Pasan por el cliente único llamarApi con el cliente
// `portal` (rules/frontend.md). Los archivos se suben como multipart con los campos antes del archivo y se descargan con
// el token: la API no publica ninguna URL del almacenamiento (ADR-21).
import { llamarApi } from "./cliente";
import { json, respuesta } from "./respuesta";
import type { Requisito } from "./ficha";

export interface DocumentoCargado {
  id_documento: number;
  formato: "pdf" | "jpg" | "png";
  tamano_kb: number;
  fecha_carga: string; // ISO 8601
  estado_verificacion: "pendiente" | "en_revision" | "conforme" | "observado";
  // A1 (bloque 5): el motivo vigente si está observado; el de una observación ya subsanada, como «motivo anterior».
  motivo_observacion?: string | null;
  motivo_anterior?: string | null;
}

export interface RequisitoConDocumentos extends Requisito {
  documentos: DocumentoCargado[];
}

// HU0017 (ADR-22): resultado de la verificación de completitud de la última confirmación. Los faltantes se nombran por
// tipo de documento y, si es por apoderado, por su parentesco.
export interface VerificacionCompletitud {
  resultado: "completo" | "incompleto";
  verificado_en: string; // ISO 8601
  faltantes: { tipo_documento: string; parentesco: string | null }[];
  falta_derecho: boolean;
}

export interface ListaDocumentos {
  editable: boolean;
  subsanacion?: boolean; // en_validacion: solo se reemplazan los documentos observados (HU0008-2.0 y HU0011-2.0)
  confirmado_en: string | null;
  verificacion?: VerificacionCompletitud | null;
  requisitos: RequisitoConDocumentos[];
}

export interface DatosCarga {
  id_requisito: number;
  id_apoderado: number | null;
  reemplaza?: number;
}

const ruta = (id: number, parte = "") => `/familia/expedientes/${id}/documentos${parte}`;

export async function listarDocumentos(id: number): Promise<ListaDocumentos> {
  return respuesta(await llamarApi("portal", ruta(id)));
}

export async function subirDocumento(id: number, datos: DatosCarga, archivo: File): Promise<DocumentoCargado> {
  const formulario = new FormData();
  // La API exige los campos antes del archivo.
  formulario.append("id_requisito", String(datos.id_requisito));
  if (datos.id_apoderado !== null) formulario.append("id_apoderado", String(datos.id_apoderado));
  if (datos.reemplaza !== undefined) formulario.append("reemplaza", String(datos.reemplaza));
  formulario.append("archivo", archivo);
  return respuesta(await llamarApi("portal", ruta(id), { method: "POST", body: formulario }));
}

export async function confirmarDocumentos(id: number): Promise<{ confirmado_en: string }> {
  return respuesta(await llamarApi("portal", ruta(id, "/confirmacion"), json("POST", {})));
}

// El archivo llega ya verificado por la API; se abre desde un blob en memoria.
export async function descargarDocumento(id: number, idDocumento: number): Promise<Blob> {
  const res = await llamarApi("portal", ruta(id, `/${idDocumento}/archivo`));
  if (!res.ok) await respuesta(res);
  return res.blob();
}
