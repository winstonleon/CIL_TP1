// Inicio de sesión con Keycloak (ADR-02): Authorization Code + PKCE con oidc-client-ts.
// Dos clientes públicos: portal-familias (pantallas P*) y gestion-interna (pantallas G*).
// El token de acceso se guarda solo en memoria: al recargar la página hay que volver a iniciar sesión
// (Keycloak conserva su propia sesión, así que el reingreso no pide la contraseña otra vez).
import { InMemoryWebStorage, UserManager, WebStorageStateStore, type User, type UserManagerSettings } from "oidc-client-ts";

export type ClienteOidc = "portal" | "gestion";

export function configuracionOidc(cliente: ClienteOidc, origen = window.location.origin): UserManagerSettings {
  const env = import.meta.env;
  return {
    authority: env.VITE_OIDC_AUTHORITY,
    client_id: cliente === "portal" ? env.VITE_OIDC_CLIENT_ID_PORTAL : env.VITE_OIDC_CLIENT_ID_GESTION,
    redirect_uri: `${origen}/callback/${cliente}`,
    post_logout_redirect_uri: `${origen}/`,
    response_type: "code",
    scope: "openid",
    userStore: new WebStorageStateStore({ store: new InMemoryWebStorage() }),
  };
}

const gestores = new Map<ClienteOidc, UserManager>();

export function gestorOidc(cliente: ClienteOidc): UserManager {
  let gestor = gestores.get(cliente);
  if (!gestor) {
    gestor = new UserManager(configuracionOidc(cliente));
    gestores.set(cliente, gestor);
  }
  return gestor;
}

export async function usuarioActual(cliente: ClienteOidc): Promise<User | null> {
  const usuario = await gestorOidc(cliente).getUser();
  return usuario && !usuario.expired ? usuario : null;
}

export async function iniciarSesion(cliente: ClienteOidc, destino: string): Promise<void> {
  await gestorOidc(cliente).signinRedirect({ state: { destino } });
}

// Completa el retorno desde Keycloak y devuelve la ruta a la que el usuario quería entrar.
export async function completarInicioSesion(cliente: ClienteOidc): Promise<string> {
  const usuario = await gestorOidc(cliente).signinRedirectCallback();
  const destino = (usuario.state as { destino?: string } | undefined)?.destino;
  return destino ?? `/${cliente}`;
}

// Roles de realm del token de acceso (realm_access.roles). Solo para mostrar en pantalla:
// la autorización real la hace la API al validar la firma del token.
export function rolesDe(usuario: User): string[] {
  const carga = usuario.access_token.split(".")[1];
  if (!carga) return [];
  try {
    const json = JSON.parse(atob(carga.replace(/-/g, "+").replace(/_/g, "/")));
    const roles = json?.realm_access?.roles;
    return Array.isArray(roles) ? roles.filter((r: unknown): r is string => typeof r === "string") : [];
  } catch {
    return [];
  }
}
