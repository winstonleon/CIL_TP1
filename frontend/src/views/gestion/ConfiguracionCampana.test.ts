// G09 · Configuración de la campaña (HU0022-1.0 y 2.0) desde la pantalla, con la API simulada en fetch. Así se prueba
// también el cliente real (llamarApi + api/configuracion): método, ruta y cuerpo. Estas pruebas no verifican partes del
// escenario en la matriz (plan HU0022): el almacenamiento y la regla los verifican las pruebas de la API y el E2E.
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { usuarioActual } from "../../auth/oidc";
import { usuarioFalso } from "../../pruebas/ayudantes";
import ConfiguracionCampana from "./ConfiguracionCampana.vue";

vi.mock("../../auth/oidc", async (original) => ({
  ...(await original<typeof import("../../auth/oidc")>()),
  usuarioActual: vi.fn(),
}));

interface Llamada {
  metodo: string;
  url: string;
  cuerpo?: unknown;
}

type Grado = Record<string, unknown> & { id_grado: number };
type Requisito = Record<string, unknown> & { id_requisito: number; id_grado: number };
type Horario = Record<string, unknown> & { id_horario: number };

let grados: Grado[];
let requisitos: Requisito[];
let horarios: Horario[];
let llamadas: Llamada[];
let errorSiguiente: { status: number; codigo: string; mensaje: string; detalle?: unknown } | null;

const responder = (status: number, cuerpo?: unknown) =>
  cuerpo === undefined ? new Response(null, { status }) : new Response(JSON.stringify(cuerpo), { status, headers: { "Content-Type": "application/json" } });

const RESPONSABLES = [
  { id_personal: 31, nombre: "Ana Lucía Torres", rol: "directora" },
  { id_personal: 32, nombre: "Carmen Villanueva Rojas", rol: "psicologa" },
  { id_personal: 33, nombre: "Luis Paredes Díaz", rol: "evaluador_academico" },
];

// API simulada de /configuracion con el formato de la API real.
function apiFalsa(url: string, init: RequestInit = {}): Response {
  const metodo = init.method ?? "GET";
  const cuerpo = typeof init.body === "string" ? JSON.parse(init.body) : undefined;
  llamadas.push({ metodo, url, cuerpo });
  if (metodo !== "GET" && errorSiguiente) {
    const { status, codigo, mensaje, detalle } = errorSiguiente;
    errorSiguiente = null;
    return responder(status, { error: { codigo, mensaje, ...(detalle === undefined ? {} : { detalle }) } });
  }
  if (metodo === "GET" && url === "/api/configuracion") return responder(200, { campana: "2031", derecho_admision: 300, grados });
  if (metodo === "PATCH" && url === "/api/configuracion/grados") {
    const guardados = (cuerpo.grados as Grado[]).map((c) => {
      const g = grados.find((x) => x.id_grado === c.id_grado)!;
      const { monto_cuota_ingreso, ...resto } = c;
      Object.assign(g, resto, monto_cuota_ingreso === undefined ? {} : { monto_cuota_ingreso: Number(monto_cuota_ingreso).toFixed(2) });
      return g;
    });
    return responder(200, guardados);
  }
  const deGrado = url.match(/^\/api\/configuracion\/grados\/(\d+)\/requisitos$/);
  if (deGrado && metodo === "GET") return responder(200, requisitos.filter((r) => r.id_grado === Number(deGrado[1])));
  if (deGrado && metodo === "POST") {
    const nuevo = { id_requisito: 500 + requisitos.length, id_grado: Number(deGrado[1]), ...cuerpo };
    requisitos.push(nuevo);
    return responder(201, nuevo);
  }
  const requisito = url.match(/^\/api\/configuracion\/requisitos\/(\d+)$/);
  if (requisito && metodo === "PATCH") {
    const r = requisitos.find((x) => x.id_requisito === Number(requisito[1]))!;
    Object.assign(r, cuerpo);
    return responder(200, r);
  }
  if (requisito && metodo === "DELETE") {
    requisitos = requisitos.filter((x) => x.id_requisito !== Number(requisito[1]));
    return responder(204);
  }
  if (metodo === "GET" && url === "/api/configuracion/responsables") return responder(200, RESPONSABLES);
  if (metodo === "GET" && url === "/api/configuracion/horarios") return responder(200, horarios);
  if (metodo === "POST" && url === "/api/configuracion/horarios") {
    const nuevo = { id_horario: 700 + horarios.length, ...cuerpo, responsable: RESPONSABLES.find((r) => r.id_personal === cuerpo.id_personal)!.nombre };
    horarios.push(nuevo);
    return responder(201, nuevo);
  }
  const horario = url.match(/^\/api\/configuracion\/horarios\/(\d+)$/);
  if (horario && metodo === "DELETE") {
    horarios = horarios.filter((x) => x.id_horario !== Number(horario[1]));
    return responder(204);
  }
  return responder(404, { error: { codigo: "NO_ENCONTRADO", mensaje: "Recurso no encontrado" } });
}

