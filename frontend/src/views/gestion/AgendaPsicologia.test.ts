// G06 · Agenda de Psicología y dictamen (HU0010) con la API simulada en fetch y el enrutador real en /gestion/psicologia,
// más la sección de requisitos complementarios de G03 (Secretaría). Solo se prueba la lógica propia de las pantallas: la
// agenda, el formulario de resultado, el dictamen habilitado solo con los resultados del grado, el campo de requisitos
// solo con «En observación» y lo que se envía. Las reglas las vuelve a aplicar la API.
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

const POSTULANTE = { nombres: "Sofía Valentina", apellidos: "Quispe Rojas" };
const citaAgenda = (id_cita: number, tipo_cita: string, hora_inicio: string, estado = "reservada") => ({
  id_cita, id_expediente: 142, codigo: "ADM-2027-0142", postulante: POSTULANTE, grado: "3.° de primaria", tipo_cita,
  fecha: "2027-10-27", hora_inicio, hora_fin: "23:59", estado, resultado_registrado: estado !== "reservada",
});
const componente = (id_cita: number, tipo_cita: string, resultado: string | null) => ({
  id_cita, tipo_cita, estado: resultado ? "asistio" : "reservada", fecha: "2027-10-29", hora_inicio: "15:00", resultado, observaciones: resultado ? `Observaciones de ${tipo_cita}` : null,
});
const dictamenBase = () => ({
  id_expediente: 142, codigo: "ADM-2027-0142", postulante: POSTULANTE, grado: "3.° de primaria", edad: 8 as number | null, estado: "en_evaluacion",
  exigidas: ["evaluacion_academica", "evaluacion_psicologica", "entrevista_padres"],
  faltan: [] as string[],
  componentes: [componente(1, "evaluacion_academica", "Satisfactorio"), componente(2, "evaluacion_psicologica", "Adecuado"), componente(3, "entrevista_padres", "Realizada")],
  habilitado: true,
  opciones: ["apto", "en_observacion", "no_apto"],
  dictamen: null as unknown,
});

let agenda: ReturnType<typeof citaAgenda>[];
let dictamen: ReturnType<typeof dictamenBase>;
let detalleG03: { status: number; cuerpo: unknown };
let lecturasDictamen: string[];
let enviosJson: { url: string; cuerpo: unknown }[];
let enviosForm: { url: string; campos: Record<string, string> }[];

const responder = (status: number, cuerpo: unknown) => ({ ok: status < 400, status, json: async () => cuerpo }) as Response;

function apiFalsa(url: string, init: RequestInit = {}): Response {
  const metodo = init.method ?? "GET";
  if (url === "/api/campana-activa") return responder(200, { campana: "2027" });
  if (url.startsWith("/api/psicologia/agenda?")) return responder(200, { fecha: "2027-10-27", citas: agenda });
  const cita = /^\/api\/psicologia\/citas\/(\d+)$/.exec(url);
  if (cita && metodo === "GET") {
    const c = agenda.find((x) => x.id_cita === Number(cita[1]))!;
    return responder(200, { ...c, iniciada: true, registrable: c.estado === "reservada", resultado: c.estado === "reservada" ? null : { resultado: "Adecuado", observaciones: "Registrado" } });
  }
  if (url.startsWith("/api/psicologia/expedientes/142/dictamen") && metodo === "GET") {
    lecturasDictamen.push(url);
    return responder(200, dictamen);
  }
  if (url === "/api/psicologia/expedientes/142/dictamen" && metodo === "POST") {
    const campos: Record<string, string> = {};
    (init.body as FormData).forEach((v, k) => (campos[k] = typeof v === "string" ? v : `archivo:${(v as File).name}`));
    enviosForm.push({ url, campos });
    return responder(201, { id_expediente: 142, estado: campos.dictamen, dictamen: campos.dictamen, tiene_informe: "archivo" in campos });
  }
  if (metodo === "POST") {
    enviosJson.push({ url, cuerpo: JSON.parse(String(init.body)) });
    return responder(201, {});
  }
  if (url === "/api/bandeja/expedientes/142") return responder(detalleG03.status, detalleG03.cuerpo);
  if (url === "/api/bandeja/expedientes/142/requisitos-complementarios") {
    return responder(200, { id_expediente: 142, codigo: "ADM-2027-0142", postulante: POSTULANTE, grado: "3.° de primaria", requisitos_complementarios: "Informe de terapia de lenguaje", fecha_emision: "2026-11-05T15:00:00.000Z" });
  }
  return responder(404, { error: { codigo: "NO_ENCONTRADO", mensaje: "Recurso no encontrado" } });
}

