// Tablero de indicadores (HU0019-1.0, G08) por su ruta real. Cada cálculo se compara con números exactos sobre trayectos con
// fechas fijas en admision_test (ayudantesIndicadores): embudo, lead time, tramos, cycle time, ocupación, avisos, filtros y
// línea base, más el acceso por rol. Datos ficticios @ejemplo.test.
import { randomUUID } from "node:crypto";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { cerrarPool, obtenerPool } from "../src/db/pool";
import type { LineaBase } from "../src/services/lineaBase";
import { crearFirmante, crearPersonal } from "./ayudantes";
import { entornoIndicadores, RUTA_INDICADORES } from "./ayudantesIndicadores";

const db = () => obtenerPool();
let firmante: Awaited<ReturnType<typeof crearFirmante>>;

beforeAll(async () => {
  firmante = await crearFirmante();
});
afterAll(cerrarPool);

// Camino completo con días fijos desde el registro (el 1 de setiembre a las 10:00): 2, 7, 10, 16, 17 y 20.
const COMPLETO = [
  ["visita_agendada", "2026-09-02T10:00:00"],
  ["portal_habilitado", "2026-09-03T10:00:00"],
  ["en_postulacion", "2026-09-04T10:00:00"],
  ["en_validacion", "2026-09-08T10:00:00"],
  ["en_evaluacion", "2026-09-11T10:00:00"],
  ["apto", "2026-09-17T10:00:00"],
  ["vacante_asignada", "2026-09-18T10:00:00"],
  ["carta_emitida", "2026-09-21T10:00:00"],
] as const;
const hasta = (estado: string) => COMPLETO.slice(0, COMPLETO.findIndex(([e]) => e === estado) + 1);
const etapa = (body: { etapas: { etapa: string }[] }, id: string) => body.etapas.find((x) => x.etapa === id) as Record<string, unknown> | undefined;

