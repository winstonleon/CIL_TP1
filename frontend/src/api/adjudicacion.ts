// Llamadas de G07 (Dirección, HU0012) a /direccion. Pasan por el cliente único llamarApi con el cliente `gestion`
// (rules/frontend.md). El informe se descarga con el token: la API no publica ninguna URL del almacenamiento (ADR-21).
import { llamarApi } from "./cliente";
import { json, respuesta } from "./respuesta";
import { blob, type Persona } from "./validaciones";

export interface AptoPorDecidir {
  id_expediente: number;
  codigo: string;
  postulante: Persona;
  grado: string;
  dictamen: string;
  recibido: string | null;
  sin_vacantes: boolean;
}

export interface GradoInventario {
  id_grado: number;
  nivel: string;
  grado: string;
  autorizadas: number;
  adjudicadas: number;
  disponibles: number;
  lista_espera: number;
}

export interface PanelAdjudicacion {
  pendientes: AptoPorDecidir[];
  inventario: GradoInventario[];
}

export interface DictamenDireccion {
  id_expediente: number;
  codigo: string;
  postulante: Persona;
  grado: string;
  dictamen: string;
  conclusiones: string;
  tiene_informe: boolean;
  fecha_emision: string;
}

export type ResultadoAdjudicacion = { resultado: "vacante_asignada" } | { resultado: "lista_espera"; posicion: number };

export async function leerPanelAdjudicacion(): Promise<PanelAdjudicacion> {
  return respuesta(await llamarApi("gestion", "/direccion/adjudicacion"));
}

export async function leerDictamen(id: number): Promise<DictamenDireccion> {
  return respuesta(await llamarApi("gestion", `/direccion/expedientes/${id}/dictamen`));
}

export async function descargarInforme(id: number): Promise<Blob> {
  return blob(await llamarApi("gestion", `/direccion/expedientes/${id}/dictamen/informe`));
}

export async function adjudicar(id: number): Promise<ResultadoAdjudicacion> {
  return respuesta(await llamarApi("gestion", `/direccion/expedientes/${id}/adjudicacion`, json("POST", {})));
}
