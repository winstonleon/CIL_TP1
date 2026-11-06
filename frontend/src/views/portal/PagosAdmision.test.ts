// P07 · Registro de comprobantes de pago (HU0013, HU0014 y HU0015-2.0) con la API simulada en fetch. Se monta la app con el
// enrutador real en /portal/pagos. Solo se prueba la lógica propia de la pantalla: montos y fracciones de la configuración,
// el cambio de modalidad, los estados derivados del Pago, el formulario y la regularización. Las reglas las aplica la API.
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { createPinia } from "pinia";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryHistory } from "vue-router";
import App from "../../App.vue";
import { usuarioActual } from "../../auth/oidc";
import { errorFracciones, errorMonto, estadoCuota, etiquetaPago, soles } from "../../portal/cuotaIngreso";
import { usuarioFalso } from "../../pruebas/ayudantes";
import { crearEnrutador } from "../../router";

vi.mock("../../auth/oidc", async (original) => ({
  ...(await original<typeof import("../../auth/oidc")>()),
  usuarioActual: vi.fn(),
  iniciarSesion: vi.fn(),
}));

const ID = 7;
const RUTA = `/api/familia/expedientes/${ID}/cuota-ingreso`;
const resumen = { id_expediente: ID, codigo: "ADM-2027-0007", estado: "vacante_asignada", grado: "3.° de primaria", postulante: "Sofía Quispe Rojas", ficha_completa: true };

const cuotaBase = () => ({
  version: "borrador-1",
  disponible: true,
  aplica: true,
  nivel: "primaria",
  grado: "3.° de primaria",
  monto: 7000,
  max_fracciones: 3,
  modalidad: null as string | null,
  numero_fracciones: null as number | null,
  montos: [] as number[],
  bancos: ["[Banco 1]"],
  cuenta_colegio: "[Banco y N.º de cuenta del colegio]",
  modalidad_editable: true,
  registrable: false,
  pago: null as Record<string, unknown> | null,
  derecho: { estado: "conforme", monto: 300, numero_operacion: "00457812", fecha_pago: "2026-10-10", fecha_validacion: "2026-10-12T15:00:00.000Z" } as Record<string, unknown> | null,
});
const elegida = (cambios: Partial<ReturnType<typeof cuotaBase>> = {}) => ({ ...cuotaBase(), modalidad: "unico", numero_fracciones: 1, montos: [7000], registrable: true, ...cambios });
const pagoBase = (cambios: Record<string, unknown> = {}) => ({
  id_pago: 31, numero_fraccion: 1, banco: "[Banco 1]", numero_operacion: "00912455", monto: 7000, fecha_pago: "2026-10-20", estado: "pendiente",
  subsanable: false, motivo_observacion: null, motivo_anterior: null, fecha_validacion: null, ...cambios,
});

let cuota: ReturnType<typeof cuotaBase>;
let respuestaModalidad: () => { status: number; cuerpo: unknown };
let respuestaComprobante: () => { status: number; cuerpo: unknown };
let envios: { metodo: string; url: string; cuerpo: unknown }[];

const responder = (status: number, cuerpo: unknown) => ({ ok: status < 400, status, json: async () => cuerpo }) as Response;
const error = (status: number, codigo: string, mensaje: string) => ({ status, cuerpo: { error: { codigo, mensaje } } });

function apiFalsa(url: string, init: RequestInit = {}): Response {
  const metodo = init.method ?? "GET";
  if (url === "/api/familia/expedientes") return responder(200, [resumen]);
  if (url === RUTA && metodo === "GET") return responder(200, cuota);
  if (url === `${RUTA}/modalidad`) {
    envios.push({ metodo, url, cuerpo: JSON.parse(String(init.body)) });
    const r = respuestaModalidad();
    return responder(r.status, r.cuerpo);
  }
  if (url === RUTA) {
    const formulario = init.body as FormData;
    envios.push({ metodo, url, cuerpo: Object.fromEntries([...formulario.entries()].filter(([k]) => k !== "archivo")) });
    const r = respuestaComprobante();
    return responder(r.status, r.cuerpo);
  }
  return responder(404, { error: { codigo: "NO_ENCONTRADO", mensaje: "Recurso no encontrado" } });
}

const montados: VueWrapper[] = [];

