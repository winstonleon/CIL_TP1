// `npm run dev:agenda` (solo dev, no es una HU): el generador corre contra admision_test con una campaña propia y cuentas
// propias, en la semana del 07/12/2026, que tiene dos feriados (08 y 09/12). La hora «actual» es fija, para que la prueba no
// dependa del día en que corre.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { generarAgenda, leerFeriados, planificarAgenda, type Cuentas, type Turno } from "../scripts/agendaGenerador";
import { cerrarPool, obtenerPool } from "../src/db/pool";
import { crearHorario } from "../src/services/configuracion";
import { crearPersonal, unico } from "./ayudantes";

const db = () => obtenerPool();
const CAMPANA = `A${unico()}`;
const DESDE = "2026-12-07"; // lunes
const HASTA = "2026-12-13"; // domingo
const ANTES = { fecha: "2026-12-01", hora: "00:00" };
const FERIADOS = new Set(["2026-12-08", "2026-12-09"]);
// Lunes: visita 5, académica 5, jornada 1. Jueves: visita 5, académica 5, psicológica 5. Viernes: visita 5, académica 5, entrevista 5.
const ESPERADO = { visita: 15, evaluacion_academica: 15, jornada_observacion: 1, evaluacion_psicologica: 5, entrevista_padres: 5 };
const TOTAL = Object.values(ESPERADO).reduce((a, b) => a + b, 0);

let cuentas: Cuentas;
let turnos: Turno[];
let idHorarioE2e: number;

const horariosDeCampana = async () =>
  (
    await db().query<{ id_horario: number; fecha: string; dia: number; tipo_cita: string; hora_inicio: string; hora_fin: string; cupos: number }>(
      `SELECT id_horario, to_char(fecha, 'YYYY-MM-DD') AS fecha, extract(isodow FROM fecha)::int AS dia, tipo_cita::text AS tipo_cita,
              to_char(hora_inicio, 'HH24:MI') AS hora_inicio, to_char(hora_fin, 'HH24:MI') AS hora_fin, cupos
         FROM horario_disponible WHERE campana_admision = $1 ORDER BY id_horario`,
      [CAMPANA],
    )
  ).rows;

beforeAll(async () => {
  const keycloakSecretaria = randomUUID();
  await crearPersonal(db(), "secretaria", keycloakSecretaria);
  cuentas = {
    keycloakSecretaria,
    responsable: {
      directora: await crearPersonal(db(), "directora"),
      psicologa: await crearPersonal(db(), "psicologa"),
      evaluador_academico: await crearPersonal(db(), "evaluador_academico"),
    },
  };
  turnos = planificarAgenda(DESDE, HASTA, FERIADOS, ANTES).turnos;
  // Un horario como los que deja el E2E: 5 min, 1 cupo, dentro de la franja de la visita del lunes.
  idHorarioE2e = (
    await crearHorario(keycloakSecretaria, CAMPANA, {
      id_personal: cuentas.responsable.directora!,
      tipo_cita: "visita",
      fecha: DESDE,
      hora_inicio: "09:10",
      hora_fin: "09:15",
      cupos: 1,
    })
  ).id_horario;
});
afterAll(cerrarPool);

describe("dev:agenda horarios de la demo", () => {
  it("dev:agenda la lista de feriados versionada trae las seis fechas acordadas", () => {
    expect([...leerFeriados()].sort()).toEqual(["2026-12-08", "2026-12-09", "2026-12-25", "2027-01-01", "2027-03-25", "2027-03-26"]);
  });

  it("dev:agenda planifica solo de lunes a viernes, salta los feriados y los cuenta, y de hoy deja solo los turnos que no empezaron", () => {
    const plan = planificarAgenda(DESDE, HASTA, FERIADOS, ANTES);
    expect(plan.diasFeriado).toBe(2);
    expect(plan.turnos).toHaveLength(TOTAL);
    expect(new Set(plan.turnos.map((t) => t.fecha))).toEqual(new Set(["2026-12-07", "2026-12-10", "2026-12-11"]));

    const deHoy = planificarAgenda(DESDE, DESDE, FERIADOS, { fecha: DESDE, hora: "10:00" }).turnos;
    expect(deHoy.filter((t) => t.tipo_cita === "visita").map((t) => t.hora_inicio)).toEqual(["11:00", "12:00"]);
    expect(deHoy.some((t) => t.tipo_cita === "jornada_observacion")).toBe(false); // el bloque empezó a las 8:00
  });

  it("dev:agenda crea los horarios con el servicio de G09, sin ninguno en un feriado ni en fin de semana, y no toca el horario del E2E", async () => {
    const r = await generarAgenda(db(), CAMPANA, cuentas, turnos);
    expect(r.creados).toEqual({ ...ESPERADO, visita: ESPERADO.visita - 1 }); // la visita de 9:00 del lunes se cruza con la del E2E
    expect(r.seCruzan).toBe(1);
    expect(r.yaExistian).toBe(0);

    const filas = await horariosDeCampana();
    expect(filas).toHaveLength(TOTAL); // 39 nuevos más el del E2E
    expect(filas.filter((f) => FERIADOS.has(f.fecha) || f.dia >= 6)).toEqual([]);
    expect(filas.find((f) => f.id_horario === idHorarioE2e)).toMatchObject({ fecha: DESDE, hora_inicio: "09:10", hora_fin: "09:15", cupos: 1 });
    expect(filas.find((f) => f.tipo_cita === "jornada_observacion")).toMatchObject({ fecha: DESDE, hora_inicio: "08:00", hora_fin: "13:00", cupos: 6 });

    // Cada alta quedó auditada como en G09.
    const { rows } = await db().query<{ n: number }>(
      `SELECT count(*)::int AS n FROM registro_auditoria
        WHERE tipo_evento = 'cambio_configuracion' AND detalle->>'entidad' = 'horario_disponible' AND detalle->>'campana' = $1
          AND detalle->>'accion' = 'alta'`,
      [CAMPANA],
    );
    expect(rows[0]!.n).toBe(TOTAL);
  });

  it("dev:agenda es idempotente: la segunda corrida no crea nada, no falla y salta los que ya existen", async () => {
    const antes = await horariosDeCampana();
    const r = await generarAgenda(db(), CAMPANA, cuentas, turnos);
    expect(Object.values(r.creados).every((n) => n === 0)).toBe(true);
    expect(r.yaExistian).toBe(TOTAL - 1);
    expect(r.seCruzan).toBe(1);
    expect(await horariosDeCampana()).toEqual(antes);
  });
});
