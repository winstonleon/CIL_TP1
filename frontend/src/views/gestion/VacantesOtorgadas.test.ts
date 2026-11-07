// «Vacantes otorgadas» de G07 (HU0016-2.0) con la API simulada en fetch. Se monta la app con el enrutador real en /gestion/vacantes.
// Solo se prueba lo propio de la pantalla: el botón deshabilitado con la alerta del escenario y el resultado de la API.
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

const fila = (id: number, cuota: string, emitible: boolean) => ({
  id_expediente: id,
  codigo: `ADM-2027-${String(id).padStart(4, "0")}`,
  postulante: { nombres: "Sofía", apellidos: "Quispe Rojas" },
  grado: "3.° de primaria",
  cuota,
  emitible,
});

let items: ReturnType<typeof fila>[];
let respuestaCarta: () => { status: number; cuerpo: unknown };
let envios: string[];
const responder = (status: number, cuerpo: unknown) => ({ ok: status < 400, status, json: async () => cuerpo }) as Response;

function apiFalsa(url: string, init: RequestInit = {}): Response {
  if (url === "/api/campana-activa") return responder(200, { campana: "2027" });
  if (url === "/api/direccion/adjudicacion") return responder(200, { pendientes: [], inventario: [] });
  if (url === "/api/direccion/cartas") return responder(200, { items });
  if (url.endsWith("/carta") && init.method === "POST") {
    envios.push(url);
    const r = respuestaCarta();
    return responder(r.status, r.cuerpo);
  }
  return responder(404, { error: { codigo: "NO_ENCONTRADO", mensaje: "Recurso no encontrado" } });
}

const montados: VueWrapper[] = [];

beforeEach(() => {
  vi.clearAllMocks();
  items = [];
  envios = [];
  respuestaCarta = () => ({ status: 201, cuerpo: { id_carta: 1 } });
  vi.stubEnv("VITE_API_URL", "/api");
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => apiFalsa(url, init)));
  vi.mocked(usuarioActual).mockResolvedValue(usuarioFalso(["directora"], "Ana Lucía Torres"));
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
  const w = mount(App, { global: { plugins: [createPinia(), enrutador] } });
  montados.push(w);
  await enrutador.push("/gestion/vacantes");
  await esperar();
  return w;
}

describe("HU0016-2.0 «Generar Carta de Vacante» en G07", () => {
  it.each([
    ["pendiente", "Cuota en conciliación"],
    ["observado", "Cuota observada"],
    ["sin_registrar", "Sin comprobante"],
  ])("HU0016-2.0 con la cuota %s deshabilita la acción, muestra la alerta y no envía nada", async (cuota, etiqueta) => {
    items = [fila(142, cuota, false)];
    const w = await abrir();

    const f = w.get('[data-testid="otorgada-142"]');
    expect(f.get('[data-testid="estado-cuota"]').text()).toBe(etiqueta);
    expect(f.get('[data-testid="generar-carta"]').attributes("disabled")).toBeDefined();
    expect(f.get('[data-testid="cuota-no-conciliada"]').text()).toBe("La cuota de ingreso no está conciliada");

    await f.get('[data-testid="generar-carta"]').trigger("click");
    await esperar();
    expect(envios).toEqual([]);
  });

  it("HU0016-2.0 si la API rechaza la emisión, G07 muestra su mensaje", async () => {
    items = [fila(142, "conforme", true)];
    respuestaCarta = () => ({ status: 409, cuerpo: { error: { codigo: "CUOTA_NO_CONCILIADA", mensaje: "La cuota de ingreso no está conciliada" } } });
    const w = await abrir();

    await w.get('[data-testid="generar-carta"]').trigger("click");
    await esperar();

    expect(w.get('[data-testid="error-carta"]').text()).toBe("La cuota de ingreso no está conciliada");
  });

  it("HU0016-2.0 (conciliada) sin alerta, el botón sirve de respaldo y el expediente sale de la lista", async () => {
    items = [fila(142, "conforme", true)];
    const w = await abrir();
    expect(w.find('[data-testid="cuota-no-conciliada"]').exists()).toBe(false);

    respuestaCarta = () => {
      items = [];
      return { status: 201, cuerpo: { id_carta: 1 } };
    };
    await w.get('[data-testid="generar-carta"]').trigger("click");
    await esperar();

    expect(envios).toEqual(["/api/direccion/expedientes/142/carta"]);
    expect(w.get('[data-testid="carta-emitida"]').text()).toBe("Carta de Vacante emitida: ADM-2027-0142.");
    expect(w.get('[data-testid="sin-otorgadas"]').text()).toBe("No hay vacantes otorgadas por formalizar.");
  });

  it("HU0016-2.0 un grado sin cuota se muestra así y se puede emitir", async () => {
    items = [fila(142, "no_aplica", true)];
    const w = await abrir();

    expect(w.get('[data-testid="estado-cuota"]').text()).toBe("Sin cuota de ingreso");
    expect(w.get('[data-testid="generar-carta"]').attributes("disabled")).toBeUndefined();
  });
});
