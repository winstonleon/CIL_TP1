// G04 · Visitas guiadas, sección «Prospectos con contacto no entregado» (HU0002-2.0, parte «rechazo síncrono»), con la
// API simulada en fetch. Así se prueba también el cliente real (llamarApi + api/prospectos): ruta y token. Los textos
// esperados se escriben literales, como en el mockup G04; el mensaje vacío y los formatos son los de S9 (plan HU0002).
import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryHistory } from "vue-router";
import App from "../../App.vue";
import { usuarioActual } from "../../auth/oidc";
import { usuarioFalso } from "../../pruebas/ayudantes";
import { crearEnrutador } from "../../router";
import VisitasGuiadas from "./VisitasGuiadas.vue";

vi.mock("../../auth/oidc", async (original) => ({
  ...(await original<typeof import("../../auth/oidc")>()),
  usuarioActual: vi.fn(),
  iniciarSesion: vi.fn(),
}));

interface Prospecto {
  id_expediente: number;
  nombres: string;
  apellidos: string;
  grado: { nivel: string; nombre_grado: string };
  correo: string;
  telefono: string;
  fecha_rebote: string | null;
}

// El prospecto del mockup G04. El rebote fue el 14/10/2026 a las 22:20 en Lima, que en UTC ya es el 15/10.
const JORGE: Prospecto = {
  id_expediente: 7,
  nombres: "Jorge",
  apellidos: "Paredes Linares",
  grado: { nivel: "primaria", nombre_grado: "2.° de primaria" },
  correo: "jparedes@rebota.ejemplo.test",
  telefono: "+51984222731",
  fecha_rebote: "2026-10-15T03:20:00.000Z",
};

// Un número internacional (E.164, ADR-17), que no es celular peruano.
const LUCIA: Prospecto = {
  id_expediente: 9,
  nombres: "Lucía",
  apellidos: "Ferrer Soto",
  grado: { nivel: "inicial", nombre_grado: "3 años" },
  correo: "lferrer@rebota.ejemplo.test",
  telefono: "+34612345678",
  fecha_rebote: "2026-10-02T14:05:00.000Z",
};

let prospectos: Prospecto[];
let fallaLaApi: boolean;
let rutas: string[];
let tokens: (string | null)[];

const responder = (status: number, cuerpo: unknown) =>
  new Response(JSON.stringify(cuerpo), { status, headers: { "Content-Type": "application/json" } });

function apiFalsa(url: string, init: RequestInit = {}): Response {
  rutas.push(url);
  tokens.push(new Headers(init.headers).get("Authorization"));
  if (url === "/api/campana-activa") return responder(200, { campana: "2027" });
  if (url === "/api/prospectos/contacto-no-entregado") {
    return fallaLaApi
      ? responder(500, { error: { codigo: "ERROR_INTERNO", mensaje: "Error interno del servidor." } })
      : responder(200, { prospectos });
  }
  return responder(404, { error: { codigo: "NO_ENCONTRADO", mensaje: "Recurso no encontrado" } });
}

beforeEach(() => {
  vi.clearAllMocks();
  prospectos = [JORGE, LUCIA];
  fallaLaApi = false;
  rutas = [];
  tokens = [];
  vi.stubEnv("VITE_API_URL", "/api");
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => apiFalsa(url, init)));
  vi.mocked(usuarioActual).mockResolvedValue(usuarioFalso(["secretaria"], "Rosa Medina"));
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

async function montar() {
  const envoltorio = mount(VisitasGuiadas);
  await flushPromises();
  return envoltorio;
}

