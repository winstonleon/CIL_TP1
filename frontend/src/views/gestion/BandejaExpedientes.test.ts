// G02 · Bandeja de expedientes (HU0008; C51, parte «bandeja» de HU0017-1.0) con la API simulada en fetch y el enrutador
// real en /gestion/bandeja: pestañas con conteo, filtros que viajan a la API, la tabla del mockup y el motivo anterior.
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { createPinia } from "pinia";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryHistory } from "vue-router";
import App from "../../App.vue";
import { usuarioActual } from "../../auth/oidc";
import { usuarioFalso } from "../../pruebas/ayudantes";
import { crearEnrutador } from "../../router";

vi.mock("../../auth/oidc", async (original) => ({
  ...(await original<typeof import("../../auth/oidc")>()),
  usuarioActual: vi.fn(),
  iniciarSesion: vi.fn(),
}));

const fila = (id: number, extra: Record<string, unknown> = {}) => ({
  id_expediente: id,
  codigo: `ADM-2027-${String(id).padStart(4, "0")}`,
  postulante: { nombres: "Sofía", apellidos: "Quispe Rojas" },
  apoderado: { nombres: "María Fernanda", apellidos: "Quispe Rojas" },
  grado: { id_grado: 3, nombre_grado: "3.° primaria" },
  estado_documental: "pendiente",
  subsanado: false,
  motivos_anteriores: [] as string[],
  ultima_actividad: new Date().toISOString(),
  en_validacion_desde: new Date(Date.now() - 6 * 24 * 3600 * 1000).toISOString(),
  ...extra,
});

let expedientes: ReturnType<typeof fila>[];
let consultas: URLSearchParams[];

const responder = (status: number, cuerpo: unknown) => ({ ok: status < 400, status, json: async () => cuerpo }) as Response;

function apiFalsa(url: string): Response {
  if (url === "/api/campana-activa") return responder(200, { campana: "2027" });
  if (url === "/api/configuracion") return responder(200, { campana: "2027", derecho_admision: 300, grados: [{ id_grado: 3, nombre_grado: "3.° primaria" }] });
  if (url.startsWith("/api/bandeja/expedientes?")) {
    consultas.push(new URLSearchParams(url.split("?")[1]));
    return responder(200, { conteos: { por_revisar: 6, observados: 3, todos: 38 }, expedientes });
  }
  return responder(404, { error: { codigo: "NO_ENCONTRADO", mensaje: "Recurso no encontrado" } });
}

const montados: VueWrapper[] = [];

beforeEach(() => {
  vi.clearAllMocks();
  expedientes = [fila(142)];
  consultas = [];
  vi.stubEnv("VITE_API_URL", "/api");
  vi.stubGlobal("fetch", vi.fn(async (url: string) => apiFalsa(url)));
  vi.mocked(usuarioActual).mockResolvedValue(usuarioFalso(["secretaria"], "Rosa Medina"));
});

afterEach(() => {
  for (const m of montados.splice(0)) m.unmount();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

async function esperar() {
  for (let i = 0; i < 8; i++) await flushPromises();
}

async function abrir() {
  const enrutador = crearEnrutador(createMemoryHistory());
  const e = mount(App, { global: { plugins: [createPinia(), enrutador] }, attachTo: document.body });
  montados.push(e);
  await enrutador.push("/gestion/bandeja");
  await esperar();
  return { e, enrutador };
}

describe("HU0017-1.0 G02 bandeja de revisión", () => {
  it("HU0017-1.0 [parte: bandeja] G02 abre en «Por revisar» con los conteos y lista el expediente completo con las columnas del mockup y «Revisar»", async () => {
    const { e, enrutador } = await abrir();

    expect(consultas[0]!.get("vista")).toBe("por_revisar");
    expect(consultas[0]!.get("orden")).toBe("antiguos");
    const pestanas = e.findAll('[role="tab"]');
    expect(pestanas.map((p) => p.text())).toEqual(["Por revisar 6", "Observados 3", "En evaluación", "Con vacante", "Todos 38"]);
    expect(pestanas[0]!.attributes("aria-selected")).toBe("true");
    expect(pestanas[2]!.attributes("aria-disabled")).toBe("true");
    expect(pestanas[2]!.attributes("title")).toBe("Disponible con HU0009");
    expect(pestanas[3]!.attributes("title")).toBe("Disponible con HU0012");

    expect(e.findAll("thead th").map((th) => th.text())).toEqual(["Código", "Postulante", "Grado", "Estado", "Última actividad", "En proceso", "Acción"]);
    const celdas = e.get('[data-testid="expediente-142"]').findAll("td").map((td) => td.text());
    expect(celdas.slice(0, 4)).toEqual(["ADM-2027-0142", "Sofía Quispe RojasApod.: María F. Quispe", "3.° primaria", "Completo · en revisión"]);
    expect(celdas[4]).toMatch(/^Hoy, /);
    expect(celdas[5]).toBe("6 días");
    expect(e.text()).toContain("Solo aparecen expedientes que el sistema ya verificó como completos.");

    await e.get('[data-testid="expediente-142"] a').trigger("click");
    await esperar();
    expect(enrutador.currentRoute.value.fullPath).toBe("/gestion/bandeja/142");
  });

  it("HU0017-1.0 [parte: bandeja] las pestañas, el grado, el orden y la búsqueda viajan a la API", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      const { e } = await abrir();
      await e.get('[data-testid="pestana-observados"]').trigger("click");
      await esperar();
      expect(consultas.at(-1)!.get("vista")).toBe("observados");
      await e.get("#g02-grado").setValue("3");
      await e.get("#g02-orden").setValue("recientes");
      await esperar();
      expect(consultas.at(-1)!.get("grado")).toBe("3");
      expect(consultas.at(-1)!.get("orden")).toBe("recientes");
      await e.get("#g02-buscar").setValue("Quispe");
      vi.advanceTimersByTime(300);
      await esperar();
      expect(consultas.at(-1)!.get("q")).toBe("Quispe");
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("HU0008-2.0 G02 subsanación", () => {
  it("HU0008-2.0 [parte: correo] (subsanación) el expediente que volvió a revisión muestra «Subsanado» con el motivo anterior", async () => {
    expedientes = [fila(151, { subsanado: true, motivos_anteriores: ["La imagen está borrosa."] }), fila(152, { estado_documental: "observado" })];
    const { e } = await abrir();

    const subsanado = e.get('[data-testid="expediente-151"]');
    expect(subsanado.get(".chip").text()).toBe("Subsanado");
    expect(subsanado.get('[data-testid="motivo-anterior"]').text()).toBe("Motivo anterior: La imagen está borrosa.");
    expect(e.get('[data-testid="expediente-152"] .chip').text()).toBe("Observado");
    expect(e.get('[data-testid="expediente-152"]').find('[data-testid="motivo-anterior"]').exists()).toBe(false);
  });
});