beforeEach(() => {
  vi.clearAllMocks();
  cuota = cuotaBase();
  envios = [];
  respuestaModalidad = () => ({ status: 200, cuerpo: elegida() });
  respuestaComprobante = () => ({ status: 201, cuerpo: elegida({ registrable: false, modalidad_editable: false, pago: pagoBase() }) });
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
  await enrutador.push("/portal/pagos");
  await esperar();
  return e;
}

const pdf = () => new File([new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31])], "voucher.pdf", { type: "application/pdf" });

async function adjuntar(e: VueWrapper, archivo: File) {
  const entrada = e.get("#p07-comprobante");
  Object.defineProperty(entrada.element, "files", { value: [archivo], configurable: true });
  await entrada.trigger("change");
  await esperar();
}

async function llenar(e: VueWrapper) {
  await e.get("#p07-banco").setValue("[Banco 1]");
  await e.get("#p07-operacion").setValue("00912455");
  await e.get("#p07-fecha").setValue("2026-10-20");
  await adjuntar(e, pdf());
}

const enviar = async (e: VueWrapper) => {
  await e.get('[data-testid="form-comprobante"]').trigger("submit");
  await esperar();
};

describe("HU0013-1.0 P07 modalidad de pago", () => {
  it("HU0013-1.0 P07 muestra el monto del nivel y el derecho validado, y al confirmar el pago único habilita la carga del comprobante", async () => {
    const e = await abrir();

    expect(e.get('[data-testid="tarjeta-cuota"] h2').text()).toBe("Cuota de ingreso · Primaria");
    expect(e.get('[data-testid="estado-cuota"]').text()).toBe("Vacante otorgada");
    expect(e.get('[data-testid="monto-cuota"]').text()).toBe("S/ 7,000");
    expect(e.get('[data-testid="tarjeta-derecho"]').text()).toContain("Validado por Tesorería");
    expect(e.find('[data-testid="derecho-validado"]').exists()).toBe(true);
    expect(e.find('[data-testid="form-comprobante"]').exists()).toBe(false);

    await e.get('[data-testid="form-modalidad"]').trigger("submit");
    await esperar();

    expect(envios).toEqual([{ metodo: "POST", url: `${RUTA}/modalidad`, cuerpo: { modalidad: "unico" } }]);
    expect(e.get('[data-testid="modalidad-elegida"]').text()).toContain("Pago único");
    expect(e.find('[data-testid="form-comprobante"]').exists()).toBe(true);
    expect((e.get("#p07-monto").element as HTMLInputElement).value).toBe("7000.00");
  });

  it("HU0013-1.0 P07 con pago fraccionado envía el número de fracciones y muestra el monto de cada pago", async () => {
    respuestaModalidad = () => ({ status: 200, cuerpo: elegida({ modalidad: "fraccionado", numero_fracciones: 3, montos: [2333.33, 2333.33, 2333.34] }) });
    const e = await abrir();
    expect(e.get('[data-testid="form-modalidad"]').text()).toContain("Hasta 3 fracciones");

    await e.get('[data-testid="modalidad-fraccionado"]').setValue();
    await e.get("#p07-fracciones").setValue("3");
    await e.get('[data-testid="form-modalidad"]').trigger("submit");
    await esperar();

    expect(envios[0]!.cuerpo).toEqual({ modalidad: "fraccionado", numero_fracciones: 3 });
    const filas = e.findAll('[data-testid="modalidad-elegida"] li').map((li) => li.text());
    expect(filas).toEqual(["Fracción 1 de 3S/ 2,333.33", "Fracción 2 de 3S/ 2,333.33", "Fracción 3 de 3S/ 2,333.34"]);
    expect((e.get("#p07-monto").element as HTMLInputElement).value).toBe("2333.33");
  });

  it("HU0013-1.0 P07 (cambio de modalidad) sin pago registrado se puede cambiar; con pago registrado ya no se ofrece", async () => {
    cuota = elegida();
    respuestaModalidad = () => ({ status: 200, cuerpo: elegida({ modalidad: "fraccionado", numero_fracciones: 2, montos: [3500, 3500] }) });
    const e = await abrir();

    await e.get('[data-testid="cambiar-modalidad"]').trigger("click");
    await e.get('[data-testid="modalidad-fraccionado"]').setValue();
    await e.get("#p07-fracciones").setValue("2");
    await e.get('[data-testid="form-modalidad"]').trigger("submit");
    await esperar();

    expect(envios[0]!.cuerpo).toEqual({ modalidad: "fraccionado", numero_fracciones: 2 });
    expect(e.find('[data-testid="form-modalidad"]').exists()).toBe(false);

    cuota = elegida({ modalidad_editable: false, registrable: false, pago: pagoBase() });
    const conPago = await abrir();
    expect(conPago.find('[data-testid="cambiar-modalidad"]').exists()).toBe(false);
    expect(conPago.find('[data-testid="form-modalidad"]').exists()).toBe(false);
  });

  it("HU0013-1.0 P07 sin la vacante, la cuota no se ofrece; con cuota 0 dice que el grado no la tiene; sin fracciones, «Pago fraccionado» se ve deshabilitado", async () => {
    cuota = { ...cuotaBase(), disponible: false, modalidad_editable: false };
    expect((await abrir()).find('[data-testid="cuota-no-disponible"]').exists()).toBe(true);

    cuota = { ...cuotaBase(), aplica: false, modalidad_editable: false };
    expect((await abrir()).get('[data-testid="cuota-no-aplica"]').text()).toBe("Este grado no tiene cuota de ingreso.");

    cuota = { ...cuotaBase(), max_fracciones: 1 };
    const e = await abrir();
    expect((e.get('[data-testid="modalidad-fraccionado"]').element as HTMLInputElement).disabled).toBe(true);
    expect(e.get('[data-testid="form-modalidad"]').text()).toContain("No disponible en este grado");
  });
});

