// Agendamiento de las evaluaciones (HU0009, P08; plan del bloque 6) por las rutas reales de la familia (/familia), de G09
// (/configuracion) y de n8n (/internal). Cubre HU0009-1.0 y 2.0, «Confirmar citas» todo o nada, la concurrencia (último
// cupo y turnos cruzados), C25 (evaluaciones del grado y horarios válidos), el orden de la entrevista (decisión O), la
// regla de 24 h, C40 (jornada grupal), C52 (aviso de habilitación) y los avisos (ADR-07). Datos ficticios @ejemplo.test.
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { variablesInvalidas } from "../src/config";
import { cerrarPool, obtenerPool } from "../src/db/pool";
import { crearFirmante, crearPersonal, eventosDe, violacion } from "./ayudantes";
import { intentadaHace, intentosDe } from "./ayudantesVisita";
import { entornoEvaluacion, rutaEvaluaciones, rutaReprogramacion, type EntornoEvaluacion } from "./ayudantesEvaluacion";

const db = () => obtenerPool();
let firmante: Awaited<ReturnType<typeof crearFirmante>>;
let e: EntornoEvaluacion;

beforeAll(async () => {
  firmante = await crearFirmante();
  e = await entornoEvaluacion(db(), firmante);
});
afterAll(cerrarPool);

const FRONT = () => process.env.FRONTEND_PUBLIC_URL!.replace(/\/+$/, "");
const cupos = async (idHorario: number) => (await db().query<{ cupos: number }>("SELECT cupos FROM horario_disponible WHERE id_horario = $1", [idHorario])).rows[0]!.cupos;
const estado = async (idExpediente: number) =>
  (await db().query<{ estado: string }>("SELECT estado::text AS estado FROM expediente WHERE id_expediente = $1", [idExpediente])).rows[0]!.estado;
const citasDe = async (idExpediente: number) =>
  (
    await db().query<{ id_cita: number; id_horario: number; id_personal: number; tipo_cita: string; estado: string }>(
      "SELECT id_cita, id_horario, id_personal, tipo_cita::text AS tipo_cita, estado::text AS estado FROM cita WHERE id_expediente = $1 ORDER BY id_cita",
      [idExpediente],
    )
  ).rows;
const eventosTipo = async (idExpediente: number, tipo: string) => (await eventosDe(db(), idExpediente)).filter((ev) => ev.tipo_evento === tipo);
const correoDe = async (idPersonal: number) => (await db().query<{ correo: string }>("SELECT correo FROM personal WHERE id_personal = $1", [idPersonal])).rows[0]!.correo;
// Simula que la cita es dentro de `minutos` (el paso del tiempo solo en la fila de la prueba).
const citaDentroDe = (idCita: number, minutos: number) => db().query("UPDATE cita SET fecha_hora = now() + make_interval(mins => $2) WHERE id_cita = $1", [idCita, minutos]);

