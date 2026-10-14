// HU0021-1.0 «al iniciar sesión, le muestra únicamente las opciones de ese rol»: la barra lateral de la gestión
// interna (mockups G02–G11). Las etiquetas esperadas se escriben literales, tal como están en los mockups.
import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryHistory } from "vue-router";
import App from "../../App.vue";
import { cerrarSesion, usuarioActual } from "../../auth/oidc";
import { usuarioFalso } from "../../pruebas/ayudantes";
import { crearEnrutador } from "../../router";

vi.mock("../../auth/oidc", async (original) => ({
  ...(await original<typeof import("../../auth/oidc")>()),
  usuarioActual: vi.fn(),
  iniciarSesion: vi.fn(),
  cerrarSesion: vi.fn(),
}));

beforeEach(() => {
  vi.clearAllMocks();
});

async function montarGestion(roles: string[], nombre = "Persona Ficticia") {
  vi.mocked(usuarioActual).mockResolvedValue(usuarioFalso([...roles, "offline_access", "default-roles-cil-admision"], nombre));
  const pinia = createPinia();
  setActivePinia(pinia);
  const enrutador = crearEnrutador(createMemoryHistory());
  const envoltorio = mount(App, { global: { plugins: [pinia, enrutador] } });
  await enrutador.push("/gestion");
  await flushPromises();
  return envoltorio;
}

const casos: Array<[string, string, string[]]> = [
  ["secretaria", "Secretaría de Admisión", ["Bandeja de expedientes", "Visitas guiadas", "Configuración de campaña"]],
  ["tesoreria", "Tesorería", ["Validaciones de Tesorería"]],
  ["psicologa", "Psicología", ["Agenda y dictámenes"]],
  ["evaluador_academico", "Evaluación académica", ["Evaluaciones académicas"]],
  ["directora", "Dirección", ["Adjudicación de vacantes", "Indicadores", "Usuarios y roles"]],
];

describe("HU0021-1.0 navegación de la gestión interna por rol", () => {
  it.each(casos)("HU0021-1.0 al iniciar sesión, %s ve en la barra lateral únicamente las opciones de su rol", async (rol, area, opciones) => {
    const envoltorio = await montarGestion([rol]);

    const menu = envoltorio.get("nav");
    expect(menu.attributes("aria-label")).toBe(`Menú de ${area}`);
    const visibles = menu.findAll(".opcion").map((o) => o.text());
    expect(visibles).toEqual(opciones);
    expect(menu.text()).toContain("Solo ves las opciones de tu rol.");

    // Solo «Usuarios y roles» tiene pantalla en HU0021; las demás se ven pero no navegan (plan HU0021, P4).
    const enlaces = menu.findAll("a.opcion").map((a) => a.text());
    expect(enlaces).toEqual(rol === "directora" ? ["Usuarios y roles"] : []);
    for (const deshabilitada of menu.findAll('[aria-disabled="true"]')) {
      expect(deshabilitada.element.tagName).toBe("SPAN");
    }
  });

  it("G10 el encabezado muestra el área, el nombre y las iniciales de la persona", async () => {
    const envoltorio = await montarGestion(["directora"], "Ana Lucía Torres");
    expect(envoltorio.get('[data-testid="nombre-sesion"]').text()).toBe("Ana Lucía Torres");
    expect(envoltorio.get(".avatar").text()).toBe("AL");
    expect(envoltorio.get(".encabezado").text()).toContain("Dirección");
  });

  it("G10 «Cerrar sesión» cierra la sesión del cliente gestion-interna", async () => {
    const envoltorio = await montarGestion(["secretaria"]);
    await envoltorio.get('button[aria-label="Cerrar sesión"]').trigger("click");
    expect(cerrarSesion).toHaveBeenCalledWith("gestion");
  });
});
