// requisito_documental: qué documentos exige cada grado y bajo qué condición (G09, HU0022).
// tipo_documento es el nombre visible («Partida de nacimiento»), único por grado sin distinguir mayúsculas (P14).
import type { Consultable } from "../db/pool";

const COLUMNAS = `r.id_requisito, r.id_grado, r.tipo_documento, r.categoria::text AS categoria,
  r.condicion_aplicacion::text AS condicion_aplicacion, r.obligatorio, r.por_apoderado`;

export interface DatosRequisito {
  tipo_documento: string;
  categoria: string;
  condicion_aplicacion: string;
  obligatorio: boolean;
  por_apoderado: boolean;
}

export interface FilaRequisito extends DatosRequisito {
  id_requisito: number;
  id_grado: number;
}

// Restricciones que hacen único el nombre en el grado: la del DBML y el índice sin mayúsculas.
export const UNICIDADES_REQUISITO = ["uq_requisito_grado_tipo", "uq_requisito_grado_tipo_minusculas"];

export async function listarRequisitos(db: Consultable, idGrado: number): Promise<FilaRequisito[]> {
  const { rows } = await db.query<FilaRequisito>(
    `SELECT ${COLUMNAS} FROM requisito_documental r WHERE r.id_grado = $1 ORDER BY r.id_requisito`,
    [idGrado],
  );
  return rows;
}

export async function insertarRequisito(db: Consultable, idGrado: number, d: DatosRequisito): Promise<FilaRequisito> {
  const { rows } = await db.query<FilaRequisito>(
    `INSERT INTO requisito_documental AS r (id_grado, tipo_documento, categoria, condicion_aplicacion, obligatorio, por_apoderado)
     VALUES ($1, $2, $3::categoria_requisito, $4::condicion_aplicacion, $5, $6)
     RETURNING ${COLUMNAS}`,
    [idGrado, d.tipo_documento, d.categoria, d.condicion_aplicacion, d.obligatorio, d.por_apoderado],
  );
  return rows[0]!;
}

// Lee el requisito (solo si su grado es de la campaña) y lo bloquea hasta el fin de la transacción.
export async function bloquearRequisito(db: Consultable, campana: string, idRequisito: number): Promise<FilaRequisito | null> {
  const { rows } = await db.query<FilaRequisito>(
    `SELECT ${COLUMNAS} FROM requisito_documental r JOIN grado g ON g.id_grado = r.id_grado
      WHERE r.id_requisito = $1 AND g.campana_admision = $2
      FOR UPDATE OF r`,
    [idRequisito, campana],
  );
  return rows[0] ?? null;
}

// El grado no se cambia (plan HU0022, P4).
export async function actualizarRequisito(db: Consultable, idRequisito: number, d: DatosRequisito): Promise<FilaRequisito> {
  const { rows } = await db.query<FilaRequisito>(
    `UPDATE requisito_documental AS r
        SET tipo_documento = $2, categoria = $3::categoria_requisito, condicion_aplicacion = $4::condicion_aplicacion,
            obligatorio = $5, por_apoderado = $6
      WHERE r.id_requisito = $1
      RETURNING ${COLUMNAS}`,
    [idRequisito, d.tipo_documento, d.categoria, d.condicion_aplicacion, d.obligatorio, d.por_apoderado],
  );
  return rows[0]!;
}

// Hay documentos (vigentes o no) cargados para el requisito: no se puede quitar.
export async function requisitoEnUso(db: Consultable, idRequisito: number): Promise<boolean> {
  const { rowCount } = await db.query("SELECT 1 FROM documento WHERE id_requisito = $1 LIMIT 1", [idRequisito]);
  return (rowCount ?? 0) > 0;
}

export async function eliminarRequisito(db: Consultable, idRequisito: number): Promise<void> {
  await db.query("DELETE FROM requisito_documental WHERE id_requisito = $1", [idRequisito]);
}

export interface RequisitoExigido {
  id_requisito: number;
  tipo_documento: string;
  categoria: string;
  obligatorio: boolean;
  por_apoderado: boolean;
  id_apoderado: number | null;
  apoderado: string | null; // nombres y apellidos, solo en los requisitos por apoderado
}

// Lista de documentos exigidos al expediente (R7, HU0005-1.0): los requisitos del grado con condición `todos`, más los de
// colegio peruano y condición especial según lo declarado en la ficha. Los `por_apoderado` salen una vez por cada
// apoderado del postulante; `si_dependiente` y `si_independiente`, solo para el que tiene esa condición laboral.
// Contrato que consume HU0006. Solo cuentan los requisitos del grado de la campaña del expediente (G09, C25).
export async function requisitosExigidos(db: Consultable, idExpediente: number): Promise<RequisitoExigido[]> {
  const { rows } = await db.query<RequisitoExigido>(
    `SELECT r.id_requisito, r.tipo_documento, r.categoria::text AS categoria, r.obligatorio, r.por_apoderado,
            a.id_apoderado, a.nombres || ' ' || a.apellidos AS apoderado
       FROM expediente e
       JOIN postulante p ON p.id_postulante = e.id_postulante
       JOIN requisito_documental r ON r.id_grado = e.id_grado
       LEFT JOIN LATERAL (
              SELECT ap.id_apoderado, ap.nombres, ap.apellidos
                FROM postulante_apoderado pa
                JOIN apoderado ap ON ap.id_apoderado = pa.id_apoderado
               WHERE r.por_apoderado
                 AND pa.id_postulante = p.id_postulante
                 AND (r.condicion_aplicacion NOT IN ('si_dependiente', 'si_independiente')
                      OR (r.condicion_aplicacion = 'si_dependiente' AND ap.condicion_laboral = 'dependiente')
                      OR (r.condicion_aplicacion = 'si_independiente' AND ap.condicion_laboral = 'independiente'))
            ) a ON r.por_apoderado
      WHERE e.id_expediente = $1
        AND (r.condicion_aplicacion IN ('todos', 'si_dependiente', 'si_independiente')
             OR (r.condicion_aplicacion = 'solo_colegio_peruano' AND p.estudio_en_colegio_peruano IS TRUE)
             OR (r.condicion_aplicacion = 'solo_condicion_especial' AND p.tiene_condicion_especial IS TRUE))
        AND (NOT r.por_apoderado OR a.id_apoderado IS NOT NULL)
      ORDER BY r.id_requisito, a.id_apoderado`,
    [idExpediente],
  );
  return rows;
}