describe("HU0009-1.0 agendamiento exitoso de las evaluaciones del grado", () => {
  it("HU0009-1.0 con las tres validaciones conformes, la familia elige un turno por evaluación del grado y «Confirmar citas» reserva los turnos, registra las citas, envía la confirmación con las pautas previas y pasa el expediente a en_evaluacion", async () => {
    const f = await e.habilitadaReal();
    const t = await e.turnosTercero();
    const familia = e.familiaApi(f.token);

    const p08 = await familia.get(rutaEvaluaciones(f.idExpediente));
    expect(p08.status).toBe(200);
    expect(p08.body.modo).toBe("agendar");
    expect(p08.body.evaluaciones.map((x: { tipo_cita: string }) => x.tipo_cita)).toEqual(["evaluacion_academica", "evaluacion_psicologica", "entrevista_padres"]);
    for (const x of p08.body.evaluaciones) {
      expect(x.cita).toBeNull();
      expect(x.horarios).toContainEqual(expect.objectContaining({ id_horario: t[x.tipo_cita as keyof typeof t], disponible: true }));
    }

    const res = await familia.post(rutaEvaluaciones(f.idExpediente), e.pedidos(t));

    expect(res.status).toBe(201);
    expect(res.body.estado).toBe("en_evaluacion");
    expect(res.body).not.toHaveProperty("id_notificacion");
    expect(res.body.citas).toHaveLength(3);
    // Reserva los turnos (R12: cupo descontado) y registra las citas con su responsable.
    for (const tipo of ["evaluacion_academica", "evaluacion_psicologica", "entrevista_padres"] as const) expect(await cupos(t[tipo])).toBe(0);
    const citas = await citasDe(f.idExpediente);
    expect(citas.map((c) => [c.tipo_cita, c.id_horario, c.estado])).toEqual(
      expect.arrayContaining([
        ["evaluacion_academica", t.evaluacion_academica, "reservada"],
        ["evaluacion_psicologica", t.evaluacion_psicologica, "reservada"],
        ["entrevista_padres", t.entrevista_padres, "reservada"],
      ]),
    );
    expect(citas.find((c) => c.tipo_cita === "evaluacion_academica")!.id_personal).toBe(e.evaluador);
    // Cambia el estado a «En evaluación» con auditoría (R6), sin actor del personal.
    expect(await estado(f.idExpediente)).toBe("en_evaluacion");
    const [transicion] = (await eventosTipo(f.idExpediente, "transicion_estado")).filter((ev) => ev.estado_nuevo === "en_evaluacion");
    expect(transicion).toMatchObject({ estado_anterior: "en_validacion", id_personal: null });
    expect(transicion!.detalle.id_citas.sort()).toEqual(citas.map((c) => c.id_cita).sort());
    // La confirmación: primer intento reservado y evento a agendamiento después del COMMIT (ADR-16), solo con ids.
    const [aviso] = await intentosDe(db(), f.idExpediente, "evaluaciones_confirmadas");
    expect(aviso).toMatchObject({ estado_envio: "pendiente", id_notificacion: transicion!.detalle.id_notificacion });
    expect(e.eventos.disparar).toHaveBeenCalledWith("agendamiento", { id_expediente: f.idExpediente, id_notificacion: aviso!.id_notificacion });
    const correo = await e.interno.aviso(f.idExpediente, { id_notificacion: aviso!.id_notificacion });
    expect(correo.status).toBe(201);
    expect(correo.body).toMatchObject({ id_expediente: f.idExpediente, id_notificacion: aviso!.id_notificacion, tipo_evento: "evaluaciones_confirmadas" });
    expect(correo.body.asunto).toContain("Citas de evaluación confirmadas");
    for (const pauta of ["[Pautas previas de la evaluación académica", "[Pautas previas de la evaluación psicológica", "[Pautas previas de la entrevista a los padres"]) {
      expect(correo.body.cuerpo).toContain(pauta);
    }
    expect(correo.body.cuerpo).toContain("9:00 a. m.");
    expect(correo.body.cuerpo).toContain(`${FRONT()}/portal/evaluaciones`);
    // P08 muestra las citas agendadas; es de la familia: no registra tiempo de atención (ADR-05).
    const despues = await familia.get(rutaEvaluaciones(f.idExpediente));
    expect(despues.body.modo).toBe("agendadas");
    expect(despues.body.evaluaciones.every((x: { cita: { estado: string; reprogramable: boolean } }) => x.cita.estado === "reservada" && x.cita.reprogramable)).toBe(true);
    const atenciones = (await eventosDe(db(), f.idExpediente)).filter((ev) => ev.tipo_evento.startsWith("atencion_") && Number(ev.id_evento) > Number(transicion!.id_evento));
    expect(atenciones).toEqual([]);
  });

  it("HU0009-1.0 (no habilitado) sin las tres validaciones conformes P08 no ofrece turnos y «Confirmar citas» responde 409 AGENDAMIENTO_NO_HABILITADO sin reservar nada", async () => {
    const f = await e.habilitada({ ramas: { financiera: "pendiente" } });
    const t = await e.turnosTercero();
    const familia = e.familiaApi(f.token);

    const p08 = await familia.get(rutaEvaluaciones(f.idExpediente));
    expect(p08.body.modo).toBe("bloqueado");
    expect(p08.body.evaluaciones.every((x: { horarios: unknown[] }) => x.horarios.length === 0)).toBe(true);

    const res = await familia.post(rutaEvaluaciones(f.idExpediente), e.pedidos(t));

    expect(res.status).toBe(409);
    expect(res.body.error.codigo).toBe("AGENDAMIENTO_NO_HABILITADO");
    expect(await citasDe(f.idExpediente)).toEqual([]);
    expect(await cupos(t.evaluacion_academica)).toBe(1);
    expect(await estado(f.idExpediente)).toBe("en_validacion");
  });

  it("HU0009-1.0 (todo o nada) si uno de los turnos ya no tiene cupo responde 409 HORARIO_SIN_CUPO con ese turno y no reserva ninguno", async () => {
    const f = await e.habilitada();
    const t = await e.turnosTercero();
    await db().query("UPDATE horario_disponible SET cupos = 0 WHERE id_horario = $1", [t.entrevista_padres]);

    const res = await e.familiaApi(f.token).post(rutaEvaluaciones(f.idExpediente), e.pedidos(t));

    expect(res.status).toBe(409);
    expect(res.body.error).toMatchObject({ codigo: "HORARIO_SIN_CUPO", detalle: [{ id_horario: t.entrevista_padres }] });
    expect(await cupos(t.evaluacion_academica)).toBe(1);
    expect(await cupos(t.evaluacion_psicologica)).toBe(1);
    expect(await citasDe(f.idExpediente)).toEqual([]);
    expect(await estado(f.idExpediente)).toBe("en_validacion");
    expect(await intentosDe(db(), f.idExpediente)).toEqual([]);
    expect(e.eventos.disparar).not.toHaveBeenCalled();
  });

  it("HU0009-1.0 (concurrencia) dos familias compiten por el último cupo de un turno: una recibe 201 y la otra 409, sin reservas parciales", async () => {
    const [a, b] = [await e.habilitada(), await e.habilitada()];
    const t = await e.turnosTercero(2);
    await db().query("UPDATE horario_disponible SET cupos = 1 WHERE id_horario = $1", [t.evaluacion_academica]);
    // La psicológica y la entrevista tienen 2 cupos, pero son individuales (C40): cada familia usa su propio turno.
    const tb = { ...t, evaluacion_psicologica: await e.horario("evaluacion_psicologica", { dias: t.dia, inicio: "12:00", fin: "13:00" }), entrevista_padres: await e.horario("entrevista_padres", { dias: t.dia + 1, inicio: "16:30", fin: "17:30" }) };

    const [ra, rb] = await Promise.all([
      e.familiaApi(a.token).post(rutaEvaluaciones(a.idExpediente), e.pedidos(t)),
      e.familiaApi(b.token).post(rutaEvaluaciones(b.idExpediente), e.pedidos(tb)),
    ]);

    expect([ra.status, rb.status].sort()).toEqual([201, 409]);
    const perdedora = ra.status === 409 ? { f: a, res: ra, t } : { f: b, res: rb, t: tb };
    expect(perdedora.res.body.error.codigo).toBe("HORARIO_SIN_CUPO");
    expect(await cupos(t.evaluacion_academica)).toBe(0);
    expect(await citasDe(perdedora.f.idExpediente)).toEqual([]);
    expect(await estado(perdedora.f.idExpediente)).toBe("en_validacion");
    // La perdedora no descontó sus otros turnos (los de A tenían 2 cupos; los de B, 1).
    const inicial = perdedora.t === t ? 2 : 1;
    expect(await cupos(perdedora.t.evaluacion_psicologica)).toBe(inicial);
    expect(await cupos(perdedora.t.entrevista_padres)).toBe(inicial);
  });

  it("HU0009-1.0 (turnos cruzados) dos familias piden los mismos turnos en orden inverso: sin interbloqueo, una reserva todos y la otra recibe 409 sin reservas parciales", async () => {
    // Tres rondas: sin el bloqueo en orden por id, A tomaría la académica y B la psicológica, y cada una esperaría a la
    // otra (PostgreSQL abortaría una con 40P01 y la API respondería 500).
    for (let ronda = 0; ronda < 3; ronda++) {
      const [a, b] = [await e.habilitada(), await e.habilitada()];
      const t = await e.turnosTercero();
      const orden = ["evaluacion_academica", "evaluacion_psicologica", "entrevista_padres"];

      const [ra, rb] = await Promise.all([
        e.familiaApi(a.token).post(rutaEvaluaciones(a.idExpediente), e.pedidos(t, orden)),
        e.familiaApi(b.token).post(rutaEvaluaciones(b.idExpediente), e.pedidos(t, [...orden].reverse())),
      ]);

      expect([ra.status, rb.status].sort()).toEqual([201, 409]);
      const perdedora = ra.status === 409 ? { f: a, res: ra } : { f: b, res: rb };
      expect(perdedora.res.body.error.codigo).toBe("HORARIO_SIN_CUPO");
      expect(await citasDe(perdedora.f.idExpediente)).toEqual([]);
      for (const tipo of orden) expect(await cupos(t[tipo as keyof typeof t])).toBe(0);
    }
  });

  it("HU0009-1.0 (C25) solo se ofrecen y reservan horarios del tipo, de la campaña activa, futuros y de un responsable activo con el rol de ADR-15", async () => {
    const f = await e.habilitada();
    const t = await e.turnosTercero();
    const d = t.dia;
    const inactiva = await crearPersonal(db(), "evaluador_academico");
    await db().query("UPDATE personal SET activo = false WHERE id_personal = $1", [inactiva]);
    const otroRol = await crearPersonal(db(), "directora");
    const invalidos = {
      otra_campana: await e.horario("evaluacion_academica", { dias: d, inicio: "13:00", fin: "14:00", campana: `X${d}` }),
      pasado: await e.horario("evaluacion_academica", { dias: -2, inicio: "13:00", fin: "14:00" }),
      inactivo: await e.horario("evaluacion_academica", { dias: d, inicio: "13:00", fin: "14:00", idPersonal: inactiva }),
      otro_rol: await e.horario("evaluacion_academica", { dias: d, inicio: "13:00", fin: "14:00", idPersonal: otroRol }),
      otro_tipo: t.evaluacion_psicologica,
    };
    const familia = e.familiaApi(f.token);

    const ofrecidos = (await familia.get(rutaEvaluaciones(f.idExpediente))).body.evaluaciones.find((x: { tipo_cita: string }) => x.tipo_cita === "evaluacion_academica")
      .horarios.map((h: { id_horario: number }) => h.id_horario);
    expect(ofrecidos).toContain(t.evaluacion_academica);
    for (const id of Object.values(invalidos)) expect(ofrecidos).not.toContain(id);

    for (const [motivo, id] of Object.entries(invalidos)) {
      const res = await familia.post(rutaEvaluaciones(f.idExpediente), e.pedidos({ ...t, evaluacion_academica: id }));
      expect(res.status, motivo).toBe(409);
      expect(res.body.error.codigo, motivo).toBe("HORARIO_NO_DISPONIBLE");
    }
    expect(await citasDe(f.idExpediente)).toEqual([]);
  });

  it("HU0009-1.0 (orden) la entrevista a los padres antes del fin de otra evaluación responde 422 ORDEN_DE_CITAS sin reservar nada", async () => {
    const f = await e.habilitada();
    const t = await e.turnosTercero();
    const temprana = await e.horario("entrevista_padres", { dias: t.dia, inicio: "07:00", fin: "08:00" });

    const res = await e.familiaApi(f.token).post(rutaEvaluaciones(f.idExpediente), e.pedidos({ ...t, entrevista_padres: temprana }));

    expect(res.status).toBe(422);
    expect(res.body.error.codigo).toBe("ORDEN_DE_CITAS");
    expect(await citasDe(f.idExpediente)).toEqual([]);
    expect(await cupos(temprana)).toBe(1);
  });

  it("HU0009-1.0 (evaluaciones del grado) sin un turno por cada evaluación exigida, o con una que el grado no exige, responde 422 EVALUACIONES_NO_CORRESPONDEN", async () => {
    const f = await e.habilitada();
    const t = await e.turnosTercero();
    const jornada = await e.horario("jornada_observacion", { dias: t.dia + 2, inicio: "08:00", fin: "09:00" });
    const familia = e.familiaApi(f.token);

    const falta = await familia.post(rutaEvaluaciones(f.idExpediente), e.pedidos(t, ["evaluacion_academica", "entrevista_padres"]));
    const sobra = await familia.post(rutaEvaluaciones(f.idExpediente), e.pedidos({ ...t, jornada_observacion: jornada }, ["jornada_observacion", "evaluacion_academica", "evaluacion_psicologica", "entrevista_padres"]));

    for (const res of [falta, sobra]) {
      expect(res.status).toBe(422);
      expect(res.body.error).toMatchObject({ codigo: "EVALUACIONES_NO_CORRESPONDEN", detalle: { exigidas: ["evaluacion_academica", "evaluacion_psicologica", "entrevista_padres"] } });
    }
    expect(await citasDe(f.idExpediente)).toEqual([]);
  });

  it("HU0009-1.0 (una sola vez) con las citas ya agendadas, otro «Confirmar citas» responde 409 EVALUACIONES_YA_AGENDADAS", async () => {
    const { f } = await e.agendada();
    const t = await e.turnosTercero();

    const res = await e.familiaApi(f.token).post(rutaEvaluaciones(f.idExpediente), e.pedidos(t));

    expect(res.status).toBe(409);
    expect(res.body.error.codigo).toBe("EVALUACIONES_YA_AGENDADAS");
    expect(await cupos(t.evaluacion_academica)).toBe(1);
  });

  it("HU0009-1.0 (aviso) la confirmación sigue ADR-07: el barrido la retoma a los 10 min con una fila nueva y, tras 6 intentos, la cierra con una fila fallido y 409 AVISO_AGOTADO", async () => {
    const { f } = await e.agendada();
    const tipo = "evaluaciones_confirmadas";
    const listado = async () => (await e.interno.pendientes()).filter((x) => x.id_expediente === f.idExpediente);

    // Recién reservado por la acción: lo envía el webhook; el barrido no lo toma.
    expect(await listado()).toEqual([]);
    for (let intento = 1; intento < 6; intento++) {
      const filas = await intentosDe(db(), f.idExpediente, tipo);
      await intentadaHace(db(), filas.at(-1)!.id_notificacion, 11);
      expect(await listado()).toEqual([{ id_expediente: f.idExpediente, tipo_evento: tipo }]);
      const r = await e.interno.aviso(f.idExpediente, { tipo_evento: tipo });
      expect(r.status).toBe(201);
      expect(r.body.id_notificacion).toBeGreaterThan(filas.at(-1)!.id_notificacion);
      // Un intento en curso no se repite.
      expect((await e.interno.aviso(f.idExpediente, { tipo_evento: tipo })).body.error.codigo).toBe("AVISO_YA_REGISTRADO");
    }
    const filas = await intentosDe(db(), f.idExpediente, tipo);
    expect(filas).toHaveLength(6);
    await intentadaHace(db(), filas.at(-1)!.id_notificacion, 11);

    const agotado = await e.interno.aviso(f.idExpediente, { tipo_evento: tipo });

    expect(agotado.status).toBe(409);
    expect(agotado.body.error.codigo).toBe("AVISO_AGOTADO");
    const final = await intentosDe(db(), f.idExpediente, tipo);
    expect(final).toHaveLength(7);
    expect(final.at(-1)!.estado_envio).toBe("fallido");
    expect(final.slice(0, 6).every((x) => x.estado_envio === "pendiente")).toBe(true);
    expect(await listado()).toEqual([]);
  });
});

