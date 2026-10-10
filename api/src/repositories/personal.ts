import type { Consultable } from "../db/pool";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// id_personal del usuario de Keycloak, o null si no es Personal (p. ej. una familia).
export async function buscarIdPersonalPorKeycloak(db: Consultable, keycloakUserId: string): Promise<number | null> {
  if (!UUID.test(keycloakUserId)) return null;
  const { rows } = await db.query<{ id_personal: number }>(
    "SELECT id_personal FROM personal WHERE keycloak_user_id = $1::uuid",
    [keycloakUserId],
  );
  return rows[0]?.id_personal ?? null;
}
