// P02 · Agendamiento de la visita guiada (HU0003-1.0, HU0003-2.0 y C31) con la API simulada en fetch. Se monta la app
// con el enrutador real en /visita-guiada?t=…: así se prueba que la ruta es pública (sin sesión) y que el token del
// enlace viaja en la cabecera X-Enlace-Visita, nunca en la URL de la API ni como Authorization.
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { createPinia } from "pinia";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryHistory } from "vue-router";
import App from "../../App.vue";
import { usuarioActual } from "../../auth/oidc";
import { crearEnrutador } from "../../router";

vi.mock("../../auth/oidc", async (original) => ({
  ...(await original<typeof import("../../auth/oidc")>()),
  usuarioActual: vi.fn(),
  iniciarSesion: vi.fn(),
}));

const TOKEN = "v1.TokenFicticioDeLaCarpeta";
const H = (id_horario: number, fecha: string, hora_inicio: string, disponible: boolean) => ({ id_horario, fecha, hora_inicio, hora_fin: "23:00", disponible });

let horarios: ReturnType<typeof H>[];
let respuestaLectura: { status: number; cuerpo?: unknown } | null;
let respuestaReserva: { status: number; cuerpo: unknown };
let llamadas: { url: string; metodo: string; cabeceras: Headers; cuerpo?: unknown }[];

const responder = (status: number, cuerpo: unknown) =>
  new Response(JSON.stringify(cuerpo), { status, headers: { "Content-Type": "application/json" } });
const error = (status: number, codigo: string, mensaje: string) => ({ status, cuerpo: { error: { codigo, mensaje } } });

function apiFalsa(url: string, init: RequestInit = {}): Response {
  const metodo = init.method ?? "GET";
  llamadas.push({ url, metodo, cabeceras: new Headers(init.headers), cuerpo: init.body ? JSON.parse(String(init.body)) : undefined });
  if (url === "/api/publico/visita-guiada" && metodo === "GET") {
    if (respuestaLectura) return responder(respuestaLectura.status, respuestaLectura.cuerpo);
    return responder(200, {
      campana: "2027",
      apoderado: { nombres: "María Fernanda", apellidos: "Quispe Rojas" },
      grado: { nombre_grado: "3.° de primaria" },
      lugar: "[Dirección del colegio]",
      horarios,
    });
  }
  if (url === "/api/publico/visita-guiada/reserva" && metodo === "POST") return responder(respuestaReserva.status, respuestaReserva.cuerpo);
  return responder(404, { error: { codigo: "NO_ENCONTRADO", mensaje: "Recurso no encontrado" } });
}

const montados: VueWrapper[] = [];

beforeEach(() => {
  vi.clearAllMocks();
  horarios = [
    H(31, "2026-10-15", "08:30", false),
    H(32, "2026-10-15", "10:00", true),
    H(33, "2026-10-15", "11:30", true),
    H(34, "2026-10-20", "10:00", true),
    H(36, "2026-10-22", "10:00", false),
    H(35, "2026-11-03", "09:00", true),
  ];
  respuestaLectura = null;
  respuestaReserva = { status: 201, cuerpo: { estado: "reservada", fecha: "2026-10-15", hora_inicio: "10:00" } };
  llamadas = [];
  vi.stubEnv("VITE_API_URL", "/api");
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => apiFalsa(url, init)));
});