describe("HU0022-1.0 [parte: agendamiento] evaluaciones y horarios configurados en G09", () => {
  it("HU0022-1.0 [parte: agendamiento] un grado configurado por la ruta de G09 ofrece y exige solo sus evaluaciones, más la entrevista, con los horarios creados en G09", async () => {
    const sec = e.api(e.secretaria.token);
    const base = await e.habilitada();
    // G09: el grado pasa a exigir solo la jornada de observación (Inicial, R11) y Secretaría crea sus horarios.
    const g09 = await request(e.app)
      .patch("/configuracion/grados")
      .set("Authorization", `Bearer ${e.secretaria.token}`)
      .send({ grados: [{ id_grado: base.idGrado, requiere_jornada_observacion: true, requiere_evaluacion_psicologica: false, requiere_evaluacion_academica: false }] });
    expect(g09.status).toBe(200);
    const d = e.diasNuevos();
    const fecha = (dias: number) => new Date(Date.now() + dias * 86_400_000).toLocaleDateString("en-CA", { timeZone: "America/Lima" });
    const crear = async (tipo_cita: string, dias: number, hora_inicio: string, hora_fin: string, idPersonal: number) => {
      const r = await sec.post("/configuracion/horarios", { id_personal: idPersonal, tipo_cita, fecha: fecha(dias), hora_inicio, hora_fin, cupos: 3 });
      expect(r.status, JSON.stringify(r.body)).toBe(201);
      return r.body.id_horario as number;
    };
    const jornada = await crear("jornada_observacion", d, "08:00", "10:00", e.psicologa);
    const entrevista = await crear("entrevista_padres", d + 1, "08:00", "09:00", e.psicologa);
    const academica = await crear("evaluacion_academica", d, "11:00", "12:00", e.evaluador);
    const familia = e.familiaApi(base.token);

    const p08 = await familia.get(rutaEvaluaciones(base.idExpediente));
    expect(p08.body.evaluaciones.map((x: { tipo_cita: string }) => x.tipo_cita)).toEqual(["jornada_observacion", "entrevista_padres"]);
    expect(p08.body.evaluaciones[0].horarios.map((h: { id_horario: number }) => h.id_horario)).toContain(jornada);

    const conAcademica = await familia.post(rutaEvaluaciones(base.idExpediente), {
      horarios: [{ tipo_cita: "jornada_observacion", id_horario: jornada }, { tipo_cita: "evaluacion_academica", id_horario: academica }, { tipo_cita: "entrevista_padres", id_horario: entrevista }],
    });
    expect(conAcademica.status).toBe(422);
    expect(conAcademica.body.error).toMatchObject({ codigo: "EVALUACIONES_NO_CORRESPONDEN", detalle: { exigidas: ["jornada_observacion", "entrevista_padres"] } });

    const res = await familia.post(rutaEvaluaciones(base.idExpediente), {
      horarios: [{ tipo_cita: "jornada_observacion", id_horario: jornada }, { tipo_cita: "entrevista_padres", id_horario: entrevista }],
    });
    expect(res.status).toBe(201);
    expect((await citasDe(base.idExpediente)).map((c) => c.tipo_cita).sort()).toEqual(["entrevista_padres", "jornada_observacion"]);
  });
});

