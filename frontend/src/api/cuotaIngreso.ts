// Llamadas de P07 (HU0013, HU0014 y HU0015-2.0) a /familia/expedientes/:id/cuota-ingreso. Pasan por el cliente único
// llamarApi con el cliente `portal` (rules/frontend.md). El comprobante se sube como multipart, con los campos antes del archivo.
import { llamarApi } from "./cliente";
import type { DatosComprobante, PagoRegistrado } from "./derechoAdmision";
import { json, respuesta } from "./respuesta";

export type Modalidad = "unico" | "fraccionado";

export interface PagoCuota {
  id_pago: number;
  numero_fraccion: number;
  banco: string;
  numero_operacion: string;
  monto: number;
  fecha_pago: string; // AAAA-MM-DD
  estado: "pendiente" | "en_revision" | "conforme" | "observado";
  subsanable: boolean;
  motivo_observacion: string | null;
  motivo_anterior: string | null;
  fecha_validacion: string | null;
}

export interface CuotaIngreso {
  version: string;
  disponible: boolean;
  aplica: boolean;
  nivel: string;
  grado: string;
  monto: number;
  max_fracciones: number;
  modalidad: Modalidad | null;
  numero_fracciones: number | null;
  montos: number[];
  bancos: string[];
  cuenta_colegio: string;
  modalidad_editable: boolean;
  registrable: boolean;
  pago: PagoCuota | null;
  derecho: (PagoRegistrado & { fecha_validacion: string | null }) | null;
}

export type DatosCuota = DatosComprobante & { monto: string };
export type EleccionModalidad = { modalidad: "unico" } | { modalidad: "fraccionado"; numero_fracciones: number };

const ruta = (id: number) => `/familia/expedientes/${id}/cuota-ingreso`;

export async function leerCuota(id: number): Promise<CuotaIngreso> {
  return respuesta(await llamarApi("portal", ruta(id)));
}

export async function elegirModalidad(id: number, eleccion: EleccionModalidad): Promise<CuotaIngreso> {
  return respuesta(await llamarApi("portal", `${ruta(id)}/modalidad`, json("POST", eleccion)));
}

function formularioDe(datos: DatosCuota, archivo: File): FormData {
  const formulario = new FormData();
  formulario.append("banco", datos.banco);
  formulario.append("numero_operacion", datos.numero_operacion);
  formulario.append("fecha_pago", datos.fecha_pago);
  formulario.append("monto", datos.monto);
  formulario.append("archivo", archivo);
  return formulario;
}

export async function registrarCuota(id: number, datos: DatosCuota, archivo: File): Promise<CuotaIngreso> {
  return respuesta(await llamarApi("portal", ruta(id), { method: "POST", body: formularioDe(datos, archivo) }));
}

// Subsanación (A1): el comprobante nuevo de la cuota observada reemplaza al anterior en la misma fila; vuelve a conciliación.
export async function regularizarCuota(id: number, datos: DatosCuota, archivo: File): Promise<CuotaIngreso> {
  return respuesta(await llamarApi("portal", ruta(id), { method: "PUT", body: formularioDe(datos, archivo) }));
}