const grado = (id: number, nombre: string, valores: Record<string, unknown> = {}): Grado => ({
  id_grado: id,
  nivel: "primaria",
  nombre_grado: nombre,
  vacantes_autorizadas: 30,
  vacantes_adjudicadas: 0,
  requiere_jornada_observacion: false,
  requiere_evaluacion_psicologica: true,
  requiere_evaluacion_academica: false,
  monto_cuota_ingreso: "7000.00",
  max_fracciones: 1,
  ...valores,
});

beforeEach(() => {
  grados = [
    grado(1, "3 años", { nivel: "inicial", vacantes_autorizadas: 20, vacantes_adjudicadas: 12, requiere_jornada_observacion: true, requiere_evaluacion_psicologica: false }),
    grado(5, "2.° de primaria", { vacantes_adjudicadas: 27, requiere_evaluacion_academica: true, max_fracciones: 3 }),
    grado(10, "1.° de secundaria", { nivel: "secundaria", requiere_evaluacion_academica: true, monto_cuota_ingreso: "4000.00" }),
  ];
  requisitos = [
    { id_requisito: 41, id_grado: 5, tipo_documento: "Partida de nacimiento", categoria: "postulante_y_padres", condicion_aplicacion: "todos", obligatorio: true, por_apoderado: false },
    { id_requisito: 42, id_grado: 5, tipo_documento: "Boletas de pago (últimos 3 meses)", categoria: "financiero", condicion_aplicacion: "si_dependiente", obligatorio: true, por_apoderado: true },
    { id_requisito: 43, id_grado: 1, tipo_documento: "DNI del postulante", categoria: "postulante_y_padres", condicion_aplicacion: "todos", obligatorio: true, por_apoderado: false },
  ];
  horarios = [
    { id_horario: 61, id_personal: 31, responsable: "Ana Lucía Torres", tipo_cita: "visita", fecha: "2031-01-15", hora_inicio: "09:00", hora_fin: "10:00", cupos: 1 },
  ];
  llamadas = [];
  errorSiguiente = null;
  vi.stubEnv("VITE_API_URL", "/api");
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => apiFalsa(url, init)));
  vi.mocked(usuarioActual).mockResolvedValue(usuarioFalso(["secretaria"], "Secretaria Ficticia"));
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

async function montar() {
  const envoltorio = mount(ConfiguracionCampana);
  await flushPromises();
  return envoltorio;
}

const cambios = (metodo: string) => llamadas.filter((l) => l.metodo === metodo);
const fila = (envoltorio: VueWrapper, id: number) => envoltorio.get(`[data-testid="grado-${id}"]`);

async function abrirPestana(envoltorio: VueWrapper, nombre: string) {
  const pestana = envoltorio.findAll('[role="tab"]').find((t) => t.text() === nombre)!;
  await pestana.trigger("click");
  await flushPromises();
}

// ====================================================================== pestaña de grados (mockup)