describe("C40 la jornada de observación es grupal y las demás citas siguen individuales", () => {
  it("C40 la visita guiada sigue individual: dos citas activas de la misma directora a la misma hora violan uq_cita_personal_fecha, aunque el horario tenga cupos de sobra", async () => {
    const directora = await crearPersonal(db(), "directora");
    const [a, b] = [await e.habilitada(), await e.habilitada()];
    const visita = await e.horario("visita", { dias: e.diasNuevos(), inicio: "10:00", fin: "11:00", cupos: 2, idPersonal: directora });
    const insertar = (idExpediente: number) =>
      db().query(
        `INSERT INTO cita (id_expediente, id_personal, id_horario, tipo_cita, fecha_hora)
         SELECT $1, h.id_personal, h.id_horario, 'visita', (h.fecha + h.hora_inicio) AT TIME ZONE 'America/Lima' FROM horario_disponible h WHERE h.id_horario = $2`,
        [idExpediente, visita],
      );
    await insertar(a.idExpediente);

    const error = await violacion(insertar(b.idExpediente));

    expect(error).toMatchObject({ code: "23505", constraint: "uq_cita_personal_fecha" });
  });

  it("C40 dos familias reservan la misma jornada de observación (cupos 2); un horario individual con 2 cupos admite una sola cita", async () => {
    const [a, b] = [await e.habilitada({ requiere: { jornada: true } }), await e.habilitada({ requiere: { jornada: true } })];
    const d = e.diasNuevos();
    const jornada = await e.horario("jornada_observacion", { dias: d, inicio: "08:00", fin: "10:00", cupos: 2 });
    const entrevista = await e.horario("entrevista_padres", { dias: d + 1, inicio: "08:00", fin: "09:00", cupos: 2 });
    const otraEntrevista = await e.horario("entrevista_padres", { dias: d + 1, inicio: "10:00", fin: "11:00" });
    const cuerpo = (idEntrevista: number) => ({ horarios: [{ tipo_cita: "jornada_observacion", id_horario: jornada }, { tipo_cita: "entrevista_padres", id_horario: idEntrevista }] });

    expect((await e.familiaApi(a.token).post(rutaEvaluaciones(a.idExpediente), cuerpo(entrevista))).status).toBe(201);
    // La entrevista individual con un cupo de sobra no admite otra cita a la misma hora (uq_cita_personal_fecha).
    const individual = await e.familiaApi(b.token).post(rutaEvaluaciones(b.idExpediente), cuerpo(entrevista));
    expect(individual.status).toBe(409);
    expect(individual.body.error.codigo).toBe("HORARIO_SIN_CUPO");
    const p08 = await e.familiaApi(b.token).get(rutaEvaluaciones(b.idExpediente));
    const ofrecida = p08.body.evaluaciones.find((x: { tipo_cita: string }) => x.tipo_cita === "entrevista_padres").horarios.find((h: { id_horario: number }) => h.id_horario === entrevista);
    expect(ofrecida.disponible).toBe(false);

    expect((await e.familiaApi(b.token).post(rutaEvaluaciones(b.idExpediente), cuerpo(otraEntrevista))).status).toBe(201);
    const { rows } = await db().query("SELECT count(*)::int AS n FROM cita WHERE id_horario = $1 AND estado = 'reservada'", [jornada]);
    expect(rows[0].n).toBe(2);
    expect(await cupos(jornada)).toBe(0);
  });
});

