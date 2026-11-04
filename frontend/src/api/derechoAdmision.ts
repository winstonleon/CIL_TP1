// Llamadas de P07b (HU0007) a /familia/expedientes/:id/derecho-admision. Pasan por el cliente único llamarApi con el
// cliente `portal` (rules/frontend.md). El comprobante se sube como multipart, con los campos antes del archivo.
import { llamarApi } from "./cliente";
import { respuesta } from "./respuesta";

export interface Constancia {
  codigo: string;
  expediente: string;
  postulante: string | null;
  concepto: string;
  monto: number;
  banco: string;
  numero_operacion: string;
  fecha_pago: string; // AAAA-MM-DD
  registrado_en: string | null; // ISO 8601; solo en la respuesta del registro (C49)
  estado: "pendiente" | "en_revision" | "conforme" | "observado";
}

export interface DerechoAdmision {
  version: string;
  monto: number;
  bancos: string[];
  cuenta_colegio: string;
  registrable: boolean;
  pago: Constancia | null;
}

export interface DatosComprobante {
  banco: string;
  numero_operacion: string;
  fecha_pago: string; // AAAA-MM-DD
}

const ruta = (id: number) => `/familia/expedientes/${id}/derecho-admision`;

export async function leerDerechoAdmision(id: number): Promise<DerechoAdmision> {
  return respuesta(await llamarApi("portal", ruta(id)));
}

export async function registrarDerechoAdmision(id: number, datos: DatosComprobante, archivo: File): Promise<Constancia> {
  const formulario = new FormData();
  formulario.append("banco", datos.banco);
  formulario.append("numero_operacion", datos.numero_operacion);
  formulario.append("fecha_pago", datos.fecha_pago);
  formulario.append("archivo", archivo);
  return respuesta(await llamarApi("portal", ruta(id), { method: "POST", body: formulario }));
}