describe("HU0019-1.0 embudo de conversión", () => {
  it("HU0019-1.0 (embudo) cuenta los expedientes que alcanzaron cada etapa, con su tasa de conversión, sin contar dos veces una visita repetida", async () => {
    const e = await entornoIndicadores(db(), firmante);
    const g = await e.grado();
    await e.trayecto(g, "2026-09-01T10:00:00"); // sigue de prospecto
    // «No asistió» y vuelve a reservar: dos llegadas a visita_agendada, una sola visita realizada.
    await e.trayecto(g, "2026-09-01T10:00:00", [
      ["visita_agendada", "2026-09-02T10:00:00"],
      ["prospecto", "2026-09-03T10:00:00"],
      ["visita_agendada", "2026-09-04T10:00:00"],
      ["portal_habilitado", "2026-09-05T10:00:00"],
    ]);
    await e.trayecto(g, "2026-09-01T10:00:00", [...hasta("en_evaluacion"), ["no_apto", "2026-09-15T10:00:00"]]);
    await e.trayecto(g, "2026-09-01T10:00:00", [...hasta("en_evaluacion"), ["en_observacion", "2026-09-15T10:00:00"], ["apto", "2026-09-16T10:00:00"]]);
    await e.trayecto(g, "2026-09-01T10:00:00", COMPLETO);

    const res = await e.consultar();

    expect(res.status).toBe(200);
    expect(res.body.embudo).toEqual([
      { etapa: "prospectos", titulo: "Prospectos registrados", total: 5, conversion_pct: null },
      { etapa: "visitas", titulo: "Visitas realizadas", total: 4, conversion_pct: 80 },
      { etapa: "postulaciones", titulo: "Postulaciones iniciadas", total: 3, conversion_pct: 75 },
      { etapa: "completos", titulo: "Expedientes completos", total: 3, conversion_pct: 100 },
      { etapa: "evaluaciones", titulo: "Evaluaciones concluidas", total: 3, conversion_pct: 100 },
      { etapa: "aptos", titulo: "Dictámenes Apto", total: 2, conversion_pct: 66.7 },
      { etapa: "vacantes", titulo: "Vacantes otorgadas", total: 1, conversion_pct: 50 },
      { etapa: "cartas", titulo: "Cartas emitidas", total: 1, conversion_pct: 100 },
    ]);
    // En curso: solo el expediente en apto (la carta y el no apto ya terminaron; prospecto y portal aún no postulan).
    expect(res.body.tarjetas.en_curso).toBe(1);
  });

  it("HU0019-1.0 (embudo) nunca crece: un expediente sin las transiciones previas en su bitácora cuenta en las etapas que dejó atrás", async () => {
    const e = await entornoIndicadores(db(), firmante);
    const g = await e.grado();
    await e.trayecto(g, "2026-09-01T10:00:00", [["en_postulacion", "2026-09-04T10:00:00"]]); // sin visita en la bitácora
    const sinBitacora = await e.trayecto(g, "2026-09-01T10:00:00");
    await db().query("UPDATE expediente SET estado = 'apto' WHERE id_expediente = $1", [sinBitacora]); // solo el estado actual

    const res = await e.consultar();

    expect(res.body.embudo.map((x: { total: number }) => x.total)).toEqual([2, 2, 2, 1, 1, 1, 0, 0]);
    expect(res.body.embudo.every((x: { conversion_pct: number | null }) => x.conversion_pct === null || x.conversion_pct <= 100)).toBe(true);
  });

  it("HU0019-1.0 (embudo) una campaña sin expedientes responde en cero y sin conversiones", async () => {
    const e = await entornoIndicadores(db(), firmante);

    const res = await e.consultar();

    expect(res.status).toBe(200);
    expect(res.body.embudo.map((x: { total: number }) => x.total)).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
    expect(res.body.embudo.map((x: { conversion_pct: number | null }) => x.conversion_pct)).toEqual(Array(8).fill(null));
    expect(res.body.tarjetas).toEqual({ en_curso: 0, lead_time_dias: null, cartas: 0, cycle_time_horas: null, ocupacion_pct: null, observados_pct: null });
  });

  it("HU0019-1.0 (observados) es el % de los que llegaron a validación con alguna observación, aunque ya se haya subsanado", async () => {
    const e = await entornoIndicadores(db(), firmante);
    const g = await e.grado();
    const observado = await e.trayecto(g, "2026-09-01T10:00:00", hasta("en_validacion"));
    await e.trayecto(g, "2026-09-01T10:00:00", hasta("en_validacion"));
    await e.trayecto(g, "2026-09-01T10:00:00", hasta("en_validacion"));
    await e.trayecto(g, "2026-09-01T10:00:00", hasta("en_postulacion")); // no llegó a validación: fuera de la base
    await e.atencion(observado, { tipo: "validacion_documental", id: observado }, "2026-09-09T09:00:00", "2026-09-09T09:30:00", { decision: "observado" });

    const res = await e.consultar();

    expect(res.body.tarjetas.observados_pct).toBe(33.3);
  });
});

describe("HU0019-1.0 lead time", () => {
  it("HU0019-1.0 (lead time) va del registro a carta_emitida, por expediente y en promedio", async () => {
    const e = await entornoIndicadores(db(), firmante);
    const g = await e.grado();
    const a = await e.trayecto(g, "2026-09-01T10:00:00", COMPLETO); // 20 días
    const b = await e.trayecto(g, "2026-08-22T10:00:00", COMPLETO); // 30 días

    const res = await e.consultar();

    expect(res.body.tarjetas.lead_time_dias).toBe(25);
    expect(res.body.tarjetas.cartas).toBe(2);
    expect(res.body.expedientes).toEqual([
      { codigo: `ADM-${e.campana}-${String(a).padStart(4, "0")}`, grado: expect.any(String), etapa: "Carta emitida", dias: 20, final: true, cycle_horas: null },
      { codigo: `ADM-${e.campana}-${String(b).padStart(4, "0")}`, grado: expect.any(String), etapa: "Carta emitida", dias: 30, final: true, cycle_horas: null },
    ]);
  });

  it("HU0019-1.0 (lead time) sin cartas emitidas la tarjeta queda nula y cada expediente muestra los días hasta su última etapa, como parcial", async () => {
    const e = await entornoIndicadores(db(), firmante);
    const g = await e.grado();
    await e.trayecto(g, "2026-09-01T10:00:00"); // sin transiciones: 0 días
    await e.trayecto(g, "2026-09-01T10:00:00", hasta("apto")); // 16 días

    const res = await e.consultar();

    expect(res.body.tarjetas.lead_time_dias).toBeNull();
    expect(res.body.tarjetas.cartas).toBe(0);
    expect(res.body.expedientes.map((x: { etapa: string; dias: number; final: boolean }) => [x.etapa, x.dias, x.final])).toEqual([
      ["Prospecto", 0, false],
      ["Apto", 16, false],
    ]);
  });

  it("HU0019-1.0 (tramos) cada etapa promedia sus tramos completados, y los tramos suman el lead time", async () => {
    const e = await entornoIndicadores(db(), firmante);
    const g = await e.grado();
    await e.trayecto(g, "2026-09-01T10:00:00", COMPLETO);
    await e.trayecto(g, "2026-09-01T10:00:00", hasta("apto")); // este no completa las dos últimas etapas

    const res = await e.consultar();

    const tramos = res.body.etapas.map((x: { etapa: string; tramo_dias: number | null; n_tramo: number }) => [x.etapa, x.tramo_dias, x.n_tramo]);
    expect(tramos).toEqual([
      ["captacion_visita", 2, 2],
      ["visita_expediente", 5, 2],
      ["verificacion_pagos", 3, 2],
      ["evaluaciones_dictamen", 6, 2],
      ["adjudicacion", 1, 1],
      ["cuota_carta", 3, 1],
    ]);
    expect(tramos.reduce((s: number, [, dias]: [string, number]) => s + dias, 0)).toBe(res.body.tarjetas.lead_time_dias);
  });
});