describe("C52 aviso a la familia de que ya puede agendar", () => {
  it("C52 cuando la última decisión completa la unión, el barrido de agendamiento envía «Ya puedes agendar» con el enlace a P08, una sola vez, y deja de hacerlo cuando la familia agenda", async () => {
    // Sin la unión no hay aviso.
    const parcial = await e.habilitada({ ramas: { documental: "pendiente" } });
    // Con la unión por las rutas reales: el atencion_fin lleva habilita_agendamiento (B1). La primera minuto pertenece al
    // camino normal; para no esperarlo, un expediente con la unión de hace 2 min (misma marca, escrita por SQL).
    const real = await e.habilitadaReal();
    expect((await e.interno.pendientes()).filter((x) => x.id_expediente === real.idExpediente)).toEqual([]);
    const f = await e.habilitada();
    await db().query(
      `INSERT INTO registro_auditoria (id_expediente, id_personal, tipo_evento, detalle, fecha_hora)
       VALUES ($1, $2, 'atencion_fin', $3, now() - interval '2 minutes')`,
      [f.idExpediente, e.secretaria.idPersonal, JSON.stringify({ item: { tipo: "validacion_documental", id: f.idExpediente }, decision: "conforme", id_evento_inicio: null, habilita_agendamiento: true })],
    );

    const pendientes = await e.interno.pendientes();
    expect(pendientes).toContainEqual({ id_expediente: f.idExpediente, tipo_evento: "evaluaciones_habilitadas" });
    expect(pendientes.filter((x) => x.id_expediente === parcial.idExpediente)).toEqual([]);

    const aviso = await e.interno.aviso(f.idExpediente, { tipo_evento: "evaluaciones_habilitadas" });
    expect(aviso.status).toBe(201);
    expect(aviso.body.asunto).toContain("Ya puedes agendar tus evaluaciones");
    expect(aviso.body.cuerpo).toContain(`${FRONT()}/portal/evaluaciones`);
    expect(aviso.body.cuerpo).toContain("Documentos, derecho de admisión y documentación financiera validados: ya puedes agendar.");
    expect(await intentosDe(db(), f.idExpediente, "evaluaciones_habilitadas")).toHaveLength(1);
    expect((await e.interno.pendientes()).filter((x) => x.id_expediente === f.idExpediente)).toEqual([]);
    // Al agendar, una retoma pendiente ya no corresponde.
    await intentadaHace(db(), aviso.body.id_notificacion, 11);
    const t = await e.turnosTercero();
    expect((await e.familiaApi(f.token).post(rutaEvaluaciones(f.idExpediente), e.pedidos(t))).status).toBe(201);
    expect((await e.interno.pendientes()).filter((x) => x.tipo_evento === "evaluaciones_habilitadas" && x.id_expediente === f.idExpediente)).toEqual([]);
    expect((await e.interno.aviso(f.idExpediente, { tipo_evento: "evaluaciones_habilitadas" })).body.error.codigo).toBe("AVISO_NO_CORRESPONDE");
  });

  it("C52 el barrido no reenvía evaluaciones_habilitadas a un expediente que ya lo recibió (enviado) ni a uno que ya pasó a en_evaluacion", async () => {
    const unionHace2Min = (idExpediente: number) =>
      db().query(
        `INSERT INTO registro_auditoria (id_expediente, id_personal, tipo_evento, detalle, fecha_hora)
         VALUES ($1, $2, 'atencion_fin', $3, now() - interval '2 minutes')`,
        [idExpediente, e.tesoreria.idPersonal, JSON.stringify({ item: { tipo: "documentacion_financiera", id: idExpediente }, decision: "conforme", id_evento_inicio: null, habilita_agendamiento: true })],
      );
    const habilitacionesDe = async (idExpediente: number) =>
      (await e.interno.pendientes()).filter((x) => x.id_expediente === idExpediente && x.tipo_evento === "evaluaciones_habilitadas");
    const cerrar = (idNotificacion: number, estado_envio: string) =>
      request(e.app).patch(`/internal/notificaciones/${idNotificacion}`).set("Authorization", `Bearer ${process.env.INTERNAL_API_TOKEN}`).send({ estado_envio });

    // (a) Ya lo recibió: notificacion-multicanal cerró el envío como `enviado`. Ni con el tiempo de una retoma vuelve.
    const recibido = await e.habilitada();
    await unionHace2Min(recibido.idExpediente);
    const primero = await e.interno.aviso(recibido.idExpediente, { tipo_evento: "evaluaciones_habilitadas" });
    expect(primero.status).toBe(201);
    expect((await cerrar(primero.body.id_notificacion, "enviado")).status).toBe(200);
    await intentadaHace(db(), primero.body.id_notificacion, 60);
    expect(await habilitacionesDe(recibido.idExpediente)).toEqual([]);
    const otraVez = await e.interno.aviso(recibido.idExpediente, { tipo_evento: "evaluaciones_habilitadas" });
    expect(otraVez.status).toBe(409);
    expect(otraVez.body.error.codigo).toBe("AVISO_YA_REGISTRADO");
    expect(await intentosDe(db(), recibido.idExpediente, "evaluaciones_habilitadas")).toEqual([
      expect.objectContaining({ id_notificacion: primero.body.id_notificacion, estado_envio: "enviado" }),
    ]);

    // (b) Ya pasó a en_evaluacion antes de que el barrido tomara el aviso: no recibe ningún intento.
    const agendo = await e.habilitada();
    await unionHace2Min(agendo.idExpediente);
    expect(await habilitacionesDe(agendo.idExpediente)).toHaveLength(1);
    const t = await e.turnosTercero();
    expect((await e.familiaApi(agendo.token).post(rutaEvaluaciones(agendo.idExpediente), e.pedidos(t))).status).toBe(201);
    expect(await habilitacionesDe(agendo.idExpediente)).toEqual([]);
    const tarde = await e.interno.aviso(agendo.idExpediente, { tipo_evento: "evaluaciones_habilitadas" });
    expect(tarde.status).toBe(409);
    expect(tarde.body.error.codigo).toBe("AVISO_NO_CORRESPONDE");
    expect(await intentosDe(db(), agendo.idExpediente, "evaluaciones_habilitadas")).toEqual([]);
  });
});

