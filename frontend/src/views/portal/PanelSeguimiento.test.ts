// P04 · Panel de seguimiento (HU0020 y HU0016) con la API simulada en fetch. Se monta la app con el enrutador real en /portal/panel.
// Solo se prueba lo propio de la pantalla: mostrar lo que entrega la API, llevar cada acción a su pantalla y descargar la carta.
// Las reglas las aplica la API (api/test/panelSeguimiento.test.ts).
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

const ID = 142;
const resumen = { id_expediente: ID, codigo: "ADM-2027-0142", estado: "en_validacion", grado: "3.° de primaria", postulante: "Sofía Quispe Rojas", ficha_completa: true };

const etapas = (estados: string[]) =>
  ["ficha", "documentos", "pagos", "evaluaciones", "resultado", "carta"].map((clave, i) => ({
    clave,
    titulo: ["Ficha y cuestionario", "Documentos", "Pagos y doc. financiera", "Evaluaciones", "Resultado", "Cuota y carta"][i],
    estado: estados[i],
  }));

const panelBase = () => ({
  etapas: etapas(["completado", "en_revision", "observado", "pendiente", "pendiente", "pendiente"]),
  validaciones: { documental: "en_revision", financiera: "observado", derecho: "conforme" },
  acciones: [
    { tipo: "subsanar", titulo: "Tesorería observó tu documentación financiera: Boletas de pago (madre)", motivo: "Falta la boleta de agosto de 2026", destino: "/portal/documentos" },
    { tipo: "informacion", titulo: "Tus evaluaciones se podrán agendar cuando se validen los documentos, el derecho de admisión y la documentación financiera." },
  ],
  historial: [
    { fecha: "2026-10-12T21:15:00.000Z", texto: "Tesorería observó la documentación financiera" },
    { fecha: "2026-10-12T16:02:00.000Z", texto: "Tesorería validó el derecho de admisión (S/ 300)" },
  ],
  carta: { disponible: false, fecha_emision: null as string | null },
});

let panel: ReturnType<typeof panelBase>;
let respuestaCarta: () => Response;
const responder = (status: number, cuerpo: unknown) => ({ ok: status < 400, status, json: async () => cuerpo }) as Response;

function apiFalsa(url: string): Response {
  if (url === "/api/familia/expedientes") return responder(200, [resumen]);
  if (url === `/api/familia/expedientes/${ID}/panel`) return responder(200, panel);
  if (url === `/api/familia/expedientes/${ID}/carta`) return respuestaCarta();
  return responder(404, { error: { codigo: "NO_ENCONTRADO", mensaje: "Recurso no encontrado" } });
}

const montados: VueWrapper[] = [];

beforeEach(() => {
  vi.clearAllMocks();
  panel = panelBase();
  respuestaCarta = () => ({ ok: true, status: 200, blob: async () => new Blob(["%PDF-"], { type: "application/pdf" }) }) as Response;
  vi.stubEnv("VITE_API_URL", "/api");
  vi.stubGlobal("fetch", vi.fn(async (url: string) => apiFalsa(url)));
  vi.mocked(usuarioActual).mockResolvedValue(usuarioFalso(["familia"], "María Fernanda Quispe Rojas"));
});

