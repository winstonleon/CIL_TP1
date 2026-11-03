// Compensación de un alta en Keycloak que no llegó a confirmarse en la BD. La usan el alta del personal (HU0021) y la
// cuenta de la familia (HU0004-1.0): los cambios en Keycloak se hacen dentro de la transacción, antes del COMMIT, y si
// algo falla se deshacen. Falla cerrado: nunca deja una cuenta habilitada de más.
import type { IdentidadAdmin } from "../identidad/keycloakAdmin";

// Deshace el usuario que creó o adoptó un alta fallida. Si no se puede borrar, al menos se deshabilita y se deja en el
// log (solo ids) para que un nuevo intento con el mismo correo lo adopte.
export async function compensarAlta(
  identidad: IdentidadAdmin,
  idIdentidad: string,
  paso: string,
  cuenta: "personal" | "familia",
): Promise<void> {
  try {
    await identidad.eliminarUsuario(idIdentidad);
    return;
  } catch {
    // se intenta deshabilitar abajo
  }
  let deshabilitado = true;
  try {
    await identidad.deshabilitar(idIdentidad);
  } catch {
    deshabilitado = false;
  }
  console.error(
    `Alta de ${cuenta} incompleta: el usuario de Keycloak ${idIdentidad} quedó huérfano ` +
      `(paso: ${paso}; deshabilitado: ${deshabilitado ? "sí" : "no"}). Un nuevo intento con el mismo correo lo adopta.`,
  );
}
