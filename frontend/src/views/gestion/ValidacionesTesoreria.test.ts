// G05 · Validaciones de Tesorería (HU0011 y HU0024) con la API simulada en fetch y el enrutador real en /gestion/tesoreria:
// la lista con sus estados, el panel del comprobante («Marcar conforme» y «Observar comprobante» con el motivo
// obligatorio), el de la documentación financiera y el motivo anterior.
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

const DERECHO = {
  concepto: "derecho_admision", id_expediente: 158, id_pago: 31, codigo: "ADM-2027-0158", postulante: { nombres: "Camila", apellidos: "Flores Vega" },
  grado: "Inicial 4 años", monto: 300, estado: "pendiente", subsanado: false, motivos_anteriores: [] as string[], recibido: new Date().toISOString(),
};
const FINANCIERA = {
  ...DERECHO, concepto: "documentacion_financiera", id_expediente: 142, id_pago: null, codigo: "ADM-2027-0142", postulante: { nombres: "Sofía", apellidos: "Quispe Rojas" },
  grado: "3.° primaria", monto: null,
};
const pagoBase = () => ({
  id_pago: 31, id_expediente: 158, codigo: "ADM-2027-0158", grado: "Inicial 4 años", postulante: { nombres: "Camila", apellidos: "Flores Vega" },
  banco: "[Banco 1]", numero_operacion: "00457812", monto: 300, fecha_pago: "2026-10-10", estado_validacion: "pendiente",
  motivo_observacion: null as string | null, motivo_anterior: null as string | null,
  ramas: { documental: "pendiente", financiera: "pendiente", derecho: "pendiente" }, agendamiento_habilitado: false,
});
const boleta = (id: number, estado: string) => ({
  id_documento: id, id_requisito: 3, tipo_documento: "Boletas de pago", categoria: "financiero", parentesco: "madre", formato: "pdf", tamano_kb: 300,
  fecha_carga: "2026-11-03T15:00:00.000Z", estado_verificacion: estado, motivo_observacion: null, motivo_anterior: null,
});
const financieraBase = () => ({
  id_expediente: 142, codigo: "ADM-2027-0142", grado: "3.° primaria", postulante: { nombres: "Sofía", apellidos: "Quispe Rojas" }, apoderado: { nombres: "María", apellidos: "Quispe" },
  ramas: { documental: "pendiente", financiera: "pendiente", derecho: "pendiente" }, agendamiento_habilitado: false,
  condiciones_laborales: [{ parentesco: "madre", condicion_laboral: "dependiente" }, { parentesco: "padre", condicion_laboral: "independiente" }],
  documentos: [boleta(21, "conforme"), boleta(22, "pendiente")],
});

let items: (typeof DERECHO | typeof FINANCIERA)[];
let pago: ReturnType<typeof pagoBase>;
let financiera: ReturnType<typeof financieraBase>;
let envios: { url: string; cuerpo: unknown }[];

const responder = (status: number, cuerpo: unknown) => ({ ok: status < 400, status, json: async () => cuerpo }) as Response;

function apiFalsa(url: string, init: RequestInit = {}): Response {
  const metodo = init.method ?? "GET";
  if (url === "/api/campana-activa") return responder(200, { campana: "2027" });
  if (url.startsWith("/api/tesoreria/validaciones?")) return responder(200, { conteos: { todo: 2, derecho: 1, financiera: 1 }, items });
  if (url === "/api/tesoreria/pagos/31" && metodo === "GET") return responder(200, pago);
  if (url === "/api/tesoreria/expedientes/142/documentacion-financiera") return responder(200, financiera);
  if (metodo === "POST") {
    envios.push({ url, cuerpo: JSON.parse(String(init.body)) });
    return responder(200, { agendamiento_habilitado: false, rama: "conforme" });
  }
  return responder(404, { error: { codigo: "NO_ENCONTRADO", mensaje: "Recurso no encontrado" } });
}

const montados: VueWrapper[] = [];

