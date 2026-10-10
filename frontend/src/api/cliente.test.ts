import { afterEach, describe, expect, it, vi } from "vitest";
import { usuarioActual } from "../auth/oidc";
import { usuarioFalso } from "../pruebas/ayudantes";
import { llamarApi } from "./cliente";

vi.mock("../auth/oidc", async (original) => ({
  ...(await original<typeof import("../auth/oidc")>()),
  usuarioActual: vi.fn(),
}));

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

function prepararFetch() {
  vi.stubEnv("VITE_API_URL", "/api");
  const fetchFalso = vi.fn().mockResolvedValue(new Response("{}"));
  vi.stubGlobal("fetch", fetchFalso);
  return fetchFalso;
}

describe("S0-C5 cliente HTTP hacia la API", () => {
  it("S0-C5 envía el token de acceso como Bearer y no envía cookies", async () => {
    const fetchFalso = prepararFetch();
    const usuario = usuarioFalso(["secretaria"]);
    vi.mocked(usuarioActual).mockResolvedValue(usuario);

    await llamarApi("gestion", "/salud");

    expect(usuarioActual).toHaveBeenCalledWith("gestion");
    const [url, init] = fetchFalso.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/salud");
    expect(new Headers(init.headers).get("Authorization")).toBe(`Bearer ${usuario.access_token}`);
    expect(init.credentials).toBe("omit");
  });

  it("S0-C5 sin sesión no envía la cabecera Authorization", async () => {
    const fetchFalso = prepararFetch();
    vi.mocked(usuarioActual).mockResolvedValue(null);

    await llamarApi("portal", "/salud");

    const [, init] = fetchFalso.mock.calls[0] as [string, RequestInit];
    expect(new Headers(init.headers).has("Authorization")).toBe(false);
  });
});
