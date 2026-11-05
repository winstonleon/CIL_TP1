// P08 · Agendamiento de evaluaciones (HU0009) con la API simulada en fetch. Se monta la app con el enrutador real en
// /portal/evaluaciones. Solo se prueba la lógica propia de la pantalla: las evaluaciones que entrega la API para el grado,
// «Confirmar citas» habilitado con un turno por evaluación, el turno agotado, el aviso sin las tres validaciones, la
// reprogramación (24 h) y el menú «Evaluaciones» (C52). Las reglas las vuelve a aplicar la API.
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
const resumenBase = (estado = "en_validacion") => ({ id_expediente: ID, codigo: "ADM-2027-0007", estado, grado: "3.° de primaria", postulante: "Sofía Quispe Rojas", ficha_completa: true });

const h = (id_horario: number, fecha: string, hora_inicio: string, disponible = true) => ({ id_horario, fecha, hora_inicio, hora_fin: "23:00", disponible });

// 3.° de primaria (configuración del grado): académica, psicológica y entrevista.
const agendaBase = () => ({
  modo: "agendar",
  grado: "3.° de primaria",
  min_horas_reprogramacion: 24,
  evaluaciones: [
    { tipo_cita: "evaluacion_academica", cita: null, horarios: [h(11, "2026-11-24", "08:00"), h(12, "2026-11-24", "10:00"), h(13, "2026-11-25", "08:00", false)] },
    { tipo_cita: "evaluacion_psicologica", cita: null, horarios: [h(21, "2026-11-24", "10:30"), h(22, "2026-11-24", "12:00")] },
    { tipo_cita: "entrevista_padres", cita: null, horarios: [h(31, "2026-11-26", "14:30")] },
  ],
});

const cita = (id_cita: number, tipo_cita: string, fecha: string, hora_inicio: string, reprogramable = true, plazo_vencido = !reprogramable, estado = "reservada") => ({
  id_cita, tipo_cita, fecha, hora_inicio, estado, reprogramable, plazo_vencido,
});

let resumen: ReturnType<typeof resumenBase>;
let agenda: Record<string, unknown>;
let respuestaConfirmar: () => { status: number; cuerpo: unknown };
let respuestaReprogramar: () => { status: number; cuerpo: unknown };
let envios: { url: string; cuerpo: unknown }[];

const responder = (status: number, cuerpo: unknown) => ({ ok: status < 400, status, json: async () => cuerpo }) as Response;
const error = (status: number, codigo: string, mensaje: string, detalle?: unknown) => ({ status, cuerpo: { error: { codigo, mensaje, detalle } } });

function apiFalsa(url: string, init: RequestInit = {}): Response {
  const metodo = init.method ?? "GET";
  if (url === "/api/familia/expedientes") return responder(200, [resumen]);
  if (url === `/api/familia/expedientes/${ID}/evaluaciones` && metodo === "GET") return responder(200, agenda);
  if (url === `/api/familia/expedientes/${ID}/evaluaciones` && metodo === "POST") {
    envios.push({ url, cuerpo: JSON.parse(String(init.body)) });
    const r = respuestaConfirmar();
    return responder(r.status, r.cuerpo);
  }
  if (url.startsWith(`/api/familia/expedientes/${ID}/citas/`) && metodo === "POST") {
    envios.push({ url, cuerpo: JSON.parse(String(init.body)) });
    const r = respuestaReprogramar();
    return responder(r.status, r.cuerpo);
  }
  return responder(404, { error: { codigo: "NO_ENCONTRADO", mensaje: "Recurso no encontrado" } });
}

const montados: VueWrapper[] = [];