describe("HU0022-1.0 G09 · grados, vacantes y evaluaciones", () => {
  it("HU0022-1.0 [parte: almacenamiento] muestra las pestañas y la tabla del mockup con lo que devuelve la API, sin valores fijos", async () => {
    const envoltorio = await montar();

    const pestanas = envoltorio.get('[role="tablist"]').findAll('[role="tab"]');
    expect(pestanas.map((p) => p.text())).toEqual(["Grados, vacantes y evaluaciones", "Requisitos documentales", "Cuota de ingreso", "Horarios"]);
    expect(pestanas.map((p) => p.attributes("aria-selected"))).toEqual(["true", "false", "false", "false"]);

    const encabezados = envoltorio.get("#g09-panel-grados").findAll("thead th").map((th) => th.text());
    expect(encabezados).toEqual(["Grado", "Vacantes autorizadas", "Adjudicadas", "Evaluaciones", "Cuota de ingreso", "Máx. fracciones"]);

    const segundo = fila(envoltorio, 5).findAll("td").map((td) => td.text());
    expect(segundo[0]).toBe("2.° de primaria");
    expect(segundo[2]).toBe("27");
    expect(segundo[4]).toBe("S/ 7,000");
    expect(segundo[5]).toBe("3"); // el máximo de fracciones viene de la API (en el mockup, [por definir])
    expect(fila(envoltorio, 10).findAll("td")[4]!.text()).toBe("S/ 4,000");
    expect(envoltorio.text()).toContain("Derecho de admisión: S/ 300");
    expect(envoltorio.text()).not.toContain("[por definir]");
  });

  it("HU0022-1.0 [parte: almacenamiento] edita vacantes y evaluaciones (chips con aria-pressed) y los envía en un solo guardado", async () => {
    const envoltorio = await montar();

    await fila(envoltorio, 1).get('input[aria-label="Vacantes autorizadas de 3 años"]').setValue("22");
    const academica = fila(envoltorio, 1).get('button[aria-label="Académica · 3 años"]');
    expect(academica.attributes("aria-pressed")).toBe("false");
    await academica.trigger("click");
    expect(academica.attributes("aria-pressed")).toBe("true");
    await fila(envoltorio, 1).get('button[aria-label="Observación · 3 años"]').trigger("click");

    await envoltorio.get("#g09-panel-grados").findAll("button").find((b) => b.text() === "Guardar")!.trigger("click");
    await flushPromises();

    expect(cambios("PATCH")).toHaveLength(1);
    const enviado = cambios("PATCH")[0]!;
    expect(enviado.url).toBe("/api/configuracion/grados");
    expect((enviado.cuerpo as { grados: unknown[] }).grados).toEqual([
      { id_grado: 1, vacantes_autorizadas: 22, requiere_jornada_observacion: false, requiere_evaluacion_psicologica: false, requiere_evaluacion_academica: true },
      { id_grado: 5, vacantes_autorizadas: 30, requiere_jornada_observacion: false, requiere_evaluacion_psicologica: true, requiere_evaluacion_academica: true },
      { id_grado: 10, vacantes_autorizadas: 30, requiere_jornada_observacion: false, requiere_evaluacion_psicologica: true, requiere_evaluacion_academica: true },
    ]);
    expect(envoltorio.get("#g09-panel-grados").get('[role="status"]').text()).toBe("Cambios guardados.");
  });

  it("HU0022-1.0 [parte: almacenamiento] 0 adjudicadas se muestra como «—» con aria-label «0 adjudicadas», y la entrevista aplica siempre sin poder quitarse", async () => {
    const envoltorio = await montar();

    const guion = fila(envoltorio, 10).findAll("td")[2]!.get('[aria-label="0 adjudicadas"]');
    expect(guion.text()).toBe("—");
    for (const id of [1, 5, 10]) {
      const chips = fila(envoltorio, id).get(".g09-chips");
      expect(chips.findAll("button").map((b) => b.text())).toEqual(["Observación", "Psicológica", "Académica"]);
      const entrevista = chips.findAll("span").find((s) => s.text() === "Entrevista");
      expect(entrevista?.element.tagName).toBe("SPAN");
    }
  });

  it("HU0022-1.0 [parte: almacenamiento] el panel lateral muestra los requisitos del grado elegido con los chips del mockup", async () => {
    const envoltorio = await montar();
    const panel = () => envoltorio.get('[data-testid="panel-requisitos"]');
    expect(panel().text()).toContain("DNI del postulante");

    await fila(envoltorio, 5).get('button[aria-label="Ver requisitos de 2.° de primaria"]').trigger("click");
    await flushPromises();

    expect(fila(envoltorio, 5).get(".g09-grado").attributes("aria-current")).toBe("true");
    const items = panel().findAll("li").map((li) => li.findAll("span").map((s) => s.text()));
    expect(items).toEqual([
      ["Partida de nacimiento", "Todos"],
      ["Boletas de pago (últimos 3 meses)", "Financiero · solo Tesorería", "Si es dependiente"],
    ]);
    expect(panel().text()).toContain("La ficha y el cuestionario se completan en línea.");
  });
});

// ====================================================================== HU0022-2.0

