// P07b · Registro del derecho de admisión (HU0007) con la API simulada en fetch. Se monta la app con el enrutador real en
// /portal/pagos/derecho-admision. Solo se prueba la lógica propia: campos obligatorios, el archivo, el envío con los campos
// antes del archivo, el comprobante duplicado marcado en el campo (HU0007-2.0) y la constancia (HU0007-1.0).
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
const RESUMEN = { id_expediente: ID, codigo: "ADM-2027-0007", estado: "en_postulacion", grado: "3.° de primaria", postulante: "Sofía Quispe Rojas", ficha_completa: true };
const MENSAJE = "Solo se aceptan archivos PDF, JPG o PNG de hasta 10 MB.";
const CONSTANCIA = {
  codigo: "CONST-ADM-2027-0007-31", expediente: "ADM-2027-0007", postulante: "Sofía Quispe Rojas", concepto: "Derecho de admisión", monto: 300,
  banco: "[Banco 1]", numero_operacion: "00457812", fecha_pago: "2026-10-10", registrado_en: "2026-10-11T00:05:00.000Z", estado: "pendiente",
};
const derechoBase = () => ({ version: "borrador-1", monto: 300, bancos: ["[Banco 1]", "[Banco 2]"], cuenta_colegio: "[Banco y N.º de cuenta del colegio]", registrable: true, pago: null as unknown });

let derecho: ReturnType<typeof derechoBase>;
let respuestaRegistro: () => { status: number; cuerpo: unknown };
let envios: FormData[];

const responder = (status: number, cuerpo: unknown) => ({ ok: status < 400, status, json: async () => cuerpo }) as Response;
const error = (status: number, codigo: string, mensaje: string) => ({ status, cuerpo: { error: { codigo, mensaje } } });

function apiFalsa(url: string, init: RequestInit = {}): Response {
  const metodo = init.method ?? "GET";
  if (url === "/api/familia/expedientes") return responder(200, [RESUMEN]);
  if (url === `/api/familia/expedientes/${ID}/derecho-admision` && metodo === "GET") return responder(200, derecho);
  if (url === `/api/familia/expedientes/${ID}/derecho-admision` && metodo === "POST") {
    envios.push(init.body as FormData);
    const r = respuestaRegistro();
    return responder(r.status, r.cuerpo);
  }
  return responder(404, { error: { codigo: "NO_ENCONTRADO", mensaje: "Recurso no encontrado" } });
}

const montados: VueWrapper[] = [];

