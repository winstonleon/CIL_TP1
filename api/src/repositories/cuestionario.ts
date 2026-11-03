// cuestionario_expectativas: respuestas de P05 (paso 4, HU0005). Una fila por expediente; es_borrador = true hasta que
// la familia completa la ficha. fecha_actualizacion alimenta «Borrador guardado hace N min».
import type { Consultable } from "../db/pool";

export interface FilaCuestionario {
  respuestas: Record<string, string>;
  es_borrador: boolean;
  guardado_en: string; // ISO 8601
}

export async function guardarCuestionario(
  db: Consultable,
  idExpediente: number,
  respuestas: Record<string, string>,
  esBorrador: boolean,
): Promise<string> {
  const { rows } = await db.query<{ guardado_en: Date }>(
    `INSERT INTO cuestionario_expectativas (id_expediente, respuestas, es_borrador)
     VALUES ($1, $2::jsonb, $3)
     ON CONFLICT (id_expediente)
     DO UPDATE SET respuestas = EXCLUDED.respuestas, es_borrador = EXCLUDED.es_borrador, fecha_actualizacion = now()
     RETURNING fecha_actualizacion AS guardado_en`,
    [idExpediente, JSON.stringify(respuestas), esBorrador],
  );
  return rows[0]!.guardado_en.toISOString();
}

export async function leerCuestionario(db: Consultable, idExpediente: number): Promise<FilaCuestionario | null> {
  const { rows } = await db.query<{ respuestas: Record<string, string>; es_borrador: boolean; guardado_en: Date }>(
    "SELECT respuestas, es_borrador, fecha_actualizacion AS guardado_en FROM cuestionario_expectativas WHERE id_expediente = $1",
    [idExpediente],
  );
  const fila = rows[0];
  return fila ? { respuestas: fila.respuestas, es_borrador: fila.es_borrador, guardado_en: fila.guardado_en.toISOString() } : null;
}
