import type { Consultable } from "../db/pool";
import { UUID } from "../uuid";

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

// Rol y estado de la cuenta del usuario de Keycloak (C22), o null si no tiene fila en personal.
export async function buscarPersonalPorKeycloak(
  db: Consultable,
  keycloakUserId: string,
): Promise<{ id_personal: number; rol: string; activo: boolean } | null> {
  if (!UUID.test(keycloakUserId)) return null;
  const { rows } = await db.query<{ id_personal: number; rol: string; activo: boolean }>(
    "SELECT id_personal, rol::text AS rol, activo FROM personal WHERE keycloak_user_id = $1::uuid",
    [keycloakUserId],
  );
  return rows[0] ?? null;
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

// Responsables que G09 puede asignar a un horario (HU0022): cuentas activas con alguno de los roles dados.
export async function listarResponsables(db: Consultable, roles: readonly string[]): Promise<{ id_personal: number; nombre: string; rol: string }[]> {
  const { rows } = await db.query<{ id_personal: number; nombre: string; rol: string }>(
    `SELECT id_personal, nombres || ' ' || apellidos AS nombre, rol::text AS rol FROM personal
      WHERE activo AND rol::text = ANY($1::text[])
      ORDER BY nombres, apellidos, id_personal`,
    [roles],
  );
  return rows;
}

// Rol y estado de una cuenta, con la fila bloqueada para compartir: una desactivación simultánea espera al alta del horario.
export async function leerRolYEstado(db: Consultable, idPersonal: number): Promise<{ rol: string; activo: boolean } | null> {
  const { rows } = await db.query<{ rol: string; activo: boolean }>(
    "SELECT rol::text AS rol, activo FROM personal WHERE id_personal = $1 FOR SHARE",
    [idPersonal],
  );
  return rows[0] ?? null;
}

// Reactivación (HU0021-5.0): la fila conserva su rol y su historial.
export async function marcarActivo(db: Consultable, idPersonal: number): Promise<FilaPersonal> {
  const { rows } = await db.query<FilaPersonal>(
    `UPDATE personal SET activo = true WHERE id_personal = $1 RETURNING ${COLUMNAS}`,
    [idPersonal],
  );
  return rows[0]!;
}
