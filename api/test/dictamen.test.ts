// Resultados de las evaluaciones y dictamen de admisión (HU0010 y HU0025; plan del bloque 7, ADR-25) por las rutas reales
// de G06 (/psicologia), G11 (/evaluacion-academica), G03 (/bandeja), P08 (/familia) y n8n (/internal). Cubre HU0025-1.0 y
// 2.0, HU0010-1.0, 2.0 y 3.0, R3 y HU0021-2.0 en las rutas reales (C17), C25 (4) por G09, el par de atención (ADR-05),
// C22, el cifrado de D1-A y los avisos (ADR-07, C11). Datos ficticios @ejemplo.test; n8n se simula.
// «La cita ya empezó» (S3) se simula moviendo solo la fecha de la cita de la prueba al pasado, como `citaDentroDe` de
// HU0009: las citas se reservan por la ruta real de P08, que solo admite turnos futuros.
import { randomUUID } from "node:crypto";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { descifrar } from "../src/crypto/columnas";
import { cerrarPool, obtenerPool } from "../src/db/pool";
import { crearFirmante, crearPersonal, eventosDe } from "./ayudantes";
import { exe, pdf } from "./ayudantesCarga";
import { entornoEvaluacion, rutaEvaluaciones, rutaReprogramacion, type EntornoEvaluacion } from "./ayudantesEvaluacion";
import { intentadaHace, intentosDe } from "./ayudantesVisita";

const db = () => obtenerPool();
let firmante: Awaited<ReturnType<typeof crearFirmante>>;
let e: EntornoEvaluacion;

beforeAll(async () => {
  firmante = await crearFirmante();
  e = await entornoEvaluacion(db(), firmante);
});
afterAll(cerrarPool);

const FRONT = () => process.env.FRONTEND_PUBLIC_URL!.replace(/\/+$/, "");
const CORREO_ADMISION = () => process.env.CORREO_ADMISION!;
const fechaLima = (dias: number) => new Date(Date.now() + dias * 86_400_000).toLocaleDateString("en-CA", { timeZone: "America/Lima" });

const estado = async (idExpediente: number) =>
  (await db().query<{ estado: string }>("SELECT estado::text AS estado FROM expediente WHERE id_expediente = $1", [idExpediente])).rows[0]!.estado;
const citasDe = async (idExpediente: number) =>
  (
    await db().query<{ id_cita: number; id_horario: number; tipo_cita: string; estado: string }>(
      "SELECT id_cita, id_horario, tipo_cita::text AS tipo_cita, estado::text AS estado FROM cita WHERE id_expediente = $1 ORDER BY id_cita",
      [idExpediente],
    )
  ).rows;
const eventosTipo = async (idExpediente: number, tipo: string) => (await eventosDe(db(), idExpediente)).filter((ev) => ev.tipo_evento === tipo);
const filaDictamen = async (idExpediente: number) =>
  (
    await db().query<{ id_dictamen: number; dictamen: string; conclusiones: string | null; requisitos_complementarios: string | null; informe_url: string | null }>(
      "SELECT id_dictamen, dictamen::text AS dictamen, conclusiones, requisitos_complementarios, informe_url FROM dictamen_admision WHERE id_expediente = $1",
      [idExpediente],
    )
  ).rows[0];
const filaResultado = async (idCita: number) =>
  (await db().query<{ resultado: string; observaciones: string | null }>("SELECT resultado, observaciones FROM resultado_evaluacion WHERE id_cita = $1", [idCita])).rows[0];
// El último acceso_denegado de una persona del personal.
const ultimoDenegado = async (idPersonal: number) =>
  (
    await db().query<{ id_expediente: number | null; detalle: Record<string, unknown> }>(
      "SELECT id_expediente, detalle FROM registro_auditoria WHERE id_personal = $1 AND tipo_evento = 'acceso_denegado' ORDER BY id_evento DESC LIMIT 1",
      [idPersonal],
    )
  ).rows[0];

// S3: la cita ya empezó. Cada llamada usa otro minuto para no repetir (id_personal, fecha_hora) de uq_cita_personal_fecha.
let minutos = 5;
const iniciar = (idCita: number) => db().query("UPDATE cita SET fecha_hora = now() - make_interval(mins => $2) WHERE id_cita = $1", [idCita, (minutos += 2)]);

const psicologa = () => e.api(e.tokenPsicologa);
const evaluador = () => e.api(e.tokenEvaluador);
const rutaCitaG06 = (idCita: number) => `/psicologia/citas/${idCita}`;
const rutaCitaG11 = (idCita: number) => `/evaluacion-academica/citas/${idCita}`;
const rutaDictamen = (idExpediente: number) => `/psicologia/expedientes/${idExpediente}/dictamen`;
const rutaInforme = (idExpediente: number) => `${rutaDictamen(idExpediente)}/informe`;
const rutaRequisitos = (idExpediente: number) => `/bandeja/expedientes/${idExpediente}/requisitos-complementarios`;
const resultado = (texto = "Logrado") => ({ resultado: texto, observaciones: `Observación ficticia ${randomUUID().slice(0, 6)}` });

// POST multipart del dictamen (G06), con el informe opcional.
function dictaminar(idExpediente: number, campos: Record<string, string>, archivo?: { contenido: Buffer; nombre?: string }, token = e.tokenPsicologa) {
  let r = request(e.app).post(rutaDictamen(idExpediente)).set("Authorization", `Bearer ${token}`);
  for (const [k, v] of Object.entries(campos)) r = r.field(k, v);
  if (archivo) r = r.attach("archivo", archivo.contenido, { filename: archivo.nombre ?? "informe.pdf", contentType: "application/pdf" });
  return r;
}

// Expediente de 3.° en evaluación con sus tres citas ya iniciadas y, según `registrar`, sus resultados registrados por las
// rutas reales de G11 (académica) y G06 (psicológica y entrevista).
async function enEvaluacion(registrar: ("evaluacion_academica" | "evaluacion_psicologica" | "entrevista_padres")[] = ["evaluacion_academica", "evaluacion_psicologica", "entrevista_padres"]) {
  const a = await e.agendada();
  for (const c of a.citas) await iniciar(c.id_cita);
  for (const tipo of registrar) {
    const api = tipo === "evaluacion_academica" ? evaluador() : psicologa();
    const ruta = tipo === "evaluacion_academica" ? rutaCitaG11(a.cita(tipo)) : rutaCitaG06(a.cita(tipo));
    const r = await api.post(`${ruta}/resultado`, resultado());
    if (r.status !== 201) throw new Error(`Resultado de prueba fallido (${r.status} ${JSON.stringify(r.body)})`);
  }
  e.eventos.disparar.mockClear();
  return a;
}

