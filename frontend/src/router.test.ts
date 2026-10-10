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
    vi.mocked(usuarioActual).mockResolvedValue(usuarioFalso(["familia", "offline_access", "default-roles-cil-admision"], "Familia Prueba"));
    const { envoltorio } = await montarEn("/portal");

    expect(usuarioActual).toHaveBeenCalledWith("portal");
    expect(iniciarSesion).not.toHaveBeenCalled();
    expect(envoltorio.get('[data-testid="estado-sesion"]').text()).toBe("Sesión iniciada");
    expect(envoltorio.get('[data-testid="area"]').text()).toBe("Portal de familias");
    expect(envoltorio.get('[data-testid="nombre"]').text()).toBe("Familia Prueba");
    expect(envoltorio.findAll('[data-testid="roles"] li').map((li) => li.text())).toEqual(["familia"]);
  });

  it("S0-C4 la página de inicio no exige sesión", async () => {
    const { envoltorio } = await montarEn("/");
    expect(usuarioActual).not.toHaveBeenCalled();
    expect(envoltorio.text()).toContain("Portal de familias");
    expect(envoltorio.text()).toContain("Gestión interna");
  });
});
