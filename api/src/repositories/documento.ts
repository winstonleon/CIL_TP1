// documento: archivo que la familia carga para cumplir un requisito (HU0006). `url_archivo` guarda la clave del
// almacenamiento (ADR-21), nunca el nombre original. Una subsanación inserta la fila nueva y marca vigente = false en la
// reemplazada, en la misma transacción (nota de la entidad).
import type { Consultable } from "../db/pool";

export interface FilaDocumento {
  id_documento: number;
  id_expediente: number;
  id_requisito: number;
  id_apoderado: number | null;
  url_archivo: string;
  formato: string;
  tamano_kb: number;
  fecha_carga: Date;
  estado_verificacion: string;
  motivo_observacion: string | null;
  vigente: boolean;
}

const COLUMNAS = `id_documento, id_expediente, id_requisito, id_apoderado, url_archivo, formato, tamano_kb, fecha_carga,
  estado_verificacion::text AS estado_verificacion, motivo_observacion, vigente`;

export async function insertarDocumento(
  db: Consultable,
  d: { idExpediente: number; idRequisito: number; idApoderado: number | null; clave: string; formato: string; tamanoKb: number },
): Promise<FilaDocumento> {
  const { rows } = await db.query<FilaDocumento>(
    // fecha_carga = la hora real de la inserción (clock_timestamp), no la del inicio de la transacción: una carga que
    // esperó el bloqueo del expediente no queda fechada antes de la verificación que se hizo mientras esperaba (HU0017).
    `INSERT INTO documento (id_expediente, id_requisito, id_apoderado, url_archivo, formato, tamano_kb, fecha_carga)
     VALUES ($1, $2, $3, $4, $5, $6, clock_timestamp()) RETURNING ${COLUMNAS}`,
    [d.idExpediente, d.idRequisito, d.idApoderado, d.clave, d.formato, d.tamanoKb],
  );
  return rows[0]!;
}

export async function listarDocumentosVigentes(db: Consultable, idExpediente: number): Promise<FilaDocumento[]> {
  const { rows } = await db.query<FilaDocumento>(
    `SELECT ${COLUMNAS} FROM documento WHERE id_expediente = $1 AND vigente ORDER BY fecha_carga, id_documento`,
    [idExpediente],
  );
  return rows;
}

// Bloquea el documento vigente que se va a reemplazar, solo si es de ese expediente.
export async function bloquearDocumentoVigente(db: Consultable, idDocumento: number, idExpediente: number): Promise<FilaDocumento | null> {
  const { rows } = await db.query<FilaDocumento>(
    `SELECT ${COLUMNAS} FROM documento WHERE id_documento = $1 AND id_expediente = $2 AND vigente FOR UPDATE`,
    [idDocumento, idExpediente],
  );
  return rows[0] ?? null;
}

// Archivos vigentes de un requisito (de un apoderado, si el requisito es por apoderado).
export async function contarVigentesDeRequisito(db: Consultable, idExpediente: number, idRequisito: number, idApoderado: number | null): Promise<number> {
  const { rows } = await db.query<{ n: string }>(
    `SELECT count(*) AS n FROM documento
      WHERE id_expediente = $1 AND id_requisito = $2 AND id_apoderado IS NOT DISTINCT FROM $3::int AND vigente`,
    [idExpediente, idRequisito, idApoderado],
  );
  return Number(rows[0]!.n);
}

export async function marcarNoVigente(db: Consultable, idDocumento: number): Promise<void> {
  await db.query("UPDATE documento SET vigente = false WHERE id_documento = $1", [idDocumento]);
}

// Por id, de cualquier expediente: el servicio distingue «propio», «ajeno» e «inexistente» (ADR-20).
export async function leerDocumento(db: Consultable, idDocumento: number): Promise<FilaDocumento | null> {
  const { rows } = await db.query<FilaDocumento>(`SELECT ${COLUMNAS} FROM documento WHERE id_documento = $1`, [idDocumento]);
  return rows[0] ?? null;
}
