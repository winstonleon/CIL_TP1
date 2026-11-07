// G08 · Tablero de indicadores (HU0019) con la API simulada en fetch. Se monta la app con el enrutador real en
// /gestion/indicadores. Solo se prueba lo propio de la pantalla: muestra lo que devuelve la API, envía los filtros y descarga el
// reporte. Los cálculos los hace la API y los prueban api/test/indicadores*.test.ts.
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { createPinia } from "pinia";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryHistory } from "vue-router";
import App from "../../App.vue";
import type { Indicadores } from "../../api/indicadores";
import { usuarioActual } from "../../auth/oidc";
import { usuarioFalso } from "../../pruebas/ayudantes";
import { crearEnrutador } from "../../router";

vi.mock("../../auth/oidc", async (original) => ({
  ...(await original<typeof import("../../auth/oidc")>()),
  usuarioActual: vi.fn(),
  iniciarSesion: vi.fn(),
}));

const OPCIONES = {
  campana_activa: "2027",
  campanas: ["2027", "DEMO"],
  grados: [
    { id_grado: 1, nivel: "primaria", grado: "3.° de primaria", campana: "2027" },
    { id_grado: 2, nivel: "inicial", grado: "3 años", campana: "2027" },
    { id_grado: 9, nivel: "primaria", grado: "Grado demo", campana: "DEMO" },
  ],
};

const SIN_BASE = { tramo_dias: null, cycle_horas: null };
const etapa = (id: string, titulo: string, mide: boolean, dias: number | null, horas: number | null) => ({
  etapa: id,
  titulo,
  mide_cycle: mide,
  tramo_dias: dias,
  n_tramo: 3,
  cycle_horas: horas,
  n_cycle: 2,
  linea_base: SIN_BASE,
});

const base = (): Indicadores => ({
  filtros: { campana: "2027" },
  es_demo: false,
  tarjetas: { en_curso: 38, lead_time_dias: null, cartas: 0, cycle_time_horas: 4.5, ocupacion_pct: 56.2, observados_pct: 21.4 },
  embudo: [
    { etapa: "prospectos", titulo: "Prospectos registrados", total: 100, conversion_pct: null },
    { etapa: "visitas", titulo: "Visitas realizadas", total: 78, conversion_pct: 78 },
    { etapa: "postulaciones", titulo: "Postulaciones iniciadas", total: 62, conversion_pct: 79.5 },
    { etapa: "completos", titulo: "Expedientes completos", total: 51, conversion_pct: 82.3 },
    { etapa: "evaluaciones", titulo: "Evaluaciones concluidas", total: 40, conversion_pct: 78.4 },
    { etapa: "aptos", titulo: "Dictámenes Apto", total: 33, conversion_pct: 82.5 },
    { etapa: "vacantes", titulo: "Vacantes otorgadas", total: 28, conversion_pct: 84.8 },
    { etapa: "cartas", titulo: "Cartas emitidas", total: 0, conversion_pct: 0 },
  ],
  etapas: [
    etapa("captacion_visita", "Captación → visita", false, 6, null),
    etapa("visita_expediente", "Visita → expediente completo", false, 9, null),
    etapa("verificacion_pagos", "Verificación y pagos", true, 4.2, 3.5),
    etapa("evaluaciones_dictamen", "Evaluaciones y dictamen", true, 8, 6),
    etapa("adjudicacion", "Adjudicación", true, 2, 0.25),
    etapa("cuota_carta", "Cuota → carta", true, null, null),
  ],
  vacantes: [{ id_grado: 1, nivel: "primaria", grado: "3.° de primaria", autorizadas: 20, adjudicadas: 12, disponibles: 8, lista_espera: 1, ocupacion_pct: 60 }],
  avisos: [{ tipo_evento: "visita_confirmada", enviados: 9, fallidos: 1 }],
  expedientes: [
    { codigo: "ADM-2027-0007", grado: "3.° de primaria", etapa: "Apto", dias: 18.5, final: false, cycle_horas: 4.1 },
    { codigo: "ADM-2027-0008", grado: "3.° de primaria", etapa: "Carta emitida", dias: 40, final: true, cycle_horas: null },
  ],
  linea_base: { version: "borrador-1", fuente: null, definida: false, meta_pct: 70, lead_time: null, cycle_time: null },
});

