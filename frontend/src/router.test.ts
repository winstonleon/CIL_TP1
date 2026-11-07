import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryHistory } from "vue-router";
import App from "./App.vue";
import { iniciarSesion, usuarioActual } from "./auth/oidc";
import { usuarioFalso } from "./pruebas/ayudantes";
import { crearEnrutador } from "./router";

vi.mock("./auth/oidc", async (original) => ({
  ...(await original<typeof import("./auth/oidc")>()),
  usuarioActual: vi.fn(),
  iniciarSesion: vi.fn(),
}));

beforeEach(() => {
  vi.clearAllMocks();
  setActivePinia(createPinia());
});

async function montarEn(ruta: string) {
  const pinia = createPinia();
  setActivePinia(pinia);
  const enrutador = crearEnrutador(createMemoryHistory());
  const envoltorio = mount(App, { global: { plugins: [pinia, enrutador] } });
  await enrutador.push(ruta);
  await flushPromises();
  return { envoltorio, enrutador };
}

describe("S0-C4 protección de las áreas con Keycloak", () => {
  it("S0-C4 sin sesión, entrar a /gestion redirige al login de Keycloak del cliente gestion-interna", async () => {
    vi.mocked(usuarioActual).mockResolvedValue(null);
    const { enrutador, envoltorio } = await montarEn("/gestion");

    expect(usuarioActual).toHaveBeenCalledWith("gestion");
    expect(iniciarSesion).toHaveBeenCalledWith("gestion", "/gestion");
    expect(enrutador.currentRoute.value.path).not.toBe("/gestion");
    expect(envoltorio.find('[data-testid="estado-sesion"]').exists()).toBe(false);
  });

  it("S0-C4 con sesión, /portal muestra «Sesión iniciada», el nombre y solo los roles de la aplicación", async () => {
    vi.mocked(usuarioActual).mockResolvedValue(usuarioFalso(["secretaria", "offline_access", "default-roles-cil-admision"], "Familia Prueba"));
    const { envoltorio } = await montarEn("/portal");

    expect(usuarioActual).toHaveBeenCalledWith("portal");
    expect(iniciarSesion).not.toHaveBeenCalled();
    expect(envoltorio.get('[data-testid="estado-sesion"]').text()).toBe("Sesión iniciada");
    expect(envoltorio.get('[data-testid="area"]').text()).toBe("Portal de familias");
    expect(envoltorio.get('[data-testid="nombre"]').text()).toBe("Familia Prueba");
    expect(envoltorio.findAll('[data-testid="roles"] li').map((li) => li.text())).toEqual(["secretaria"]);
  });

  it("S0-C4 la página de inicio no exige sesión", async () => {
    const { envoltorio } = await montarEn("/");
    expect(usuarioActual).not.toHaveBeenCalled();
    expect(envoltorio.text()).toContain("Portal de familias");
    expect(envoltorio.text()).toContain("Gestión interna");
  });
});

describe("HU0003-1.0 P02 es una ruta pública (ADR-17)", () => {
  it("HU0003-1.0 /visita-guiada es pública: abre P02 sin consultar la sesión ni redirigir a Keycloak, y su lectura no lleva Authorization", async () => {
    vi.stubEnv("VITE_API_URL", "/api");
    const lectura = { campana: "2031", apoderado: { nombres: "Ana", apellidos: "Prueba" }, grado: { nombre_grado: "Inicial 3 años" }, lugar: "[Dirección del colegio]", horarios: [] };
    const fetchFalso = vi.fn(async (_url: string, _init?: RequestInit) => new Response(JSON.stringify(lectura)));
    vi.stubGlobal("fetch", fetchFalso);

    const { enrutador, envoltorio } = await montarEn("/visita-guiada?t=v1.TokenFicticio");

    expect(usuarioActual).not.toHaveBeenCalled();
    expect(iniciarSesion).not.toHaveBeenCalled();
    expect(enrutador.currentRoute.value.path).toBe("/visita-guiada");
    expect(envoltorio.get("h1").text()).toBe("Agenda tu visita guiada");
    expect(fetchFalso).toHaveBeenCalledTimes(1);
    const [url, init] = fetchFalso.mock.calls[0]!;
    expect(url).toBe("/api/publico/visita-guiada");
    expect(new Headers(init?.headers).has("Authorization")).toBe(false);
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });
});

describe("HU0021-1.0 pantalla G10 según el rol", () => {
  it("HU0021-1.0 /gestion/usuarios solo la abre la directora; otro rol vuelve a /gestion", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("[]")));
    vi.mocked(usuarioActual).mockResolvedValue(usuarioFalso(["secretaria"]));
    const secretaria = await montarEn("/gestion/usuarios");
    expect(secretaria.enrutador.currentRoute.value.path).toBe("/gestion");
    expect(secretaria.envoltorio.find('[data-testid="matriz-permisos"]').exists()).toBe(false);

    vi.mocked(usuarioActual).mockResolvedValue(usuarioFalso(["directora"]));
    const directora = await montarEn("/gestion/usuarios");
    expect(directora.enrutador.currentRoute.value.path).toBe("/gestion/usuarios");
    expect(directora.envoltorio.get('[data-testid="titulo-pantalla"]').text()).toBe("Usuarios y roles");
    vi.unstubAllGlobals();
  });
});

describe("G09 pantalla de configuración según el rol", () => {
  it("G09 /gestion/configuracion solo la abre la secretaría, con el título y la campaña activa; otro rol vuelve a /gestion", async () => {
    vi.stubEnv("VITE_API_URL", "/api");
    const cuerpo = (url: string) =>
      url === "/api/campana-activa" ? { campana: "2031" } : url === "/api/configuracion" ? { campana: "2031", derecho_admision: 300, grados: [] } : [];
    vi.stubGlobal("fetch", vi.fn(async (url: string) => new Response(JSON.stringify(cuerpo(url)))));

    vi.mocked(usuarioActual).mockResolvedValue(usuarioFalso(["directora"]));
    const directora = await montarEn("/gestion/configuracion");
    expect(directora.enrutador.currentRoute.value.path).toBe("/gestion");
    expect(directora.envoltorio.find('[role="tablist"]').exists()).toBe(false);

    vi.mocked(usuarioActual).mockResolvedValue(usuarioFalso(["secretaria"]));
    const secretaria = await montarEn("/gestion/configuracion");
    expect(secretaria.enrutador.currentRoute.value.path).toBe("/gestion/configuracion");
    expect(secretaria.envoltorio.get('[data-testid="titulo-pantalla"]').text()).toBe("Configuración de la campaña 2031");
    expect(secretaria.envoltorio.find('[role="tablist"]').exists()).toBe(true);
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });
});
