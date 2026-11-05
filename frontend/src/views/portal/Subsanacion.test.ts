// Subsanación de la familia (decisión A1 del bloque 5) en P06 y P07b, con la API simulada en fetch y el enrutador real:
// mientras se valida el expediente, P06 ofrece «Reemplazar» solo en el documento observado y muestra su motivo; P07b
// muestra el motivo de la observación del comprobante y «Regularizar el pago» envía el comprobante nuevo con PUT. Una
// observación ya subsanada se muestra como «Motivo anterior».
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

const ID = 7;
const RESUMEN = { id_expediente: ID, codigo: "ADM-2027-0007", estado: "en_validacion", grado: "3.° de primaria", postulante: "Sofía Quispe Rojas", ficha_completa: true };

const documento = (id: number, estado: string, extra: Record<string, unknown> = {}) => ({
  id_documento: id, formato: "pdf", tamano_kb: 820, fecha_carga: "2026-11-03T15:00:00.000Z", estado_verificacion: estado,
  motivo_observacion: null, motivo_anterior: null, ...extra,
});
const requisito = (id: number, tipo: string, documentos: unknown[]) => ({
  id_requisito: id, tipo_documento: tipo, categoria: "postulante_y_padres", obligatorio: true, por_apoderado: false, id_apoderado: null, apoderado: null, documentos,
});
const listaBase = () => ({
  editable: false,
  subsanacion: true,
  confirmado_en: "2026-11-03T15:30:00.000Z",
  verificacion: { resultado: "completo", verificado_en: "2026-11-03T15:31:00.000Z", faltantes: [], falta_derecho: false },
  requisitos: [
    requisito(1, "Partida de nacimiento", [documento(11, "observado", { motivo_observacion: "La imagen está borrosa." })]),
    requisito(2, "DNI del postulante", [documento(12, "conforme")]),
    requisito(3, "Libreta de notas", [documento(13, "pendiente", { motivo_anterior: "Falta la segunda página." })]),
  ],
});

const CONSTANCIA = {
  codigo: "CONST-ADM-2027-0007-31", expediente: "ADM-2027-0007", postulante: "Sofía Quispe Rojas", concepto: "Derecho de admisión", monto: 300,
  banco: "[Banco 1]", numero_operacion: "00457812", fecha_pago: "2026-10-10", registrado_en: null,
};
const derechoBase = () => ({
  version: "borrador-1", monto: 300, bancos: ["[Banco 1]", "[Banco 2]"], cuenta_colegio: "[Banco y N.º de cuenta del colegio]", registrable: false,
  pago: { ...CONSTANCIA, estado: "observado", subsanable: true, motivo_observacion: "El monto abonado no coincide.", motivo_anterior: null } as Record<string, unknown>,
});

let lista: ReturnType<typeof listaBase>;
let derecho: ReturnType<typeof derechoBase>;
let envios: { metodo: string; url: string; cuerpo: FormData }[];

const responder = (status: number, cuerpo: unknown) => ({ ok: status < 400, status, json: async () => cuerpo }) as Response;

function apiFalsa(url: string, init: RequestInit = {}): Response {
  const metodo = init.method ?? "GET";
  if (url === "/api/familia/expedientes") return responder(200, [RESUMEN]);
  if (url === `/api/familia/expedientes/${ID}/documentos` && metodo === "GET") return responder(200, lista);
  if (url === `/api/familia/expedientes/${ID}/derecho-admision` && metodo === "GET") return responder(200, derecho);
  if (metodo === "POST" || metodo === "PUT") {
    envios.push({ metodo, url, cuerpo: init.body as FormData });
    if (url.endsWith("/derecho-admision")) {
      derecho = { ...derechoBase(), pago: { ...CONSTANCIA, banco: "[Banco 2]", estado: "pendiente", subsanable: false, motivo_observacion: null, motivo_anterior: "El monto abonado no coincide." } };
      return responder(200, derecho);
    }
    return responder(201, documento(99, "pendiente"));
  }
  return responder(404, { error: { codigo: "NO_ENCONTRADO", mensaje: "Recurso no encontrado" } });
}

const montados: VueWrapper[] = [];

beforeEach(() => {
  vi.clearAllMocks();
  lista = listaBase();
  derecho = derechoBase();
  envios = [];
  vi.stubEnv("VITE_API_URL", "/api");
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => apiFalsa(url, init)));
  vi.mocked(usuarioActual).mockResolvedValue(usuarioFalso(["familia"], "María Fernanda Quispe Rojas"));
});

