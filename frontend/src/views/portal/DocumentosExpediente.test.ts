// P06 · Documentos del expediente (HU0006) con la API simulada en fetch. Se monta la app con el enrutador real en
// /portal/documentos. Solo se prueba la lógica propia de la pantalla: secciones y estados, subida asociada al requisito (y
// al apoderado), el rechazo previo y el de la API con el aviso en el campo (HU0006-2.0), y «Confirmar documentos».
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

const requisito = (id: number, tipo: string, categoria: string, extra: Record<string, unknown> = {}) => ({
  id_requisito: id, tipo_documento: tipo, categoria, obligatorio: true, por_apoderado: false, id_apoderado: null, apoderado: null, documentos: [], ...extra,
});
const documento = (id: number, estado = "pendiente") => ({ id_documento: id, formato: "pdf", tamano_kb: 1228, fecha_carga: "2026-11-03T15:00:00.000Z", estado_verificacion: estado });

const listaBase = () => ({
  editable: true,
  confirmado_en: null as string | null,
  requisitos: [
    requisito(1, "Partida de nacimiento", "postulante_y_padres"),
    requisito(2, "Certificado de estudios", "colegio_procedencia"),
    requisito(3, "Boletas de pago", "financiero", { por_apoderado: true, id_apoderado: 10, apoderado: "María Fernanda Quispe Rojas" }),
  ],
});

let lista: ReturnType<typeof listaBase>;
let respuestaListado: () => { status: number; cuerpo: unknown };
let respuestaSubida: () => { status: number; cuerpo: unknown };
let subidas: FormData[];
let confirmaciones: number;

const responder = (status: number, cuerpo: unknown) => ({ ok: status < 400, status, json: async () => cuerpo }) as Response;
const error = (status: number, codigo: string, mensaje: string) => ({ status, cuerpo: { error: { codigo, mensaje } } });

function apiFalsa(url: string, init: RequestInit = {}): Response {
  const metodo = init.method ?? "GET";
  if (url === "/api/familia/expedientes") return responder(200, [RESUMEN]);
  if (url === `/api/familia/expedientes/${ID}/documentos` && metodo === "GET") {
    const r = respuestaListado();
    return responder(r.status, r.cuerpo);
  }
  if (url === `/api/familia/expedientes/${ID}/documentos` && metodo === "POST") {
    subidas.push(init.body as FormData);
    const r = respuestaSubida();
    return responder(r.status, r.cuerpo);
  }
  if (url === `/api/familia/expedientes/${ID}/documentos/confirmacion` && metodo === "POST") {
    confirmaciones++;
    return responder(200, { confirmado_en: "2026-11-03T15:30:00.000Z" });
  }
  return responder(404, { error: { codigo: "NO_ENCONTRADO", mensaje: "Recurso no encontrado" } });
}

const montados: VueWrapper[] = [];