afterEach(() => {
  for (const m of montados.splice(0)) m.unmount();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function abrir(ruta = "/portal/panel") {
  const pinia = createPinia();
  const enrutador = crearEnrutador(createMemoryHistory());
  const w = mount(App, { global: { plugins: [pinia, enrutador] } });
  montados.push(w);
  await enrutador.push(ruta);
  for (let i = 0; i < 8; i++) await flushPromises();
  return { w, enrutador };
}

describe("HU0020-1.0 consulta del avance en P04", () => {
  it("HU0020-1.0 muestra las seis etapas con su estado, el expediente y el saludo del mockup", async () => {
    const { w } = await abrir();

    expect(w.get('[data-testid="saludo"]').text()).toBe("Hola, María");
    expect(w.text()).toContain("Aquí ves en qué etapa está la postulación de Sofía y qué necesitas hacer.");
    expect(w.text()).toContain("Expediente ADM-2027-0142");
    const filas = w.findAll(".etapa").map((e) => [e.get(".etapa-titulo").text(), e.get('[data-testid="estado-etapa"]').text()]);
    expect(filas).toEqual([
      ["Ficha y cuestionario", "Completado"],
      ["Documentos", "En revisión"],
      ["Pagos y doc. financiera", "Observado"],
      ["Evaluaciones", "Pendiente"],
      ["Resultado", "Pendiente"],
      ["Cuota y carta", "Pendiente"],
    ]);
  });

  it("HU0020-1.0 muestra el estado de cada validación con los nombres del mockup", async () => {
    const { w } = await abrir();

    expect(w.get('[data-testid="validacion-documental"]').text()).toContain("En revisión");
    expect(w.get('[data-testid="validacion-financiera"]').text()).toContain("Observado");
    expect(w.get('[data-testid="validacion-derecho"]').text()).toContain("Conforme");
  });

  it("HU0020-1.0 muestra el historial con su fecha, en hora de Lima", async () => {
    const { w } = await abrir();

    const filas = w.findAll('[data-testid="historial"] li');
    expect(filas).toHaveLength(2);
    expect(filas[0]!.text()).toContain("Tesorería observó la documentación financiera");
    expect(filas[0]!.text()).toMatch(/12 oct.*4:15/);
  });

  it("HU0020-1.0 sin acciones ni movimientos lo dice, y un error de la API se puede reintentar", async () => {
    panel = { ...panelBase(), acciones: [], historial: [] };
    const { w } = await abrir();
    expect(w.get('[data-testid="sin-acciones"]').text()).toBe("No tienes acciones pendientes.");

    vi.stubGlobal("fetch", vi.fn(async (url: string) => (url.endsWith("/panel") ? responder(500, { error: { codigo: "ERROR", mensaje: "No se pudo cargar" } }) : apiFalsa(url))));
    const otro = await abrir();
    expect(otro.w.get('[data-testid="error-panel"]').text()).toBe("No se pudo cargar");
  });

  it("HU0020-1.0 (D4-A) con el valor neutro de la API, el menú «Evaluaciones» sigue deshabilitado como con el dictamen", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => (url === "/api/familia/expedientes" ? responder(200, [{ ...resumen, estado: "resultado_en_revision" }]) : apiFalsa(url))));
    const { w } = await abrir();

    expect(w.get('[data-testid="menu-evaluaciones"]').attributes("disabled")).toBeDefined();
  });

  it("HU0020-1.0 la familia entra al portal por P04, y «Mi postulación» está en el menú", async () => {
    const { w, enrutador } = await abrir("/portal");

    expect(enrutador.currentRoute.value.path).toBe("/portal/panel");
    expect(w.get('[data-testid="menu-panel"]').text()).toBe("Mi postulación");
    expect(w.find('[data-testid="estado-sesion"]').exists()).toBe(false);
  });
});

describe("HU0020-2.0 acción pendiente desde P04", () => {
  it("HU0020-2.0 muestra el motivo de la observación y «Subsanar» lleva a la pantalla donde se subsana", async () => {
    const { w, enrutador } = await abrir();

    const accion = w.findAll('[data-testid="accion"]')[0]!;
    expect(accion.text()).toContain("Tesorería observó tu documentación financiera");
    expect(accion.get('[data-testid="motivo"]').text()).toBe("Motivo: Falta la boleta de agosto de 2026");
    expect(accion.get('[data-testid="ir-accion"]').text()).toBe("Subsanar");

    await accion.get('[data-testid="ir-accion"]').trigger("click");
    for (let i = 0; i < 4; i++) await flushPromises();
    expect(enrutador.currentRoute.value.path).toBe("/portal/documentos");
  });

  it("HU0020-2.0 una acción informativa no tiene enlace", async () => {
    const { w } = await abrir();

    const informativa = w.findAll('[data-testid="accion"]')[1]!;
    expect(informativa.text()).toContain("Tus evaluaciones se podrán agendar");
    expect(informativa.find('[data-testid="ir-accion"]').exists()).toBe(false);
  });
});

describe("HU0016-1.0 descarga de la carta en P04", () => {
  it("HU0016-1.0 sin carta no se ofrece la descarga", async () => {
    const { w } = await abrir();

    expect(w.find('[data-testid="descargar-carta"]').exists()).toBe(false);
  });

  it("HU0016-1.0 con la carta emitida, la familia la descarga con su sesión y el nombre del expediente", async () => {
    panel = { ...panelBase(), acciones: [], carta: { disponible: true, fecha_emision: "2026-11-06T15:00:00.000Z" } };
    const crear = vi.fn(() => "blob:carta");
    vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: crear, revokeObjectURL: vi.fn() }));
    const clic = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      expect(this.download).toBe("carta-vacante-ADM-2027-0142.pdf");
    });
    const { w } = await abrir();

    await w.get('[data-testid="descargar-carta"]').trigger("click");
    for (let i = 0; i < 4; i++) await flushPromises();

    expect(crear).toHaveBeenCalledOnce();
    expect(clic).toHaveBeenCalledOnce();
    expect(w.find('[data-testid="sin-acciones"]').exists()).toBe(false);
  });

  it("HU0016-1.0 si la descarga falla, la pantalla lo dice", async () => {
    panel = { ...panelBase(), carta: { disponible: true, fecha_emision: "2026-11-06T15:00:00.000Z" } };
    respuestaCarta = () => responder(500, { error: { codigo: "ARCHIVO_NO_DISPONIBLE", mensaje: "No se pudo leer el archivo" } });
    const { w } = await abrir();

    await w.get('[data-testid="descargar-carta"]').trigger("click");
    for (let i = 0; i < 4; i++) await flushPromises();

    expect(w.get('[data-testid="error-carta"]').text()).toBe("No se pudo leer el archivo");
  });
});