describe("HU0025-1.0 registro del resultado de la evaluación académica", () => {
  it("HU0025-1.0 el evaluador ingresa el resultado y las observaciones en el formulario de su cita y confirma: se registra el resultado, la evaluación académica queda completada y la psicóloga la ve para el dictamen", async () => {
    const a = await e.agendada();
    const idCita = a.cita("evaluacion_academica");
    await iniciar(idCita);
    const ev = evaluador();

    const form = await ev.get(rutaCitaG11(idCita));
    expect(form.status).toBe(200);
    expect(form.body).toMatchObject({ id_cita: idCita, tipo_cita: "evaluacion_academica", estado: "reservada", registrable: true, resultado: null });

    const entrada = resultado("Satisfactorio");
    const res = await ev.post(`${rutaCitaG11(idCita)}/resultado`, entrada);

    expect(res.status).toBe(201);
    expect(res.body).toEqual({ id_cita: idCita, id_expediente: a.f.idExpediente, estado: "asistio" });
    expect((await citasDe(a.f.idExpediente)).find((c) => c.id_cita === idCita)!.estado).toBe("asistio");
    expect((await filaResultado(idCita))!.resultado).toBe("Satisfactorio");
    // La pone a disposición de la psicóloga: el dictamen la muestra completada, con el resultado y las observaciones.
    const g06 = await psicologa().get(rutaDictamen(a.f.idExpediente));
    expect(g06.status).toBe(200);
    expect(g06.body.componentes).toContainEqual(
      expect.objectContaining({ id_cita: idCita, tipo_cita: "evaluacion_academica", estado: "asistio", resultado: "Satisfactorio", observaciones: entrada.observaciones }),
    );
    expect(g06.body.faltan).toEqual(["evaluacion_psicologica", "entrevista_padres"]);
    // El expediente sigue en evaluación: el resultado no es una transición.
    expect(await estado(a.f.idExpediente)).toBe("en_evaluacion");
  });

  it("HU0025-1.0 (R3) sin dar al evaluador acceso al informe psicológico ni a la documentación financiera: G11 solo devuelve su cita, y las rutas de Psicología y Tesorería le responden 403 auditado como acceso_denegado", async () => {
    const a = await enEvaluacion();
    const conclusiones = `Conclusión confidencial ${randomUUID()}`;
    expect((await dictaminar(a.f.idExpediente, { dictamen: "apto", conclusiones }, { contenido: pdf("informe confidencial") })).status).toBe(201);
    const ev = evaluador();

    const g11 = await ev.get(rutaCitaG11(a.cita("evaluacion_academica")));
    expect(g11.status).toBe(200);
    const texto = JSON.stringify(g11.body);
    expect(texto).not.toContain(conclusiones);
    for (const clave of ["dictamen", "conclusiones", "informe_url", "componentes", "documentos"]) expect(g11.body).not.toHaveProperty(clave);
    // Tampoco ve el resultado de la evaluación psicológica (no es su cita).
    expect((await ev.get(rutaCitaG11(a.cita("evaluacion_psicologica")))).status).toBe(404);

    for (const ruta of [rutaDictamen(a.f.idExpediente), rutaInforme(a.f.idExpediente)]) {
      const r = await ev.get(ruta);
      expect(r.status).toBe(403);
      expect(r.body.error.codigo).toBe("ACCESO_DENEGADO");
      expect(await ultimoDenegado(e.evaluador)).toMatchObject({ id_expediente: a.f.idExpediente, detalle: expect.objectContaining({ recurso: "informe_psicologico" }) });
    }
    const financiera = await ev.get(`/tesoreria/expedientes/${a.f.idExpediente}/documentacion-financiera`);
    expect(financiera.status).toBe(403);
    expect(await ultimoDenegado(e.evaluador)).toMatchObject({ detalle: expect.objectContaining({ ruta: `/tesoreria/expedientes/${a.f.idExpediente}/documentacion-financiera` }) });
  });

  it("HU0025-1.0 (S3) la cita de otro responsable o de otro tipo responde 404, una cita que todavía no empieza 409 CITA_NO_INICIADA y un segundo registro 409 RESULTADO_YA_REGISTRADO", async () => {
    const a = await e.agendada();
    const academica = a.cita("evaluacion_academica");
    const ev = evaluador();

    const futura = await ev.post(`${rutaCitaG11(academica)}/resultado`, resultado());
    expect(futura.status).toBe(409);
    expect(futura.body.error.codigo).toBe("CITA_NO_INICIADA");

    await iniciar(academica);
    // Otro evaluador activo: la cita no es suya.
    const sub = randomUUID();
    await crearPersonal(db(), "evaluador_academico", sub);
    const otro = e.api(await firmante.token(sub, ["evaluador_academico"]));
    expect((await otro.post(`${rutaCitaG11(academica)}/resultado`, resultado())).status).toBe(404);
    // La psicóloga no registra la académica, ni el evaluador una de la psicóloga (S1).
    expect((await psicologa().post(`${rutaCitaG06(academica)}/resultado`, resultado())).status).toBe(404);
    expect((await ev.post(`${rutaCitaG11(a.cita("evaluacion_psicologica"))}/resultado`, resultado())).status).toBe(404);

    expect((await ev.post(`${rutaCitaG11(academica)}/resultado`, resultado())).status).toBe(201);
    const otraVez = await ev.post(`${rutaCitaG11(academica)}/resultado`, resultado());
    expect(otraVez.status).toBe(409);
    expect(otraVez.body.error.codigo).toBe("RESULTADO_YA_REGISTRADO");
    expect(await eventosTipo(a.f.idExpediente, "atencion_fin")).toHaveLength(1);
  });

  it("HU0025-1.0 (validación) el resultado y las observaciones son obligatorios, el resultado tiene hasta 50 caracteres (escala por definir, S4) y «inasistencia» se registra solo con «No asistió»", async () => {
    const a = await e.agendada();
    const idCita = a.cita("evaluacion_academica");
    await iniciar(idCita);
    const ev = evaluador();
    for (const cuerpo of [{}, { resultado: "Logrado" }, { resultado: "x".repeat(51), observaciones: "Bien" }, { resultado: "Inasistencia", observaciones: "No vino" }, { ...resultado(), extra: 1 }]) {
      const r = await ev.post(`${rutaCitaG11(idCita)}/resultado`, cuerpo);
      expect(r.status, JSON.stringify(cuerpo)).toBe(400);
    }
    expect(await filaResultado(idCita)).toBeUndefined();
  });

  it("HU0025-1.0 (agenda) G11 lista solo las citas académicas del día del evaluador de la sesión, y G06 solo las de la psicóloga", async () => {
    const a = await e.agendada();
    const dia = fechaLima(a.t.dia);

    const g11 = await evaluador().get(`/evaluacion-academica/agenda?fecha=${dia}`);
    expect(g11.status).toBe(200);
    const ids11 = g11.body.citas.map((c: { id_cita: number }) => c.id_cita);
    expect(ids11).toContain(a.cita("evaluacion_academica"));
    expect(ids11).not.toContain(a.cita("evaluacion_psicologica"));
    expect(g11.body.citas.every((c: { tipo_cita: string }) => c.tipo_cita === "evaluacion_academica")).toBe(true);
    expect(g11.body.citas.find((c: { id_cita: number }) => c.id_cita === a.cita("evaluacion_academica"))).toMatchObject({
      codigo: expect.stringMatching(/^ADM-/),
      hora_inicio: "09:00",
      estado: "reservada",
      resultado_registrado: false,
    });

    const g06 = await psicologa().get(`/psicologia/agenda?fecha=${dia}`);
    const ids06 = g06.body.citas.map((c: { id_cita: number }) => c.id_cita);
    expect(ids06).toContain(a.cita("evaluacion_psicologica"));
    expect(ids06).not.toContain(a.cita("evaluacion_academica"));
    expect((await psicologa().get(`/psicologia/agenda?fecha=${fechaLima(a.t.dia + 1)}`)).body.citas.map((c: { id_cita: number }) => c.id_cita)).toContain(
      a.cita("entrevista_padres"),
    );
    expect((await evaluador().get("/evaluacion-academica/agenda?fecha=2026-02-30")).status).toBe(400);
  });
});

