// `npm run dev:demo` (HU0019, D4-A): el generador corre contra admision_test con una campaña propia. La bitácora no se puede
// limpiar, así que importa tanto lo que escribe como lo que se niega a escribir.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { generarDemo, TOTAL_DEMO, validarDemo } from "../scripts/demoGenerador";
import { cerrarPool, enTransaccion, obtenerPool } from "../src/db/pool";
import { calcularIndicadores } from "../src/services/indicadores";
import { LINEA_BASE } from "../src/services/lineaBase";
import { crearPersonal, unico } from "./ayudantes";

const db = () => obtenerPool();
const CAMPANA = `D${unico()}`;
let dni = 970000;
const prefijoDni = () => String(++dni);
const contar = async (sql: string, ...p: unknown[]) => (await db().query<{ n: number }>(sql, p)).rows[0]!.n;
const eventosDe = (campana: string) =>
  contar(
    "SELECT count(*)::int AS n FROM registro_auditoria r JOIN expediente e ON e.id_expediente = r.id_expediente JOIN grado g ON g.id_grado = e.id_grado WHERE g.campana_admision = $1",
    campana,
  );
const expedientesDe = (campana: string) =>
  contar("SELECT count(*)::int AS n FROM expediente e JOIN grado g ON g.id_grado = e.id_grado WHERE g.campana_admision = $1", campana);

beforeAll(async () => {
  for (const rol of ["secretaria", "tesoreria", "psicologa", "directora"]) await crearPersonal(db(), rol);
  await enTransaccion((c) => generarDemo(c, CAMPANA));
});
afterAll(cerrarPool);

