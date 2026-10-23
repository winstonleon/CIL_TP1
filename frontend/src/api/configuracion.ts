// Llamadas de G09 (Configuración de la campaña, HU0022) a /configuracion y de la gestión interna a /campana-activa (C23).
// Pasan por el cliente único llamarApi (rules/frontend.md).
import type { CategoriaRequisito, CondicionAplicacion, TipoCita } from "../gestion/configuracion";
import { llamarApi } from "./cliente";
import { json, respuesta } from "./respuesta";

export interface GradoConfiguracion {
  id_grado: number;
  nivel: string;
  nombre_grado: string;
  vacantes_autorizadas: number;
  vacantes_adjudicadas: number;
  requiere_jornada_observacion: boolean;
  requiere_evaluacion_psicologica: boolean;
  requiere_evaluacion_academica: boolean;
  monto_cuota_ingreso: string; // numeric(10,2) como texto, p. ej. "7000.00"
  max_fracciones: number;
}

export interface Configuracion {
  campana: string;
  derecho_admision: number;
  grados: GradoConfiguracion[];
}

export type CambioGrado = { id_grado: number } & Partial<{
  vacantes_autorizadas: number;
  requiere_jornada_observacion: boolean;
  requiere_evaluacion_psicologica: boolean;
  requiere_evaluacion_academica: boolean;
  monto_cuota_ingreso: number;
  max_fracciones: number;
}>;

export interface DatosRequisito {
  tipo_documento: string;
  categoria: CategoriaRequisito;
  condicion_aplicacion: CondicionAplicacion;
  obligatorio: boolean;
  por_apoderado: boolean;
}

export interface Requisito extends DatosRequisito {
  id_requisito: number;
  id_grado: number;
}

export interface DatosHorario {
  id_personal: number;
  tipo_cita: TipoCita;
  fecha: string; // AAAA-MM-DD
  hora_inicio: string; // HH:MM
  hora_fin: string;
  cupos: number;
}

export interface Horario extends DatosHorario {
  id_horario: number;
  responsable: string;
}

export interface Responsable {
  id_personal: number;
  nombre: string;
  rol: string;
}

// Mínimo de vacantes por grado que devuelve el 422 de HU0022-2.0 en error.detalle.
export interface MinimoVacantes {
  id_grado: number;
  minimo: number;
}

// C23: la campaña activa, o null si la respuesta no la trae.
export async function obtenerCampanaActiva(): Promise<string | null> {
  const cuerpo = await respuesta<{ campana?: unknown } | null>(await llamarApi("gestion", "/campana-activa"));
  return typeof cuerpo?.campana === "string" ? cuerpo.campana : null;
}

export async function obtenerConfiguracion(): Promise<Configuracion> {
  return respuesta(await llamarApi("gestion", "/configuracion"));
}

export async function guardarGrados(grados: CambioGrado[]): Promise<GradoConfiguracion[]> {
  return respuesta(await llamarApi("gestion", "/configuracion/grados", json("PATCH", { grados })));
}

export async function listarRequisitos(idGrado: number): Promise<Requisito[]> {
  return respuesta(await llamarApi("gestion", `/configuracion/grados/${idGrado}/requisitos`));
}

export async function crearRequisito(idGrado: number, datos: DatosRequisito): Promise<Requisito> {
  return respuesta(await llamarApi("gestion", `/configuracion/grados/${idGrado}/requisitos`, json("POST", datos)));
}

export async function modificarRequisito(idRequisito: number, cambios: Partial<DatosRequisito>): Promise<Requisito> {
  return respuesta(await llamarApi("gestion", `/configuracion/requisitos/${idRequisito}`, json("PATCH", cambios)));
}

export async function quitarRequisito(idRequisito: number): Promise<void> {
  return respuesta(await llamarApi("gestion", `/configuracion/requisitos/${idRequisito}`, json("DELETE")));
}

export async function listarResponsables(): Promise<Responsable[]> {
  return respuesta(await llamarApi("gestion", "/configuracion/responsables"));
}

export async function listarHorarios(): Promise<Horario[]> {
  return respuesta(await llamarApi("gestion", "/configuracion/horarios"));
}

export async function crearHorario(datos: DatosHorario): Promise<Horario> {
  return respuesta(await llamarApi("gestion", "/configuracion/horarios", json("POST", datos)));
}

export async function quitarHorario(idHorario: number): Promise<void> {
  return respuesta(await llamarApi("gestion", `/configuracion/horarios/${idHorario}`, json("DELETE")));
}