describe("HU0025-2.0 registro de inasistencia a la evaluación académica", () => {
  it("HU0025-2.0 el evaluador registra la inasistencia: el sistema libera la cita (no_asistio) y notifica a la familia, con el enlace a P08, para que reprograme la evaluación", async () => {
    const a = await e.agendada();
    const idCita = a.cita("evaluacion_academica");
    await iniciar(idCita);

    const res = await evaluador().post(`${rutaCitaG11(idCita)}/inasistencia`, {});

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ id_cita: idCita, id_expediente: a.f.idExpediente, estado: "no_asistio" });
    expect((await citasDe(a.f.idExpediente)).find((c) => c.id_cita === idCita)!.estado).toBe("no_asistio");
    expect(await filaResultado(idCita)).toEqual({ resultado: "inasistencia", observaciones: null });
    expect(await estado(a.f.idExpediente)).toBe("en_evaluacion");
    const intentos = await intentosDe(db(), a.f.idExpediente, "evaluacion_inasistencia");
    expect(intentos).toHaveLength(1);
    const idNotificacion = intentos[0]!.id_notificacion;
    expect(e.eventos.disparar).toHaveBeenCalledWith("agendamiento", { id_expediente: a.f.idExpediente, id_notificacion: idNotificacion });
    const fin = (await eventosTipo(a.f.idExpediente, "atencion_fin")).at(-1)!;
    expect(fin.detalle).toMatchObject({ item: { tipo: "cita", id: idCita }, decision: "inasistencia", id_notificacion: idNotificacion });

    // n8n reserva el aviso por el webhook: a la familia, con el enlace a P08.
    const aviso = await e.interno.aviso(a.f.idExpediente, { id_notificacion: idNotificacion });
    expect(aviso.status).toBe(201);
    expect(aviso.body).toMatchObject({ id_notificacion: idNotificacion, tipo_evento: "evaluacion_inasistencia" });
    expect(aviso.body.cuerpo).toContain(`${FRONT()}/portal/evaluaciones`);
    expect(aviso.body.cuerpo).toContain("[Aviso de inasistencia a la evaluación académica: por definir con el colegio]");
    expect((await e.interno.contacto(a.f.idExpediente, idNotificacion)).body.correo).toBe(a.f.correo);
  });

  it("HU0025-2.0 (reprogramación, D2-A) la familia reprograma en P08 la evaluación a la que no asistió, sin la regla de 24 h: la cita vieja queda no_asistio, la nueva es la vigente y la vieja ya no se reprograma", async () => {
    const a = await e.agendada();
    const vieja = a.cita("evaluacion_academica");
    await iniciar(vieja);
    expect((await evaluador().post(`${rutaCitaG11(vieja)}/inasistencia`, {})).status).toBe(200);
    const familia = e.familiaApi(a.f.token);

    const p08 = await familia.get(rutaEvaluaciones(a.f.idExpediente));
    expect(p08.body.evaluaciones.find((x: { tipo_cita: string }) => x.tipo_cita === "evaluacion_academica").cita).toMatchObject({
      id_cita: vieja,
      estado: "no_asistio",
      inasistencia: true,
      reprogramable: true,
    });
    const cuposAntes = (await db().query<{ cupos: number }>("SELECT cupos FROM horario_disponible WHERE id_horario = $1", [a.t.evaluacion_academica])).rows[0]!.cupos;
    const nuevoHorario = await e.horario("evaluacion_academica", { dias: a.t.dia, inicio: "12:00", fin: "13:00" });

    const res = await familia.post(rutaReprogramacion(a.f.idExpediente, vieja), { id_horario: nuevoHorario });

    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const citas = await citasDe(a.f.idExpediente);
    expect(citas.find((c) => c.id_cita === vieja)!.estado).toBe("no_asistio");
    const nueva = citas.find((c) => c.id_horario === nuevoHorario)!;
    expect(nueva.estado).toBe("reservada");
    expect(res.body.cita).toMatchObject({ id_cita: nueva.id_cita, estado: "reservada", inasistencia: false });
    // El turno vencido no se libera: su cupo no cambia.
    expect((await db().query<{ cupos: number }>("SELECT cupos FROM horario_disponible WHERE id_horario = $1", [a.t.evaluacion_academica])).rows[0]!.cupos).toBe(cuposAntes);
    expect((await eventosTipo(a.f.idExpediente, "cita_reprogramada")).at(-1)!.detalle).toMatchObject({ id_cita_anterior: vieja, id_cita_nueva: nueva.id_cita });
    expect((await intentosDe(db(), a.f.idExpediente, "evaluacion_liberada_responsable"))).toHaveLength(0);
    // P08 muestra la cita nueva como la vigente, y la vieja no se reprograma otra vez.
    const despues = await familia.get(rutaEvaluaciones(a.f.idExpediente));
    expect(despues.body.evaluaciones.find((x: { tipo_cita: string }) => x.tipo_cita === "evaluacion_academica").cita.id_cita).toBe(nueva.id_cita);
    const otraVez = await familia.post(rutaReprogramacion(a.f.idExpediente, vieja), { id_horario: await e.horario("evaluacion_academica", { dias: a.t.dia, inicio: "14:00", fin: "14:30" }) });
    expect(otraVez.status).toBe(409);
    expect(otraVez.body.error.codigo).toBe("CITA_NO_REPROGRAMABLE");
  });

  it("HU0025-2.0 (otro responsable) si el nuevo horario de la inasistencia lo atiende otra persona, se avisa al responsable nuevo y también al anterior, como en toda reprogramación (ADR-24)", async () => {
    const a = await e.agendada();
    const vieja = a.cita("evaluacion_academica");
    await iniciar(vieja);
    expect((await evaluador().post(`${rutaCitaG11(vieja)}/inasistencia`, {})).status).toBe(200);
    const otro = await crearPersonal(db(), "evaluador_academico");
    const nuevo = await e.horario("evaluacion_academica", { dias: a.t.dia, inicio: "12:00", fin: "13:00", idPersonal: otro });

    const res = await e.familiaApi(a.f.token).post(rutaReprogramacion(a.f.idExpediente, vieja), { id_horario: nuevo });

    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const [aNuevo] = await intentosDe(db(), a.f.idExpediente, "evaluacion_reprogramada_responsable");
    const [aAnterior] = await intentosDe(db(), a.f.idExpediente, "evaluacion_liberada_responsable");
    const correo = async (id: number) => (await db().query<{ correo: string }>("SELECT correo FROM personal WHERE id_personal = $1", [id])).rows[0]!.correo;
    expect((await e.interno.contacto(a.f.idExpediente, aNuevo!.id_notificacion)).body.correo).toBe(await correo(otro));
    expect((await e.interno.contacto(a.f.idExpediente, aAnterior!.id_notificacion)).body.correo).toBe(await correo(e.evaluador));
    const liberado = await e.interno.aviso(a.f.idExpediente, { id_notificacion: aAnterior!.id_notificacion });
    expect(liberado.status).toBe(201);
    expect(liberado.body.asunto).toContain("Turno liberado: Evaluación académica");
  });

  it("HU0025-2.0 (orden) con la entrevista ya registrada, la inasistencia se reprograma después de ella, el nuevo resultado se registra y el dictamen se habilita (decisión A, ADR-24)", async () => {
    const a = await enEvaluacion(["evaluacion_psicologica", "entrevista_padres"]);
    const vieja = a.cita("evaluacion_academica");
    expect((await evaluador().post(`${rutaCitaG11(vieja)}/inasistencia`, {})).status).toBe(200);
    expect((await psicologa().get(rutaDictamen(a.f.idExpediente))).body).toMatchObject({ habilitado: false, faltan: ["evaluacion_academica"] });
    const nuevo = await e.horario("evaluacion_academica", { dias: a.t.dia + 2, inicio: "09:00", fin: "10:00" });

    const res = await e.familiaApi(a.f.token).post(rutaReprogramacion(a.f.idExpediente, vieja), { id_horario: nuevo });

    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const nueva = res.body.cita.id_cita as number;
    await iniciar(nueva);
    expect((await evaluador().post(`${rutaCitaG11(nueva)}/resultado`, resultado())).status).toBe(201);
    expect((await psicologa().get(rutaDictamen(a.f.idExpediente))).body).toMatchObject({ habilitado: true, faltan: [] });
    expect((await dictaminar(a.f.idExpediente, { dictamen: "apto", conclusiones: "Conclusiones ficticias" })).status).toBe(201);
  });

  it("HU0025-2.0 (orden) con la entrevista a menos de 24 h la excepción también aplica; con la entrevista movible, el orden se sigue exigiendo con 422 ORDEN_DE_CITAS", async () => {
    const movible = await e.agendada();
    const vieja = movible.cita("evaluacion_academica");
    await iniciar(vieja);
    expect((await evaluador().post(`${rutaCitaG11(vieja)}/inasistencia`, {})).status).toBe(200);
    const despues = await e.horario("evaluacion_academica", { dias: movible.t.dia + 2, inicio: "09:00", fin: "10:00" });

    const rechazo = await e.familiaApi(movible.f.token).post(rutaReprogramacion(movible.f.idExpediente, vieja), { id_horario: despues });
    expect(rechazo.status).toBe(422);
    expect(rechazo.body.error.codigo).toBe("ORDEN_DE_CITAS");

    // A menos de 24 h ya no se puede mover la entrevista: la inasistencia se reprograma después de ella.
    await db().query("UPDATE cita SET fecha_hora = now() + make_interval(mins => $2) WHERE id_cita = $1", [movible.cita("entrevista_padres"), (minutos += 2) + 600]);
    const res = await e.familiaApi(movible.f.token).post(rutaReprogramacion(movible.f.idExpediente, vieja), { id_horario: despues });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
  });

  it("HU0025-2.0 (aviso) el aviso de la inasistencia sigue ADR-07: si el intento queda pendiente más de 10 min, el barrido de agendamiento lo retoma con una fila nueva", async () => {
    const a = await e.agendada();
    const idCita = a.cita("evaluacion_academica");
    await iniciar(idCita);
    await evaluador().post(`${rutaCitaG11(idCita)}/inasistencia`, {});
    const [primero] = await intentosDe(db(), a.f.idExpediente, "evaluacion_inasistencia");
    expect(await e.interno.pendientes()).not.toContainEqual({ id_expediente: a.f.idExpediente, tipo_evento: "evaluacion_inasistencia" });

    await intentadaHace(db(), primero!.id_notificacion, 11);
    expect(await e.interno.pendientes()).toContainEqual({ id_expediente: a.f.idExpediente, tipo_evento: "evaluacion_inasistencia" });
    const retoma = await e.interno.aviso(a.f.idExpediente, { tipo_evento: "evaluacion_inasistencia" });

    expect(retoma.status).toBe(201);
    expect(retoma.body.id_notificacion).toBeGreaterThan(primero!.id_notificacion);
    expect(await intentosDe(db(), a.f.idExpediente, "evaluacion_inasistencia")).toHaveLength(2);
  });
});