let indicadores: Indicadores;
let consultas: string[];
let respuestaExportacion: () => Response;

const responder = (status: number, cuerpo: unknown) => ({ ok: status < 400, status, json: async () => cuerpo }) as Response;

function apiFalsa(url: string): Response {
  if (url === "/api/campana-activa") return responder(200, { campana: "2027" });
  if (url === "/api/direccion/indicadores/filtros") return responder(200, OPCIONES);
  if (url.startsWith("/api/direccion/indicadores/exportacion")) {
    consultas.push(url);
    return respuestaExportacion();
  }
  if (url.startsWith("/api/direccion/indicadores")) {
    consultas.push(url);
    return responder(200, indicadores);
  }
  return responder(404, { error: { codigo: "NO_ENCONTRADO", mensaje: "Recurso no encontrado" } });
}

const montados: VueWrapper[] = [];

beforeEach(() => {
  vi.clearAllMocks();
  indicadores = base();
  consultas = [];
  respuestaExportacion = () =>
    ({
      ok: true,
      status: 200,
      headers: new Headers({ "Content-Disposition": 'attachment; filename="indicadores-2027-2026-11-05.xlsx"' }),
      blob: async () => new Blob(["xlsx"]),
    }) as unknown as Response;
  vi.stubEnv("VITE_API_URL", "/api");
  vi.stubGlobal("fetch", vi.fn(async (url: string) => apiFalsa(url)));
  vi.mocked(usuarioActual).mockResolvedValue(usuarioFalso(["directora"], "Ana Lucía Torres"));
});