describe("HU0019-1.0 cycle time por etapa (ADR-05)", () => {
  it("HU0019-1.0 (cycle time) suma los pares de cada expediente por etapa y promedia entre los expedientes con atención", async () => {
    const e = await entornoIndicadores(db(), firmante);
    const g = await e.grado();
    const a = await e.trayecto(g, "2026-09-01T10:00:00", hasta("en_validacion"));
    const b = await e.trayecto(g, "2026-09-01T10:00:00", hasta("en_validacion"));
    await e.trayecto(g, "2026-09-01T10:00:00", hasta("en_validacion")); // sin atención: fuera del promedio
    // a: 30 min de documentos + 1 h de financiera + 1 h 30 de una segunda apertura = 3 h. b: 1 h.
    await e.atencion(a, { tipo: "validacion_documental", id: a }, "2026-09-09T09:00:00", "2026-09-09T09:30:00");
    await e.atencion(a, { tipo: "documentacion_financiera", id: a }, "2026-09-09T10:00:00", "2026-09-09T11:00:00");
    await e.atencion(a, { tipo: "validacion_documental", id: a }, "2026-09-10T09:00:00", "2026-09-10T10:30:00");
    await e.atencion(b, { tipo: "validacion_documental", id: b }, "2026-09-09T09:00:00", "2026-09-09T10:00:00");

    const res = await e.consultar();

    expect(etapa(res.body, "verificacion_pagos")).toMatchObject({ cycle_horas: 2, n_cycle: 2 });
    expect(res.body.tarjetas.cycle_time_horas).toBe(2);
    const porExpediente = res.body.expedientes.map((x: { cycle_horas: number | null }) => x.cycle_horas);
    expect(porExpediente).toEqual([3, 1, null]);
  });

  it("HU0019-1.0 (cycle time) un inicio con fin a las 8 h exactas cuenta, y uno a las 8 h y 1 s no", async () => {
    const e = await entornoIndicadores(db(), firmante);
    const g = await e.grado();
    const a = await e.trayecto(g, "2026-09-01T10:00:00", hasta("apto"));
    const b = await e.trayecto(g, "2026-09-01T10:00:00", hasta("apto"));
    await e.atencion(a, { tipo: "dictamen", id: a }, "2026-09-15T08:00:00", "2026-09-15T16:00:00");
    await e.atencion(b, { tipo: "dictamen", id: b }, "2026-09-15T08:00:00", "2026-09-15T16:00:01");

    const res = await e.consultar();

    expect(etapa(res.body, "evaluaciones_dictamen")).toMatchObject({ cycle_horas: 8, n_cycle: 1 });
  });

  it("HU0019-1.0 (cycle time) no cuenta un inicio sin fin ni un fin sin inicio emparejado", async () => {
    const e = await entornoIndicadores(db(), firmante);
    const g = await e.grado();
    const a = await e.trayecto(g, "2026-09-01T10:00:00", hasta("apto"));
    await e.atencion(a, { tipo: "cita", id: 900 }, "2026-09-12T08:00:00", null);
    await e.atencion(a, { tipo: "cita", id: 901 }, "2026-09-12T09:00:00", "2026-09-12T09:30:00", { sinEmparejar: true });

    const res = await e.consultar();

    expect(etapa(res.body, "evaluaciones_dictamen")).toMatchObject({ cycle_horas: null, n_cycle: 0 });
    expect(res.body.tarjetas.cycle_time_horas).toBeNull();
  });

  it("HU0019-1.0 (cycle time) el pago del derecho va a Verificación y el de la cuota a Cuota → carta, y cita, dictamen y adjudicación a sus etapas", async () => {
    const e = await entornoIndicadores(db(), firmante);
    const g = await e.grado();
    const a = await e.trayecto(g, "2026-09-01T10:00:00", COMPLETO);
    const derecho = await e.pago(a, "derecho_admision");
    const cuota = await e.pago(a, "cuota_ingreso");
    await e.atencion(a, { tipo: "pago", id: derecho }, "2026-09-09T09:00:00", "2026-09-09T09:15:00"); // 0,25 h
    await e.atencion(a, { tipo: "pago", id: cuota }, "2026-09-19T09:00:00", "2026-09-19T09:30:00"); // 0,5 h
    await e.atencion(a, { tipo: "cita", id: 900 }, "2026-09-12T09:00:00", "2026-09-12T10:00:00"); // 1 h
    await e.atencion(a, { tipo: "dictamen", id: a }, "2026-09-16T09:00:00", "2026-09-16T11:00:00"); // + 2 h
    await e.atencion(a, { tipo: "adjudicacion", id: a }, "2026-09-18T09:00:00", "2026-09-18T09:06:00"); // 0,1 h

    const res = await e.consultar();

    expect(res.body.etapas.map((x: { etapa: string; mide_cycle: boolean; cycle_horas: number | null }) => [x.etapa, x.mide_cycle, x.cycle_horas])).toEqual([
      ["captacion_visita", false, null],
      ["visita_expediente", false, null],
      ["verificacion_pagos", true, 0.25],
      ["evaluaciones_dictamen", true, 3],
      ["adjudicacion", true, 0.1],
      ["cuota_carta", true, 0.5],
    ]);
  });
});