describe("HU0010-1.0 registro de dictamen Apto", () => {
  it("HU0010-1.0 [parte: dictamen, informe restringido y estado] con la entrevista a los padres concluida y los resultados de todas las evaluaciones del grado, la psicóloga ingresa las conclusiones, elige Apto y guarda: el informe queda archivado con acceso restringido y el expediente pasa a apto para la Dirección", async () => {
    const a = await enEvaluacion();
    const conclusiones = `Integra la información de las evaluaciones ${randomUUID()}`;
    const informe = pdf(`informe psicopedagógico ${randomUUID()}`);

    const g06 = await psicologa().get(rutaDictamen(a.f.idExpediente));
    expect(g06.body).toMatchObject({ estado: "en_evaluacion", faltan: [], habilitado: true, opciones: ["apto", "en_observacion", "no_apto"], dictamen: null });

    const res = await dictaminar(a.f.idExpediente, { dictamen: "apto", conclusiones }, { contenido: informe });

    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body).toEqual({ id_expediente: a.f.idExpediente, estado: "apto", dictamen: "apto", tiene_informe: true });
    expect(await estado(a.f.idExpediente)).toBe("apto");
    const transicion = (await eventosTipo(a.f.idExpediente, "transicion_estado")).at(-1)!;
    expect(transicion).toMatchObject({ estado_anterior: "en_evaluacion", estado_nuevo: "apto", id_personal: e.psicologa });
    const fila = (await filaDictamen(a.f.idExpediente))!;
    expect(fila.dictamen).toBe("apto");
    expect(fila.informe_url).toMatch(/^[0-9a-f-]{36}$/);
    // Archiva el informe con acceso restringido: la psicóloga lo descarga; Secretaría recibe 403 auditado (R3).
    const descarga = await request(e.app)
      .get(rutaInforme(a.f.idExpediente))
      .set("Authorization", `Bearer ${e.tokenPsicologa}`)
      .buffer(true)
      .parse((r, cb) => {
        const trozos: Buffer[] = [];
        r.on("data", (t: Buffer) => trozos.push(t));
        r.on("end", () => cb(null, Buffer.concat(trozos)));
      });
    expect(descarga.status).toBe(200);
    expect(descarga.headers["content-type"]).toBe("application/pdf");
    expect(descarga.headers["x-content-type-options"]).toBe("nosniff");
    expect(descarga.headers["cache-control"]).toBe("no-store");
    expect(Buffer.from(descarga.body as Buffer).equals(informe)).toBe(true);
    expect((await e.api(e.secretaria.token).get(rutaInforme(a.f.idExpediente))).status).toBe(403);
    expect(await ultimoDenegado(e.secretaria.idPersonal)).toMatchObject({ id_expediente: a.f.idExpediente, detalle: expect.objectContaining({ recurso: "informe_psicologico" }) });
    // «Deriva a la Dirección» (D3-A): queda en apto para G07 (HU0012), sin aviso.
    expect(e.eventos.disparar).not.toHaveBeenCalled();
    expect((await intentosDe(db(), a.f.idExpediente)).filter((n) => n.tipo_evento.startsWith("dictamen_"))).toHaveLength(0);
    const despues = await psicologa().get(rutaDictamen(a.f.idExpediente));
    expect(despues.body).toMatchObject({ habilitado: false, opciones: [], dictamen: { dictamen: "apto", conclusiones, tiene_informe: true } });
  });

  it("HU0010-1.0 [parte: dictamen, informe restringido y estado] (resultados incompletos) sin el resultado de la entrevista a los padres el dictamen responde 409 RESULTADOS_INCOMPLETOS con lo que falta, y G06 no lo habilita", async () => {
    const a = await enEvaluacion(["evaluacion_academica", "evaluacion_psicologica"]);

    const g06 = await psicologa().get(`${rutaDictamen(a.f.idExpediente)}?abrir=1`);
    expect(g06.body).toMatchObject({ habilitado: false, faltan: ["entrevista_padres"] });
    expect((await eventosTipo(a.f.idExpediente, "atencion_inicio")).filter((ev) => ev.detalle.item.tipo === "dictamen")).toHaveLength(0);

    const res = await dictaminar(a.f.idExpediente, { dictamen: "apto", conclusiones: "Conclusiones ficticias" }, { contenido: pdf() });

    expect(res.status).toBe(409);
    expect(res.body.error).toMatchObject({ codigo: "RESULTADOS_INCOMPLETOS", detalle: [{ tipo_cita: "entrevista_padres" }] });
    expect(await estado(a.f.idExpediente)).toBe("en_evaluacion");
    expect(await filaDictamen(a.f.idExpediente)).toBeUndefined();
  });

  it("HU0010-1.0 [parte: dictamen, informe restringido y estado] (validación) un dictamen inválido responde 400 y un informe que no es PDF, JPG ni PNG 415, sin dictamen ni transición", async () => {
    const a = await enEvaluacion();
    const casos: Record<string, string>[] = [
      { dictamen: "apto" },
      { dictamen: "aprobado", conclusiones: "C" },
      { dictamen: "apto", conclusiones: "C", requisitos_complementarios: "R" },
      { dictamen: "en_observacion", conclusiones: "C" },
      { dictamen: "apto", conclusiones: "C", extra: "1" },
      { dictamen: "apto", conclusiones: "x".repeat(4001) },
    ];
    for (const campos of casos) expect((await dictaminar(a.f.idExpediente, campos)).status, JSON.stringify(campos).slice(0, 80)).toBe(400);
    const ejecutable = await dictaminar(a.f.idExpediente, { dictamen: "apto", conclusiones: "C" }, { contenido: exe(), nombre: "informe.pdf" });
    expect(ejecutable.status).toBe(415);
    expect(await filaDictamen(a.f.idExpediente)).toBeUndefined();
    expect(await estado(a.f.idExpediente)).toBe("en_evaluacion");
  });
});

