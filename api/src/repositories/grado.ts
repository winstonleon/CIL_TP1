// grado: configuración de la campaña por grado (G09, HU0022). Las vacantes adjudicadas no tienen columna:
// adjudicadas = vacantes_autorizadas − vacantes_disponibles, porque asignar una vacante descuenta 1 de las
// disponibles (R14) y R21 la devuelve (plan HU0022, P7).
import type { Consultable } from "../db/pool";

// monto_cuota_ingreso sale como texto ("7000.00") para no perder precisión en JSON.
const COLUMNAS = `id_grado, nivel::text AS nivel, nombre_grado, vacantes_autorizadas, vacantes_disponibles,
  requiere_jornada_observacion, requiere_evaluacion_psicologica, requiere_evaluacion_academica,
  monto_cuota_ingreso::text AS monto_cuota_ingreso, max_fracciones`;

export interface FilaGrado {
  id_grado: number;
  nivel: string;
  nombre_grado: string;
  vacantes_autorizadas: number;
  vacantes_disponibles: number;
  requiere_jornada_observacion: boolean;
  requiere_evaluacion_psicologica: boolean;
  requiere_evaluacion_academica: boolean;
  monto_cuota_ingreso: string;
  max_fracciones: number;
}

export type ValoresGrado = Omit<FilaGrado, "id_grado" | "nivel" | "nombre_grado">;

// En el orden del nivel (inicial, primaria, secundaria) y del alta, como la tabla de G09.
export async function listarGrados(db: Consultable, campana: string): Promise<FilaGrado[]> {
  const { rows } = await db.query<FilaGrado>(
    `SELECT ${COLUMNAS} FROM grado WHERE campana_admision = $1 ORDER BY nivel, id_grado`,
    [campana],
  );
  return rows;
}

// Lo que P01 puede mostrar sin sesión (HU0001): solo id, nivel y nombre. Columnas explícitas a propósito, para que una
// columna nueva de grado (vacantes, cuotas…) nunca llegue al endpoint público.
export interface GradoPublico {
  id_grado: number;
  nivel: string;
  nombre_grado: string;
}

export async function listarGradosPublicos(db: Consultable, campana: string): Promise<GradoPublico[]> {
  const { rows } = await db.query<GradoPublico>(
    `SELECT id_grado, nivel::text AS nivel, nombre_grado FROM grado WHERE campana_admision = $1
      ORDER BY grado.nivel, id_grado`,
    [campana],
  );
  return rows;
}

export async function existeGrado(db: Consultable, campana: string, idGrado: number): Promise<boolean> {
  const { rowCount } = await db.query("SELECT 1 FROM grado WHERE id_grado = $1 AND campana_admision = $2", [idGrado, campana]);
  return (rowCount ?? 0) > 0;
}

export async function contarGrados(db: Consultable, campana: string): Promise<number> {
  const { rows } = await db.query<{ n: number }>("SELECT count(*)::int AS n FROM grado WHERE campana_admision = $1", [campana]);
  return rows[0]!.n;
}

// Dos cargas de la misma campaña a la vez esperan una a la otra (C26): la segunda ya la ve cargada.
export async function bloquearCampana(db: Consultable, campana: string): Promise<void> {
  await db.query("SELECT pg_advisory_xact_lock(hashtext('campana:' || $1))", [campana]);
}

export type NuevoGrado = Omit<FilaGrado, "id_grado" | "vacantes_disponibles">;

// Alta de un grado de una campaña nueva (C26, carga de campaña): sin adjudicadas, todas las vacantes quedan disponibles.
export async function insertarGrado(db: Consultable, campana: string, g: NuevoGrado): Promise<FilaGrado> {
  const { rows } = await db.query<FilaGrado>(
    `INSERT INTO grado (nivel, nombre_grado, campana_admision, vacantes_autorizadas, vacantes_disponibles,
                        requiere_jornada_observacion, requiere_evaluacion_psicologica, requiere_evaluacion_academica,
                        monto_cuota_ingreso, max_fracciones)
     VALUES ($1::nivel_educativo, $2, $3, $4, $4, $5, $6, $7, $8::numeric, $9)
     RETURNING ${COLUMNAS}`,
    [
      g.nivel,
      g.nombre_grado,
      campana,
      g.vacantes_autorizadas,
      g.requiere_jornada_observacion,
      g.requiere_evaluacion_psicologica,
      g.requiere_evaluacion_academica,
      g.monto_cuota_ingreso,
      g.max_fracciones,
    ],
  );
  return rows[0]!;
}

// Lee los grados de la campaña y los bloquea hasta el fin de la transacción, en orden de id (sin interbloqueos).
export async function bloquearGrados(db: Consultable, campana: string, ids: number[]): Promise<FilaGrado[]> {
  const { rows } = await db.query<FilaGrado>(
    `SELECT ${COLUMNAS} FROM grado WHERE campana_admision = $1 AND id_grado = ANY($2::int[]) ORDER BY id_grado FOR UPDATE`,
    [campana, ids],
  );
  return rows;
}

export async function actualizarGrado(db: Consultable, idGrado: number, v: ValoresGrado): Promise<FilaGrado> {
  const { rows } = await db.query<FilaGrado>(
    `UPDATE grado SET vacantes_autorizadas = $2, vacantes_disponibles = $3, requiere_jornada_observacion = $4,
            requiere_evaluacion_psicologica = $5, requiere_evaluacion_academica = $6, monto_cuota_ingreso = $7::numeric,
            max_fracciones = $8
      WHERE id_grado = $1
      RETURNING ${COLUMNAS}`,
    [
      idGrado,
      v.vacantes_autorizadas,
      v.vacantes_disponibles,
      v.requiere_jornada_observacion,
      v.requiere_evaluacion_psicologica,
      v.requiere_evaluacion_academica,
      v.monto_cuota_ingreso,
      v.max_fracciones,
    ],
  );
  return rows[0]!;
}