describe("HU0002-2.0 G04: prospectos con contacto no entregado", () => {
  it("HU0002-2.0 [parte: rechazo síncrono] G04 muestra la sección con la insignia, el texto y una fila por prospecto, con el teléfono y la fecha del mockup", async () => {
    const e = await montar();

    // Una sola llamada, a la ruta de G04 y con el token de la sesión.
    expect(rutas).toEqual(["/api/prospectos/contacto-no-entregado"]);
    expect(tokens[0]).toMatch(/^Bearer /);

    const titulo = e.get("h2#g04-contacto-titulo");
    expect(titulo.text()).toBe("Prospectos con contacto no entregado");
    expect(titulo.get("svg").attributes("aria-hidden")).toBe("true");
    // Insignia: el texto del mockup a la vista y, para el lector de pantalla, uno que se entiende solo.
    const insignia = e.get('[data-testid="insignia-pendientes"]');
    expect(insignia.get('[aria-hidden="true"]').text()).toBe("2 pendientes");
    expect(insignia.get(".solo-lector").text()).toBe("2 prospectos pendientes");
    expect(e.text()).toContain("El correo con la carpeta informativa rebotó. Corrige los datos de contacto y reenvía la carpeta.");

    // Las columnas del mockup sin «Acciones» (C32), con encabezados de columna.
    const tabla = e.get("table");
    expect(tabla.attributes("aria-labelledby")).toBe("g04-contacto-titulo");
    const encabezados = tabla.findAll("thead th");
    expect(encabezados.map((th) => th.text())).toEqual(["Prospecto", "Correo rebotado", "Teléfono", "Fecha"]);
    expect(encabezados.map((th) => th.attributes("scope"))).toEqual(["col", "col", "col", "col"]);
    expect(e.find("button").exists()).toBe(false);

    // Una fila por prospecto, en el orden de la API (los rebotes más recientes primero).
    const filas = tabla.findAll("tbody tr");
    expect(filas.map((f) => f.attributes("data-testid"))).toEqual(["prospecto-7", "prospecto-9"]);
    const celdas = (i: number) => filas[i]!.findAll("td");
    expect(celdas(0)[0]!.get(".nombre").text()).toBe("Jorge Paredes Linares");
    expect(celdas(0)[0]!.get(".detalle").text()).toBe("Interés: 2.° de primaria");
    expect(celdas(0)[1]!.text()).toContain("jparedes@rebota.ejemplo.test");
    expect(celdas(0)[1]!.get(".no-entregado").text()).toBe("Contacto no entregado");
    // S9: celular peruano como en el mockup y fecha dd/mm/aaaa en la hora de Lima (en UTC sería el 15/10).
    expect(celdas(0)[2]!.text()).toBe("984 222 731");
    expect(celdas(0)[3]!.text()).toBe("14/10/2026");
    // S9: cualquier otro número, en E.164.
    expect(celdas(1)[0]!.get(".nombre").text()).toBe("Lucía Ferrer Soto");
    expect(celdas(1)[2]!.text()).toBe("+34612345678");
    expect(celdas(1)[3]!.text()).toBe("02/10/2026");

    // Con un solo prospecto, la insignia del mockup: «1 pendiente».
    prospectos = [JORGE];
    const uno = await montar();
    expect(uno.get('[data-testid="insignia-pendientes"] [aria-hidden="true"]').text()).toBe("1 pendiente");
    expect(uno.get('[data-testid="insignia-pendientes"] .solo-lector').text()).toBe("1 prospecto pendiente");
    expect(uno.findAll("tbody tr")).toHaveLength(1);
  });

  it("HU0002-2.0 [parte: rechazo síncrono] G04 sin prospectos muestra el mensaje vacío", async () => {
    prospectos = [];
    const e = await montar();

    expect(e.get("h2#g04-contacto-titulo").text()).toBe("Prospectos con contacto no entregado");
    const vacio = e.get('[role="status"]');
    expect(vacio.text()).toBe("No hay prospectos con contacto no entregado.");
    expect(e.find('[data-testid="insignia-pendientes"]').exists()).toBe(false);
    expect(e.find("table").exists()).toBe(false);
    expect(e.text()).not.toContain("El correo con la carpeta informativa rebotó.");
  });

  it("G04 si la API responde con error, avisa y no muestra el mensaje vacío ni la tabla", async () => {
    fallaLaApi = true;
    const e = await montar();

    expect(e.get('[role="alert"]').text()).toBe("Error interno del servidor.");
    expect(e.find('[role="status"]').exists()).toBe(false);
    expect(e.find("table").exists()).toBe(false);
  });
});

describe("HU0002-2.0 G04 en la navegación de la gestión interna", () => {
  async function montarEn(ruta: string) {
    const pinia = createPinia();
    setActivePinia(pinia);
    const enrutador = crearEnrutador(createMemoryHistory());
    const envoltorio = mount(App, { global: { plugins: [pinia, enrutador] } });
    await enrutador.push(ruta);
    await flushPromises();
    return { envoltorio, enrutador };
  }

  it("HU0002-2.0 [parte: rechazo síncrono] «Visitas guiadas» aparece y navega solo para secretaria", async () => {
    const secretaria = await montarEn("/gestion");
    const enlace = secretaria.envoltorio.findAll("nav a.opcion").find((a) => a.text() === "Visitas guiadas");
    expect(enlace?.attributes("href")).toBe("/gestion/visitas");
    await enlace!.trigger("click");
    await flushPromises();
    expect(secretaria.enrutador.currentRoute.value.path).toBe("/gestion/visitas");
    expect(secretaria.envoltorio.get('[data-testid="titulo-pantalla"]').text()).toBe("Visitas guiadas");
    expect(secretaria.envoltorio.get("a.opcion.activa").text()).toBe("Visitas guiadas");
    expect(secretaria.envoltorio.findAll('[data-testid^="prospecto-"]')).toHaveLength(2);

    // Otro rol no ve la opción y, si entra por la dirección, vuelve a /gestion sin pedir los prospectos.
    for (const rol of ["tesoreria", "psicologa", "evaluador_academico", "directora"]) {
      rutas = [];
      vi.mocked(usuarioActual).mockResolvedValue(usuarioFalso([rol]));
      const otro = await montarEn("/gestion/visitas");
      expect(otro.enrutador.currentRoute.value.path, rol).toBe("/gestion");
      expect(otro.envoltorio.get("nav").text(), rol).not.toContain("Visitas guiadas");
      expect(otro.envoltorio.find("#g04-contacto-titulo").exists(), rol).toBe(false);
      expect(rutas, rol).not.toContain("/api/prospectos/contacto-no-entregado");
    }
  });
});