describe("HU0010-1.0 [parte: dictamen, informe restringido y estado] datos del postulante en G06", () => {
  it("HU0010-1.0 [parte: dictamen, informe restringido y estado] (G06) el dictamen muestra la edad del postulante calculada con su fecha de nacimiento; sin ficha, null", async () => {
    const f = await e.habilitadaReal();
    const t = await e.turnosTercero();
    expect((await e.familiaApi(f.token).post(rutaEvaluaciones(f.idExpediente), e.pedidos(t))).status).toBe(201);
    // familiaConFicha registra el 14/03/2018.
    const [anio, mes, dia] = fechaLima(0).split("-").map(Number) as [number, number, number];
    const edad = anio - 2018 - (mes < 3 || (mes === 3 && dia < 14) ? 1 : 0);

    expect((await psicologa().get(rutaDictamen(f.idExpediente))).body.edad).toBe(edad);

    const sinFicha = await e.agendada();
    expect((await psicologa().get(rutaDictamen(sinFicha.f.idExpediente))).body.edad).toBeNull();
  });
});

describe("HU0022-1.0 [parte: dictamen] evaluaciones exigidas configuradas en G09", () => {
  it("HU0022-1.0 [parte: dictamen] un grado configurado por la ruta de G09 con solo la evaluación psicológica exige para el dictamen esa evaluación y la entrevista, no el texto fijo de G06 (C25 4)", async () => {
    const f = await e.habilitada();
    const g09 = await request(e.app)
      .patch("/configuracion/grados")
      .set("Authorization", `Bearer ${e.secretaria.token}`)
      .send({ grados: [{ id_grado: f.idGrado, requiere_jornada_observacion: false, requiere_evaluacion_psicologica: true, requiere_evaluacion_academica: false }] });
    expect(g09.status).toBe(200);
    const d = e.diasNuevos();
    const psico = await e.horario("evaluacion_psicologica", { dias: d, inicio: "10:30", fin: "11:30" });
    const entrevista = await e.horario("entrevista_padres", { dias: d + 1, inicio: "15:00", fin: "16:00" });
    const reserva = await e.familiaApi(f.token).post(rutaEvaluaciones(f.idExpediente), {
      horarios: [{ tipo_cita: "evaluacion_psicologica", id_horario: psico }, { tipo_cita: "entrevista_padres", id_horario: entrevista }],
    });
    expect(reserva.status).toBe(201);
    const citas = reserva.body.citas as { id_cita: number; tipo_cita: string }[];

    const antes = await psicologa().get(rutaDictamen(f.idExpediente));
    expect(antes.body).toMatchObject({ exigidas: ["evaluacion_psicologica", "entrevista_padres"], faltan: ["evaluacion_psicologica", "entrevista_padres"], habilitado: false });

    for (const c of citas) {
      await iniciar(c.id_cita);
      expect((await psicologa().post(`${rutaCitaG06(c.id_cita)}/resultado`, resultado())).status).toBe(201);
    }
    const listo = await psicologa().get(rutaDictamen(f.idExpediente));
    expect(listo.body).toMatchObject({ faltan: [], habilitado: true });
    expect((await dictaminar(f.idExpediente, { dictamen: "apto", conclusiones: "Conclusiones ficticias" })).status).toBe(201);
    expect(await estado(f.idExpediente)).toBe("apto");
  });
});