describe("HU0022-2.0 G09 · menos vacantes que las adjudicadas", () => {
  it("HU0022-2.0 [parte: regla] no valida la regla en el cliente: envía el cambio y, con el 422 de la API, marca el grado con «Ya hay 27 adjudicadas» y muestra el aviso con el mínimo", async () => {
    const envoltorio = await montar();
    const entrada = fila(envoltorio, 5).get('input[aria-label="Vacantes autorizadas de 2.° de primaria"]');
    await entrada.setValue("25");
    expect(entrada.attributes("aria-invalid")).toBe("false");
    expect(envoltorio.text()).not.toContain("adjudicadas (27)");

    const mensaje = "No se puede fijar para 2.° de primaria un número de vacantes menor al de vacantes ya adjudicadas (27).";
    errorSiguiente = { status: 422, codigo: "VACANTES_MENORES_QUE_ADJUDICADAS", mensaje, detalle: [{ id_grado: 5, minimo: 27 }] };
    await envoltorio.get("#g09-panel-grados").findAll("button").find((b) => b.text() === "Guardar")!.trigger("click");
    await flushPromises();

    expect(cambios("PATCH")).toHaveLength(1); // la pantalla no bloqueó el envío
    expect(fila(envoltorio, 5).classes()).toContain("g09-fila-aviso");
    expect(entrada.attributes("aria-invalid")).toBe("true");
    const error = envoltorio.get(`#${entrada.attributes("aria-describedby")}`);
    expect(error.text()).toBe("Ya hay 27 adjudicadas");
    expect(envoltorio.get('#g09-panel-grados [role="alert"]').text()).toBe(mensaje);
    expect(fila(envoltorio, 1).classes()).not.toContain("g09-fila-aviso");
    expect(envoltorio.get("#g09-panel-grados").get('[role="status"]').text()).toBe("");
  });
});

// ====================================================================== requisitos (P5)

describe("HU0022-1.0 G09 · requisitos documentales", () => {
  it("HU0022-1.0 [parte: almacenamiento] registra un requisito; «Se exige a cada apoderado» queda marcado y bloqueado con «Si es dependiente»", async () => {
    const envoltorio = await montar();
    await abrirPestana(envoltorio, "Requisitos documentales");
    const panel = envoltorio.get("#g09-panel-requisitos");
    expect(panel.get("h2#g09-requisito-formulario").text()).toBe("Nuevo requisito");

    await panel.get("#g09-req-documento").setValue("Recibos por honorarios y DJ anual");
    await panel.get("#g09-req-categoria").setValue("financiero");
    await panel.get("#g09-req-condicion").setValue("si_dependiente");
    const porApoderado = panel.findAll('input[type="checkbox"]')[1]!;
    expect((porApoderado.element as HTMLInputElement).checked).toBe(true);
    expect(porApoderado.attributes("disabled")).toBeDefined();

    await panel.get("form").trigger("submit");
    await flushPromises();

    expect(cambios("POST")).toEqual([
      {
        metodo: "POST",
        url: "/api/configuracion/grados/1/requisitos",
        cuerpo: { tipo_documento: "Recibos por honorarios y DJ anual", categoria: "financiero", condicion_aplicacion: "si_dependiente", obligatorio: true, por_apoderado: true },
      },
    ]);
    expect(panel.text()).toContain("Recibos por honorarios y DJ anual");
    expect(panel.get('[role="status"]').text()).toBe("Requisito agregado.");
  });

  it("HU0022-1.0 [parte: almacenamiento] edita un requisito sin poder cambiar el grado y muestra junto al campo el 409 de nombre repetido", async () => {
    const envoltorio = await montar();
    await abrirPestana(envoltorio, "Requisitos documentales");
    const panel = envoltorio.get("#g09-panel-requisitos");
    await panel.get("#g09-req-grado").setValue("5");
    await flushPromises();

    await panel.get('button[aria-label="Editar Partida de nacimiento"]').trigger("click");
    expect(panel.get("h2#g09-requisito-formulario").text()).toBe("Editar requisito");
    expect(panel.get("#g09-req-grado").attributes("disabled")).toBeDefined();

    await panel.get("#g09-req-documento").setValue("BOLETAS DE PAGO (últimos 3 meses)");
    errorSiguiente = { status: 409, codigo: "REQUISITO_DUPLICADO", mensaje: "El grado ya tiene un requisito con ese nombre (sin distinguir mayúsculas)" };
    await panel.get("form").trigger("submit");
    await flushPromises();

    expect(cambios("PATCH")[0]).toMatchObject({ url: "/api/configuracion/requisitos/41" });
    const documento = panel.get("#g09-req-documento");
    expect(documento.attributes("aria-invalid")).toBe("true");
    expect(envoltorio.get(`#${documento.attributes("aria-describedby")}`).text()).toBe(
      "El grado ya tiene un requisito con ese nombre (sin distinguir mayúsculas)",
    );

    await panel.get("#g09-req-documento").setValue("Partida de nacimiento (original)");
    await panel.get("form").trigger("submit");
    await flushPromises();
    expect(cambios("PATCH")[1]!.cuerpo).toMatchObject({ tipo_documento: "Partida de nacimiento (original)" });
    expect(cambios("PATCH")[1]!.cuerpo).not.toHaveProperty("id_grado");
    expect(panel.get('[data-testid="requisito-41"]').text()).toContain("Partida de nacimiento (original)");
  });

  it("HU0022-1.0 [parte: almacenamiento] quita un requisito tras confirmar y, si la API responde 409 EN_USO, explica por qué no se quitó", async () => {
    const envoltorio = await montar();
    await abrirPestana(envoltorio, "Requisitos documentales");
    const panel = envoltorio.get("#g09-panel-requisitos");
    await panel.get("#g09-req-grado").setValue("5");
    await flushPromises();

    await panel.get('button[aria-label="Quitar Partida de nacimiento"]').trigger("click");
    expect(panel.get("dialog").text()).toContain("¿Quitar el requisito Partida de nacimiento de 2.° de primaria?");
    await panel.get("dialog").findAll("button").find((b) => b.text() === "Quitar")!.trigger("click");
    await flushPromises();
    expect(cambios("DELETE")).toEqual([{ metodo: "DELETE", url: "/api/configuracion/requisitos/41", cuerpo: undefined }]);
    expect(panel.find('[data-testid="requisito-41"]').exists()).toBe(false);

    await panel.get('button[aria-label="Quitar Boletas de pago (últimos 3 meses)"]').trigger("click");
    errorSiguiente = { status: 409, codigo: "EN_USO", mensaje: "No se puede quitar: ya hay documentos cargados para este requisito" };
    await panel.get("dialog").findAll("button").find((b) => b.text() === "Quitar")!.trigger("click");
    await flushPromises();
    expect(panel.get('[role="alert"]').text()).toBe("No se puede quitar: ya hay documentos cargados para este requisito.");
    expect(panel.find('[data-testid="requisito-42"]').exists()).toBe(true);
  });
});

