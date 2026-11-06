// Lógica de P07 (HU0013, HU0014 y HU0015-2.0): los textos de los estados de la cuota, derivados del Pago, y las validaciones
// de la pantalla. Las reglas las vuelve a aplicar la API (R17): el máximo de fracciones lo informa ella (HU0013-2.0).
import type { CuotaIngreso } from "../api/cuotaIngreso";

export type Tono = "revision" | "conforme" | "observado";

export const NIVEL_VISIBLE: Record<string, string> = { inicial: "Inicial", primaria: "Primaria", secundaria: "Secundaria" };

// S/ 7,000 sin céntimos, como el mockup, y S/ 2,333.33 con ellos.
export function soles(monto: number): string {
  const decimales = Number.isInteger(monto) ? 0 : 2;
  return `S/ ${monto.toLocaleString("en-US", { minimumFractionDigits: decimales, maximumFractionDigits: 2 })}`;
}

// Estados de la HU: el expediente sigue en vacante_asignada y cada uno sale del Pago.
export function estadoCuota(c: Pick<CuotaIngreso, "disponible" | "pago">): { texto: string; tono: Tono } | null {
  if (c.pago?.estado === "conforme") return { texto: "Cuota acreditada", tono: "conforme" };
  if (c.pago?.estado === "observado") return { texto: "Cuota observada", tono: "observado" };
  if (c.pago) return { texto: "Cuota en conciliación", tono: "revision" };
  return c.disponible ? { texto: "Vacante otorgada", tono: "revision" } : null;
}

// Etiqueta de cada pago de la modalidad elegida: «Pago único» o «Fracción 2 de 3».
export const etiquetaPago = (indice: number, total: number) => (total === 1 ? "Pago único" : `Fracción ${indice + 1} de ${total}`);

// Lo que la pantalla puede decir sin la API. Un número mayor que el máximo lo rechaza la API e informa el máximo.
export function errorFracciones(texto: string): string {
  return /^\d+$/.test(texto.trim()) && Number(texto) >= 2 ? "" : "Indica un número de fracciones de 2 en adelante.";
}

export const errorMonto = (texto: string): string =>
  /^\d{1,8}(\.\d{1,2})?$/.test(texto.trim()) && Number(texto) > 0 ? "" : "Escribe el monto abonado, por ejemplo 7000.00.";