describe("HU0010-2.0 registro de dictamen En observación con requisitos complementarios", () => {
  it("HU0010-2.0 la psicóloga selecciona En observación y detalla los requisitos complementarios: el expediente pasa a en_observacion y se notifica al personal de admisión, que ve los requisitos sin las conclusiones", async () => {
    const a = await enEvaluacion();
    const conclusiones = `Conclusión reservada ${randomUUID()}`;
    const requisitos = `Informe de terapia de lenguaje ${randomUUID()}`;

    const res = await dictaminar(a.f.idExpediente, { dictamen: "en_observacion", conclusiones, requisitos_complementarios: requisitos });

    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body).toMatchObject({ estado: "en_observacion", dictamen: "en_observacion", tiene_informe: false });
    expect(await estado(a.f.idExpediente)).toBe("en_observacion");
    const [intento] = await intentosDe(db(), a.f.idExpediente, "dictamen_en_observacion");
    expect(intento).toMatchObject({ estado_envio: "pendiente" });
    expect((await eventosTipo(a.f.idExpediente, "transicion_estado")).at(-1)!.detalle).toMatchObject({ id_notificacion: intento!.id_notificacion });
    expect(e.eventos.disparar).toHaveBeenCalledWith("agendamiento", { id_expediente: a.f.idExpediente, id_notificacion: intento!.id_notificacion });

    // El aviso va al buzón de admisión, solo con el código y el enlace a G03: sin requisitos ni conclusiones (C11).
    const aviso = await e.interno.aviso(a.f.idExpediente, { id_notificacion: intento!.id_notificacion });
    expect(aviso.status).toBe(201);
    expect(aviso.body.tipo_evento).toBe("dictamen_en_observacion");
    expect(aviso.body.cuerpo).toContain(`${FRONT()}/gestion/bandeja/${a.f.idExpediente}`);
    expect(aviso.body.asunto).toMatch(/ADM-/);
    for (const texto of [conclusiones, requisitos]) expect(JSON.stringify(aviso.body)).not.toContain(texto);
    const contacto = await e.interno.contacto(a.f.idExpediente, intento!.id_notificacion);
    expect(contacto.body).toEqual({ id_expediente: a.f.idExpediente, correo: CORREO_ADMISION(), autoriza_whatsapp: false });

    // Secretaría coordina con la familia: ve los requisitos en G03, nunca las conclusiones ni el informe (R3).
    const g03 = await e.api(e.secretaria.token).get(rutaRequisitos(a.f.idExpediente));
    expect(g03.status).toBe(200);
    expect(g03.body).toMatchObject({ id_expediente: a.f.idExpediente, requisitos_complementarios: requisitos });
    expect(JSON.stringify(g03.body)).not.toContain(conclusiones);
    expect(g03.body).not.toHaveProperty("conclusiones");
  });

  it("HU0010-2.0 (nuevo dictamen, D4a-A) desde en_observacion la psicóloga emite Apto: se actualiza la misma fila y el dictamen anterior se recupera y descifra desde la auditoría", async () => {
    const a = await enEvaluacion();
    const conclusiones = `Primera conclusión ${randomUUID()}`;
    const requisitos = `Sesión adicional ${randomUUID()}`;
    expect((await dictaminar(a.f.idExpediente, { dictamen: "en_observacion", conclusiones, requisitos_complementarios: requisitos }, { contenido: pdf("primer informe") })).status).toBe(201);
    const primera = (await filaDictamen(a.f.idExpediente))!;

    const g06 = await psicologa().get(rutaDictamen(a.f.idExpediente));
    expect(g06.body).toMatchObject({ estado: "en_observacion", habilitado: true, opciones: ["apto", "no_apto"], dictamen: { dictamen: "en_observacion", requisitos_complementarios: requisitos } });
    const otraObservacion = await dictaminar(a.f.idExpediente, { dictamen: "en_observacion", conclusiones: "C", requisitos_complementarios: "R" });
    expect(otraObservacion.status).toBe(409);
    expect(otraObservacion.body.error.codigo).toBe("DICTAMEN_YA_EMITIDO");

    const nuevas = `Conclusión final ${randomUUID()}`;
    const res = await dictaminar(a.f.idExpediente, { dictamen: "apto", conclusiones: nuevas });

    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body).toMatchObject({ estado: "apto", tiene_informe: true });
    const fila = (await filaDictamen(a.f.idExpediente))!;
    expect(fila).toMatchObject({ id_dictamen: primera.id_dictamen, dictamen: "apto", requisitos_complementarios: null, informe_url: primera.informe_url });
    expect(descifrar(fila.conclusiones!)).toBe(nuevas);
    expect((await eventosTipo(a.f.idExpediente, "transicion_estado")).at(-1)).toMatchObject({ estado_anterior: "en_observacion", estado_nuevo: "apto" });
    const fin = (await eventosTipo(a.f.idExpediente, "atencion_fin")).at(-1)!;
    const anterior = fin.detalle.dictamen_anterior;
    expect(anterior).toMatchObject({ dictamen: "en_observacion", informe_url: primera.informe_url });
    // Guardado ya cifrado (nunca en claro) y recuperable con la clave de la API.
    expect(JSON.stringify(fin.detalle)).not.toContain(conclusiones);
    expect(JSON.stringify(fin.detalle)).not.toContain(requisitos);
    expect(anterior.conclusiones).toMatch(/^v1:/);
    expect(descifrar(anterior.conclusiones)).toBe(conclusiones);
    expect(descifrar(anterior.requisitos_complementarios)).toBe(requisitos);
    // Secretaría ya no tiene requisitos por coordinar.
    expect((await e.api(e.secretaria.token).get(rutaRequisitos(a.f.idExpediente))).status).toBe(404);
  });

  it("HU0010-2.0 (D1) las observaciones de los resultados, las conclusiones y los requisitos complementarios se guardan cifrados: la BD no tiene el texto en claro", async () => {
    const a = await e.agendada();
    for (const c of a.citas) await iniciar(c.id_cita);
    const observacion = `Observación clínica ${randomUUID()}`;
    expect((await psicologa().post(`${rutaCitaG06(a.cita("evaluacion_psicologica"))}/resultado`, { resultado: "Adecuado", observaciones: observacion })).status).toBe(201);
    expect((await evaluador().post(`${rutaCitaG11(a.cita("evaluacion_academica"))}/resultado`, resultado())).status).toBe(201);
    expect((await psicologa().post(`${rutaCitaG06(a.cita("entrevista_padres"))}/resultado`, resultado())).status).toBe(201);
    const conclusiones = `Conclusión ${randomUUID()}`;
    const requisitos = `Requisito ${randomUUID()}`;
    expect((await dictaminar(a.f.idExpediente, { dictamen: "en_observacion", conclusiones, requisitos_complementarios: requisitos })).status).toBe(201);

    const res = (await filaResultado(a.cita("evaluacion_psicologica")))!;
    expect(res.resultado).toBe("Adecuado");
    expect(res.observaciones).toMatch(/^v1:/);
    expect(res.observaciones).not.toContain(observacion);
    expect(descifrar(res.observaciones!)).toBe(observacion);
    expect((await filaResultado(a.cita("evaluacion_academica")))!.observaciones).toMatch(/^v1:/);
    const fila = (await filaDictamen(a.f.idExpediente))!;
    for (const [guardado, claro] of [[fila.conclusiones, conclusiones], [fila.requisitos_complementarios, requisitos]] as const) {
      expect(guardado).toMatch(/^v1:/);
      expect(guardado).not.toContain(claro);
      expect(descifrar(guardado!)).toBe(claro);
    }
  });
});