describe("HU0013-2.0 P07 número de fracciones no permitido", () => {
  it("HU0013-2.0 P07 muestra el máximo que informa la API y no habilita la carga", async () => {
    respuestaModalidad = () => error(422, "FRACCIONES_NO_PERMITIDAS", "El número máximo de fracciones permitido es 3");
    const e = await abrir();

    await e.get('[data-testid="modalidad-fraccionado"]').setValue();
    await e.get("#p07-fracciones").setValue("9");
    await e.get('[data-testid="form-modalidad"]').trigger("submit");
    await esperar();

    expect(e.get('[data-testid="error-modalidad"]').text()).toBe("El número máximo de fracciones permitido es 3");
    expect(e.find('[data-testid="form-comprobante"]').exists()).toBe(false);
  });

  it("HU0013-2.0 P07 un número que no es una cantidad de fracciones no llega a la API", async () => {
    const e = await abrir();
    await e.get('[data-testid="modalidad-fraccionado"]').setValue();
    await e.get("#p07-fracciones").setValue("1");
    await e.get('[data-testid="form-modalidad"]').trigger("submit");
    await esperar();
    expect(envios).toEqual([]);
    expect(errorFracciones("abc")).not.toBe("");
    expect(errorFracciones("2")).toBe("");
  });
});

describe("HU0014-1.0 P07 comprobante de la cuota", () => {
  it("HU0014-1.0 P07 «Confirmar pago de cuota» envía los datos y el archivo, y deja la cuota «en conciliación»", async () => {
    cuota = elegida();
    const e = await abrir();
    await llenar(e);

    await enviar(e);

    expect(envios).toEqual([{ metodo: "POST", url: RUTA, cuerpo: { banco: "[Banco 1]", numero_operacion: "00912455", fecha_pago: "2026-10-20", monto: "7000.00" } }]);
    expect(e.get('[data-testid="estado-cuota"]').text()).toBe("Cuota en conciliación");
    expect(e.find('[data-testid="comprobante-cuota"]').exists()).toBe(true);
    expect(e.find('[data-testid="form-comprobante"]').exists()).toBe(false);
  });

  it("HU0014-1.0 P07 los campos son obligatorios, el monto abonado debe ser válido y un duplicado muestra la alerta", async () => {
    cuota = elegida();
    const e = await abrir();
    await e.get("#p07-monto").setValue("abc");
    await enviar(e);
    expect(envios).toEqual([]);
    expect(e.text()).toContain("Selecciona el banco.");
    expect(e.text()).toContain("Escribe el monto abonado");
    expect(errorMonto("7000.50")).toBe("");
    expect(errorMonto("0")).not.toBe("");

    respuestaComprobante = () => error(409, "COMPROBANTE_DUPLICADO", "Este comprobante ya fue registrado.");
    await e.get("#p07-monto").setValue("7000");
    await llenar(e);
    await enviar(e);
    expect(e.find('[data-testid="alerta-duplicado"]').exists()).toBe(true);
    expect(e.text()).toContain("Este N.° de operación ya está registrado.");
  });
});

