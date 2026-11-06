// G07 · Adjudicación de vacantes (HU0012) con la API simulada en fetch. Se monta la app con el enrutador real en
// /gestion/vacantes. Solo se prueba la lógica propia de la pantalla: la acción según el cupo, el resultado que devuelve la
// API (aunque el botón ofreciera otra cosa), el panel del dictamen y el inventario por nivel. Las reglas las aplica la API.
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { createPinia } from "pinia";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryHistory } from "vue-router";
import App from "../../App.vue";
import { usuarioActual } from "../../auth/oidc";
import { accionDe, gradosSinVacantes, mensajeResultado } from "../../gestion/adjudicacion";
import { usuarioFalso } from "../../pruebas/ayudantes";
import { crearEnrutador } from "../../router";

vi.mock("../../auth/oidc", async (original) => ({
  ...(await original<typeof import("../../auth/oidc")>()),
  usuarioActual: vi.fn(),
  iniciarSesion: vi.fn(),
}));

const apto = (id: number, grado: string, sin_vacantes: boolean, nombres = "Sofía") => ({
  id_expediente: id,
  codigo: `ADM-2027-${String(id).padStart(4, "0")}`,
  postulante: { nombres, apellidos: "Quispe Rojas" },
  grado,
  dictamen: "apto",
  recibido: "2026-11-05T15:00:00.000Z",
  sin_vacantes,
});
const inventarioBase = [
  { id_grado: 1, nivel: "inicial", grado: "3 años", autorizadas: 20, adjudicadas: 4, disponibles: 16, lista_espera: 0 },
  { id_grado: 2, nivel: "primaria", grado: "3.° de primaria", autorizadas: 30, adjudicadas: 29, disponibles: 1, lista_espera: 0 },
  { id_grado: 3, nivel: "primaria", grado: "5.° de primaria", autorizadas: 30, adjudicadas: 30, disponibles: 0, lista_espera: 1 },
];

let pendientes: ReturnType<typeof apto>[];
let inventario: typeof inventarioBase;
let respuestaAdjudicacion: () => { status: number; cuerpo: unknown };
let envios: string[];

const responder = (status: number, cuerpo: unknown) => ({ ok: status < 400, status, json: async () => cuerpo }) as Response;

function apiFalsa(url: string, init: RequestInit = {}): Response {
  const metodo = init.method ?? "GET";
  if (url === "/api/campana-activa") return responder(200, { campana: "2027" });
  if (url === "/api/direccion/adjudicacion") return responder(200, { pendientes, inventario });
  if (url === "/api/direccion/expedientes/142/dictamen") {
    return responder(200, { ...apto(142, "3.° de primaria", false), conclusiones: "Conclusiones ficticias", tiene_informe: true, fecha_emision: "2026-11-05T15:00:00.000Z" });
  }
  if (url.endsWith("/adjudicacion") && metodo === "POST") {
    envios.push(url);
    const r = respuestaAdjudicacion();
    return responder(r.status, r.cuerpo);
  }
  return responder(404, { error: { codigo: "NO_ENCONTRADO", mensaje: "Recurso no encontrado" } });
}

const montados: VueWrapper[] = [];