describe("HU0019-1.0 ocupación de vacantes (ADR-14, C25 3)", () => {
  it("HU0019-1.0 (ocupación) adjudicadas = autorizadas − disponibles por grado, y la tarjeta es sobre el total autorizado", async () => {
    const e = await entornoIndicadores(db(), firmante);
    const a = await e.grado({ autorizadas: 20, disponibles: 5 });
    const b = await e.grado({ autorizadas: 10, disponibles: 10 });
    await e.trayecto(a, "2026-09-01T10:00:00", [...hasta("apto"), ["lista_espera", "2026-09-18T10:00:00"]]);

    const res = await e.consultar();

    expect(res.body.vacantes).toEqual([
      expect.objectContaining({ id_grado: a, autorizadas: 20, adjudicadas: 15, disponibles: 5, lista_espera: 1, ocupacion_pct: 75 }),
      expect.objectContaining({ id_grado: b, autorizadas: 10, adjudicadas: 0, disponibles: 10, lista_espera: 0, ocupacion_pct: 0 }),
    ]);
    expect(res.body.tarjetas.ocupacion_pct).toBe(50);
  });

  it("HU0019-1.0 (ocupación) coincide con los expedientes en vacante_asignada o carta_emitida cuando la vacante se descontó (C25 3)", async () => {
    const e = await entornoIndicadores(db(), firmante);
    const g = await e.grado({ autorizadas: 4, disponibles: 2 });
    await e.trayecto(g, "2026-09-01T10:00:00", hasta("vacante_asignada"));
    await e.trayecto(g, "2026-09-01T10:00:00", COMPLETO);
    await e.trayecto(g, "2026-09-01T10:00:00", hasta("apto"));

    const res = await e.consultar();

    const enVacante = res.body.expedientes.filter((x: { etapa: string }) => ["Vacante otorgada", "Carta emitida"].includes(x.etapa));
    expect(res.body.vacantes[0].adjudicadas).toBe(enVacante.length);
    expect(res.body.vacantes[0].adjudicadas).toBe(2);
  });
});