afterEach(() => {
  for (const m of montados.splice(0)) m.unmount();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

async function abrir(ruta = `/visita-guiada?t=${encodeURIComponent(TOKEN)}`) {
  const enrutador = crearEnrutador(createMemoryHistory());
  const e = mount(App, { global: { plugins: [createPinia(), enrutador] }, attachTo: document.body });
  montados.push(e);
  await enrutador.push(ruta);
  await flushPromises();
  return e;
}

const dia = (e: VueWrapper, fecha: string) => e.get(`button.dia[data-fecha="${fecha}"]`);
const lecturas = () => llamadas.filter((l) => l.metodo === "GET");
const reservas = () => llamadas.filter((l) => l.metodo === "POST");

describe("HU0003-1.0 P02 agendamiento de la visita guiada", () => {
  it("HU0003-1.0 P02 resalta los días con horarios, lista los del día con «Disponible» o «Reservado» y navega entre meses", async () => {
    const e = await abrir();

    // Pública: no busca sesión. El token va en la cabecera, sin Authorization ni en la URL.
    expect(usuarioActual).not.toHaveBeenCalled();
    expect(lecturas()).toHaveLength(1);
    expect(lecturas()[0]!.url).toBe("/api/publico/visita-guiada");
    expect(lecturas()[0]!.cabeceras.get("X-Enlace-Visita")).toBe(TOKEN);
    expect(lecturas()[0]!.cabeceras.get("Authorization")).toBeNull();

    expect(e.get("h1").text()).toBe("Agenda tu visita guiada");
    expect(e.get('[data-testid="proceso"]').text()).toBe("Proceso de Admisión 2027");
    expect(e.get("a.boton-portal").attributes("href")).toBe("/portal");
    // Abre en el mes del primer día con horario disponible, con ese día elegido.
    expect(e.get('[data-testid="mes"]').text()).toBe("Octubre 2026");
    expect(dia(e, "2026-10-15").attributes("aria-label")).toBe("15 de octubre (seleccionado)");
    expect(dia(e, "2026-10-20").attributes("aria-label")).toBe("20 de octubre (disponible)");
    expect(dia(e, "2026-10-20").attributes("disabled")).toBeUndefined();
    // Un día solo con horarios reservados no se resalta.
    expect(dia(e, "2026-10-22").attributes("aria-label")).toBe("22 de octubre (no disponible)");
    expect(dia(e, "2026-10-22").attributes("disabled")).toBeDefined();
    expect(e.findAll(".rejilla-dias span.dia-semana").map((d) => d.text())).toEqual(["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"]);
    expect(e.findAll(".rejilla-dias > span:not(.dia-semana)")).toHaveLength(3); // octubre de 2026 empieza en jueves

    expect(e.get("#p02-horarios").text()).toBe("Horarios del jueves 15 de octubre");
    const lista = () => e.findAll(".lista-horarios button").map((b) => [b.get(".horario-hora").text(), b.get(".chip").text(), b.attributes("disabled") !== undefined]);
    expect(lista()).toEqual([
      ["8:30 a. m.", "Reservado", true],
      ["10:00 a. m.", "Disponible", false],
      ["11:30 a. m.", "Disponible", false],
    ]);
    expect(e.get('[data-testid="apoderado"]').text()).toBe("María Fernanda Quispe Rojas");
    expect(e.text()).toContain("Apoderado/a");
    expect(e.text()).toContain("[Dirección del colegio]");
    expect(e.text()).toContain("Te enviaremos la confirmación y un recordatorio por correo y, si lo autorizaste, por WhatsApp.");

    await dia(e, "2026-10-20").trigger("click");
    expect(e.get("#p02-horarios").text()).toBe("Horarios del martes 20 de octubre");
    expect(lista()).toEqual([["10:00 a. m.", "Disponible", false]]);

    await e.get('button[aria-label="Mes siguiente"]').trigger("click");
    expect(e.get('[data-testid="mes"]').text()).toBe("Noviembre 2026");
    expect(dia(e, "2026-11-03").attributes("aria-label")).toBe("3 de noviembre (disponible)");
    await e.get('button[aria-label="Mes anterior"]').trigger("click");
    await e.get('button[aria-label="Mes anterior"]').trigger("click");
    expect(e.get('[data-testid="mes"]').text()).toBe("Septiembre 2026");
  });

  it("HU0003-1.0 P02 exige los asistentes y confirma la visita", async () => {
    const e = await abrir();

    // Sin horario elegido, pide elegir uno y no llama a la API.
    await e.get("form").trigger("submit");
    expect(e.get('[data-testid="aviso"]').text()).toBe("Elige un día y un horario disponible.");
    expect(reservas()).toHaveLength(0);

    await e.get('[data-testid="horario-32"]').trigger("click");
    expect(e.find('[data-testid="aviso"]').exists()).toBe(false);
    expect(e.get('[data-testid="fecha"]').text()).toBe("Jueves 15 de octubre de 2026");
    expect(e.get('[data-testid="hora"]').text()).toBe("10:00 a. m.");
    expect(e.get('[data-testid="horario-32"]').attributes("aria-pressed")).toBe("true");

    // Sin asistentes, los marca como obligatorios y no llama a la API.
    await e.get("#p02as").setValue("   ");
    await e.get("form").trigger("submit");
    expect(e.get("#p02as").attributes("aria-invalid")).toBe("true");
    expect(e.text()).toContain("Escribe los nombres de los asistentes.");
    expect(reservas()).toHaveLength(0);

    await e.get("#p02as").setValue("  María Fernanda Quispe Rojas, José Luis Quispe Huamán ");
    await e.get("form").trigger("submit");
    await flushPromises();

    expect(reservas()).toHaveLength(1);
    const [reserva] = reservas();
    expect(reserva!.url).toBe("/api/publico/visita-guiada/reserva");
    expect(reserva!.cabeceras.get("X-Enlace-Visita")).toBe(TOKEN);
    expect(reserva!.cabeceras.get("Authorization")).toBeNull();
    expect(reserva!.cuerpo).toEqual({ id_horario: 32, asistentes: "María Fernanda Quispe Rojas, José Luis Quispe Huamán" });
    expect(e.get('[data-testid="visita-reservada"]').text()).toBe(
      "Tu visita quedó agendada para el jueves 15 de octubre a las 10:00 a. m. Te enviamos la confirmación a tu correo.",
    );
    expect(e.find('[data-testid="mes"]').exists()).toBe(false);
  });
});

describe("HU0003-2.0 P02 horario tomado simultáneamente", () => {
  it("HU0003-2.0 P02 ante un 409 muestra el aviso del mockup, recarga los horarios y pide elegir otro", async () => {
    const e = await abrir();
    await e.get('[data-testid="horario-33"]').trigger("click");
    await e.get("#p02as").setValue("Elena Castro Mejía");
    // Otra familia tomó el horario: la API responde 409 y, al recargar, el horario viene reservado.
    respuestaReserva = error(409, "HORARIO_SIN_CUPO", "El horario ya no tiene cupo. Elige otro horario o día.");
    horarios = horarios.map((h) => (h.id_horario === 33 ? { ...h, disponible: false } : h));

    await e.get("form").trigger("submit");
    await flushPromises();

    expect(e.get('[data-testid="aviso"]').text()).toBe("El horario de las 11:30 a. m. acaba de reservarse. Elige otro horario o día.");
    expect(e.get('[data-testid="aviso"]').attributes("role")).toBe("alert");
    expect(lecturas()).toHaveLength(2); // recargó los horarios
    expect(e.get('[data-testid="horario-33"]').attributes("disabled")).toBeDefined();
    expect(e.get('[data-testid="horario-33"] .chip').text()).toBe("Reservado");
    expect(e.get('[data-testid="hora"]').text()).toBe("—");
    expect(e.find('[data-testid="visita-reservada"]').exists()).toBe(false);
    // Elegir otro horario quita el aviso y se puede confirmar.
    respuestaReserva = { status: 201, cuerpo: { estado: "reservada", fecha: "2026-10-15", hora_inicio: "10:00" } };
    await e.get('[data-testid="horario-32"]').trigger("click");
    expect(e.find('[data-testid="aviso"]').exists()).toBe(false);
    await e.get("form").trigger("submit");
    await flushPromises();
    expect(reservas().map((r) => (r.cuerpo as { id_horario: number }).id_horario)).toEqual([33, 32]);
    expect(e.find('[data-testid="visita-reservada"]').exists()).toBe(true);
  });
});

describe("C31 P02 con un enlace que no admite reservar", () => {
  it("C31 P02 con un enlace no válido o ya usado muestra su mensaje y no muestra el calendario", async () => {
    // Sin ?t= no llama a la API.
    const sinToken = await abrir("/visita-guiada");
    expect(llamadas).toHaveLength(0);
    expect(sinToken.get('[data-testid="enlace-no-valido"]').text()).toBe(
      "Este enlace no es válido o ya no está vigente. Si deseas agendar tu visita, comunícate con Admisión.",
    );
    expect(sinToken.find('[data-testid="mes"]').exists()).toBe(false);

    respuestaLectura = error(404, "ENLACE_NO_VALIDO", "Este enlace no es válido o ya no está vigente. Si deseas agendar tu visita, comunícate con Admisión.");
    const invalido = await abrir();
    expect(invalido.get('[data-testid="enlace-no-valido"]').attributes("role")).toBe("alert");
    expect(invalido.find('[data-testid="mes"]').exists()).toBe(false);

    respuestaLectura = error(409, "VISITA_YA_AGENDADA", "Ya tienes una visita agendada. Revisa el correo de confirmación.");
    const usado = await abrir();
    expect(usado.get('[data-testid="ya-agendada"]').text()).toBe("Ya tienes una visita agendada. Revisa el correo de confirmación.");
    expect(usado.find('[data-testid="mes"]').exists()).toBe(false);
    expect(usado.find("form").exists()).toBe(false);

    // Si el enlace deja de valer entre la lectura y la reserva, también se muestra el estado.
    respuestaLectura = null;
    const tarde = await abrir();
    await tarde.get('[data-testid="horario-32"]').trigger("click");
    await tarde.get("#p02as").setValue("Elena Castro Mejía");
    respuestaReserva = error(409, "VISITA_YA_AGENDADA", "Ya tienes una visita agendada. Revisa el correo de confirmación.");
    await tarde.get("form").trigger("submit");
    await flushPromises();
    expect(tarde.find('[data-testid="ya-agendada"]').exists()).toBe(true);
    expect(tarde.find('[data-testid="mes"]').exists()).toBe(false);
  });
});
