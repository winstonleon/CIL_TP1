// Cuestionario de expectativas de P05 (paso 4, HU0005). Las preguntas las entregó el equipo en nombre del colegio (C42); la
// versión sigue en `borrador-1` hasta que el colegio las apruebe (ADR-19). Las respuestas guardadas conservan el id de la
// pregunta.

export const VERSION_CUESTIONARIO = "borrador-1";

export interface Pregunta {
  id: string;
  texto: string;
}

export const PREGUNTAS: readonly Pregunta[] = [
  { id: "p1", texto: "¿Qué los motivó a considerar nuestro colegio y qué esperan encontrar en él para su hijo/a?" },
  { id: "p2", texto: "¿Cómo describirían a su hijo/a: sus intereses, sus fortalezas y lo que necesita que lo apoyen más?" },
  { id: "p3", texto: "¿Qué esperan del colegio en la formación académica y en valores, y cómo piensan participar ustedes como familia en ese proceso?" },
];

export const LARGO_MAXIMO_RESPUESTA = 2000;

export const esPregunta = (id: string) => PREGUNTAS.some((p) => p.id === id);