describe("HU0014-2.0 P07 archivo no válido", () => {
  it("HU0014-2.0 [parte: formato] P07 rechaza el archivo por su firma, advierte el formato y no llama a la API", async () => {
    cuota = elegida();
    const e = await abrir();
    await llenar(e);
    await adjuntar(e, new File([new Uint8Array([0x4d, 0x5a, 0x90, 0x00])], "voucher.pdf", { type: "application/pdf" }));

    await enviar(e);

    expect(envios).toEqual([]);
    expect(e.get('[data-testid="ayuda-archivo"]').text()).toContain("Solo se aceptan archivos PDF, JPG o PNG");
    expect(e.get('[data-testid="ayuda-archivo"]').text()).toContain("Carga un PDF o JPG legible.");
  });

  it("HU0014-2.0 [parte: formato] P07 si la API rechaza el archivo, pide cargar un PDF o JPG legible", async () => {
    cuota = elegida();
    respuestaComprobante = () => error(415, "FORMATO_NO_ADMITIDO", "Formato no admitido");
    const e = await abrir();
    await llenar(e);

    await enviar(e);

    expect(e.get('[data-testid="ayuda-archivo"]').text()).toContain("Carga un PDF o JPG legible.");
  });
});

describe("HU0015 P07 resultado de la conciliación", () => {
  it("HU0015-1.0 [parte: conciliación] P07 muestra «Cuota acreditada» con la fecha de validación", async () => {
    cuota = elegida({ registrable: false, modalidad_editable: false, pago: pagoBase({ estado: "conforme", fecha_validacion: "2026-10-21T15:00:00.000Z" }) });
    const e = await abrir();
    expect(e.get('[data-testid="estado-cuota"]').text()).toBe("Cuota acreditada");
    expect(e.get('[data-testid="comprobante-cuota"]').text()).toContain("Validado");
  });

  it("HU0015-2.0 P07 muestra «Cuota observada» con el motivo y regulariza con PUT en la misma fila; después el motivo es el anterior", async () => {
    const motivo = "El abono es menor al monto que corresponde";
    cuota = elegida({ registrable: false, modalidad_editable: false, pago: pagoBase({ estado: "observado", subsanable: true, motivo_observacion: motivo }) });
    respuestaComprobante = () => ({ status: 200, cuerpo: elegida({ registrable: false, modalidad_editable: false, pago: pagoBase({ motivo_anterior: motivo }) }) });
    const e = await abrir();

    expect(e.get('[data-testid="estado-cuota"]').text()).toBe("Cuota observada");
    expect(e.get('[data-testid="observacion"]').text()).toContain(motivo);

    await e.get('[data-testid="regularizar-cuota"]').trigger("click");
    expect(e.get('[data-testid="motivo-regularizar"]').text()).toContain(motivo);
    await llenar(e);
    await enviar(e);

    expect(envios[0]!.metodo).toBe("PUT");
    expect(e.get('[data-testid="estado-cuota"]').text()).toBe("Cuota en conciliación");
    expect(e.get('[data-testid="motivo-anterior"]').text()).toContain(motivo);
    expect(e.find('[data-testid="observacion"]').exists()).toBe(false);
  });
});

describe("HU0013-1.0 lógica de P07", () => {
  it("HU0013-1.0 los montos y los estados se muestran con los textos de la HU", () => {
    expect(soles(7000)).toBe("S/ 7,000");
    expect(soles(2333.34)).toBe("S/ 2,333.34");
    expect(etiquetaPago(0, 1)).toBe("Pago único");
    expect(etiquetaPago(1, 3)).toBe("Fracción 2 de 3");
    expect(estadoCuota({ disponible: false, pago: null })).toBeNull();
    expect(estadoCuota({ disponible: true, pago: null })?.texto).toBe("Vacante otorgada");
  });
});