afterEach(() => {
  for (const m of montados.splice(0)) m.unmount();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

async function esperar() {
  for (let i = 0; i < 8; i++) await flushPromises();
}

async function abrir(ruta: string) {
  const enrutador = crearEnrutador(createMemoryHistory());
  const e = mount(App, { global: { plugins: [createPinia(), enrutador] }, attachTo: document.body });
  montados.push(e);
  await enrutador.push(ruta);
  await esperar();
  return e;
}

const PDF = [0x25, 0x50, 0x44, 0x46, 0x2d, 0x31];
const archivo = () => new File([new Uint8Array(PDF)], "nitido.pdf");

async function elegir(e: VueWrapper, selector: string) {
  const entrada = e.get(selector);
  Object.defineProperty(entrada.element, "files", { value: [archivo()], configurable: true });
  await entrada.trigger("change");
  await esperar();
}

describe("HU0008-2.0 P06 subsanación de un documento observado", () => {
  it("HU0008-2.0 [parte: correo] (subsanación) P06 muestra el motivo y ofrece «Reemplazar» solo en el documento observado; envía el reemplazo de ese documento", async () => {
    const e = await abrir("/portal/documentos");

    expect(e.get('[data-testid="subsanacion"]').text()).toContain("Subsana solo lo que esté observado");
    expect(e.find('[data-testid="no-editable"]').exists()).toBe(false);
    expect(e.get('[data-testid="motivo-vigente"]').text()).toBe("Secretaría: La imagen está borrosa.");
    expect(e.findAll('[data-testid^="reemplazo-"]').map((r) => r.attributes("data-testid"))).toEqual(["reemplazo-11"]);
    // Sin cargas nuevas ni «Confirmar documentos» mientras se valida.
    expect(e.find('[data-testid^="archivo-"]').exists()).toBe(false);
    expect(e.findAll("button").some((b) => b.text() === "Confirmar documentos")).toBe(false);

    await elegir(e, '[data-testid="reemplazo-11"]');

    expect(envios).toHaveLength(1);
    expect(envios[0]!.metodo).toBe("POST");
    expect(envios[0]!.cuerpo.get("id_requisito")).toBe("1");
    expect(envios[0]!.cuerpo.get("reemplaza")).toBe("11");
  });

  it("HU0008-2.0 [parte: correo] (subsanación) un documento ya reemplazado que espera revisión muestra su motivo como «Motivo anterior»", async () => {
    const e = await abrir("/portal/documentos");
    const anterior = e.get('[data-testid="motivo-anterior"]');
    expect(anterior.text()).toBe("Motivo anterior: Falta la segunda página.");
    expect(e.get('[data-testid="requisito-3-0"]').find('[data-testid="motivo-vigente"]').exists()).toBe(false);
    expect(e.get('[data-testid="requisito-3-0"]').find('[data-testid^="reemplazo-"]').exists()).toBe(false);
  });
});

describe("HU0024-2.0 P07b regularización del pago observado", () => {
  it("HU0024-2.0 (subsanación) P07b muestra el motivo de la observación y «Regularizar el pago» envía el comprobante nuevo con PUT; después el motivo queda como anterior", async () => {
    const e = await abrir("/portal/pagos/derecho-admision");
    expect(e.get('[data-testid="observacion"]').text()).toContain("Motivo: El monto abonado no coincide.");

    await e.get('[data-testid="regularizar"]').trigger("click");
    await esperar();
    expect(e.get("form h2").text()).toBe("Regularizar el pago");
    expect(e.get('[data-testid="motivo-regularizar"]').text()).toBe("Motivo de la observación: El monto abonado no coincide.");
    await e.get("#p07b-banco").setValue("[Banco 2]");
    await e.get("#p07b-operacion").setValue("00999111");
    await e.get("#p07b-fecha").setValue("2026-10-11");
    await elegir(e, "#p07b-comprobante");
    await e.get("form").trigger("submit");
    await esperar();

    expect(envios).toHaveLength(1);
    expect(envios[0]!.metodo).toBe("PUT");
    expect([...envios[0]!.cuerpo.keys()]).toEqual(["banco", "numero_operacion", "fecha_pago", "archivo"]);
    expect(e.find('[data-testid="constancia"]').exists()).toBe(true);
    expect(e.find('[data-testid="observacion"]').exists()).toBe(false);
    expect(e.get('[data-testid="motivo-anterior"]').text()).toBe("Motivo anterior: El monto abonado no coincide.");
    expect(e.find('[data-testid="regularizar"]').exists()).toBe(false);
  });
});