describe("HU0019-1.0 avisos (C8)", () => {
  it("HU0019-1.0 (avisos) cada aviso cuenta una sola vez: varios intentos son un envío, y los pendientes y huérfanos no cuentan", async () => {
    const e = await entornoIndicadores(db(), firmante);
    const g = await e.grado();
    const a = await e.trayecto(g, "2026-09-01T10:00:00");
    const b = await e.trayecto(g, "2026-09-01T10:00:00");
    // a: dos intentos de resultado desconocido y el que cerró. b: seis intentos y la fila de cierre.
    await e.notificacion(a, "visita_confirmada", "pendiente");
    await e.notificacion(a, "visita_confirmada", "pendiente");
    await e.notificacion(a, "visita_confirmada", "enviado");
    for (let i = 0; i < 6; i++) await e.notificacion(b, "visita_confirmada", "pendiente");
    await e.notificacion(b, "visita_confirmada", "fallido");
    // Aviso de observaciones reemplazado por otro: el intento sin enviar queda huérfano (C8).
    await e.notificacion(a, "subsanacion_solicitada", "pendiente");
    await e.notificacion(a, "subsanacion_solicitada", "enviado");
    await e.notificacion(b, "recordatorio_visita", "pendiente"); // sin cierre: no aparece

    const res = await e.consultar();

    expect(res.body.avisos).toEqual([
      { tipo_evento: "subsanacion_solicitada", enviados: 1, fallidos: 0 },
      { tipo_evento: "visita_confirmada", enviados: 1, fallidos: 1 },
    ]);
  });
});

