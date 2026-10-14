import type { Consultable } from "../db/pool";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Columnas que se devuelven al cliente (G10). keycloak_user_id no sale de la API.
const COLUMNAS = "id_personal, nombres, apellidos, correo, rol::text AS rol, activo";

export interface FilaPersonal {
  id_personal: number;
  nombres: string;
  apellidos: string;
  correo: string;
  rol: string;
  activo: boolean;
}

export interface FilaPersonalConIdentidad extends FilaPersonal {
  keycloak_user_id: string;
}

export interface NuevoPersonal {
  nombres: string;
  apellidos: string;
  correo: string;
  rol: string;
  keycloakUserId: string;
}

// id_personal del usuario de Keycloak, o null si no es Personal (p. ej. una familia).
export async function buscarIdPersonalPorKeycloak(db: Consultable, keycloakUserId: string): Promise<number | null> {
  if (!UUID.test(keycloakUserId)) return null;
  const { rows } = await db.query<{ id_personal: number }>(
    "SELECT id_personal FROM personal WHERE keycloak_user_id = $1::uuid",
    [keycloakUserId],
  );
  return rows[0]?.id_personal ?? null;
}

export async function listarPersonal(db: Consultable): Promise<FilaPersonal[]> {
  const { rows } = await db.query<FilaPersonal>(`SELECT ${COLUMNAS} FROM personal ORDER BY activo DESC, id_personal`);
  return rows;
}

// Serializa las altas con el mismo correo hasta el fin de la transacción (doble clic, reintentos).
export async function bloquearCorreo(db: Consultable, correo: string): Promise<void> {
  await db.query("SELECT pg_advisory_xact_lock(hashtext('personal:' || $1))", [correo]);
}

export async function existeCorreo(db: Consultable, correo: string): Promise<boolean> {
  const { rowCount } = await db.query("SELECT 1 FROM personal WHERE correo = $1", [correo]);
  return (rowCount ?? 0) > 0;
}

export async function insertarPersonal(db: Consultable, p: NuevoPersonal): Promise<FilaPersonal> {
  const { rows } = await db.query<FilaPersonal>(
    `INSERT INTO personal (nombres, apellidos, rol, correo, keycloak_user_id)
     VALUES ($1, $2, $3::rol_personal, $4, $5::uuid)
     RETURNING ${COLUMNAS}`,
    [p.nombres, p.apellidos, p.rol, p.correo, p.keycloakUserId],
  );
  return rows[0]!;
}

// Lee la cuenta y bloquea la fila hasta el fin de la transacción (SELECT ... FOR UPDATE).
export async function bloquearPersonal(db: Consultable, idPersonal: number): Promise<FilaPersonalConIdentidad | null> {
  const { rows } = await db.query<FilaPersonalConIdentidad>(
    `SELECT ${COLUMNAS}, keycloak_user_id::text AS keycloak_user_id FROM personal WHERE id_personal = $1 FOR UPDATE`,
    [idPersonal],
  );
  return rows[0] ?? null;
}

export async function actualizarPersonal(
  db: Consultable,
  idPersonal: number,
  p: { nombres: string; apellidos: string; rol: string },
): Promise<FilaPersonal> {
  const { rows } = await db.query<FilaPersonal>(
    `UPDATE personal SET nombres = $2, apellidos = $3, rol = $4::rol_personal
      WHERE id_personal = $1
      RETURNING ${COLUMNAS}`,
    [idPersonal, p.nombres, p.apellidos, p.rol],
  );
  return rows[0]!;
}

// Las cuentas se desactivan, no se eliminan (modelo de datos, nota de Personal.activo).
export async function marcarInactivo(db: Consultable, idPersonal: number): Promise<FilaPersonal> {
  const { rows } = await db.query<FilaPersonal>(
    `UPDATE personal SET activo = false WHERE id_personal = $1 RETURNING ${COLUMNAS}`,
    [idPersonal],
  );
  return rows[0]!;
}
