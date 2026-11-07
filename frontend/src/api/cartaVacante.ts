// Llamadas de la sección «Vacantes otorgadas» de G07 (HU0016-2.0) a /direccion. Pasan por el cliente único llamarApi con el
// cliente `gestion` (rules/frontend.md).
import { llamarApi } from "./cliente";
import { json, respuesta } from "./respuesta";
import type { Persona } from "./validaciones";

export type EstadoCuotaCarta = "pendiente" | "observado" | "conforme" | "sin_registrar" | "no_aplica";

export interface VacanteOtorgada {
  id_expediente: number;
  codigo: string;
  postulante: Persona;
  grado: string;
  cuota: EstadoCuotaCarta;
  emitible: boolean; // R18: la misma condición que aplica la API al emitir
}

export async function listarVacantesOtorgadas(): Promise<{ items: VacanteOtorgada[] }> {
  return respuesta(await llamarApi("gestion", "/direccion/cartas"));
}

export async function generarCarta(id: number): Promise<{ id_carta: number }> {
  return respuesta(await llamarApi("gestion", `/direccion/expedientes/${id}/carta`, json("POST", {})));
}
