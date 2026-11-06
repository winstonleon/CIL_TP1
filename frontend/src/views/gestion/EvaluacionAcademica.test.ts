// G11 · Registro de la evaluación académica (HU0025) con la API simulada en fetch y el enrutador real en
// /gestion/evaluacion-academica. Solo se prueba la lógica propia de la pantalla: la tabla del día con los estados del
// mockup, el formulario con sus campos obligatorios, la nota de R3 y «Marcar “No asistió”» con confirmación.
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

const fila = (id_cita: number, nombres: string, codigo: string, hora_inicio: string, estado = "reservada") => ({
  id_cita, id_expediente: id_cita + 100, codigo, postulante: { nombres, apellidos: "Ficticia" }, grado: "3.° primaria", tipo_cita: "evaluacion_academica",
  fecha: "2027-10-27", hora_inicio, hora_fin: "09:00", estado, resultado_registrado: estado !== "reservada",
});

let citas: ReturnType<typeof fila>[];
let envios: { url: string; cuerpo: unknown }[];

const responder = (status: number, cuerpo: unknown) => ({ ok: status < 400, status, json: async () => cuerpo }) as Response;

function apiFalsa(url: string, init: RequestInit = {}): Response {
  const metodo = init.method ?? "GET";
  if (url === "/api/campana-activa") return responder(200, { campana: "2027" });
  if (url.startsWith("/api/evaluacion-academica/agenda?")) return responder(200, { fecha: "2027-10-27", citas });
  const cita = /^\/api\/evaluacion-academica\/citas\/(\d+)$/.exec(url);
  if (cita && metodo === "GET") {
    const c = citas.find((x) => x.id_cita === Number(cita[1]))!;
    return responder(200, { ...c, iniciada: true, registrable: c.estado === "reservada", resultado: c.estado === "asistio" ? { resultado: "Logrado", observaciones: "Bien" } : null });
  }
  if (metodo === "POST") {
    envios.push({ url, cuerpo: JSON.parse(String(init.body)) });
    return responder(url.endsWith("/inasistencia") ? 200 : 201, {});
  }
  return responder(404, { error: { codigo: "NO_ENCONTRADO", mensaje: "Recurso no encontrado" } });
}

const montados: VueWrapper[] = [];

beforeEach(() => {
  vi.clearAllMocks();
  citas = [fila(1, "Sofía", "ADM-2027-0142", "08:00"), fila(2, "Thiago", "ADM-2027-0155", "12:30", "asistio")];
  envios = [];
  vi.stubEnv("VITE_API_URL", "/api");
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => apiFalsa(url, init)));
  vi.mocked(usuarioActual).mockResolvedValue(usuarioFalso(["evaluador_academico"], "Luis Paredes"));
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
  await enrutador.push("/gestion/evaluacion-academica");
  await esperar();
  return e;
}

async function abrirCita(e: VueWrapper, id: number) {
  await e.get(`[data-testid="cita-${id}"]`).trigger("click");
  await esperar();
}

describe("HU0025-1.0 G11 registro del resultado de la evaluación académica", () => {
  it("HU0025-1.0 G11 la tabla del día tiene Hora, Postulante, Grado y Estado con los textos del mockup, y una evaluación registrada se ve en solo lectura", async () => {
    const e = await abrir();
    expect(e.findAll("th").map((t) => t.text())).toEqual(["Hora", "Postulante", "Grado", "Estado"]);
    expect(e.get('[data-testid="fila-1"]').findAll("td").map((t) => t.text())).toEqual(["8:00 a. m.", "Sofía FicticiaADM-2027-0142", "3.° primaria", expect.stringMatching(/^(Programada|En curso)$/)]);
    expect(e.get('[data-testid="fila-2"]').findAll("td")[3]!.text()).toBe("Registrada");

    await abrirCita(e, 2);
    expect(e.get('[data-testid="resultado-registrado"]').text()).toContain("Logrado");
    expect(e.find('[data-testid="guardar-resultado"]').exists()).toBe(false);
  });

  it("HU0025-1.0 G11 el resultado y las observaciones son obligatorios; al confirmar envía ambos y muestra la nota de que no hay acceso al informe psicológico ni a la documentación financiera", async () => {
    const e = await abrir();
    await abrirCita(e, 1);
    expect(e.get('[data-testid="nota-r3"]').text()).toContain("No tienes acceso al informe psicológico ni a la documentación financiera.");
    expect(e.get('[data-testid="campo-resultado"]').attributes("placeholder")).toBe("[Escala de calificación por definir]");

    await e.get('[data-testid="guardar-resultado"]').trigger("click");
    await esperar();
    expect(envios).toEqual([]);
    expect(e.get('[data-testid="campo-resultado"]').attributes("aria-invalid")).toBe("true");
    expect(e.get('[data-testid="campo-observaciones"]').attributes("aria-invalid")).toBe("true");

    await e.get('[data-testid="campo-resultado"]').setValue("Satisfactorio");
    await e.get('[data-testid="campo-observaciones"]').setValue("Resolvió los ejercicios de comprensión lectora");
    await e.get('[data-testid="guardar-resultado"]').trigger("click");
    await esperar();
    expect(envios).toEqual([{ url: "/api/evaluacion-academica/citas/1/resultado", cuerpo: { resultado: "Satisfactorio", observaciones: "Resolvió los ejercicios de comprensión lectora" } }]);
  });
});

describe("HU0025-2.0 G11 registro de inasistencia", () => {
  it("HU0025-2.0 G11 «Marcar “No asistió”» pide confirmación; cancelar no envía nada y confirmar registra la inasistencia", async () => {
    const e = await abrir();
    await abrirCita(e, 1);

    await e.get('[data-testid="marcar-no-asistio"]').trigger("click");
    expect(e.get('[data-testid="confirmar-inasistencia"]').text()).toContain("La cita se libera y se avisa a la familia para que la reprograme.");
    await e.get('[data-testid="confirmar-inasistencia"] button').trigger("click"); // Cancelar
    expect(envios).toEqual([]);
    expect(e.find('[data-testid="confirmar-inasistencia"]').exists()).toBe(false);

    await e.get('[data-testid="marcar-no-asistio"]').trigger("click");
    citas = [fila(1, "Sofía", "ADM-2027-0142", "08:00", "no_asistio"), citas[1]!];
    await e.get('[data-testid="confirmar-no-asistio"]').trigger("click");
    await esperar();
    expect(envios).toEqual([{ url: "/api/evaluacion-academica/citas/1/inasistencia", cuerpo: {} }]);
    expect(e.get('[data-testid="fila-1"]').findAll("td")[3]!.text()).toBe("No asistió");
  });
});
