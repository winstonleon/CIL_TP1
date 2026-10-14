// Lectura y escritura de los tres estados del expediente (solo las usa transicionarExpediente)
// y comprobación de existencia (la usa la política de acceso restringido, HU0021-2.0).
import type { Consultable } from "../db/pool";

export async function existeExpediente(db: Consultable, idExpediente: number): Promise<boolean> {
  const { rowCount } = await db.query("SELECT 1 FROM expediente WHERE id_expediente = $1", [idExpediente]);
  return (rowCount ?? 0) > 0;
}

export type CampoEstado = "estado" | "estado_documental" | "estado_financiero";

// Nombre de columna y tipo enum de cada campo: lista cerrada, nunca entra texto del usuario al SQL.
const CAMPOS: Record<CampoEstado, { columna: string; tipo: string }> = {
  estado: { columna: "estado", tipo: "estado_expediente" },
  estado_documental: { columna: "estado_documental", tipo: "estado_revision" },
  estado_financiero: { columna: "estado_financiero", tipo: "estado_revision" },
};

export function esCampoEstado(valor: string): valor is CampoEstado {
  return Object.hasOwn(CAMPOS, valor);
}

export async function esValorDeEstado(db: Consultable, campo: CampoEstado, valor: string): Promise<boolean> {
  const { rows } = await db.query<{ valido: boolean }>(
    `SELECT $1::text = ANY (enum_range(NULL::${CAMPOS[campo].tipo})::text[]) AS valido`,
    [valor],
  );
  return rows[0]!.valido;
}

// Lee el estado actual y bloquea la fila hasta el fin de la transacción (SELECT ... FOR UPDATE).
export async function bloquearEstado(db: Consultable, idExpediente: number, campo: CampoEstado): Promise<string | null> {
  const { rows } = await db.query<{ valor: string }>(
    `SELECT ${CAMPOS[campo].columna}::text AS valor FROM expediente WHERE id_expediente = $1 FOR UPDATE`,
    [idExpediente],
  );
  return rows[0]?.valor ?? null;
}

export async function actualizarEstado(db: Consultable, idExpediente: number, campo: CampoEstado, valor: string): Promise<void> {
  const { columna, tipo } = CAMPOS[campo];
  await db.query(`UPDATE expediente SET ${columna} = $2::${tipo} WHERE id_expediente = $1`, [idExpediente, valor]);
}
