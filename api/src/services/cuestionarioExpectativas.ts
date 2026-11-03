// Cuestionario de expectativas de P05 (paso 4, HU0005). El colegio aún no entrega las preguntas (C42): hasta entonces
// la versión es `borrador-1` y el texto va entre corchetes (ADR-19). Al recibirlas se sube la versión; las respuestas
// guardadas conservan el id de la pregunta.

export const VERSION_CUESTIONARIO = "borrador-1";

export interface Pregunta {
  id: string;
  texto: string;
}

export const PREGUNTAS: readonly Pregunta[] = [
  { id: "p1", texto: "[Pregunta 1 del colegio por confirmar]" },
  { id: "p2", texto: "[Pregunta 2 del colegio por confirmar]" },
  { id: "p3", texto: "[Pregunta 3 del colegio por confirmar]" },
];

export const LARGO_MAXIMO_RESPUESTA = 2000;

export const esPregunta = (id: string) => PREGUNTAS.some((p) => p.id === id);
