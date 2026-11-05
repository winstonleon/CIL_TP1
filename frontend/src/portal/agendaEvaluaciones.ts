// Lógica de P08 (HU0009) sin pantalla: nombres y responsables de cada evaluación (mockup P08), días con horarios, la
// selección completa para «Confirmar citas» y el resumen. Las evaluaciones que corresponden las decide la API con la
// configuración del grado (C25 4): aquí no se fija ninguna lista por grado.
import type { Evaluacion, HorarioEvaluacion, TipoEvaluacion } from "../api/evaluaciones";
import { DIAS_SEMANA, diaYMes, horaVisible, numeroDia } from "./calendarioVisita";

export const NOMBRE_EVALUACION: Record<TipoEvaluacion, string> = {
  jornada_observacion: "Jornada de observación",
  evaluacion_academica: "Evaluación académica",
  evaluacion_psicologica: "Evaluación psicológica",
  entrevista_padres: "Entrevista a los padres",
};

// Línea «A cargo de…» del mockup. La jornada no aparece en el mockup: solo se dice quién la conduce (ADR-15).
export const A_CARGO: Record<TipoEvaluacion, string> = {
  jornada_observacion: "A cargo de la Psicóloga",
  evaluacion_academica: "A cargo del Evaluador académico · solo el postulante",
  evaluacion_psicologica: "A cargo de la Psicóloga · solo el postulante",
  entrevista_padres: "A cargo de la Psicóloga · padre y madre o tutor",
};

const NUMEROS = ["", "una", "dos", "tres", "cuatro"];

// «Para 3.° de primaria corresponden tres citas.» / «corresponde una cita».
export function textoCitas(grado: string, n: number): string {
  const cantidad = NUMEROS[n] ?? String(n);
  return n === 1 ? `Para ${grado} corresponde una cita.` : `Para ${grado} corresponden ${cantidad} citas.`;
}

// Días con horarios del tipo, en orden, con la etiqueta del botón («Mar» y «27») y si tienen algo disponible.
export function diasDe(horarios: HorarioEvaluacion[]): { fecha: string; semana: string; numero: number; disponible: boolean }[] {
  const fechas = [...new Set(horarios.map((h) => h.fecha))].sort();
  return fechas.map((fecha) => ({
    fecha,
    semana: DIAS_SEMANA[(new Date(`${fecha}T00:00:00Z`).getUTCDay() + 6) % 7]!,
    numero: numeroDia(fecha),
    disponible: horarios.some((h) => h.fecha === fecha && h.disponible),
  }));
}

// El primer día con algo disponible (el que se muestra al abrir), o el primero.
export const diaInicial = (horarios: HorarioEvaluacion[]) => diasDe(horarios).find((d) => d.disponible)?.fecha ?? diasDe(horarios)[0]?.fecha ?? null;

export type Seleccion = Partial<Record<TipoEvaluacion, number>>;

// «Confirmar citas» se habilita con un turno disponible elegido para cada evaluación del grado.
export function seleccionCompleta(evaluaciones: Evaluacion[], seleccion: Seleccion): boolean {
  return (
    evaluaciones.length > 0 &&
    evaluaciones.every((e) => {
      const id = seleccion[e.tipo_cita];
      return id !== undefined && e.horarios.some((h) => h.id_horario === id && h.disponible);
    })
  );
}

// «Martes 27 de octubre · 8:00 a. m.»
export function cuandoEs(h: { fecha: string; hora_inicio: string }): string {
  const dia = diaYMes(h.fecha);
  return `${dia.charAt(0).toUpperCase()}${dia.slice(1)} · ${horaVisible(h.hora_inicio)}`;
}

// Resumen de citas: el turno elegido de cada evaluación, o «Sin elegir».
export function resumen(evaluaciones: Evaluacion[], seleccion: Seleccion): { tipo_cita: TipoEvaluacion; texto: string }[] {
  return evaluaciones.map((e) => {
    const h = e.horarios.find((x) => x.id_horario === seleccion[e.tipo_cita]);
    return { tipo_cita: e.tipo_cita, texto: h ? cuandoEs(h) : "Sin elegir" };
  });
}

// Lo que se envía a la API, en el orden de las evaluaciones.
export const pedidoDe = (evaluaciones: Evaluacion[], seleccion: Seleccion) =>
  evaluaciones.map((e) => ({ tipo_cita: e.tipo_cita, id_horario: seleccion[e.tipo_cita]! }));
