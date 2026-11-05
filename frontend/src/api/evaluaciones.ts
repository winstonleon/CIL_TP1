// Llamadas de P08 (HU0009) a /familia/expedientes/:id/evaluaciones y a la reprogramación de una cita. Pasan por el cliente
// único llamarApi con el cliente `portal` (rules/frontend.md).
import { llamarApi } from "./cliente";
import { json, respuesta } from "./respuesta";

export type TipoEvaluacion = "jornada_observacion" | "evaluacion_academica" | "evaluacion_psicologica" | "entrevista_padres";

export interface HorarioEvaluacion {
  id_horario: number;
  fecha: string; // AAAA-MM-DD, hora de Lima
  hora_inicio: string; // HH:MM
  hora_fin: string;
  disponible: boolean;
}

export interface CitaEvaluacion {
  id_cita: number;
  tipo_cita: TipoEvaluacion;
  fecha: string;
  hora_inicio: string;
  estado: string;
  reprogramable: boolean;
  plazo_vencido: boolean; // reservada y futura, pero a menos de las horas mínimas para reprogramar
}

export interface Evaluacion {
  tipo_cita: TipoEvaluacion;
  cita: CitaEvaluacion | null;
  horarios: HorarioEvaluacion[];
}

// «bloqueado»: aún sin las tres validaciones conformes; «agendar»: ya puede elegir; «agendadas»: en evaluación.
export interface AgendaEvaluaciones {
  modo: "bloqueado" | "agendar" | "agendadas";
  grado: string;
  min_horas_reprogramacion: number;
  evaluaciones: Evaluacion[];
}

const ruta = (id: number) => `/familia/expedientes/${id}/evaluaciones`;

export async function leerEvaluaciones(id: number): Promise<AgendaEvaluaciones> {
  return respuesta(await llamarApi("portal", ruta(id)));
}

// «Confirmar citas» (HU0009-1.0): un turno por evaluación del grado.
export async function confirmarCitas(id: number, horarios: { tipo_cita: TipoEvaluacion; id_horario: number }[]): Promise<{ estado: string; citas: CitaEvaluacion[] }> {
  return respuesta(await llamarApi("portal", ruta(id), json("POST", { horarios })));
}

// HU0009-2.0: el nuevo horario de una cita.
export async function reprogramarCita(id: number, idCita: number, idHorario: number): Promise<{ cita: CitaEvaluacion }> {
  return respuesta(await llamarApi("portal", `/familia/expedientes/${id}/citas/${idCita}/reprogramacion`, json("POST", { id_horario: idHorario })));
}
