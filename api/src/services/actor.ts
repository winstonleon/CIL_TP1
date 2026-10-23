// Quién actúa en un evento de auditoría del personal (gestion_usuario, cambio_configuracion).
// Si no tiene fila en personal (C18), se guarda su id de Keycloak en el detalle.
import type { Consultable } from "../db/pool";
import { buscarIdPersonalPorKeycloak } from "../repositories/personal";

export async function actor(db: Consultable, keycloakUserId: string) {
  const idPersonal = await buscarIdPersonalPorKeycloak(db, keycloakUserId);
  return { idPersonal, detalle: idPersonal === null ? { actor_keycloak_user_id: keycloakUserId } : {} };
}