describe("HU0019-1.0 filtros", () => {
  it("HU0019-1.0 (filtros) el rango usa la fecha de registro en días de Lima, con los dos bordes incluidos", async () => {
    const e = await entornoIndicadores(db(), firmante);
    const g = await e.grado();
    await e.trayecto(g, "2026-08-31T23:59:59"); // antes
    const primero = await e.trayecto(g, "2026-09-01T00:00:00");
    const ultimo = await e.trayecto(g, "2026-09-30T23:59:59");
    await e.trayecto(g, "2026-10-01T00:00:00"); // después

    const res = await e.consultar({ desde: "2026-09-01", hasta: "2026-09-30" });

    expect(res.body.expedientes.map((x: { codigo: string }) => Number(x.codigo.slice(-4)))).toEqual([primero % 10000, ultimo % 10000]);
    expect(res.body.filtros).toEqual({ campana: e.campana, id_grado: null, desde: "2026-09-01", hasta: "2026-09-30" });
  });

  it("HU0019-1.0 (filtros) el grado filtra expedientes, avisos y vacantes; la ocupación no depende del rango", async () => {
    const e = await entornoIndicadores(db(), firmante);
    const a = await e.grado({ autorizadas: 10, disponibles: 6 });
    const b = await e.grado({ autorizadas: 10, disponibles: 10 });
    const enA = await e.trayecto(a, "2026-09-01T10:00:00");
    const enB = await e.trayecto(b, "2026-09-01T10:00:00");
    await e.notificacion(enA, "carpeta_enviada", "enviado");
    await e.notificacion(enB, "carpeta_enviada", "enviado");

    const res = await e.consultar({ id_grado: a, desde: "2030-01-01", hasta: "2030-01-31" });
    const soloGrado = await e.consultar({ id_grado: a });

    expect(res.body.expedientes).toEqual([]);
    expect(res.body.avisos).toEqual([]);
    expect(res.body.vacantes).toEqual([expect.objectContaining({ id_grado: a, adjudicadas: 4 })]);
    expect(res.body.tarjetas.ocupacion_pct).toBe(40);
    expect(soloGrado.body.expedientes).toHaveLength(1);
    expect(soloGrado.body.avisos).toEqual([{ tipo_evento: "carpeta_enviada", enviados: 1, fallidos: 0 }]);
  });

  it("HU0019-1.0 (filtros) sin campaña usa la activa, y otra campaña no mezcla sus expedientes", async () => {
    const e = await entornoIndicadores(db(), firmante);
    const otra = `O${e.campana.slice(1)}`;
    await e.trayecto(await e.grado(), "2026-09-01T10:00:00");
    await e.trayecto(await e.grado({ campana: otra }), "2026-09-01T10:00:00");
    await e.trayecto(await e.grado({ campana: otra }), "2026-09-01T10:00:00");

    const activa = await request(e.app).get(RUTA_INDICADORES).set("Authorization", `Bearer ${e.tokenDirectora}`);
    const laOtra = await e.consultar({ campana: otra });

    expect(activa.body.filtros.campana).toBe(e.campana);
    expect(activa.body.expedientes).toHaveLength(1);
    expect(laOtra.body.expedientes).toHaveLength(2);
    expect(laOtra.body.es_demo).toBe(false);
  });

  it.each([
    ["fecha imposible", { desde: "2026-02-30" }],
    ["mes imposible", { desde: "2026-13-01" }],
    ["día imposible", { hasta: "2026-11-32" }],
    ["fecha con otro formato", { hasta: "01/09/2026" }],
    ["desde después de hasta", { desde: "2026-10-01", hasta: "2026-09-01" }],
    ["campaña inválida", { campana: "no válida" }],
    ["grado no numérico", { id_grado: "x" }],
    ["parámetro desconocido", { nivel: "primaria" }],
  ])("HU0019-1.0 (filtros) %s responde 400", async (_caso, query) => {
    const e = await entornoIndicadores(db(), firmante);

    const res = await e.consultar(query as Record<string, string>);

    expect(res.status).toBe(400);
    expect(res.body.error.codigo).toBe("VALIDACION");
  });

  it("HU0019-1.0 (filtros) G08 recibe la campaña activa, las campañas con grados y sus grados", async () => {
    const e = await entornoIndicadores(db(), firmante);
    const g = await e.grado({ nombre: `Grado filtro ${e.campana}` });

    const res = await request(e.app).get(`${RUTA_INDICADORES}/filtros`).set("Authorization", `Bearer ${e.tokenDirectora}`);

    expect(res.status).toBe(200);
    expect(res.body.campana_activa).toBe(e.campana);
    expect(res.body.campanas).toContain(e.campana);
    expect(res.body.grados).toContainEqual({ id_grado: g, nivel: "primaria", grado: `Grado filtro ${e.campana}`, campana: e.campana });
  });
});