describe("DEMO datos ficticios del tablero", () => {
  it("DEMO crea 60 expedientes con correos @ejemplo.test y cada evento marcado como demo", async () => {
    expect(await expedientesDe(CAMPANA)).toBe(TOTAL_DEMO);
    expect(TOTAL_DEMO).toBe(60);
    const { rows } = await db().query<{ correo: string }>(
      `SELECT a.correo FROM apoderado a JOIN expediente e ON e.id_apoderado_titular = a.id_apoderado JOIN grado g ON g.id_grado = e.id_grado
        WHERE g.campana_admision = $1`,
      [CAMPANA],
    );
    expect(rows.every((r) => /^demo-\d{2}@ejemplo\.test$/.test(r.correo))).toBe(true);
    const sinMarca = await contar(
      `SELECT count(*)::int AS n FROM registro_auditoria r JOIN expediente e ON e.id_expediente = r.id_expediente JOIN grado g ON g.id_grado = e.id_grado
        WHERE g.campana_admision = $1 AND r.detalle->>'demo' IS DISTINCT FROM 'true'`,
      CAMPANA,
    );
    expect(sinMarca).toBe(0);
  });

  it("DEMO no deja nada que n8n pueda tomar: ni citas, ni cuentas, ni intentos por retomar", async () => {
    const tablas = ["cita", "dictamen_admision"];
    for (const t of tablas) {
      const n = await contar(
        `SELECT count(*)::int AS n FROM ${t} x JOIN expediente e ON e.id_expediente = x.id_expediente JOIN grado g ON g.id_grado = e.id_grado WHERE g.campana_admision = $1`,
        CAMPANA,
      );
      expect(n, t).toBe(0);
    }
    await enTransaccion((c) => validarDemo(c, CAMPANA)); // incluye los seis barridos, sin lanzar
  });

  it("DEMO el tablero muestra expedientes en todas las etapas, con cartas emitidas y un embudo que no crece", async () => {
    const ind = await calcularIndicadores({ campana: CAMPANA }, LINEA_BASE);

    const embudo = ind.embudo.map((x) => x.total);
    expect(embudo).toEqual([60, 53, 50, 44, 28, 23, 16, 8]);
    expect(ind.tarjetas.cartas).toBe(8);
    expect(ind.tarjetas.lead_time_dias).toBeGreaterThan(20);
    expect(ind.tarjetas.lead_time_dias).toBeLessThan(70);
    expect(ind.etapas.every((e) => e.tramo_dias !== null)).toBe(true);
    expect(ind.etapas.filter((e) => e.mide_cycle).every((e) => e.cycle_horas !== null && e.cycle_horas < 8)).toBe(true);
    expect(ind.vacantes.reduce((s, g) => s + g.adjudicadas, 0)).toBe(16);
    expect(ind.vacantes.reduce((s, g) => s + g.lista_espera, 0)).toBe(2);
    expect(ind.tarjetas.observados_pct).toBeGreaterThan(0);
    expect(ind.avisos.length).toBeGreaterThan(3);
  });

  it("DEMO respeta R14 y ADR-25: la lista de espera llega con el grado lleno, en posiciones 1 y 2, y cada dictamen coincide con su transición", async () => {
    const { rows: orden } = await db().query<{ estado_nuevo: string; posicion: number | null }>(
      `SELECT r.estado_nuevo, e.posicion_lista_espera AS posicion
         FROM registro_auditoria r JOIN expediente e ON e.id_expediente = r.id_expediente JOIN grado g ON g.id_grado = e.id_grado
        WHERE g.campana_admision = $1 AND r.tipo_evento = 'transicion_estado'
          AND r.estado_nuevo IN ('vacante_asignada', 'lista_espera')
          AND e.id_grado = (SELECT x.id_grado FROM expediente x JOIN grado y ON y.id_grado = x.id_grado WHERE y.campana_admision = $1 AND x.estado = 'lista_espera' LIMIT 1)
        ORDER BY r.fecha_hora`,
      [CAMPANA],
    );
    expect(orden.map((o) => o.estado_nuevo)).toEqual([...Array(6).fill("vacante_asignada"), "lista_espera", "lista_espera"]);
    expect(orden.slice(6).map((o) => o.posicion)).toEqual([1, 2]);

    const dictamenes = await contar(
      `SELECT count(*)::int AS n FROM registro_auditoria r JOIN expediente e ON e.id_expediente = r.id_expediente JOIN grado g ON g.id_grado = e.id_grado
        WHERE g.campana_admision = $1 AND r.tipo_evento = 'atencion_fin' AND r.detalle->'item'->>'tipo' = 'dictamen'`,
      CAMPANA,
    );
    // 28 expedientes con dictamen y uno adicional por cada uno que pasó por «En observación» antes del Apto.
    const conDosDictamenes = await contar(
      `SELECT count(*)::int AS n FROM registro_auditoria r JOIN expediente e ON e.id_expediente = r.id_expediente JOIN grado g ON g.id_grado = e.id_grado
        WHERE g.campana_admision = $1 AND r.tipo_evento = 'transicion_estado' AND r.estado_anterior = 'en_observacion'`,
      CAMPANA,
    );
    expect(dictamenes).toBe(28 + conDosDictamenes);
  });

  it("DEMO los avisos de la visita y de las evaluaciones salen cuando corresponde: uno por reserva y uno por agendamiento", async () => {
    const ind = await calcularIndicadores({ campana: CAMPANA }, LINEA_BASE);
    const avisos = new Map(ind.avisos.map((a) => [a.tipo_evento, a.enviados]));
    const reservas = await contar(
      `SELECT count(*)::int AS n FROM registro_auditoria r JOIN expediente e ON e.id_expediente = r.id_expediente JOIN grado g ON g.id_grado = e.id_grado
        WHERE g.campana_admision = $1 AND r.tipo_evento = 'transicion_estado' AND r.estado_nuevo = 'visita_agendada'`,
      CAMPANA,
    );

    expect(avisos.get("visita_confirmada")).toBe(reservas);
    expect(avisos.get("evaluaciones_confirmadas")).toBe(36); // los 36 expedientes que llegaron a en_evaluacion
  });

  it("DEMO se niega a correr dos veces y la segunda corrida no escribe nada", async () => {
    const antes = await eventosDe(CAMPANA);

    await expect(enTransaccion((c) => generarDemo(c, CAMPANA))).rejects.toThrow("ya existe");

    expect(await expedientesDe(CAMPANA)).toBe(TOTAL_DEMO);
    expect(await contar("SELECT count(*)::int AS n FROM grado WHERE campana_admision = $1", CAMPANA)).toBe(4);
    expect(await eventosDe(CAMPANA)).toBe(antes);
  });

  it("DEMO ante una inconsistencia revierte todo: no queda ni el grado ni un solo evento", async () => {
    const otra = `R${unico()}`;

    await expect(
      enTransaccion(async (c) => {
        await generarDemo(c, otra, prefijoDni());
        // Se rompe la identidad de C25 antes del COMMIT: la validación debe abortar la transacción.
        await c.query("UPDATE grado SET vacantes_disponibles = vacantes_disponibles - 1 WHERE campana_admision = $1 AND vacantes_disponibles > 0", [otra]);
        await validarDemo(c, otra);
      }),
    ).rejects.toThrow("C25");

    expect(await contar("SELECT count(*)::int AS n FROM grado WHERE campana_admision = $1", otra)).toBe(0);
    expect(await expedientesDe(otra)).toBe(0);
  });

  it.each([
    ["un correo real", "UPDATE apoderado SET correo = 'persona@gmail.com' WHERE id_apoderado = (SELECT e.id_apoderado_titular FROM expediente e JOIN grado g ON g.id_grado = e.id_grado WHERE g.campana_admision = $1 LIMIT 1)", "@ejemplo.test"],
    ["un estado que no coincide con la bitácora", "UPDATE expediente SET estado = 'apto' WHERE id_expediente = (SELECT e.id_expediente FROM expediente e JOIN grado g ON g.id_grado = e.id_grado WHERE g.campana_admision = $1 AND e.estado = 'prospecto' LIMIT 1)", "bitácora"],
    ["una transición no permitida", "INSERT INTO registro_auditoria (id_expediente, tipo_evento, estado_anterior, estado_nuevo, detalle) SELECT e.id_expediente, 'transicion_estado', 'prospecto', 'apto', '{\"campo\":\"estado\",\"demo\":true}' FROM expediente e JOIN grado g ON g.id_grado = e.id_grado WHERE g.campana_admision = $1 AND e.estado = 'prospecto' LIMIT 1", "transición no permitida"],
    ["un evento sin la marca demo", "INSERT INTO registro_auditoria (id_expediente, tipo_evento, detalle) SELECT e.id_expediente, 'documentos_confirmados', '{}' FROM expediente e JOIN grado g ON g.id_grado = e.id_grado WHERE g.campana_admision = $1 LIMIT 1", "marcado como demo"],
    ["una rama que no coincide con su bitácora", "UPDATE expediente SET estado_financiero = 'observado' WHERE id_expediente = (SELECT e.id_expediente FROM expediente e JOIN grado g ON g.id_grado = e.id_grado WHERE g.campana_admision = $1 AND e.estado = 'prospecto' LIMIT 1)", "rama financiera"],
    ["una posición de lista de espera fuera de orden", "UPDATE expediente SET posicion_lista_espera = posicion_lista_espera + 10 WHERE id_expediente IN (SELECT e.id_expediente FROM expediente e JOIN grado g ON g.id_grado = e.id_grado WHERE g.campana_admision = $1 AND e.estado = 'lista_espera')", "lista de espera"],
    ["un prospecto sin carpeta, que tomaría el barrido", "DELETE FROM notificacion WHERE id_expediente = (SELECT e.id_expediente FROM expediente e JOIN grado g ON g.id_grado = e.id_grado WHERE g.campana_admision = $1 AND e.estado = 'prospecto' LIMIT 1)", "barrido"],
  ])("DEMO la validación rechaza %s y revierte", async (_caso, sql, motivo) => {
    const otra = `R${unico()}`;

    await expect(
      enTransaccion(async (c) => {
        await generarDemo(c, otra, prefijoDni());
        await c.query(sql, [otra]);
        await validarDemo(c, otra);
      }),
    ).rejects.toThrow(motivo);

    expect(await expedientesDe(otra)).toBe(0);
  });
});
