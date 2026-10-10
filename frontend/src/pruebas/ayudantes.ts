import { User } from "oidc-client-ts";

// Token con la forma de un JWT (firma ficticia): el frontend solo lee la carga para mostrarla.
export function tokenFalso(carga: Record<string, unknown>): string {
  const b64url = (o: unknown) => btoa(JSON.stringify(o)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return `${b64url({ alg: "RS256", typ: "JWT" })}.${b64url(carga)}.firma-ficticia`;
}

export function usuarioFalso(roles: string[], nombre = "Persona Ficticia"): User {
  return new User({
    access_token: tokenFalso({ realm_access: { roles } }),
    token_type: "Bearer",
    profile: { sub: "00000000-0000-0000-0000-000000000001", iss: "http://keycloak.prueba", aud: "x", exp: 0, iat: 0, name: nombre },
    expires_at: Math.floor(Date.now() / 1000) + 300,
  });
}
