// G05 · pestaña «Cuota de ingreso» (HU0015) con la API simulada en fetch. Se monta la app con el enrutador real en
// /gestion/tesoreria. Solo se prueba lo propio de la cuota: la pestaña con su conteo, los textos del mockup, el abono junto
// al monto que corresponde y las dos decisiones. El camino común del comprobante lo prueba ValidacionesTesoreria.test.ts.
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { createPinia } from "pinia";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryHistory } from "vue-router";
import App from "../../App.vue";
import { usuarioActual } from "../../auth/oidc";
import { conceptoTesoreria, etiquetaTesoreria } from "../../gestion/validacion";
import { usuarioFalso } from "../../pruebas/ayudantes";
import { crearEnrutador } from "../../router";

vi.mock("../../auth/oidc", async (original) => ({
  ...(await original<typeof import("../../auth/oidc")>()),
  usuarioActual: vi.fn(),
  iniciarSesion: vi.fn(),
}));

const CUOTA = {
  concepto: "cuota_ingreso",
  id_expediente: 151,
  id_pago: 41,
  codigo: "ADM-2027-0151",
  postulante: { nombres: "Valeria", apellidos: "Chávez León" },
  grado: "1.° de secundaria",
  monto: 4000,
  estado: "pendiente",
  subsanado: false,
  motivos_anteriores: [] as string[],
  recibido: "2026-11-05T15:00:00.000Z",
  numero_fraccion: 1,
  modalidad: "unico",
  numero_fracciones: 1,
};
const detalle = () => ({
  id_pago: 41,
  id_expediente: 151,
  codigo: "ADM-2027-0151",
  grado: "1.° de secundaria",
  postulante: { nombres: "Valeria", apellidos: "Chávez León" },
  concepto: "cuota_ingreso",
  numero_fraccion: 1,
  modalidad: "unico",
  numero_fracciones: 1,
  monto_corresponde: 4000,
  banco: "[Banco 1]",
  numero_operacion: "00912455",
  monto: 3900,
  fecha_pago: "2026-10-20",
  estado_validacion: "pendiente",
  motivo_observacion: null,
  motivo_anterior: null,
  ramas: { documental: "conforme", financiera: "conforme", derecho: "conforme" },
  agendamiento_habilitado: false,
});

let envios: { url: string; cuerpo: unknown }[];
let vistas: string[];

const responder = (status: number, cuerpo: unknown) => ({ ok: status < 400, status, json: async () => cuerpo }) as Response;

function apiFalsa(url: string, init: RequestInit = {}): Response {
  const metodo = init.method ?? "GET";
  if (url === "/api/campana-activa") return responder(200, { campana: "2027" });
  if (url.startsWith("/api/tesoreria/validaciones?")) {
    vistas.push(url.split("vista=")[1]!);
    return responder(200, { conteos: { todo: 1, derecho: 0, financiera: 0, cuota: 1 }, items: [CUOTA] });
  }
  if (url === "/api/tesoreria/pagos/41" && metodo === "GET") return responder(200, detalle());
  if (metodo === "POST") {
    envios.push({ url, cuerpo: JSON.parse(String(init.body)) });
    return responder(200, { agendamiento_habilitado: false });
  }
  return responder(404, { error: { codigo: "NO_ENCONTRADO", mensaje: "Recurso no encontrado" } });
}

const montados: VueWrapper[] = [];

beforeEach(() => {
  vi.clearAllMocks();
  envios = [];
  vistas = [];
  vi.stubEnv("VITE_API_URL", "/api");
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => apiFalsa(url, init)));
  vi.mocked(usuarioActual).mockResolvedValue(usuarioFalso(["tesoreria"], "Jorge Salazar"));
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
  await enrutador.push("/gestion/tesoreria");
  await esperar();
  return e;
}

async function abrirPanel(e: VueWrapper) {
  await e.get('[data-testid="pestana-cuota"]').trigger("click");
  await esperar();
  await e.get('[data-testid="item-cuota_ingreso-41"] button').trigger("click");
  await esperar();
  return e.get('[data-testid="panel-comprobante"]');
}

const boton = (w: { findAll: VueWrapper["findAll"] }, texto: string) => w.findAll("button").find((b) => b.text() === texto);

describe("HU0015-1.0 G05 conciliación", () => {
  it("HU0015-1.0 [parte: conciliación] G05 la pestaña «Cuota de ingreso» se habilita con su conteo, pide su vista y lista con los textos del mockup", async () => {
    const e = await abrir();
    const pestana = e.get('[data-testid="pestana-cuota"]');
    expect(pestana.text()).toBe("Cuota de ingreso (1)");
    expect(pestana.attributes("aria-disabled")).toBeUndefined();

    await pestana.trigger("click");
    await esperar();

    expect(vistas.at(-1)).toBe("cuota");
    const fila = e.get('[data-testid="item-cuota_ingreso-41"]').findAll("td").map((td) => td.text());
    expect(fila.slice(2, 4)).toEqual(["Cuota de ingreso · pago único S/ 4,000", "Por conciliar"]);
    expect(e.get('[data-testid="aviso-carta"]').text()).toContain("emite automáticamente la Carta de Vacante");
    expect(conceptoTesoreria({ concepto: "cuota_ingreso", monto: 3500, modalidad: "fraccionado", numero_fraccion: 1 })).toBe("Cuota de ingreso · 1.ª fracción");
    expect(etiquetaTesoreria({ concepto: "cuota_ingreso", estado: "pendiente", subsanado: true }).texto).toBe("Subsanado");
  });

  it("HU0015-1.0 [parte: conciliación] G05 muestra el abono junto al monto que corresponde y «Conciliar y aprobar pago» envía la conformidad", async () => {
    const e = await abrir();
    const panel = await abrirPanel(e);

    expect(panel.get("h2").text()).toBe("Cuota de ingreso");
    expect(panel.get('[data-testid="monto"]').text()).toBe("S/ 3900");
    expect(panel.get('[data-testid="monto-corresponde"]').text()).toBe("S/ 4000");

    await panel.get('[data-testid="comprobante-conforme"]').trigger("click");
    await esperar();

    expect(panel.get('[data-testid="comprobante-conforme"]').text()).toBe("Conciliar y aprobar pago");
    expect(envios).toEqual([{ url: "/api/tesoreria/pagos/41/decision", cuerpo: { decision: "conforme" } }]);
    expect(e.get('[data-testid="aviso"]').text()).toBe("Pago conciliado. La cuota de ingreso quedó acreditada.");
  });
});

describe("HU0015-2.0 G05 rechazo", () => {
  it("HU0015-2.0 G05 «Rechazar comprobante» exige el motivo del desajuste y lo envía", async () => {
    const e = await abrir();
    const panel = await abrirPanel(e);

    await boton(panel, "Rechazar comprobante")!.trigger("click");
    await esperar();
    await panel.get("textarea").setValue("El abono es menor al monto que corresponde");
    await boton(panel, "Rechazar comprobante")!.trigger("click");
    await esperar();

    expect(envios).toEqual([{ url: "/api/tesoreria/pagos/41/decision", cuerpo: { decision: "observado", motivo: "El abono es menor al monto que corresponde" } }]);
  });
});