beforeEach(() => {
  vi.clearAllMocks();
  pendientes = [apto(142, "3.° de primaria", false), apto(155, "5.° de primaria", true, "Thiago")];
  inventario = inventarioBase;
  envios = [];
  respuestaAdjudicacion = () => ({ status: 200, cuerpo: { resultado: "vacante_asignada" } });
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
  const e = mount(App, { global: { plugins: [createPinia(), enrutador] }, attachTo: document.body });
  montados.push(e);
  await enrutador.push("/gestion/vacantes");
  await esperar();
  return e;
}

const adjudicar = async (e: VueWrapper, id: number) => {
  await e.get(`[data-testid="apto-${id}"] [data-testid="adjudicar"]`).trigger("click");
  await esperar();
};

describe("HU0012-1.0 G07 asignación de la vacante", () => {
  it("HU0012-1.0 G07 lista los aptos con los textos del mockup y la acción de cada fila depende del cupo del grado", async () => {
    const e = await abrir();

    expect(e.get('[data-testid="conteo-pendientes"]').text()).toBe("2 pendientes");
    expect(e.get('[data-testid="apto-142"]').findAll("td").map((td) => td.text())[0]).toBe("Sofía Quispe RojasADM-2027-0142");
    expect(e.get('[data-testid="apto-142"] [data-testid="adjudicar"]').text()).toBe("Aprobar y asignar vacante");
    expect(e.get('[data-testid="apto-155"] [data-testid="adjudicar"]').text()).toBe("Lista de espera");
    expect(e.get('[data-testid="aviso-sin-vacantes"]').text()).toContain("5.° de primaria no tiene vacantes disponibles.");
  });

  it("HU0012-1.0 G07 al asignar llama a la API, muestra el resultado y recarga el panel", async () => {
    const e = await abrir();
    pendientes = pendientes.filter((p) => p.id_expediente !== 142);

    await adjudicar(e, 142);

    expect(envios).toEqual(["/api/direccion/expedientes/142/adjudicacion"]);
    expect(e.get('[data-testid="resultado"]').text()).toContain("Vacante asignada a Sofía Quispe Rojas (ADM-2027-0142)");
    expect(e.find('[data-testid="apto-142"]').exists()).toBe(false);
  });

  it("HU0012-1.0 G07 el inventario se ve por nivel, con adjudicadas y lista de espera", async () => {
    const e = await abrir();
    expect(e.find('[data-testid="grado-2"]').exists()).toBe(false);

    await e.get('[data-testid="nivel-primaria"]').trigger("click");

    expect(e.get('[data-testid="grado-3"]').findAll("td").map((td) => td.text())).toEqual(["5.° de primaria", "30", "30", "0", "1"]);
    expect(e.find('[data-testid="grado-1"]').exists()).toBe(false);
  });

  it("HU0012-1.0 G07 «Ver dictamen» abre las conclusiones y el informe del expediente", async () => {
    const e = await abrir();

    await e.get('[data-testid="apto-142"] button').trigger("click");
    await esperar();

    expect(e.get('[data-testid="conclusiones"]').text()).toBe("Conclusiones ficticias");
    expect(e.find('[data-testid="ver-informe"]').exists()).toBe(true);
  });

  it("HU0012-1.0 G07 un error de la API se muestra y la fila sigue ahí", async () => {
    respuestaAdjudicacion = () => ({ status: 409, cuerpo: { error: { codigo: "ADJUDICACION_NO_CORRESPONDE", mensaje: "El expediente no tiene un dictamen Apto por decidir" } } });
    const e = await abrir();

    await adjudicar(e, 142);

    expect(e.get('[data-testid="error-accion"]').text()).toContain("dictamen Apto");
    expect(e.find('[data-testid="resultado"]').exists()).toBe(false);
  });
});

describe("HU0012-2.0 G07 grado sin vacantes", () => {
  it("HU0012-2.0 G07 muestra el resultado de la API: si la asignación terminó en lista de espera, lo dice con la posición, aunque el botón ofreciera asignar", async () => {
    respuestaAdjudicacion = () => ({ status: 200, cuerpo: { resultado: "lista_espera", posicion: 3 } });
    const e = await abrir();
    expect(e.get('[data-testid="apto-142"] [data-testid="adjudicar"]').text()).toBe("Aprobar y asignar vacante");

    await adjudicar(e, 142);

    const resultado = e.get('[data-testid="resultado"]');
    expect(resultado.text()).toContain("La vacante no se asignó");
    expect(resultado.text()).toContain("lista de espera, en la posición 3");
    expect(resultado.text()).not.toContain("Vacante asignada");
    expect(resultado.classes()).toContain("observado");
  });

  it("HU0012-2.0 la lógica de G07 nombra cada grado sin vacantes una vez y distingue los dos resultados", () => {
    expect(gradosSinVacantes([apto(1, "4.° de primaria", true), apto(2, "4.° de primaria", true), apto(3, "6.° de primaria", false)])).toEqual(["4.° de primaria"]);
    expect(accionDe({ sin_vacantes: true })).toBe("Lista de espera");
    expect(mensajeResultado({ resultado: "lista_espera", posicion: 2 }, apto(9, "4.° de primaria", true)).tono).toBe("observado");
    expect(mensajeResultado({ resultado: "vacante_asignada" }, apto(9, "4.° de primaria", false)).tono).toBe("conforme");
  });
});