afterEach(() => {
  for (const m of montados.splice(0)) m.unmount();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function esperar() {
  for (let i = 0; i < 8; i++) await flushPromises();
}

async function abrir() {
  const enrutador = crearEnrutador(createMemoryHistory());
  const e = mount(App, { global: { plugins: [createPinia(), enrutador] }, attachTo: document.body });
  montados.push(e);
  await enrutador.push("/gestion/indicadores");
  await esperar();
  return e;
}

const texto = (e: VueWrapper, id: string) => e.get(`[data-testid="${id}"]`).text();
const elegir = async (e: VueWrapper, id: string, valor: string) => {
  const campo = e.get(`[data-testid="${id}"]`);
  (campo.element as HTMLInputElement).value = valor;
  await campo.trigger("change");
};

describe("HU0019-1.0 G08 tablero de indicadores", () => {
  it("HU0019-1.0 G08 abre con la campaña activa y muestra tarjetas, embudo con conversión, tiempos por etapa, vacantes y expedientes", async () => {
    const e = await abrir();

    expect(consultas).toEqual(["/api/direccion/indicadores?campana=2027"]);
    expect(e.text()).toContain("Indicadores de admisión");
    expect(texto(e, "en-curso")).toBe("38");
    expect(texto(e, "ocupacion")).toBe("56.2 %");
    expect(texto(e, "observados")).toBe("21.4 %");
    expect(e.text()).toContain("De la solicitud a la carta");
    expect(e.text()).toContain("Requirieron subsanación");
    expect(texto(e, "embudo-visitas")).toContain("Visitas realizadas");
    expect(texto(e, "conversion-visitas")).toBe("78 %");
    expect(texto(e, "conversion-prospectos")).toBe("");
    expect(e.get('[data-testid="etapa-verificacion_pagos"] [data-testid="tramo"]').text()).toBe("4.2 d");
    expect(e.get('[data-testid="etapa-verificacion_pagos"] [data-testid="cycle"]').text()).toBe("Atención: 3.5 h");
    expect(texto(e, "vacantes-1")).toContain("60 %");
    expect(texto(e, "aviso-visita_confirmada")).toContain("9");
    expect(e.findAll('[data-testid="fila-expediente"]')[0]!.text()).toContain("ADM-2027-0007");
  });

  it("HU0019-1.0 G08 sin cartas emitidas la tarjeta lo dice, y cada expediente rotula su lead time como parcial", async () => {
    const e = await abrir();

    expect(texto(e, "lead-time")).toBe("Sin cartas emitidas");
    const [parcial, completo] = e.findAll('[data-testid="fila-expediente"]');
    expect(parcial!.text()).toContain("18.5 d (parcial)");
    expect(completo!.text()).toContain("40 d");
    expect(completo!.text()).not.toContain("parcial");
  });

  it("HU0019-1.0 G08 con cartas emitidas muestra el lead time promedio", async () => {
    indicadores.tarjetas = { ...indicadores.tarjetas, lead_time_dias: 32.5, cartas: 4 };

    const e = await abrir();

    expect(texto(e, "lead-time")).toBe("32.5 d");
  });

  it("HU0019-1.0 G08 la tabla de avisos muestra una etiqueta legible por cada tipo, y un tipo desconocido tal cual", async () => {
    const etiquetas: Record<string, string> = {
      carpeta_enviada: "Carpeta informativa",
      visita_confirmada: "Confirmación de la visita",
      visita_reprogramacion: "Invitación a reprogramar la visita",
      credenciales_portal: "Credenciales del portal",
      recordatorio_visita: "Recordatorio de la visita",
      documentos_faltantes: "Documentos faltantes",
      subsanacion_solicitada: "Observaciones por subsanar",
      evaluaciones_habilitadas: "Evaluaciones habilitadas",
      evaluaciones_confirmadas: "Confirmación de las evaluaciones",
      evaluacion_reprogramada: "Evaluación reprogramada (familia)",
      evaluacion_reprogramada_responsable: "Evaluación reprogramada (responsable)",
      evaluacion_liberada_responsable: "Turno liberado (responsable)",
      evaluacion_inasistencia: "Inasistencia a la evaluación",
      dictamen_en_observacion: "Dictamen en observación (Admisión)",
      dictamen_no_apto: "Dictamen No apto",
      vacante_asignada: "Vacante otorgada",
      lista_espera: "Lista de espera",
      cuota_por_conciliar: "Cuota por conciliar (Tesorería)",
    };
    indicadores.avisos = [...Object.keys(etiquetas), "tipo_futuro"].map((tipo_evento) => ({ tipo_evento, enviados: 1, fallidos: 0 }));

    const e = await abrir();

    for (const [tipo, etiqueta] of Object.entries(etiquetas)) {
      expect(e.get(`[data-testid="aviso-${tipo}"] td`).text()).toBe(etiqueta);
    }
    expect(e.get('[data-testid="aviso-tipo_futuro"] td').text()).toBe("tipo_futuro");
  });

  it("HU0019-1.0 G08 las etapas sin atención del personal dicen que no se miden", async () => {
    const e = await abrir();

    expect(e.get('[data-testid="etapa-captacion_visita"] [data-testid="cycle"]').text()).toBe("No se mide: sin atención del personal");
    expect(e.get('[data-testid="etapa-captacion_visita"] [data-testid="tramo"]').text()).toBe("6 d");
    expect(e.get('[data-testid="etapa-cuota_carta"] [data-testid="tramo"]').text()).toBe("—");
  });

  it("HU0019-1.0 G08 «Actualizar métricas» consulta con la campaña, el grado y el rango elegidos, y al cambiar de campaña ofrece sus grados", async () => {
    const e = await abrir();
    consultas = [];

    await elegir(e, "filtro-grado", "1");
    await elegir(e, "filtro-desde", "2026-09-01");
    await elegir(e, "filtro-hasta", "2026-12-31");
    expect(consultas).toEqual([]); // no consulta hasta pulsar el botón
    await e.get('[data-testid="actualizar"]').trigger("click");
    await esperar();

    expect(consultas).toEqual(["/api/direccion/indicadores?campana=2027&id_grado=1&desde=2026-09-01&hasta=2026-12-31"]);

    await elegir(e, "filtro-campana", "DEMO");
    await esperar();
    const opciones = e.get('[data-testid="filtro-grado"]').findAll("option").map((o) => o.text());
    expect(opciones).toEqual(["Todos los grados", "Grado demo"]);
    expect(e.text()).toContain("Campaña 2027"); // la tarjeta rotula los datos mostrados, no el filtro sin aplicar
    expect((e.get('[data-testid="filtro-grado"]').element as HTMLSelectElement).value).toBe("");
  });

  it("HU0019-1.0 G08 un error de la API se muestra y los datos anteriores siguen en pantalla", async () => {
    const e = await abrir();
    vi.mocked(fetch).mockImplementationOnce(async () => responder(400, { error: { codigo: "VALIDACION", mensaje: "Datos inválidos: desde" } }));

    await e.get('[data-testid="actualizar"]').trigger("click");
    await esperar();

    expect(texto(e, "error")).toBe("Datos inválidos: desde");
    expect(texto(e, "en-curso")).toBe("38");
  });

  it("HU0019-1.0 G08 sin línea base dice «[Línea base por definir]» y no muestra la comparación", async () => {
    const e = await abrir();

    expect(texto(e, "sin-linea-base")).toBe("[Línea base por definir]");
    expect(e.find('[data-testid="fila-base"]').exists()).toBe(false);
  });

  it("HU0019-1.0 G08 con línea base muestra actual, base, % de optimización y la meta", async () => {
    indicadores.tarjetas = { ...indicadores.tarjetas, lead_time_dias: 20, cartas: 3 };
    indicadores.linea_base = {
      version: "prueba",
      fuente: "Medición ficticia",
      definida: true,
      meta_pct: 70,
      lead_time: { base: 100, optimizacion_pct: 80, cumple_meta: true },
      cycle_time: { base: 9, optimizacion_pct: 50, cumple_meta: false },
    };

    const e = await abrir();

    expect(texto(e, "meta")).toBe("Meta de optimización: ≥ 70 % · Fuente: Medición ficticia");
    const filas = e.findAll('[data-testid="fila-base"]').map((f) => f.findAll("td").map((c) => c.text()));
    expect(filas).toEqual([
      ["Lead time", "100", "20 d", "80 %", "Cumple"],
      ["Cycle time", "9", "4.5 h", "50 %", "No cumple"],
    ]);
  });

  it("HU0019-1.0 G08 la campaña DEMO dice «Datos ficticios de demostración», y otra campaña no", async () => {
    const real = await abrir();
    expect(real.find('[data-testid="aviso-demo"]').exists()).toBe(false);

    indicadores.es_demo = true;
    const demo = await abrir();

    expect(texto(demo, "aviso-demo")).toBe("Datos ficticios de demostración");
  });

  it("HU0019-1.0 G08 otro rol no ve la pantalla", async () => {
    vi.mocked(usuarioActual).mockResolvedValue(usuarioFalso(["secretaria"], "Rosa Medina"));

    const e = await abrir();

    expect(e.find('[data-testid="en-curso"]').exists()).toBe(false);
    expect(consultas).toEqual([]);
  });
});

describe("HU0019-2.0 G08 exportación", () => {
  it("HU0019-2.0 G08 «Exportar reporte ejecutivo» descarga el archivo con los filtros aplicados y dice que no incluye datos personales", async () => {
    const url = vi.fn(() => "blob:reporte");
    vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: url, revokeObjectURL: vi.fn() }));
    const clic = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      expect(this.download).toBe("indicadores-2027-2026-11-05.xlsx");
    });
    const e = await abrir();
    consultas = [];
    await elegir(e, "filtro-desde", "2026-09-01");

    await e.get('[data-testid="exportar"]').trigger("click");
    await esperar();

    expect(consultas).toEqual(["/api/direccion/indicadores/exportacion?campana=2027&desde=2026-09-01&formato=xlsx"]);
    expect(url).toHaveBeenCalledOnce();
    expect(clic).toHaveBeenCalledOnce();
    expect(e.text()).toContain("No incluye datos personales de los postulantes.");
  });

  it("HU0019-2.0 G08 un error de la exportación se muestra", async () => {
    respuestaExportacion = () => responder(403, { error: { codigo: "ACCESO_DENEGADO", mensaje: "No tienes permiso" } });
    const e = await abrir();

    await e.get('[data-testid="exportar"]').trigger("click");
    await esperar();

    expect(texto(e, "error")).toBe("No tienes permiso");
  });
});
