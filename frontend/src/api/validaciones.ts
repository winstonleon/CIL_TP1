// Llamadas de G02 y G03 (Secretaría, /bandeja) y G05 (Tesorería, /tesoreria) para las validaciones en paralelo (HU0008,
// HU0011 y HU0024). Pasan por el cliente único llamarApi con el cliente `gestion` (rules/frontend.md). Los archivos se
// descargan con el token: la API no publica ninguna URL del almacenamiento (ADR-21).
import { llamarApi } from "./cliente";
import { json, respuesta } from "./respuesta";

export type EstadoRevision = "pendiente" | "en_revision" | "conforme" | "observado";

export interface Ramas {
  documental: EstadoRevision;
  financiera: EstadoRevision;
  derecho: EstadoRevision | null;
}

export interface Persona {
  nombres: string | null;
  apellidos: string | null;
}

// ---- G02 · bandeja de expedientes

export type VistaBandeja = "por_revisar" | "observados" | "todos";

export interface FilaBandeja {
  id_expediente: number;
  codigo: string;
  postulante: Persona;
  apoderado: Persona;
  grado: { id_grado: number; nombre_grado: string };
  estado_documental: EstadoRevision;
  subsanado: boolean;
  motivos_anteriores: string[]; // de las observaciones ya subsanadas que esperan revisión
  ultima_actividad: string | null;
  en_validacion_desde: string | null;
}

export interface Bandeja {
  conteos: Record<VistaBandeja, number>;
  expedientes: FilaBandeja[];
}

export interface FiltrosBandeja {
  vista: VistaBandeja;
  grado?: number;
  q?: string;
  orden: "antiguos" | "recientes";
}

export async function listarBandeja(f: FiltrosBandeja): Promise<Bandeja> {
  const p = new URLSearchParams({ vista: f.vista, orden: f.orden });
  if (f.grado) p.set("grado", String(f.grado));
  if (f.q?.trim()) p.set("q", f.q.trim());
  return respuesta(await llamarApi("gestion", `/bandeja/expedientes?${p}`));
}

// ---- G03 y G05 · documentos de una rama

export interface DocumentoRevision {
  id_documento: number;
  id_requisito: number;
  tipo_documento: string;
  categoria: string;
  parentesco: string | null;
  formato: "pdf" | "jpg" | "png";
  tamano_kb: number;
  fecha_carga: string;
  estado_verificacion: EstadoRevision;
  motivo_observacion: string | null;
  motivo_anterior: string | null;
}

export interface DetalleRama {
  id_expediente: number;
  codigo: string;
  grado: string;
  postulante: Persona;
  apoderado: Persona & { telefono?: string };
  ramas: Ramas;
  agendamiento_habilitado: boolean;
  condiciones_laborales?: { parentesco: string; condicion_laboral: string | null }[];
  documentos: DocumentoRevision[];
}

export type Decision = { decision: "conforme" } | { decision: "observado"; motivo: string };

export interface ResultadoConformidad {
  rama: "conforme";
  agendamiento_habilitado: boolean;
}

export type Rama = "documental" | "financiera";

const base = (rama: Rama, id: number) => (rama === "documental" ? `/bandeja/expedientes/${id}` : `/tesoreria/expedientes/${id}`);

// Abrir el detalle registra atencion_inicio en la API (§4.7).
export async function leerDetalle(rama: Rama, id: number): Promise<DetalleRama> {
  return respuesta(await llamarApi("gestion", rama === "documental" ? base(rama, id) : `${base(rama, id)}/documentacion-financiera`));
}

export async function decidirDocumento(rama: Rama, id: number, idDocumento: number, d: Decision): Promise<void> {
  await respuesta(await llamarApi("gestion", `${base(rama, id)}/documentos/${idDocumento}/decision`, json("POST", d)));
}

export async function darConformidad(rama: Rama, id: number): Promise<ResultadoConformidad> {
  const parte = rama === "documental" ? "validacion-documental" : "validacion-financiera";
  return respuesta(await llamarApi("gestion", `${base(rama, id)}/${parte}`, json("POST", {})));
}

async function blob(res: Response): Promise<Blob> {
  if (!res.ok) await respuesta(res);
  return res.blob();
}

export async function descargarDocumento(rama: Rama, id: number, idDocumento: number): Promise<Blob> {
  return blob(await llamarApi("gestion", `${base(rama, id)}/documentos/${idDocumento}/archivo`));
}

// ---- G05 · lista de Tesorería y comprobante del derecho

export type VistaTesoreria = "todo" | "derecho" | "financiera";

export interface ItemTesoreria {
  concepto: "documentacion_financiera" | "derecho_admision";
  id_expediente: number;
  id_pago: number | null;
  codigo: string;
  postulante: Persona;
  grado: string;
  monto: number | null;
  estado: EstadoRevision;
  subsanado: boolean;
  motivos_anteriores: string[];
  recibido: string | null;
}

export interface ListaTesoreria {
  conteos: Record<VistaTesoreria, number>;
  items: ItemTesoreria[];
}

export async function listarTesoreria(vista: VistaTesoreria): Promise<ListaTesoreria> {
  return respuesta(await llamarApi("gestion", `/tesoreria/validaciones?vista=${vista}`));
}

export interface DetallePago {
  id_pago: number;
  id_expediente: number;
  codigo: string;
  grado: string;
  postulante: Persona;
  banco: string;
  numero_operacion: string;
  monto: number;
  fecha_pago: string;
  estado_validacion: EstadoRevision;
  motivo_observacion: string | null;
  motivo_anterior: string | null;
  ramas: Ramas;
  agendamiento_habilitado: boolean;
}

export async function leerPago(idPago: number): Promise<DetallePago> {
  return respuesta(await llamarApi("gestion", `/tesoreria/pagos/${idPago}`));
}

export async function decidirPago(idPago: number, d: Decision): Promise<{ agendamiento_habilitado: boolean }> {
  return respuesta(await llamarApi("gestion", `/tesoreria/pagos/${idPago}/decision`, json("POST", d)));
}

export async function descargarComprobante(idPago: number): Promise<Blob> {
  return blob(await llamarApi("gestion", `/tesoreria/pagos/${idPago}/comprobante`));
}
