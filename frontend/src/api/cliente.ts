// Único cliente HTTP hacia la API (rules/frontend.md). Envía el token de acceso como Bearer (ADR-02)
// y no envía cookies: la sesión no viaja en cookies.
import { usuarioActual, type ClienteOidc } from "../auth/oidc";

export async function llamarApi(cliente: ClienteOidc, ruta: string, init: RequestInit = {}): Promise<Response> {
  const usuario = await usuarioActual(cliente);
  const cabeceras = new Headers(init.headers);
  if (usuario) cabeceras.set("Authorization", `Bearer ${usuario.access_token}`);
  return fetch(`${import.meta.env.VITE_API_URL}${ruta}`, { ...init, headers: cabeceras, credentials: "omit" });
}
