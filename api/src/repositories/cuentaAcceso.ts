// Cuenta_Acceso: vínculo del apoderado con su usuario de Keycloak (rol familia). Se crea al registrar en G04 que la
// familia asistió y quiere postular (HU0004-1.0). Solo guarda el keycloak_user_id: la contraseña vive en Keycloak (R5).
import type { Consultable } from "../db/pool";

export async function insertarCuentaAcceso(db: Consultable, idApoderado: number, keycloakUserId: string): Promise<number> {
  const { rows } = await db.query<{ id_cuenta: number }>(
    "INSERT INTO cuenta_acceso (id_apoderado, keycloak_user_id) VALUES ($1, $2::uuid) RETURNING id_cuenta",
    [idApoderado, keycloakUserId],
  );
  return rows[0]!.id_cuenta;
}

// ¿El usuario de Keycloak ya tiene una cuenta de familia? (un huérfano de un alta fallida no la tiene).
export async function existeCuentaDeUsuario(db: Consultable, keycloakUserId: string): Promise<boolean> {
  const { rowCount } = await db.query("SELECT 1 FROM cuenta_acceso WHERE keycloak_user_id = $1::uuid", [keycloakUserId]);
  return (rowCount ?? 0) > 0;
}

// Usuario de Keycloak de la familia titular del expediente (aviso de credenciales y M3), o null si no tiene cuenta.
export async function usuarioDelExpediente(db: Consultable, idExpediente: number): Promise<string | null> {
  const { rows } = await db.query<{ keycloak_user_id: string }>(
    `SELECT ca.keycloak_user_id::text AS keycloak_user_id
       FROM expediente e JOIN cuenta_acceso ca ON ca.id_apoderado = e.id_apoderado_titular
      WHERE e.id_expediente = $1`,
    [idExpediente],
  );
  return rows[0]?.keycloak_user_id ?? null;
}