beforeEach(() => {
  vi.clearAllMocks();
  derecho = derechoBase();
  envios = [];
  respuestaRegistro = () => ({ status: 201, cuerpo: CONSTANCIA });
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

async function abrir() {
  const enrutador = crearEnrutador(createMemoryHistory());
  const e = mount(App, { global: { plugins: [createPinia(), enrutador] }, attachTo: document.body });
  montados.push(e);
  await enrutador.push("/portal/pagos/derecho-admision");
  await esperar();
  return e;
}

const PDF = [0x25, 0x50, 0x44, 0x46, 0x2d, 0x31];
const archivo = (bytes: number[], nombre: string) => new File([new Uint8Array(bytes)], nombre);

async function elegirArchivo(e: VueWrapper, f: File) {
  const entrada = e.get("#p07b-comprobante");
  Object.defineProperty(entrada.element, "files", { value: [f], configurable: true });
  await entrada.trigger("change");
  await esperar();
}

async function llenar(e: VueWrapper, cambios: Partial<{ banco: string; operacion: string; fecha: string }> = {}) {
  await e.get("#p07b-banco").setValue(cambios.banco ?? "[Banco 1]");
  await e.get("#p07b-operacion").setValue(cambios.operacion ?? "00457812");
  await e.get("#p07b-fecha").setValue(cambios.fecha ?? "2026-10-10");
}

const enviar = async (e: VueWrapper) => {
  await e.get("form").trigger("submit");
  await esperar();
};

describe("HU0007-1.0 P07b registro del comprobante del derecho de admisión", () => {
  it("HU0007-1.0 muestra el monto de S/ 300 y la cuenta del colegio que entrega la API, con los bancos de la lista", async () => {
    const e = await abrir();

    expect(e.get("h1").text()).toBe("Registrar el derecho de admisión");
    expect(e.text()).toContain("S/ 300 (no reembolsable)");
    expect(e.text()).toContain("[Banco y N.º de cuenta del colegio]");
    expect(e.get("#p07b-banco").findAll("option").map((o) => o.text())).toEqual(["Selecciona", "[Banco 1]", "[Banco 2]"]);
  });

  it("HU0007-1.0 un envío con campos vacíos no llama a la API y marca cada campo obligatorio", async () => {
    const e = await abrir();

    await enviar(e);

    expect(envios).toHaveLength(0);
    expect(e.text()).toContain("Selecciona el banco.");
    expect(e.text()).toContain("Escribe el N.° de operación.");
    expect(e.text()).toContain("Escribe la fecha de pago.");
    expect(e.get('[data-testid="ayuda-archivo"]').text()).toBe("Adjunta el comprobante de pago.");
  });

  it("HU0007-1.0 envía el comprobante con los campos antes del archivo y muestra la constancia con el estado pendiente de validación", async () => {
    const e = await abrir();
    await llenar(e);
    await elegirArchivo(e, archivo(PDF, "voucher.pdf"));

    await enviar(e);

    expect(envios).toHaveLength(1);
    expect(Array.from(envios[0]!.keys())).toEqual(["banco", "numero_operacion", "fecha_pago", "archivo"]);
    expect(envios[0]!.get("numero_operacion")).toBe("00457812");
    const constancia = e.get('[data-testid="constancia"]').text();
    expect(constancia).toContain("Constancia de registro del comprobante");
    expect(constancia).toContain("Recibimos tu comprobante");
    expect(constancia).toContain("S/ 300");
    expect(constancia).toContain("10/10/2026"); // fecha de pago
    expect(constancia).toContain("Registrado el");
    expect(constancia).toContain("Pendiente de validación");
    expect(e.get('[data-testid="codigo-constancia"]').text()).toBe("CONST-ADM-2027-0007-31");
    expect(e.find("form").exists()).toBe(false);
  });

  it("HU0007-1.0 una fecha de pago futura se marca en el campo y no se envía", async () => {
    const e = await abrir();
    await llenar(e, { fecha: "2999-01-01" });
    await elegirArchivo(e, archivo(PDF, "voucher.pdf"));

    await enviar(e);

    expect(envios).toHaveLength(0);
    expect(e.text()).toContain("La fecha de pago no puede ser futura.");
  });

  it("HU0007-1.0 un comprobante que no es PDF, JPG ni PNG se marca en el campo y no se envía", async () => {
    const e = await abrir();
    await llenar(e);
    await elegirArchivo(e, archivo([0x50, 0x4b, 0x03, 0x04], "voucher.pdf"));
    expect(e.get('[data-testid="ayuda-archivo"]').text()).toBe(MENSAJE);

    await enviar(e);

    expect(envios).toHaveLength(0);
    expect(e.get('[data-testid="ayuda-archivo"]').text()).toBe(MENSAJE);
  });

  it("HU0007-1.0 si la API rechaza el comprobante (413 o 415) se muestra el mismo aviso de formatos admitidos", async () => {
    const e = await abrir();
    await llenar(e);
    await elegirArchivo(e, archivo(PDF, "voucher.pdf"));
    respuestaRegistro = () => error(415, "FORMATO_NO_ADMITIDO", "Solo se aceptan archivos PDF, JPG o PNG de hasta 10 MB");

    await enviar(e);

    expect(e.get('[data-testid="ayuda-archivo"]').text()).toBe(MENSAJE);
    expect(e.find('[data-testid="constancia"]').exists()).toBe(false);
  });

  it("HU0007-1.0 al volver con el comprobante ya registrado muestra la constancia, sin la hora de registro que la API no guarda", async () => {
    derecho = { ...derechoBase(), registrable: false, pago: { ...CONSTANCIA, registrado_en: null } };
    const e = await abrir();

    const constancia = e.get('[data-testid="constancia"]').text();
    expect(constancia).toContain("00457812");
    expect(constancia).not.toContain("Registrado el");
    expect(e.find("form").exists()).toBe(false);
  });

  it("HU0007-1.0 fuera del estado en que se registra no muestra el formulario", async () => {
    derecho = { ...derechoBase(), registrable: false };
    const e = await abrir();

    expect(e.find('[data-testid="no-registrable"]').exists()).toBe(true);
    expect(e.find("form").exists()).toBe(false);
  });
});

describe("HU0007-2.0 P07b comprobante duplicado", () => {
  it("HU0007-2.0 ante un número de operación ya registrado muestra la alerta, marca el campo y deja el formulario para corregir", async () => {
    const e = await abrir();
    await llenar(e);
    await elegirArchivo(e, archivo(PDF, "voucher.pdf"));
    respuestaRegistro = () => error(409, "COMPROBANTE_DUPLICADO", "Este comprobante ya fue registrado. Revisa el N.° de operación.");

    await enviar(e);

    const alerta = e.get('[data-testid="alerta-duplicado"]').text();
    expect(alerta).toContain("Este comprobante ya fue registrado.");
    expect(alerta).toContain("comunícate con la Secretaría de Admisión");
    expect(e.get("#p07b-operacion-error").text()).toBe("Este N.° de operación ya está registrado.");
    expect(e.get("#p07b-operacion").attributes("aria-invalid")).toBe("true");
    expect(e.find('[data-testid="constancia"]').exists()).toBe(false);

    // La familia corrige el número y el siguiente envío sale sin la alerta.
    respuestaRegistro = () => ({ status: 201, cuerpo: CONSTANCIA });
    await e.get("#p07b-operacion").setValue("00457813");
    await enviar(e);
    expect(envios).toHaveLength(2);
    expect(envios[1]!.get("numero_operacion")).toBe("00457813");
    expect(e.find('[data-testid="alerta-duplicado"]').exists()).toBe(false);
    expect(e.find('[data-testid="constancia"]').exists()).toBe(true);
  });
});
