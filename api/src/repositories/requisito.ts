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
