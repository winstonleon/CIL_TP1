import { UserManager } from "oidc-client-ts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { usuarioFalso } from "../pruebas/ayudantes";
import { configuracionOidc, rolesDe } from "./oidc";

beforeEach(() => {
  vi.stubEnv("VITE_OIDC_AUTHORITY", "http://keycloak.prueba/realms/cil-admision");
  vi.stubEnv("VITE_OIDC_CLIENT_ID_PORTAL", "portal-familias");
  vi.stubEnv("VITE_OIDC_CLIENT_ID_GESTION", "gestion-interna");
});
afterEach(() => {
  vi.unstubAllEnvs();
  localStorage.clear();
  sessionStorage.clear();
});

describe("S0-C4 clientes OIDC del frontend", () => {
  it("S0-C4 cada área usa su propio cliente de Keycloak con Authorization Code y su ruta de retorno", () => {
    expect(configuracionOidc("portal", "http://localhost:5173")).toMatchObject({
      authority: "http://keycloak.prueba/realms/cil-admision",
      client_id: "portal-familias",
      redirect_uri: "http://localhost:5173/callback/portal",
      response_type: "code",
      scope: "openid",
    });
    expect(configuracionOidc("gestion", "http://localhost:5173")).toMatchObject({
      client_id: "gestion-interna",
      redirect_uri: "http://localhost:5173/callback/gestion",
      response_type: "code",
    });
  });

  it("S0-C4 el usuario y su token se guardan solo en memoria, no en localStorage ni en sessionStorage", async () => {
    const gestor = new UserManager(configuracionOidc("gestion", "http://localhost:5173"));
    const usuario = usuarioFalso(["secretaria"]);
    await gestor.storeUser(usuario);

    expect((await gestor.getUser())?.access_token).toBe(usuario.access_token);
    const guardado = [...Object.values(localStorage), ...Object.values(sessionStorage)].join("");
    expect(guardado).not.toContain(usuario.access_token);
  });

  it("S0-C4 rolesDe lee realm_access.roles del token de acceso", () => {
    expect(rolesDe(usuarioFalso(["tesoreria", "offline_access"]))).toEqual(["tesoreria", "offline_access"]);
  });
});