describe("HU0010-3.0 registro de dictamen No apto", () => {
  it("HU0010-3.0 la psicóloga selecciona No apto y registra las conclusiones: el sistema cierra el expediente en no_apto, notifica a la familia sin el contenido del informe psicológico y concluye el proceso", async () => {
    const a = await enEvaluacion();
    const conclusiones = `No cumple el perfil ${randomUUID()}`;
    const observaciones = (await db().query<{ observaciones: string }>(
      "SELECT r.observaciones FROM resultado_evaluacion r JOIN cita c ON c.id_cita = r.id_cita WHERE c.id_expediente = $1",
      [a.f.idExpediente],
    )).rows.map((r) => descifrar(r.observaciones));

    const res = await dictaminar(a.f.idExpediente, { dictamen: "no_apto", conclusiones }, { contenido: pdf("informe no apto"), nombre: "informe_confidencial.pdf" });

    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(await estado(a.f.idExpediente)).toBe("no_apto");
    const [intento] = await intentosDe(db(), a.f.idExpediente, "dictamen_no_apto");
    expect(e.eventos.disparar).toHaveBeenCalledWith("agendamiento", { id_expediente: a.f.idExpediente, id_notificacion: intento!.id_notificacion });

    // Notifica a la familia, sin conclusiones, observaciones, requisitos ni el informe (C11).
    const aviso = await e.interno.aviso(a.f.idExpediente, { id_notificacion: intento!.id_notificacion });
    expect(aviso.status).toBe(201);
    expect(aviso.body.tipo_evento).toBe("dictamen_no_apto");
    expect(aviso.body.cuerpo).toContain("[Comunicación del resultado del proceso de admisión: por definir con el colegio]");
    const texto = JSON.stringify(aviso.body);
    for (const prohibido of [conclusiones, ...observaciones, "informe", "conclusi", "v1:"]) expect(texto.toLowerCase()).not.toContain(prohibido.toLowerCase());
    expect((await e.interno.contacto(a.f.idExpediente, intento!.id_notificacion)).body.correo).toBe(a.f.correo);

    // Concluye el proceso: no hay otro dictamen, ni resultados, ni reprogramaciones.
    const otro = await dictaminar(a.f.idExpediente, { dictamen: "apto", conclusiones: "C" });
    expect(otro.status).toBe(409);
    expect(otro.body.error.codigo).toBe("DICTAMEN_YA_EMITIDO");
    expect((await psicologa().get(rutaDictamen(a.f.idExpediente))).body).toMatchObject({ estado: "no_apto", habilitado: false, opciones: [] });
    const reprogramar = await e.familiaApi(a.f.token).post(rutaReprogramacion(a.f.idExpediente, a.cita("entrevista_padres")), {
      id_horario: await e.horario("entrevista_padres", { dias: a.t.dia + 1, inicio: "17:00", fin: "18:00" }),
    });
    expect(reprogramar.status).toBe(409);
  });

  it("HU0010-3.0 (D4d) con una cita de evaluación todavía reservada, No apto responde 409 CITAS_PENDIENTES y no cierra el expediente", async () => {
    const a = await e.agendada();
    // El grado deja de exigir la académica después de agendar (C25 7): esa cita sigue reservada.
    await e.configurar(a.f.idGrado, { psicologica: true });
    for (const tipo of ["evaluacion_psicologica", "entrevista_padres"] as const) {
      await iniciar(a.cita(tipo));
      expect((await psicologa().post(`${rutaCitaG06(a.cita(tipo))}/resultado`, resultado())).status).toBe(201);
    }

    const res = await dictaminar(a.f.idExpediente, { dictamen: "no_apto", conclusiones: "Conclusiones ficticias" });

    expect(res.status).toBe(409);
    expect(res.body.error).toMatchObject({ codigo: "CITAS_PENDIENTES", detalle: [{ id_cita: a.cita("evaluacion_academica") }] });
    expect(await estado(a.f.idExpediente)).toBe("en_evaluacion");
  });
});

describe("HU0021-2.0 [ruta real] informe psicológico en G06 y G11 (R3, C17)", () => {
  it("HU0021-2.0 [ruta real] el evaluador académico, Secretaría y Tesorería reciben 403 en la agenda, el dictamen y el informe de G06, y cada intento queda en acceso_denegado con recurso informe_psicologico", async () => {
    const a = await enEvaluacion();
    expect((await dictaminar(a.f.idExpediente, { dictamen: "apto", conclusiones: "C" }, { contenido: pdf() })).status).toBe(201);
    const intrusos = [
      { token: e.tokenEvaluador, idPersonal: e.evaluador },
      { token: e.secretaria.token, idPersonal: e.secretaria.idPersonal },
      { token: e.tesoreria.token, idPersonal: e.tesoreria.idPersonal },
    ];
    for (const intruso of intrusos) {
      const api = e.api(intruso.token);
      for (const [ruta, idExpediente] of [
        ["/psicologia/agenda?fecha=2027-01-15", null],
        [rutaCitaG06(a.cita("evaluacion_psicologica")), null],
        [rutaDictamen(a.f.idExpediente), a.f.idExpediente],
        [rutaInforme(a.f.idExpediente), a.f.idExpediente],
      ] as const) {
        const r = await api.get(ruta);
        expect(r.status, `${ruta}`).toBe(403);
        expect(r.body.error.codigo).toBe("ACCESO_DENEGADO");
        expect(JSON.stringify(r.body)).not.toContain("conclusiones");
        expect(await ultimoDenegado(intruso.idPersonal)).toMatchObject({ id_expediente: idExpediente, detalle: expect.objectContaining({ recurso: "informe_psicologico" }) });
      }
      const post = await dictaminar(a.f.idExpediente, { dictamen: "no_apto", conclusiones: "C" }, undefined, intruso.token);
      expect(post.status).toBe(403);
    }
    expect(await estado(a.f.idExpediente)).toBe("apto");
  });

  it("HU0021-2.0 [ruta real] G11 es solo del evaluador académico: Psicología, Secretaría y Tesorería reciben 403 auditado como acceso_denegado", async () => {
    const a = await e.agendada();
    for (const intruso of [
      { token: e.tokenPsicologa, idPersonal: e.psicologa },
      { token: e.secretaria.token, idPersonal: e.secretaria.idPersonal },
      { token: e.tesoreria.token, idPersonal: e.tesoreria.idPersonal },
    ]) {
      const r = await e.api(intruso.token).get(rutaCitaG11(a.cita("evaluacion_academica")));
      expect(r.status).toBe(403);
      expect(await ultimoDenegado(intruso.idPersonal)).toMatchObject({
        detalle: expect.objectContaining({ roles_requeridos: ["evaluador_academico"], ruta: rutaCitaG11(a.cita("evaluacion_academica")) }),
      });
    }
  });
});