// ====================================================================== cuota de ingreso (P5)

describe("HU0022-1.0 G09 · cuota de ingreso", () => {
  it("HU0022-1.0 [parte: almacenamiento] guarda la cuota (también 0) y el máximo de fracciones de los grados con lo que devuelve la API", async () => {
    const envoltorio = await montar();
    await abrirPestana(envoltorio, "Cuota de ingreso");
    const panel = envoltorio.get("#g09-panel-cuota");
    expect((panel.get('input[aria-label="Máximo de fracciones de 2.° de primaria"]').element as HTMLInputElement).value).toBe("3");

    await panel.get('input[aria-label="Cuota de ingreso de 3 años"]').setValue("0");
    await panel.get('input[aria-label="Máximo de fracciones de 3 años"]').setValue("4");
    await panel.findAll("button").find((b) => b.text() === "Guardar")!.trigger("click");
    await flushPromises();

    expect(cambios("PATCH")).toHaveLength(1);
    expect((cambios("PATCH")[0]!.cuerpo as { grados: unknown[] }).grados).toEqual([
      { id_grado: 1, monto_cuota_ingreso: 0, max_fracciones: 4 },
      { id_grado: 5, monto_cuota_ingreso: 7000, max_fracciones: 3 },
      { id_grado: 10, monto_cuota_ingreso: 4000, max_fracciones: 1 },
    ]);
    expect(panel.get('[role="status"]').text()).toBe("Cambios guardados.");
    // La primera pestaña muestra lo guardado.
    expect(fila(envoltorio, 1).findAll("td")[4]!.text()).toBe("S/ 0");
    expect(fila(envoltorio, 1).findAll("td")[5]!.text()).toBe("4");
  });
});

// ====================================================================== horarios (P5)