describe("HU0019-1.0 línea base del OE3", () => {
  it("HU0019-1.0 (línea base) sin valores no hay comparación y G08 sabe que está por definir", async () => {
    const e = await entornoIndicadores(db(), firmante);
    await e.trayecto(await e.grado(), "2026-09-01T10:00:00", COMPLETO);

    const res = await e.consultar();

    expect(res.body.linea_base).toEqual({ version: "borrador-1", fuente: null, definida: false, meta_pct: 70, lead_time: null, cycle_time: null });
    expect(etapa(res.body, "cuota_carta")!.linea_base).toEqual({ tramo_dias: null, cycle_horas: null });
  });

  it("HU0019-1.0 (línea base) con valores calcula el % de optimización = (base − actual) / base y lo compara con la meta", async () => {
    const lineaBase: LineaBase = {
      version: "prueba-1",
      fuente: "Medición ficticia de prueba",
      meta_optimizacion_pct: 70,
      lead_time_dias: 100, // actual 20: 80 %, cumple
      cycle_time_horas: 2, // actual 1: 50 %, no cumple
      etapas: {
        captacion_visita: { tramo_dias: 4, cycle_horas: null }, // actual 2: 50 %
        verificacion_pagos: { tramo_dias: 0, cycle_horas: 0.5 }, // base 0 no se calcula; actual 1: −100 %
      },
    };
    const e = await entornoIndicadores(db(), firmante, lineaBase);
    const a = await e.trayecto(await e.grado(), "2026-09-01T10:00:00", COMPLETO);
    await e.atencion(a, { tipo: "validacion_documental", id: a }, "2026-09-09T09:00:00", "2026-09-09T10:00:00");

    const res = await e.consultar();

    expect(res.body.linea_base).toEqual({
      version: "prueba-1",
      fuente: "Medición ficticia de prueba",
      definida: true,
      meta_pct: 70,
      lead_time: { base: 100, optimizacion_pct: 80, cumple_meta: true },
      cycle_time: { base: 2, optimizacion_pct: 50, cumple_meta: false },
    });
    expect(etapa(res.body, "captacion_visita")!.linea_base).toEqual({
      tramo_dias: { base: 4, optimizacion_pct: 50, cumple_meta: false },
      cycle_horas: null,
    });
    expect(etapa(res.body, "verificacion_pagos")!.linea_base).toEqual({
      tramo_dias: { base: 0, optimizacion_pct: null, cumple_meta: null },
      cycle_horas: { base: 0.5, optimizacion_pct: -100, cumple_meta: false },
    });
  });

  it("HU0019-1.0 (línea base) la meta es configurable y sin dato actual se muestra la base sin porcentaje", async () => {
    const lineaBase: LineaBase = { version: "prueba-2", fuente: null, meta_optimizacion_pct: 50, lead_time_dias: 40, cycle_time_horas: 2, etapas: {} };
    const e = await entornoIndicadores(db(), firmante, lineaBase);
    const a = await e.trayecto(await e.grado(), "2026-09-01T10:00:00", hasta("apto"));
    await e.atencion(a, { tipo: "dictamen", id: a }, "2026-09-16T09:00:00", "2026-09-16T10:00:00");

    const res = await e.consultar();

    expect(res.body.linea_base.lead_time).toEqual({ base: 40, optimizacion_pct: null, cumple_meta: null }); // sin cartas
    expect(res.body.linea_base.cycle_time).toEqual({ base: 2, optimizacion_pct: 50, cumple_meta: true }); // 50 % ≥ 50 %
  });
});

describe("HU0019-1.0 acceso", () => {
  const ultimoDenegado = async (idPersonal: number) =>
    (
      await db().query<{ detalle: Record<string, unknown> }>(
        "SELECT detalle FROM registro_auditoria WHERE id_personal = $1 AND tipo_evento = 'acceso_denegado' ORDER BY id_evento DESC LIMIT 1",
        [idPersonal],
      )
    ).rows[0];

  it("HU0019-1.0 (acceso) otro rol recibe 403 y el intento se audita como acceso_denegado", async () => {
    const e = await entornoIndicadores(db(), firmante);
    const sub = randomUUID();
    const secretaria = await crearPersonal(db(), "secretaria", sub);

    const res = await e.consultar({}, await firmante.token(sub, ["secretaria"]));

    expect(res.status).toBe(403);
    expect((await ultimoDenegado(secretaria))?.detalle).toMatchObject({ ruta: RUTA_INDICADORES, roles_requeridos: ["directora"] });
  });

  it("HU0019-1.0 (acceso) la familia recibe 403 y sin token responde 401", async () => {
    const e = await entornoIndicadores(db(), firmante);

    const familia = await e.consultar({}, await firmante.token(randomUUID(), ["familia"]));
    const sinToken = await request(e.app).get(RUTA_INDICADORES);

    expect(familia.status).toBe(403);
    expect(sinToken.status).toBe(401);
  });

  it("HU0019-1.0 (acceso) una directora desactivada recibe 403 aunque su token siga vigente (C22)", async () => {
    const e = await entornoIndicadores(db(), firmante);
    await db().query("UPDATE personal SET activo = false WHERE id_personal = $1", [e.directora]);

    const res = await e.consultar();

    expect(res.status).toBe(403);
    expect(res.body.error.codigo).toBe("ACCESO_DENEGADO");
  });

  it("HU0019-1.0 (sin datos personales) la respuesta no trae nombres, correos ni teléfonos", async () => {
    const e = await entornoIndicadores(db(), firmante);
    await e.trayecto(await e.grado({ nombre: "Grado sin datos" }), "2026-09-01T10:00:00", COMPLETO);

    const res = await e.consultar();

    const texto = JSON.stringify(res.body);
    expect(texto).not.toContain("@ejemplo.test");
    expect(texto).not.toContain("Prueba");
    expect(texto).not.toContain("Ficticia");
    expect(texto).not.toContain("900000000");
  });
});