beforeEach(() => {
  vi.clearAllMocks();
  lista = listaBase();
  subidas = [];
  confirmaciones = 0;
  respuestaListado = () => ({ status: 200, cuerpo: lista });
  respuestaSubida = () => ({ status: 201, cuerpo: documento(99) });
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
  await enrutador.push("/portal/documentos");
  await esperar();
  return e;
}

const PDF = [0x25, 0x50, 0x44, 0x46, 0x2d, 0x31];
const archivo = (bytes: number[], nombre: string) => new File([new Uint8Array(bytes)], nombre);

async function elegir(e: VueWrapper, testid: string, ...archivos: File[]) {
  const entrada = e.get(`[data-testid="${testid}"]`);
  Object.defineProperty(entrada.element, "files", { value: archivos, configurable: true });
  await entrada.trigger("change");
  await esperar();
}

describe("HU0006-1.0 P06 carga de documentos", () => {
  it("HU0006-1.0 agrupa los requisitos en secciones con los estados del mockup y marca la sección financiera como solo para Tesorería", async () => {
    lista.requisitos[0]!.documentos = [documento(5, "conforme")] as never;
    lista.requisitos[1]!.documentos = [documento(6, "pendiente")] as never;
    const e = await abrir();

    expect(e.get("h1").text()).toBe("Documentos del expediente");
    expect(e.get('[data-testid="seccion-postulante_y_padres"]').text()).toContain("1 de 1 conformes");
    expect(e.get('[data-testid="requisito-1-0"]').text()).toContain("Conforme");
    expect(e.get('[data-testid="requisito-2-0"]').text()).toContain("En revisión");
    expect(e.get('[data-testid="seccion-financiero"]').text()).toContain("Solo la revisa Tesorería");
    const boletas = e.get('[data-testid="requisito-3-10"]');
    expect(boletas.text()).toContain("Boletas de pago — María Fernanda Quispe Rojas");
    expect(boletas.text()).toContain("Pendiente"); // sin archivo todavía
    expect(e.get('[data-testid="requisito-1-0"]').text()).toContain("PDF · 1,2 MB · 03/11/2026");
  });

  it("HU0006-1.0 sube el archivo asociado a su requisito y a su apoderado, con los campos antes del archivo, y vuelve a pedir la lista", async () => {
    const e = await abrir();
    respuestaListado = () => ({ status: 200, cuerpo: { ...lista, requisitos: [lista.requisitos[0], lista.requisitos[1], { ...lista.requisitos[2]!, documentos: [documento(99)] }] } });

    await elegir(e, "archivo-3-10", archivo([...PDF, 1, 2, 3], "boleta-junio.pdf"));

    expect(subidas).toHaveLength(1);
    expect(Array.from(subidas[0]!.keys())).toEqual(["id_requisito", "id_apoderado", "archivo"]);
    expect(subidas[0]!.get("id_requisito")).toBe("3");
    expect(subidas[0]!.get("id_apoderado")).toBe("10");
    expect((subidas[0]!.get("archivo") as File).name).toBe("boleta-junio.pdf");
    expect(e.get('[data-testid="requisito-3-10"]').text()).toContain("Archivo 1");
    expect(e.find('[data-testid="error-3-10"]').exists()).toBe(false);
  });

  it("HU0006-1.0 «Reemplazar» envía el id del documento anterior", async () => {
    lista.requisitos[0]!.documentos = [documento(5)] as never;
    const e = await abrir();

    await elegir(e, "reemplazo-5", archivo(PDF, "partida-nueva.pdf"));

    expect(subidas).toHaveLength(1);
    expect(subidas[0]!.get("reemplaza")).toBe("5");
    expect(subidas[0]!.has("id_apoderado")).toBe(false); // el requisito no es por apoderado
  });

  it("HU0006-1.0 «Confirmar documentos» solicita la verificación y muestra la confirmación", async () => {
    const e = await abrir();
    expect(e.find('[data-testid="confirmado"]').exists()).toBe(false);

    await e.findAll("button").find((b) => b.text() === "Confirmar documentos")!.trigger("click");
    await esperar();

    expect(confirmaciones).toBe(1);
    expect(e.get('[data-testid="confirmado"]').text()).toContain("Confirmaste tus documentos el 03/11/2026");
  });

  it("HU0006-1.0 con un cupo de archivos agotado (409) el aviso del servidor queda junto al requisito", async () => {
    const e = await abrir();
    respuestaSubida = () => error(409, "LIMITE_DOCUMENTOS_REQUISITO", "Ya cargaste el máximo de 20 archivos para este documento. Reemplaza alguno en lugar de agregar más.");

    await elegir(e, "archivo-1-0", archivo(PDF, "otra.pdf"));

    expect(e.get('[data-testid="error-1-0"]').text()).toContain("Ya cargaste el máximo de 20 archivos");
  });

  it("HU0006-1.0 fuera de en_postulacion no ofrece subir ni confirmar", async () => {
    lista.editable = false;
    const e = await abrir();

    expect(e.find('[data-testid="no-editable"]').exists()).toBe(true);
    expect(e.find('[data-testid="archivo-1-0"]').exists()).toBe(false);
    expect(e.findAll("button").some((b) => b.text() === "Confirmar documentos")).toBe(false);
  });

  it("HU0006-1.0 con la ficha incompleta pide completarla y enlaza a la ficha", async () => {
    respuestaListado = () => error(409, "FICHA_INCOMPLETA", "Completa la ficha para cargar los documentos");
    const e = await abrir();

    expect(e.get('[data-testid="error-carga"]').text()).toContain("Completa la ficha para cargar los documentos.");
    expect(e.get('[data-testid="error-carga"] a').attributes("href")).toBe("/portal/ficha");
  });
});

describe("HU0006-2.0 P06 rechaza un archivo con formato o tamaño no soportado", () => {
  it("HU0006-2.0 un ZIP o un ejecutable renombrado a .pdf no se envía: resalta el requisito con el aviso de formatos admitidos", async () => {
    const e = await abrir();

    await elegir(e, "archivo-1-0", archivo([0x50, 0x4b, 0x03, 0x04], "comprimido.zip"));
    expect(subidas).toHaveLength(0);
    expect(e.get('[data-testid="error-1-0"]').text()).toBe(MENSAJE);
    expect(e.get('[data-testid="requisito-1-0"]').classes()).toContain("invalido");

    await elegir(e, "archivo-2-0", archivo([0x4d, 0x5a, 0x90, 0x00], "factura.pdf"));
    expect(subidas).toHaveLength(0);
    expect(e.get('[data-testid="error-2-0"]').text()).toBe(MENSAJE);
  });

  it("HU0006-2.0 un archivo de más de 10 MB no se envía y el aviso desaparece al subir uno válido", async () => {
    const e = await abrir();
    const grande = new Uint8Array(10 * 1024 * 1024 + 1);
    grande.set(PDF);

    await elegir(e, "archivo-1-0", new File([grande], "grande.pdf"));
    expect(subidas).toHaveLength(0);
    expect(e.get('[data-testid="error-1-0"]').text()).toBe(MENSAJE);

    await elegir(e, "archivo-1-0", archivo(PDF, "bien.pdf"));
    expect(subidas).toHaveLength(1);
    expect(e.find('[data-testid="error-1-0"]').exists()).toBe(false);
    expect(e.get('[data-testid="requisito-1-0"]').classes()).not.toContain("invalido");
  });

  it("HU0006-2.0 si la API rechaza el archivo (413 o 415) se muestra el mismo aviso de formatos admitidos", async () => {
    const e = await abrir();

    respuestaSubida = () => error(415, "FORMATO_NO_ADMITIDO", "Solo se aceptan archivos PDF, JPG o PNG de hasta 10 MB");
    await elegir(e, "archivo-1-0", archivo(PDF, "raro.pdf"));
    expect(e.get('[data-testid="error-1-0"]').text()).toBe(MENSAJE);

    respuestaSubida = () => error(413, "ARCHIVO_DEMASIADO_GRANDE", "Solo se aceptan archivos PDF, JPG o PNG de hasta 10 MB");
    await elegir(e, "archivo-2-0", archivo(PDF, "pesado.pdf"));
    expect(e.get('[data-testid="error-2-0"]').text()).toBe(MENSAJE);
  });
});