describe("HU0022-1.0 G09 · horarios", () => {
  it("HU0022-1.0 [parte: almacenamiento] solo ofrece los responsables del rol del tipo de cita y registra el horario", async () => {
    const envoltorio = await montar();
    await abrirPestana(envoltorio, "Horarios");
    const panel = envoltorio.get("#g09-panel-horarios");
    expect(panel.get('[data-testid="horario-61"]').findAll("td").map((td) => td.text())).toEqual([
      "15/01/2031",
      "09:00 – 10:00",
      "Visita guiada",
      "Ana Lucía Torres",
      "1",
      "",
    ]);

    const opciones = () => panel.get("#g09-hor-responsable").findAll("option:not([disabled])").map((o) => o.text());
    expect(panel.get("#g09-hor-responsable").attributes("disabled")).toBeDefined();
    await panel.get("#g09-hor-tipo").setValue("visita");
    expect(opciones()).toEqual(["Ana Lucía Torres"]);
    await panel.get("#g09-hor-tipo").setValue("entrevista_padres");
    expect(opciones()).toEqual(["Carmen Villanueva Rojas"]);
    await panel.get("#g09-hor-tipo").setValue("evaluacion_academica");
    expect(opciones()).toEqual(["Luis Paredes Díaz"]);

    await panel.get("#g09-hor-responsable").setValue("33");
    await panel.get("#g09-hor-fecha").setValue("2031-01-20");
    await panel.get("#g09-hor-inicio").setValue("08:00");
    await panel.get("#g09-hor-fin").setValue("10:00");
    await panel.get("#g09-hor-cupos").setValue("2");
    await panel.get("form").trigger("submit");
    await flushPromises();

    expect(cambios("POST")).toEqual([
      {
        metodo: "POST",
        url: "/api/configuracion/horarios",
        cuerpo: { id_personal: 33, tipo_cita: "evaluacion_academica", fecha: "2031-01-20", hora_inicio: "08:00", hora_fin: "10:00", cupos: 2 },
      },
    ]);
    expect(panel.text()).toContain("Luis Paredes Díaz");
    expect(panel.get('[role="status"]').text()).toBe("Horario agregado.");
  });

  it("HU0022-1.0 [parte: almacenamiento] muestra junto a las horas el 409 de horario superpuesto y quita un horario tras confirmar (409 EN_USO con su motivo)", async () => {
    const envoltorio = await montar();
    await abrirPestana(envoltorio, "Horarios");
    const panel = envoltorio.get("#g09-panel-horarios");

    await panel.get("#g09-hor-tipo").setValue("visita");
    await panel.get("#g09-hor-responsable").setValue("31");
    await panel.get("#g09-hor-fecha").setValue("2031-01-15");
    await panel.get("#g09-hor-inicio").setValue("09:30");
    await panel.get("#g09-hor-fin").setValue("10:30");
    errorSiguiente = { status: 409, codigo: "HORARIO_SUPERPUESTO", mensaje: "El responsable ya tiene un horario que se cruza con este en esa fecha" };
    await panel.get("form").trigger("submit");
    await flushPromises();

    for (const id of ["#g09-hor-inicio", "#g09-hor-fin"]) {
      const hora = panel.get(id);
      expect(hora.attributes("aria-invalid")).toBe("true");
      expect(hora.attributes("aria-describedby")).toContain("g09-hor-inicio-error");
    }
    expect(panel.get("#g09-hor-inicio-error").text()).toBe("Ana Lucía Torres ya tiene un horario que se cruza con este el 15/01/2031.");

    await panel.get('button[aria-label="Quitar el horario del 15/01/2031, 09:00 – 10:00"]').trigger("click");
    expect(panel.get("dialog").text()).toContain("¿Quitar el horario del 15/01/2031, de 09:00 a 10:00?");
    errorSiguiente = { status: 409, codigo: "EN_USO", mensaje: "No se puede quitar: el horario ya tiene citas" };
    await panel.get("dialog").findAll("button").find((b) => b.text() === "Quitar")!.trigger("click");
    await flushPromises();
    expect(panel.get('[role="alert"]').text()).toBe("No se puede quitar: el horario ya tiene citas.");
    expect(panel.find('[data-testid="horario-61"]').exists()).toBe(true);

    await panel.get('button[aria-label="Quitar el horario del 15/01/2031, 09:00 – 10:00"]').trigger("click");
    await panel.get("dialog").findAll("button").find((b) => b.text() === "Quitar")!.trigger("click");
    await flushPromises();
    expect(cambios("DELETE").at(-1)).toMatchObject({ url: "/api/configuracion/horarios/61" });
    expect(panel.find('[data-testid="horario-61"]').exists()).toBe(false);
    expect(panel.get('[role="status"]').text()).toBe("Horario quitado.");
  });
});