beforeEach(() => {
  vi.clearAllMocks();
  resumen = resumenBase();
  agenda = agendaBase();
  envios = [];
  respuestaConfirmar = () => ({ status: 201, cuerpo: { estado: "en_evaluacion", citas: [] } });
  respuestaReprogramar = () => ({ status: 200, cuerpo: { cita: cita(9, "evaluacion_academica", "2026-11-24", "10:00") } });
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

async function abrir(ruta = "/portal/evaluaciones") {
  const enrutador = crearEnrutador(createMemoryHistory());
  const e = mount(App, { global: { plugins: [createPinia(), enrutador] }, attachTo: document.body });
  montados.push(e);
  await enrutador.push(ruta);
  await esperar();
  return e;
}

const secciones = (e: VueWrapper) => e.findAll('[data-testid^="evaluacion-"]').map((s) => s.get("h2").text());
const confirmar = (e: VueWrapper) => e.get('[data-testid="confirmar-citas"]');

async function elegirTodo(e: VueWrapper) {
  for (const id of [11, 21, 31]) await e.get(`[data-testid="horario-${id}"]`).trigger("click");
}

describe("P08 agendamiento de evaluaciones", () => {
  it("HU0009-1.0 muestra solo las evaluaciones que la API entrega para el grado, con su responsable y los turnos del primer día disponible", async () => {
    agenda = {
      ...agendaBase(),
      grado: "Kindergarten (5 años)",
      evaluaciones: [
        { tipo_cita: "jornada_observacion", cita: null, horarios: [h(41, "2026-11-24", "08:00")] },
        { tipo_cita: "entrevista_padres", cita: null, horarios: [h(31, "2026-11-26", "14:30")] },
      ],
    };
    const e = await abrir();

    expect(e.get("h1").text()).toBe("Agenda tus evaluaciones");
    expect(e.get('[data-testid="cantidad-citas"]').text()).toBe("Para Kindergarten (5 años) corresponden dos citas.");
    expect(e.get('[data-testid="habilitado"]').text()).toBe("Documentos, derecho de admisión y documentación financiera validados: ya puedes agendar.");
    expect(secciones(e)).toEqual(["Jornada de observación", "Entrevista a los padres"]);
    expect(e.get('[data-testid="evaluacion-entrevista_padres"]').text()).toContain("A cargo de la Psicóloga · padre y madre o tutor");
    expect(e.get('[data-testid="horario-41"]').text()).toBe("8:00 a. m.");
    expect(e.text()).not.toContain("Evaluación académica");
  });

  it("HU0009-1.0 «Confirmar citas» se habilita con un turno disponible por evaluación y envía un turno por evaluación; luego muestra la confirmación y las citas agendadas", async () => {
    const e = await abrir();
    // Un día sin turnos disponibles no se puede elegir.
    expect(e.get('[data-fecha="2026-11-25"]').attributes("disabled")).toBeDefined();
    expect(confirmar(e).attributes("disabled")).toBeDefined();
    await e.get('[data-testid="horario-11"]').trigger("click");
    await e.get('[data-testid="horario-21"]').trigger("click");
    expect(confirmar(e).attributes("disabled")).toBeDefined(); // falta la entrevista
    await e.get('[data-testid="horario-31"]').trigger("click");
    expect(e.get('[data-testid="evaluacion-entrevista_padres"]').text()).toContain("Seleccionada");
    expect(e.get('[data-testid="resumen-evaluacion_academica"]').text()).toContain("Martes 24 de noviembre · 8:00 a. m.");
    expect(confirmar(e).attributes("disabled")).toBeUndefined();
    agenda = {
      ...agendaBase(),
      modo: "agendadas",
      evaluaciones: [
        { tipo_cita: "evaluacion_academica", cita: cita(1, "evaluacion_academica", "2026-11-24", "08:00"), horarios: [] },
        { tipo_cita: "evaluacion_psicologica", cita: cita(2, "evaluacion_psicologica", "2026-11-24", "10:30"), horarios: [] },
        { tipo_cita: "entrevista_padres", cita: cita(3, "entrevista_padres", "2026-11-26", "14:30"), horarios: [] },
      ],
    };

    await confirmar(e).trigger("click");
    await esperar();

    expect(envios).toEqual([
      {
        url: `/api/familia/expedientes/${ID}/evaluaciones`,
        cuerpo: { horarios: [{ tipo_cita: "evaluacion_academica", id_horario: 11 }, { tipo_cita: "evaluacion_psicologica", id_horario: 21 }, { tipo_cita: "entrevista_padres", id_horario: 31 }] },
      },
    ]);
    expect(e.get('[data-testid="confirmacion"]').text()).toBe("Citas confirmadas. Te enviamos la confirmación con las pautas previas por correo.");
    expect(e.find('[data-testid="confirmar-citas"]').exists()).toBe(false);
    expect(e.findAll('[data-testid="cita"]').map((c) => c.text())).toEqual([
      "Martes 24 de noviembre · 8:00 a. m.",
      "Martes 24 de noviembre · 10:30 a. m.",
      "Jueves 26 de noviembre · 2:30 p. m.",
    ]);
  });

  it("HU0009-1.0 si un turno se agotó (409 HORARIO_SIN_CUPO) muestra el aviso de la API, recarga los turnos y suelta el agotado", async () => {
    const e = await abrir();
    await elegirTodo(e);
    respuestaConfirmar = () => error(409, "HORARIO_SIN_CUPO", "Uno de los turnos elegidos ya no tiene cupo. Elige otro turno.", [{ id_horario: 21 }]);
    const recargada = agendaBase();
    recargada.evaluaciones[1]!.horarios[0]!.disponible = false;
    agenda = recargada;

    await confirmar(e).trigger("click");
    await esperar();

    expect(e.get('[data-testid="aviso"]').text()).toBe("Uno de los turnos elegidos ya no tiene cupo. Elige otro turno.");
    expect(e.get('[data-testid="horario-21"]').attributes("disabled")).toBeDefined();
    expect(e.get('[data-testid="resumen-evaluacion_psicologica"]').text()).toContain("Sin elegir");
    expect(confirmar(e).attributes("disabled")).toBeDefined();
  });

  it("HU0009-1.0 sin las tres validaciones conformes muestra el aviso y no ofrece turnos ni «Confirmar citas»", async () => {
    agenda = { ...agendaBase(), modo: "bloqueado", evaluaciones: agendaBase().evaluaciones.map((x) => ({ ...x, horarios: [] })) };
    const e = await abrir();

    expect(e.get('[data-testid="bloqueado"]').text()).toBe(
      "Tus evaluaciones se podrán agendar cuando se validen los documentos, el derecho de admisión y la documentación financiera.",
    );
    expect(e.find('[data-testid="confirmar-citas"]').exists()).toBe(false);
    expect(e.find('[data-testid^="horario-"]').exists()).toBe(false);
  });

  it("HU0009-2.0 «Reprogramar» solo aparece en una cita con al menos 24 h de anticipación; elige el nuevo horario, envía el cambio y muestra la confirmación actualizada", async () => {
    agenda = {
      ...agendaBase(),
      modo: "agendadas",
      evaluaciones: [
        { tipo_cita: "evaluacion_academica", cita: cita(1, "evaluacion_academica", "2026-11-24", "08:00"), horarios: [h(11, "2026-11-24", "08:00", false), h(12, "2026-11-24", "10:00")] },
        { tipo_cita: "evaluacion_psicologica", cita: cita(2, "evaluacion_psicologica", "2026-11-24", "10:30", false), horarios: [h(21, "2026-11-24", "10:30", false)] },
        { tipo_cita: "entrevista_padres", cita: cita(3, "entrevista_padres", "2026-11-26", "14:30"), horarios: [h(31, "2026-11-26", "14:30", false)] },
        // Una cita que ya pasó o con otro estado no se reprograma, pero tampoco dice «faltan menos de 24 horas».
        { tipo_cita: "jornada_observacion", cita: cita(4, "jornada_observacion", "2026-11-02", "08:00", false, false, "asistio"), horarios: [] },
      ],
    };
    const e = await abrir();
    expect(e.find('[data-testid="reprogramar-evaluacion_psicologica"]').exists()).toBe(false);
    expect(e.find('[data-testid="evaluacion-jornada_observacion"] [data-testid="reprogramar-jornada_observacion"]').exists()).toBe(false);
    expect(e.find('[data-testid="evaluacion-jornada_observacion"] [data-testid="no-reprogramable"]').exists()).toBe(false);
    expect(e.get('[data-testid="evaluacion-evaluacion_psicologica"] [data-testid="no-reprogramable"]').text()).toBe("Ya no se puede reprogramar: faltan menos de 24 horas.");
    expect(e.find('[data-testid="horario-12"]').exists()).toBe(false); // el selector se abre con «Reprogramar»

    await e.get('[data-testid="reprogramar-evaluacion_academica"]').trigger("click");
    expect(e.get('[data-testid="confirmar-cambio"]').attributes("disabled")).toBeDefined();
    await e.get('[data-testid="horario-12"]').trigger("click");
    await e.get('[data-testid="confirmar-cambio"]').trigger("click");
    await esperar();

    expect(envios).toEqual([{ url: `/api/familia/expedientes/${ID}/citas/1/reprogramacion`, cuerpo: { id_horario: 12 } }]);
    expect(e.get('[data-testid="confirmacion"]').text()).toBe("Cita reprogramada. Te enviamos la confirmación actualizada por correo.");
    expect(e.find('[data-testid="confirmar-cambio"]').exists()).toBe(false);
  });

  it("HU0009-2.0 si la API rechaza el cambio (422 PLAZO_REPROGRAMACION_VENCIDO) muestra su aviso y no confirma nada", async () => {
    agenda = {
      ...agendaBase(),
      modo: "agendadas",
      evaluaciones: [{ tipo_cita: "evaluacion_academica", cita: cita(1, "evaluacion_academica", "2026-11-24", "08:00"), horarios: [h(12, "2026-11-24", "10:00")] }],
    };
    respuestaReprogramar = () => error(422, "PLAZO_REPROGRAMACION_VENCIDO", "Solo puedes reprogramar una cita hasta 24 horas antes");
    const e = await abrir();
    await e.get('[data-testid="reprogramar-evaluacion_academica"]').trigger("click");
    await e.get('[data-testid="horario-12"]').trigger("click");

    await e.get('[data-testid="confirmar-cambio"]').trigger("click");
    await esperar();

    expect(e.get('[data-testid="aviso"]').text()).toBe("Solo puedes reprogramar una cita hasta 24 horas antes");
    expect(e.find('[data-testid="confirmacion"]').exists()).toBe(false);
  });

  it("C52 el menú «Evaluaciones» se habilita en la validación y en la evaluación, y no antes", async () => {
    for (const [estado, habilitado] of [["en_postulacion", false], ["en_validacion", true], ["en_evaluacion", true]] as const) {
      resumen = resumenBase(estado);
      const e = await abrir("/portal/pagos/derecho-admision");
      const menu = e.get('[data-testid="menu-evaluaciones"]');
      expect(menu.text(), estado).toBe("Evaluaciones");
      expect(menu.element.tagName, estado).toBe(habilitado ? "A" : "BUTTON");
      if (habilitado) expect(menu.attributes("href")).toBe("/portal/evaluaciones");
      else expect(menu.attributes("aria-disabled")).toBe("true");
      for (const m of montados.splice(0)) m.unmount();
    }
  });
});