const montados: VueWrapper[] = [];

beforeEach(() => {
  vi.clearAllMocks();
  agenda = [citaAgenda(2, "evaluacion_psicologica", "10:30", "asistio"), citaAgenda(3, "entrevista_padres", "14:30")];
  dictamen = dictamenBase();
  detalleG03 = { status: 409, cuerpo: { error: { codigo: "VALIDACION_NO_CORRESPONDE", mensaje: "El expediente no está en validación" } } };
  enviosJson = [];
  enviosForm = [];
  lecturasDictamen = [];
  vi.stubEnv("VITE_API_URL", "/api");
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => apiFalsa(url, init)));
  vi.mocked(usuarioActual).mockResolvedValue(usuarioFalso(["psicologa"], "Carmen Villanueva"));
});

afterEach(() => {
  for (const m of montados.splice(0)) m.unmount();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

async function esperar() {
  for (let i = 0; i < 8; i++) await flushPromises();
}

async function abrir(ruta = "/gestion/psicologia") {
  const enrutador = crearEnrutador(createMemoryHistory());
  const e = mount(App, { global: { plugins: [createPinia(), enrutador] }, attachTo: document.body });
  montados.push(e);
  await enrutador.push(ruta);
  await esperar();
  return e;
}

async function abrirCita(e: VueWrapper, id: number) {
  await e.get(`[data-testid="cita-${id}"]`).trigger("click");
  await esperar();
}

async function abrirDictamen(e: VueWrapper, id: number) {
  await abrirCita(e, id);
  await e.get('[data-testid="abrir-dictamen"]').trigger("click");
  await esperar();
}

describe("HU0010-1.0 G06 registro de dictamen Apto", () => {
  it("HU0010-1.0 [parte: dictamen, informe restringido y estado] G06 lista las citas del día y, al abrir la entrevista, registra su resultado con el formulario de la cita (S1)", async () => {
    const e = await abrir();
    expect(e.findAll('[data-testid^="cita-"]').map((b) => b.text())).toEqual([
      expect.stringContaining("10:30Sofía Valentina Quispe RojasEvaluación psicológica · 3.° de primaria"),
      expect.stringContaining("2:30Sofía Valentina Quispe RojasEntrevista a los padres · 3.° de primaria"),
    ]);

    await abrirCita(e, 3);
    await e.get('[data-testid="guardar-resultado"]').trigger("click");
    await esperar();
    expect(enviosJson).toEqual([]);
    expect(e.get('[data-testid="formulario-resultado"]').text()).toContain("Ingresa el resultado");

    await e.get('[data-testid="campo-resultado"]').setValue("Realizada");
    await e.get('[data-testid="campo-observaciones"]').setValue("Entrevista con ambos padres");
    await e.get('[data-testid="guardar-resultado"]').trigger("click");
    await esperar();
    expect(enviosJson).toEqual([{ url: "/api/psicologia/citas/3/resultado", cuerpo: { resultado: "Realizada", observaciones: "Entrevista con ambos padres" } }]);
    // G06 no ofrece «No asistió»: la inasistencia solo existe en la evaluación académica (HU0025-2.0).
    expect(e.find('[data-testid="marcar-no-asistio"]').exists()).toBe(false);
  });

  it("HU0010-1.0 [parte: dictamen, informe restringido y estado] G06 abrir una cita no pide el dictamen: el panel se abre con «Abrir dictamen», una sola vez con abrir=1, y otra cita lo cierra", async () => {
    const e = await abrir();
    await abrirCita(e, 3);
    expect(lecturasDictamen).toEqual([]);
    expect(e.find('[data-testid="panel-dictamen"]').exists()).toBe(false);

    await e.get('[data-testid="abrir-dictamen"]').trigger("click");
    await esperar();
    expect(lecturasDictamen).toEqual(["/api/psicologia/expedientes/142/dictamen?abrir=1"]);
    expect(e.find('[data-testid="panel-dictamen"]').exists()).toBe(true);

    await abrirCita(e, 2);
    expect(e.find('[data-testid="panel-dictamen"]').exists()).toBe(false);
    expect(lecturasDictamen).toHaveLength(1);
  });

  it("HU0010-1.0 [parte: dictamen, informe restringido y estado] G06 muestra los componentes que exige el grado con sus resultados (el académico incluido, HU0025-1.0); con todos registrados, «Apto» envía las conclusiones y el informe sin requisitos", async () => {
    const e = await abrir();
    await abrirDictamen(e, 3);
    const panel = e.get('[data-testid="panel-dictamen"]');
    expect(panel.text()).toContain("Confidencial · solo Psicología");
    expect(panel.get('[data-testid="datos-postulante"]').text()).toBe("ADM-2027-0142 · 3.° de primaria · 8 años");
    expect(panel.get('[data-testid="componente-evaluacion_academica"]').text()).toContain("Evaluación académica (Evaluador académico)Registrada");
    expect(panel.get('[data-testid="componente-evaluacion_academica"]').text()).toContain("Observaciones de evaluacion_academica");
    expect(panel.get('[data-testid="componente-entrevista_padres"]').text()).toContain("Entrevista a los padres (29 oct.)Realizada");
    expect(panel.find('[data-testid="campo-requisitos"]').exists()).toBe(false);

    await panel.get('[data-testid="opcion-apto"]').setValue(true);
    await panel.get('[data-testid="campo-conclusiones"]').setValue("Integra adecuadamente la información de las evaluaciones");
    const informe = new File(["%PDF-1.4 informe"], "informe_psicopedagogico.pdf", { type: "application/pdf" });
    const entrada = panel.get('[data-testid="campo-informe"]');
    Object.defineProperty(entrada.element, "files", { value: [informe] });
    await entrada.trigger("change");
    dictamen = { ...dictamenBase(), estado: "apto", habilitado: false, opciones: [], dictamen: { dictamen: "apto", conclusiones: "Integra adecuadamente la información de las evaluaciones", requisitos_complementarios: null, tiene_informe: true, fecha_emision: "2026-11-05T15:00:00.000Z" } };
    await panel.get('[data-testid="guardar-dictamen"]').trigger("click");
    await esperar();

    expect(enviosForm).toEqual([
      { url: "/api/psicologia/expedientes/142/dictamen", campos: { dictamen: "apto", conclusiones: "Integra adecuadamente la información de las evaluaciones", archivo: "archivo:informe_psicopedagogico.pdf" } },
    ]);
    expect(e.get('[data-testid="dictamen-emitido"]').text()).toContain("Dictamen emitido: Apto");
    expect(e.find('[data-testid="guardar-dictamen"]').exists()).toBe(false);
  });

  it("HU0010-1.0 [parte: dictamen, informe restringido y estado] G06 sin los resultados de todas las evaluaciones del grado no ofrece el dictamen y dice cuáles faltan", async () => {
    dictamen = { ...dictamenBase(), faltan: ["entrevista_padres"], habilitado: false, componentes: [componente(1, "evaluacion_academica", "Satisfactorio"), componente(2, "evaluacion_psicologica", "Adecuado"), componente(3, "entrevista_padres", null)] };
    const e = await abrir();
    await abrirDictamen(e, 3);
    expect(e.get('[data-testid="dictamen-no-habilitado"]').text()).toBe("El dictamen se habilita cuando estén registrados los resultados de: Entrevista a los padres.");
    expect(e.get('[data-testid="componente-entrevista_padres"]').text()).toContain("Pendiente");
    expect(e.find('[data-testid="guardar-dictamen"]').exists()).toBe(false);
  });
});

describe("HU0010-2.0 G06 y G03 dictamen En observación", () => {
  it("HU0010-2.0 G06 el campo de requisitos complementarios, con su texto de ayuda, aparece solo con «En observación», es obligatorio y se envía con el dictamen", async () => {
    const e = await abrir();
    await abrirDictamen(e, 3);
    const panel = e.get('[data-testid="panel-dictamen"]');
    await panel.get('[data-testid="opcion-en_observacion"]').setValue(true);
    expect(panel.get('[data-testid="bloque-requisitos"]').text()).toContain("Indica qué debe presentar la familia; no copies las conclusiones");
    await panel.get('[data-testid="campo-conclusiones"]').setValue("Requiere informe complementario");
    await panel.get('[data-testid="guardar-dictamen"]').trigger("click");
    await esperar();
    expect(enviosForm).toEqual([]);
    expect(panel.text()).toContain("Detalla los requisitos complementarios");

    await panel.get('[data-testid="campo-requisitos"]').setValue("Informe de terapia de lenguaje");
    await panel.get('[data-testid="guardar-dictamen"]').trigger("click");
    await esperar();
    expect(enviosForm[0]!.campos).toEqual({ dictamen: "en_observacion", conclusiones: "Requiere informe complementario", requisitos_complementarios: "Informe de terapia de lenguaje" });
    // La recarga después de guardar no es una apertura del panel (ADR-05).
    expect(lecturasDictamen).toEqual(["/api/psicologia/expedientes/142/dictamen?abrir=1", "/api/psicologia/expedientes/142/dictamen"]);

    // Volver a Apto oculta el campo y no lo envía.
    await panel.get('[data-testid="opcion-apto"]').setValue(true);
    expect(panel.find('[data-testid="campo-requisitos"]').exists()).toBe(false);
  });

  it("HU0010-2.0 G06 en observación muestra el dictamen vigente y ofrece el nuevo dictamen solo como Apto o No apto", async () => {
    dictamen = {
      ...dictamenBase(), estado: "en_observacion", opciones: ["apto", "no_apto"],
      dictamen: { dictamen: "en_observacion", conclusiones: "Requiere informe", requisitos_complementarios: "Informe de terapia", tiene_informe: false, fecha_emision: "2026-11-05T15:00:00.000Z" },
    };
    const e = await abrir();
    await abrirDictamen(e, 3);
    expect(e.get('[data-testid="dictamen-emitido"]').text()).toContain("Dictamen vigente: En observación");
    expect(e.get('[data-testid="dictamen-emitido"]').text()).toContain("Informe de terapia");
    expect(e.findAll('[data-testid^="opcion-"]').map((o) => o.attributes("value"))).toEqual(["apto", "no_apto"]);
  });

  it("HU0010-2.0 G03 un expediente en observación muestra a Secretaría los requisitos complementarios para coordinar con la familia, sin las conclusiones", async () => {
    vi.mocked(usuarioActual).mockResolvedValue(usuarioFalso(["secretaria"], "Rosa Medina"));
    const e = await abrir("/gestion/bandeja/142");
    const seccion = e.get('[data-testid="requisitos-complementarios"]');
    expect(seccion.get('[data-testid="texto-requisitos"]').text()).toBe("Informe de terapia de lenguaje");
    expect(seccion.text()).toContain("En observación");
    expect(seccion.text()).toContain("ADM-2027-0142");
    expect(e.find('[data-testid="error-carga"]').exists()).toBe(false);
  });
});

describe("HU0010-3.0 G06 dictamen No apto", () => {
  it("HU0010-3.0 G06 «No apto» envía las conclusiones sin requisitos y deja el dictamen emitido sin formulario", async () => {
    const e = await abrir();
    await abrirDictamen(e, 3);
    const panel = e.get('[data-testid="panel-dictamen"]');
    await panel.get('[data-testid="opcion-no_apto"]').setValue(true);
    await panel.get('[data-testid="campo-conclusiones"]').setValue("No cumple el perfil de admisión");
    dictamen = { ...dictamenBase(), estado: "no_apto", habilitado: false, opciones: [], dictamen: { dictamen: "no_apto", conclusiones: "No cumple el perfil de admisión", requisitos_complementarios: null, tiene_informe: false, fecha_emision: "2026-11-05T15:00:00.000Z" } };
    await panel.get('[data-testid="guardar-dictamen"]').trigger("click");
    await esperar();

    expect(enviosForm[0]!.campos).toEqual({ dictamen: "no_apto", conclusiones: "No cumple el perfil de admisión" });
    expect(e.get('[data-testid="dictamen-emitido"]').text()).toContain("Dictamen emitido: No apto");
    expect(e.find('[data-testid="guardar-dictamen"]').exists()).toBe(false);
  });
});