describe("Tiempo de atención (ADR-05) en G06 y G11", () => {
  it("HU0025-1.0 (atención) abrir la cita en G11 registra atencion_inicio y registrar el resultado, atencion_fin con su id_evento_inicio", async () => {
    const a = await e.agendada();
    const idCita = a.cita("evaluacion_academica");
    await iniciar(idCita);
    await evaluador().get(rutaCitaG11(idCita));
    const inicio = (await eventosTipo(a.f.idExpediente, "atencion_inicio")).at(-1)!;
    expect(inicio).toMatchObject({ id_personal: e.evaluador, detalle: { item: { tipo: "cita", id: idCita } } });

    await evaluador().post(`${rutaCitaG11(idCita)}/resultado`, resultado());

    const fin = (await eventosTipo(a.f.idExpediente, "atencion_fin")).at(-1)!;
    expect(fin).toMatchObject({ id_personal: e.evaluador, detalle: { item: { tipo: "cita", id: idCita }, decision: "resultado", id_evento_inicio: Number(inicio.id_evento) } });
    // Ya registrada, abrirla otra vez no abre otro ítem.
    await evaluador().get(rutaCitaG11(idCita));
    expect(await eventosTipo(a.f.idExpediente, "atencion_inicio")).toHaveLength(1);
  });

  it("HU0010-1.0 [parte: dictamen, informe restringido y estado] (atención) abrir la cita y el dictamen en G06 registra atencion_inicio de cada ítem, y registrar el resultado y el dictamen registra su atencion_fin con id_evento_inicio", async () => {
    const a = await enEvaluacion(["evaluacion_academica", "evaluacion_psicologica"]);
    const entrevista = a.cita("entrevista_padres");
    await psicologa().get(rutaCitaG06(entrevista));
    const inicioCita = (await eventosTipo(a.f.idExpediente, "atencion_inicio")).filter((ev) => ev.detalle.item.tipo === "cita" && ev.detalle.item.id === entrevista).at(-1)!;
    await psicologa().post(`${rutaCitaG06(entrevista)}/resultado`, resultado());
    const finCita = (await eventosTipo(a.f.idExpediente, "atencion_fin")).at(-1)!;
    expect(finCita.detalle).toMatchObject({ item: { tipo: "cita", id: entrevista }, decision: "resultado", id_evento_inicio: Number(inicioCita.id_evento) });

    await psicologa().get(`${rutaDictamen(a.f.idExpediente)}?abrir=1`);
    const inicioDictamen = (await eventosTipo(a.f.idExpediente, "atencion_inicio")).at(-1)!;
    expect(inicioDictamen.detalle).toEqual({ item: { tipo: "dictamen", id: a.f.idExpediente } });
    expect((await dictaminar(a.f.idExpediente, { dictamen: "apto", conclusiones: "Conclusiones ficticias" })).status).toBe(201);
    const finDictamen = (await eventosTipo(a.f.idExpediente, "atencion_fin")).at(-1)!;
    expect(finDictamen).toMatchObject({
      id_personal: e.psicologa,
      detalle: { item: { tipo: "dictamen", id: a.f.idExpediente }, decision: "apto", id_evento_inicio: Number(inicioDictamen.id_evento) },
    });
  });
});

describe("Inicio del dictamen (ADR-05, cycle time de HU0019)", () => {
  it("HU0010-1.0 [parte: dictamen, informe restringido y estado] (atención) abrir una cita no crea un inicio del dictamen: solo el panel lo crea, y el atencion_fin se empareja con ese inicio", async () => {
    const a = await enEvaluacion();
    const iniciosDictamen = async () => (await eventosTipo(a.f.idExpediente, "atencion_inicio")).filter((ev) => ev.detalle.item.tipo === "dictamen");

    // Abrir una cita y leer el dictamen sin abrir el panel no abren el ítem.
    await psicologa().get(rutaCitaG06(a.cita("entrevista_padres")));
    expect((await psicologa().get(rutaDictamen(a.f.idExpediente))).body.habilitado).toBe(true);
    expect(await iniciosDictamen()).toHaveLength(0);

    await psicologa().get(`${rutaDictamen(a.f.idExpediente)}?abrir=1`);
    const [inicio] = await iniciosDictamen();
    expect(await iniciosDictamen()).toHaveLength(1);

    expect((await dictaminar(a.f.idExpediente, { dictamen: "en_observacion", conclusiones: "C", requisitos_complementarios: "R" })).status).toBe(201);
    const fin = (await eventosTipo(a.f.idExpediente, "atencion_fin")).at(-1)!;
    expect(fin.detalle).toMatchObject({ item: { tipo: "dictamen", id: a.f.idExpediente }, decision: "en_observacion", id_evento_inicio: Number(inicio!.id_evento) });

    // La recarga después de guardar tampoco abre otro; el nuevo dictamen se mide desde su propia apertura.
    await psicologa().get(rutaDictamen(a.f.idExpediente));
    expect(await iniciosDictamen()).toHaveLength(1);
    await psicologa().get(`${rutaDictamen(a.f.idExpediente)}?abrir=1`);
    const segundo = (await iniciosDictamen()).at(-1)!;
    expect((await dictaminar(a.f.idExpediente, { dictamen: "apto", conclusiones: "C2" })).status).toBe(201);
    expect((await eventosTipo(a.f.idExpediente, "atencion_fin")).at(-1)!.detalle).toMatchObject({ decision: "apto", id_evento_inicio: Number(segundo.id_evento) });
    expect((await psicologa().get(`${rutaDictamen(a.f.idExpediente)}?abrir=2`)).status).toBe(400);
  });
});

describe("C22 cuentas activas en G06 y G11", () => {
  it("C22 una psicóloga o un evaluador académico desactivado recibe 403 ACCESO_DENEGADO aunque su token tenga el rol", async () => {
    for (const rol of ["psicologa", "evaluador_academico"] as const) {
      const sub = randomUUID();
      const id = await crearPersonal(db(), rol, sub);
      const api = e.api(await firmante.token(sub, [rol]));
      const ruta = rol === "psicologa" ? "/psicologia/agenda?fecha=2027-01-15" : "/evaluacion-academica/agenda?fecha=2027-01-15";
      expect((await api.get(ruta)).status).toBe(200);
      await db().query("UPDATE personal SET activo = false WHERE id_personal = $1", [id]);
      const r = await api.get(ruta);
      expect(r.status).toBe(403);
      expect(r.body.error.codigo).toBe("ACCESO_DENEGADO");
    }
  });
});