describe("HU0009-2.0 reprogramación de una cita de evaluación por la familia", () => {
  it("HU0009-2.0 con al menos 24 h de anticipación, la familia elige un nuevo horario con cupo: se libera el turno anterior, se reserva el nuevo y se remite la confirmación actualizada a la familia y al evaluador responsable", async () => {
    const { f, t, cita } = await e.agendada();
    const idCita = cita("evaluacion_academica");
    const nuevo = await e.horario("evaluacion_academica", { dias: t.dia, inicio: "13:00", fin: "14:00" });
    const familia = e.familiaApi(f.token);

    const res = await familia.post(rutaReprogramacion(f.idExpediente, idCita), { id_horario: nuevo });

    expect(res.status).toBe(200);
    expect(res.body.cita).toMatchObject({ tipo_cita: "evaluacion_academica", hora_inicio: "13:00", estado: "reservada", reprogramable: true });
    expect(res.body).not.toHaveProperty("avisos");
    // Libera el turno anterior y reserva el nuevo, en la misma transacción.
    expect(await cupos(t.evaluacion_academica)).toBe(1);
    expect(await cupos(nuevo)).toBe(0);
    const citas = await citasDe(f.idExpediente);
    expect(citas.find((c) => c.id_cita === idCita)!.estado).toBe("reprogramada");
    const nueva = citas.find((c) => c.id_horario === nuevo)!;
    expect(nueva).toMatchObject({ estado: "reservada", id_personal: e.evaluador });
    expect(await estado(f.idExpediente)).toBe("en_evaluacion");
    // Evidencia: cita_reprogramada (actor familia), solo con ids.
    const [evento] = await eventosTipo(f.idExpediente, "cita_reprogramada");
    expect(evento).toMatchObject({ id_personal: null, estado_anterior: null, estado_nuevo: null });
    expect(evento!.detalle).toMatchObject({ id_cita_anterior: idCita, id_cita_nueva: nueva.id_cita, id_horario_anterior: t.evaluacion_academica, id_horario_nuevo: nuevo });
    expect(evento!.detalle).not.toHaveProperty("id_notificacion_responsable_anterior");
    // La confirmación actualizada, a la familia y al responsable (mismo evaluador: un solo aviso al personal).
    const [familiaAviso] = await intentosDe(db(), f.idExpediente, "evaluacion_reprogramada");
    const [responsableAviso] = await intentosDe(db(), f.idExpediente, "evaluacion_reprogramada_responsable");
    expect(await intentosDe(db(), f.idExpediente, "evaluacion_liberada_responsable")).toEqual([]);
    expect(e.eventos.disparar).toHaveBeenCalledWith("agendamiento", { id_expediente: f.idExpediente, id_notificacion: familiaAviso!.id_notificacion });
    expect(e.eventos.disparar).toHaveBeenCalledWith("agendamiento", { id_expediente: f.idExpediente, id_notificacion: responsableAviso!.id_notificacion });

    const aFamilia = await e.interno.aviso(f.idExpediente, { id_notificacion: familiaAviso!.id_notificacion });
    expect(aFamilia.status).toBe(201);
    expect(aFamilia.body.cuerpo).toContain("Evaluación académica: pasó del");
    expect(aFamilia.body.cuerpo).toContain("1:00 p. m.");
    expect(aFamilia.body.cuerpo).toContain("[Pautas previas de la entrevista a los padres");
    expect((await e.interno.contacto(f.idExpediente, familiaAviso!.id_notificacion)).body.correo).toBe(f.correo);

    const aResponsable = await e.interno.aviso(f.idExpediente, { id_notificacion: responsableAviso!.id_notificacion });
    expect(aResponsable.status).toBe(201);
    expect(aResponsable.body.asunto).toContain("Cita reprogramada: Evaluación académica");
    expect(aResponsable.body.cuerpo).toMatch(/Expediente: ADM-\S+/);
    // C11: ni el nombre de la familia ni el del menor en el aviso al personal.
    expect(aResponsable.body.cuerpo).not.toMatch(/María|Quispe|Sofía/);
    const contacto = await e.interno.contacto(f.idExpediente, responsableAviso!.id_notificacion);
    expect(contacto.status).toBe(200);
    expect(contacto.body).toEqual({ id_expediente: f.idExpediente, correo: await correoDe(e.evaluador), autoriza_whatsapp: false });

    // El turno liberado se puede volver a reservar (C40: la cita reprogramada no lo ocupa).
    const otra = await e.habilitada();
    const turnosOtra = { ...(await e.turnosTercero()), evaluacion_academica: t.evaluacion_academica };
    expect((await e.familiaApi(otra.token).post(rutaEvaluaciones(otra.idExpediente), e.pedidos(turnosOtra))).status).toBe(201);
  });

  it("HU0009-2.0 (24 h) con menos de REPROGRAMACION_MIN_HORAS de anticipación responde 422 PLAZO_REPROGRAMACION_VENCIDO y no cambia nada; con 24 h o más, reprograma", async () => {
    expect(process.env.REPROGRAMACION_MIN_HORAS).toBe("24");
    const { f, t, cita } = await e.agendada();
    const idCita = cita("evaluacion_psicologica");
    const nuevo = await e.horario("evaluacion_psicologica", { dias: t.dia, inicio: "12:00", fin: "13:00" });
    const familia = e.familiaApi(f.token);
    await citaDentroDe(idCita, 23 * 60);
    expect((await familia.get(rutaEvaluaciones(f.idExpediente))).body.evaluaciones.find((x: { tipo_cita: string }) => x.tipo_cita === "evaluacion_psicologica").cita).toMatchObject({ reprogramable: false, plazo_vencido: true });

    const tarde = await familia.post(rutaReprogramacion(f.idExpediente, idCita), { id_horario: nuevo });

    expect(tarde.status).toBe(422);
    expect(tarde.body.error).toMatchObject({ codigo: "PLAZO_REPROGRAMACION_VENCIDO", detalle: { min_horas: 24 } });
    expect(await cupos(nuevo)).toBe(1);
    expect((await citasDe(f.idExpediente)).find((c) => c.id_cita === idCita)!.estado).toBe("reservada");
    expect(await eventosTipo(f.idExpediente, "cita_reprogramada")).toEqual([]);

    await citaDentroDe(idCita, 24 * 60 + 6);
    expect((await familia.post(rutaReprogramacion(f.idExpediente, idCita), { id_horario: nuevo })).status).toBe(200);
  });

  it("HU0009-2.0 (24 h) REPROGRAMACION_MIN_HORAS es un entero de 1 a 168 y, sin definir, vale 24 (ADR-19)", () => {
    const base = { ...process.env };
    expect(variablesInvalidas({ ...base, REPROGRAMACION_MIN_HORAS: "0" })).toContain("REPROGRAMACION_MIN_HORAS");
    expect(variablesInvalidas({ ...base, REPROGRAMACION_MIN_HORAS: "169" })).toContain("REPROGRAMACION_MIN_HORAS");
    expect(variablesInvalidas({ ...base, REPROGRAMACION_MIN_HORAS: "veinte" })).toContain("REPROGRAMACION_MIN_HORAS");
    const sinDefinir = { ...base };
    delete sinDefinir.REPROGRAMACION_MIN_HORAS;
    expect(variablesInvalidas(sinDefinir)).toEqual([]);
  });

  it("HU0009-2.0 (otro responsable) si el nuevo horario lo atiende otra persona, se avisa al responsable nuevo y también al anterior, cada uno a su correo", async () => {
    const { f, t, cita } = await e.agendada();
    const idCita = cita("evaluacion_academica");
    const otroEvaluador = await crearPersonal(db(), "evaluador_academico");
    const nuevo = await e.horario("evaluacion_academica", { dias: t.dia, inicio: "09:00", fin: "10:00", idPersonal: otroEvaluador });

    const res = await e.familiaApi(f.token).post(rutaReprogramacion(f.idExpediente, idCita), { id_horario: nuevo });

    expect(res.status).toBe(200);
    const [aNuevo] = await intentosDe(db(), f.idExpediente, "evaluacion_reprogramada_responsable");
    const [aAnterior] = await intentosDe(db(), f.idExpediente, "evaluacion_liberada_responsable");
    expect(e.eventos.disparar).toHaveBeenCalledTimes(3);
    expect((await e.interno.contacto(f.idExpediente, aNuevo!.id_notificacion)).body.correo).toBe(await correoDe(otroEvaluador));
    expect((await e.interno.contacto(f.idExpediente, aAnterior!.id_notificacion)).body.correo).toBe(await correoDe(e.evaluador));
    const liberado = await e.interno.aviso(f.idExpediente, { id_notificacion: aAnterior!.id_notificacion });
    expect(liberado.status).toBe(201);
    expect(liberado.body.asunto).toContain("Turno liberado: Evaluación académica");
    // Una retoma del aviso al responsable sigue yendo al correo del personal.
    await intentadaHace(db(), aNuevo!.id_notificacion, 11);
    const retoma = await e.interno.aviso(f.idExpediente, { tipo_evento: "evaluacion_reprogramada_responsable" });
    expect(retoma.status).toBe(201);
    expect((await e.interno.contacto(f.idExpediente, retoma.body.id_notificacion)).body.correo).toBe(await correoDe(otroEvaluador));
  });

  it("HU0009-2.0 (orden) reprogramar una evaluación a después de la entrevista a los padres responde 422 ORDEN_DE_CITAS", async () => {
    const { f, t, cita } = await e.agendada();
    const tarde = await e.horario("evaluacion_academica", { dias: t.dia + 2, inicio: "09:00", fin: "10:00" });

    const res = await e.familiaApi(f.token).post(rutaReprogramacion(f.idExpediente, cita("evaluacion_academica")), { id_horario: tarde });

    expect(res.status).toBe(422);
    expect(res.body.error.codigo).toBe("ORDEN_DE_CITAS");
    expect(await cupos(tarde)).toBe(1);
  });

  it("HU0009-2.0 (horario) un horario de otro tipo responde 409 HORARIO_NO_DISPONIBLE y uno sin cupo 409 HORARIO_SIN_CUPO", async () => {
    const { f, t, cita } = await e.agendada();
    const idCita = cita("evaluacion_academica");
    const lleno = await e.horario("evaluacion_academica", { dias: t.dia, inicio: "14:00", fin: "15:00", cupos: 0 });
    const familia = e.familiaApi(f.token);

    const otroTipo = await familia.post(rutaReprogramacion(f.idExpediente, idCita), { id_horario: t.evaluacion_psicologica });
    const sinCupo = await familia.post(rutaReprogramacion(f.idExpediente, idCita), { id_horario: lleno });

    expect(otroTipo.status).toBe(409);
    expect(otroTipo.body.error.codigo).toBe("HORARIO_NO_DISPONIBLE");
    expect(sinCupo.status).toBe(409);
    expect(sinCupo.body.error.codigo).toBe("HORARIO_SIN_CUPO");
    expect((await citasDe(f.idExpediente)).find((c) => c.id_cita === idCita)!.estado).toBe("reservada");
  });

  it("HU0009-2.0 (ajena) la cita de otra familia responde 404 CITA_NO_ENCONTRADA y se audita acceso_denegado; su expediente, 404 EXPEDIENTE_NO_ENCONTRADO", async () => {
    const a = await e.agendada();
    const b = await e.agendada();
    const nuevo = await e.horario("evaluacion_academica", { dias: a.t.dia, inicio: "15:00", fin: "16:00" });
    const familiaB = e.familiaApi(b.f.token);

    const ajena = await familiaB.post(rutaReprogramacion(b.f.idExpediente, a.cita("evaluacion_academica")), { id_horario: nuevo });
    const otroExpediente = await familiaB.post(rutaReprogramacion(a.f.idExpediente, a.cita("evaluacion_academica")), { id_horario: nuevo });

    expect(ajena.status).toBe(404);
    expect(ajena.body.error.codigo).toBe("CITA_NO_ENCONTRADA");
    expect((await eventosTipo(b.f.idExpediente, "acceso_denegado")).map((ev) => ev.detalle.motivo)).toContain("cita_ajena");
    expect(otroExpediente.status).toBe(404);
    expect(otroExpediente.body.error.codigo).toBe("EXPEDIENTE_NO_ENCONTRADO");
    expect(await cupos(nuevo)).toBe(1);
    expect((await citasDe(a.f.idExpediente)).every((c) => c.estado === "reservada")).toBe(true);
  });
});