beforeEach(() => {
  vi.clearAllMocks();
  items = [FINANCIERA, DERECHO];
  pago = pagoBase();
  financiera = financieraBase();
  envios = [];
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

const elegir = async (e: VueWrapper, clave: string) => {
  await e.get(`[data-testid="item-${clave}"] button`).trigger("click");
  await esperar();
};
const boton = (w: { findAll: VueWrapper["findAll"] }, texto: string) => w.findAll("button").find((b) => b.text() === texto);

describe("HU0024-1.0 G05 validación conforme del derecho de admisión", () => {
  it("HU0024-1.0 G05 lista lo pendiente con los textos del mockup y el comprobante muestra los datos para contrastar con el estado de cuenta", async () => {
    const e = await abrir();

    expect(e.findAll('[role="tab"]').map((t) => t.text())).toEqual(["Todo pendiente (2)", "Derecho de admisión (1)", "Documentación financiera (1)", "Cuota de ingreso"]);
    const fila = e.get('[data-testid="item-derecho_admision-31"]').findAll("td").map((td) => td.text());
    expect(fila.slice(0, 4)).toEqual(["ADM-2027-0158", "Camila Flores VegaInicial 4 años", "Derecho de admisión · S/ 300", "Por validar"]);
    expect(e.get('[data-testid="item-documentacion_financiera-142"]').findAll("td")[3]!.text()).toBe("Por revisar");

    await elegir(e, "derecho_admision-31");
    const panel = e.get('[data-testid="panel-comprobante"]');
    expect(panel.get('[data-testid="numero-operacion"]').text()).toBe("00457812");
    expect(panel.text()).toContain("[Banco 1]");
    expect(panel.text()).toContain("S/ 300");
    expect(panel.text()).toContain("10/10/2026");

    pago = { ...pagoBase(), estado_validacion: "conforme" };
    await panel.get('[data-testid="comprobante-conforme"]').trigger("click");
    await esperar();
    expect(envios).toEqual([{ url: "/api/tesoreria/pagos/31/decision", cuerpo: { decision: "conforme" } }]);
    expect(e.get('[data-testid="panel-comprobante"] [data-testid="aviso"]').text()).toBe("Comprobante conforme.");
  });
});

describe("HU0024-2.0 G05 observación del comprobante", () => {
  it("HU0024-2.0 «Observar comprobante» exige el motivo, muestra el texto de ayuda y lo envía", async () => {
    const e = await abrir();
    await elegir(e, "derecho_admision-31");
    await boton(e.get('[data-testid="panel-comprobante"]'), "Observar comprobante")!.trigger("click");
    await esperar();
    const panel = e.get('[data-testid="panel-observacion"]');
    expect(panel.get('[data-testid="ayuda-motivo"]').text()).toBe("Describe el problema del documento; no copies su contenido");

    await boton(panel, "Observar comprobante")!.trigger("click");
    await esperar();
    expect(envios).toEqual([]);

    await panel.get("textarea").setValue("El número de operación no figura en el estado de cuenta.");
    await boton(panel, "Observar comprobante")!.trigger("click");
    await esperar();
    expect(envios).toEqual([{ url: "/api/tesoreria/pagos/31/decision", cuerpo: { decision: "observado", motivo: "El número de operación no figura en el estado de cuenta." } }]);
  });

  it("HU0024-2.0 (subsanación) el comprobante regularizado muestra «Subsanado» y su motivo como «Motivo anterior»", async () => {
    items = [{ ...DERECHO, subsanado: true, motivos_anteriores: ["El monto no coincide."] }];
    pago = { ...pagoBase(), motivo_anterior: "El monto no coincide." };
    const e = await abrir();
    const fila = e.get('[data-testid="item-derecho_admision-31"]');
    expect(fila.get(".chip").text()).toBe("Subsanado");
    expect(fila.get('[data-testid="motivo-anterior"]').text()).toBe("Motivo anterior: El monto no coincide.");

    await elegir(e, "derecho_admision-31");
    const panel = e.get('[data-testid="panel-comprobante"]');
    expect(panel.get('[data-testid="motivo-anterior"]').text()).toBe("Motivo anterior: El monto no coincide.");
    expect(panel.find('[data-testid="motivo-vigente"]').exists()).toBe(false);
  });
});

describe("HU0011 G05 documentación financiera", () => {
  it("HU0011-1.0 el panel muestra la condición laboral y «Marcar conforme» se habilita solo con todos los documentos conformes", async () => {
    const e = await abrir();
    await elegir(e, "documentacion_financiera-142");
    const panel = e.get('[data-testid="panel-financiera"]');
    expect(panel.text()).toContain("Solo Tesorería");
    expect(panel.text()).toContain("Condición laboral declarada en la ficha: Madre dependiente · Padre independiente");
    expect(panel.get('[data-testid="marcar-conforme"]').attributes("disabled")).toBeDefined();

    financiera = { ...financieraBase(), documentos: [boleta(21, "conforme"), boleta(22, "conforme")] };
    await boton(panel.get('[data-testid="documento-22"]'), "Conforme")!.trigger("click");
    await esperar();
    expect(envios.at(-1)).toEqual({ url: "/api/tesoreria/expedientes/142/documentos/22/decision", cuerpo: { decision: "conforme" } });
    const marcar = e.get('[data-testid="panel-financiera"] [data-testid="marcar-conforme"]');
    expect(marcar.attributes("disabled")).toBeUndefined();
    await marcar.trigger("click");
    await esperar();
    expect(envios.at(-1)).toEqual({ url: "/api/tesoreria/expedientes/142/validacion-financiera", cuerpo: {} });
  });

  it("HU0011-2.0 «Observar» de un documento financiero pide el motivo con el texto de ayuda y solicita la subsanación", async () => {
    const e = await abrir();
    await elegir(e, "documentacion_financiera-142");
    await boton(e.get('[data-testid="documento-22"]'), "Observar")!.trigger("click");
    await esperar();
    const panel = e.get('[data-testid="panel-observacion"]');
    expect(panel.text()).toContain("Boletas de pago (madre)");
    expect(panel.get('[data-testid="ayuda-motivo"]').text()).toBe("Describe el problema del documento; no copies su contenido");
    await panel.get("textarea").setValue("Falta la boleta de agosto de 2026.");
    await boton(panel, "Solicitar subsanación")!.trigger("click");
    await esperar();
    expect(envios.at(-1)).toEqual({ url: "/api/tesoreria/expedientes/142/documentos/22/decision", cuerpo: { decision: "observado", motivo: "Falta la boleta de agosto de 2026." } });
  });
});
