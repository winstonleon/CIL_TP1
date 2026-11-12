// Seguimiento programado (HU0018, R20 y R21; plan del bloque 11) por /internal/* y por P04: recordatorio por inactividad y
// caducidad por vencimiento del plazo de la etapa. El paso del tiempo se simula con eventos de la bitácora fechados en el
// pasado (la bitácora admite INSERT) y moviendo la fecha de una fila de intento, solo en los datos de cada prueba.
// Datos ficticios @ejemplo.test; n8n se simula.
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { variablesInvalidas } from "../src/config";
import { cerrarPool, obtenerPool } from "../src/db/pool";
import { crearFirmante, eventosDe, unico } from "./ayudantes";
import { entornoAdjudicacion, rutaModalidad } from "./ayudantesAdjudicacion";
import { pdf, rutaDocumentos, subir } from "./ayudantesCarga";
import { fichaCompleta, rutaFicha } from "./ayudantesFicha";
import { rutaEvaluaciones } from "./ayudantesEvaluacion";
import { TOKEN_INTERNO } from "./ayudantesValidacion";
import { estadoDe, intentadaHace, intentosDe } from "./ayudantesVisita";

const db = () => obtenerPool();
let e: Awaited<ReturnType<typeof entornoAdjudicacion>>;

beforeAll(async () => {
  e = await entornoAdjudicacion(db(), await crearFirmante());
});
afterAll(cerrarPool);

const DIA = 24;
const interno = {
  get: (ruta: string) => request(e.app).get(ruta).set("Authorization", `Bearer ${TOKEN_INTERNO()}`),
  post: (ruta: string, cuerpo: object = {}) => request(e.app).post(ruta).set("Authorization", `Bearer ${TOKEN_INTERNO()}`).send(cuerpo),
  patch: (ruta: string, cuerpo: object) => request(e.app).patch(ruta).set("Authorization", `Bearer ${TOKEN_INTERNO()}`).send(cuerpo),
};
const pendientes = async () => {
  const res = await interno.get("/internal/seguimiento/pendientes");
  expect(res.status).toBe(200);
  const ids = (l: { id_expediente: number }[]) => l.map((x) => x.id_expediente);
  return { caducidades: ids(res.body.caducidades), recordatorios: ids(res.body.recordatorios) };
};
const retomas = async () => (await interno.get("/internal/seguimiento/avisos-pendientes")).body.avisos as { id_expediente: number; tipo_evento: string }[];
const recordar = (id: number) => interno.post(`/internal/expedientes/${id}/recordatorio-inactividad`);
const caducar = (id: number) => interno.post(`/internal/expedientes/${id}/caducidad`);

// Un evento de la bitácora fechado hace `horas` (simula el paso del tiempo).
async function evento(idExpediente: number, tipo: string, horas: number, o: { anterior?: string; nuevo?: string; detalle?: object; idPersonal?: number } = {}) {
  const { rows } = await db().query<{ fecha_hora: Date }>(
    `INSERT INTO registro_auditoria (id_expediente, id_personal, tipo_evento, estado_anterior, estado_nuevo, detalle, fecha_hora)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb, now() - make_interval(hours => $7)) RETURNING fecha_hora`,
    [idExpediente, o.idPersonal ?? null, tipo, o.anterior ?? null, o.nuevo ?? null, JSON.stringify(o.detalle ?? {}), horas],
  );
  return rows[0]!.fecha_hora;
}
const transicion = (id: number, anterior: string, nuevo: string, horas: number) => evento(id, "transicion_estado", horas, { anterior, nuevo, detalle: { campo: "estado" } });
const fin = (id: number, horas: number, detalle: object) => evento(id, "atencion_fin", horas, { idPersonal: e.secretaria.idPersonal, detalle: { id_evento_inicio: null, ...detalle } });

const fechaLima = (d: Date) => new Intl.DateTimeFormat("es-PE", { timeZone: "America/Lima", day: "2-digit", month: "2-digit", year: "numeric" }).format(d);
const masDias = (d: Date, dias: number) => new Date(d.getTime() + dias * DIA * 3600_000);

// Familias en cada etapa con su ancla fechada hace `horas`.
async function enPostulacion(horas: number) {
  const f = await e.familia("portal_habilitado");
  const ancla = await transicion(f.idExpediente, "visita_agendada", "portal_habilitado", horas);
  return { f, ancla };
}
async function enSubsanacion(horas: number) {
  const f = await e.familia("en_validacion");
  await db().query("UPDATE expediente SET estado_documental = 'observado' WHERE id_expediente = $1", [f.idExpediente]);
  const ancla = await fin(f.idExpediente, horas, { item: { tipo: "validacion_documental", id: f.idExpediente }, decision: "observado" });
  return { f, ancla };
}
async function enAgendamiento(horas: number) {
  const f = await e.habilitada();
  const ancla = await fin(f.idExpediente, horas, { item: { tipo: "validacion_documental", id: f.idExpediente }, decision: "conforme", habilita_agendamiento: true });
  return { f, ancla };
}
async function enReprogramacion(horas: number) {
  const a = await e.agendada();
  await db().query("UPDATE cita SET estado = 'no_asistio' WHERE id_cita = $1", [a.cita("evaluacion_academica")]);
  // La fixture agenda ahora: la entrada a en_evaluacion se fecha antes de la inasistencia, como en el trámite real.
  await transicion(a.f.idExpediente, "en_validacion", "en_evaluacion", horas + 1);
  const ancla = await evento(a.f.idExpediente, "atencion_fin", horas, {
    idPersonal: e.evaluador,
    detalle: { item: { tipo: "cita", id: a.cita("evaluacion_academica") }, decision: "inasistencia", id_evento_inicio: null },
  });
  return { f: a.f, ancla, a };
}
async function enCuota(horas: number) {
  const f = await e.conVacante();
  const ancla = await transicion(f.idExpediente, "apto", "vacante_asignada", horas);
  return { f, ancla };
}
const disponibles = async (idGrado: number) =>
  (await db().query<{ autorizadas: number; disponibles: number }>("SELECT vacantes_autorizadas AS autorizadas, vacantes_disponibles AS disponibles FROM grado WHERE id_grado = $1", [idGrado])).rows[0]!;
// C25 (2): adjudicadas = expedientes del grado en vacante_asignada o carta_emitida.
async function identidadC25(idGrado: number) {
  const g = await disponibles(idGrado);
  const { rows } = await db().query<{ n: number }>("SELECT count(*)::int AS n FROM expediente WHERE id_grado = $1 AND estado IN ('vacante_asignada', 'carta_emitida')", [idGrado]);
  return { adjudicadas: g.autorizadas - g.disponibles, expedientes: rows[0]!.n };
}
const gradoDe = async (idExpediente: number) => (await db().query<{ id_grado: number }>("SELECT id_grado FROM expediente WHERE id_expediente = $1", [idExpediente])).rows[0]!.id_grado;

describe("HU0018-1.0 envío de recordatorio por inactividad de la familia", () => {
  it("HU0018-1.0 [parte: correo] con 48 h sin interacción en la postulación, la revisión diaria lo toma y el recordatorio lleva la acción pendiente, la fecha límite de la etapa y el enlace a su expediente", async () => {
    const { f, ancla } = await enPostulacion(49);

    expect((await pendientes()).recordatorios).toContain(f.idExpediente);
    const res = await recordar(f.idExpediente);

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ id_expediente: f.idExpediente, tipo_evento: "recordatorio_48h" });
    expect(res.body.asunto).toBe(`Tienes una acción pendiente · Admisión ${e.campana}`);
    const lineas = (res.body.cuerpo as string).split("\n");
    expect(lineas[0]).toBe("Hola, María Fernanda:");
    expect(lineas).toContain("Acción pendiente: completar la ficha de inscripción, cargar tus documentos y registrar el derecho de admisión.");
    expect(lineas).toContain(`Fecha límite: ${fechaLima(masDias(ancla, 15))}. Si vence sin completarla, tu postulación caducará.`);
    expect(lineas).toContain(`Tu expediente: ${process.env.FRONTEND_PUBLIC_URL!.replace(/\/+$/, "")}/portal/panel`);
    expect(await intentosDe(db(), f.idExpediente, "recordatorio_48h")).toEqual([
      { id_notificacion: res.body.id_notificacion, tipo_evento: "recordatorio_48h", estado_envio: "pendiente" },
    ]);
    // «Registra el envío en el historial»: la fila de notificacion (R20), no un evento nuevo de la bitácora.
    expect((await eventosDe(db(), f.idExpediente)).map((x) => x.tipo_evento)).toEqual(["transicion_estado"]);
  });

  it("HU0018-1.0 [parte: correo] con 47 h sin interacción todavía no se envía: la revisión no lo toma y la reserva responde 409 RECORDATORIO_NO_CORRESPONDE", async () => {
    const { f } = await enPostulacion(47);

    expect((await pendientes()).recordatorios).not.toContain(f.idExpediente);
    const res = await recordar(f.idExpediente);
    expect(res.status).toBe(409);
    expect(res.body.error.codigo).toBe("RECORDATORIO_NO_CORRESPONDE");
    expect(await intentosDe(db(), f.idExpediente)).toEqual([]);
  });

  it("HU0018-1.0 [parte: correo] (interacción, D3-A) una carga de documento, el guardado del cuestionario o un evento de la familia en las últimas 48 h aplazan el recordatorio", async () => {
    // Carga de un documento (P06): la fila de documento con su fecha_carga, como la deja la carga.
    const conCarga = await enPostulacion(72);
    const { rows } = await db().query<{ id_requisito: number }>(
      "INSERT INTO requisito_documental (id_grado, tipo_documento, categoria) VALUES ($1, $2, 'postulante_y_padres') RETURNING id_requisito",
      [conCarga.f.idGrado, `Partida ${unico()}`],
    );
    await db().query(
      "INSERT INTO documento (id_expediente, id_requisito, url_archivo, formato, tamano_kb) VALUES ($1, $2, $3, 'pdf', 1)",
      [conCarga.f.idExpediente, rows[0]!.id_requisito, `clave-${unico()}`],
    );

    // Guardado del cuestionario (autoguardado de P05) por la ruta real, ya en en_postulacion (sin transición nueva).
    const conBorrador = { f: await e.familia("en_postulacion") };
    await transicion(conBorrador.f.idExpediente, "visita_agendada", "portal_habilitado", 72);
    const guardado = await e.como(conBorrador.f.token).guardar(rutaFicha(conBorrador.f.idExpediente), { ...fichaCompleta(), modo: "borrador" });
    expect(guardado.status).toBe(200);
    expect((await eventosDe(db(), conBorrador.f.idExpediente)).map((x) => x.tipo_evento)).toEqual(["transicion_estado"]);

    // Un evento de la familia en la bitácora (P06, «Confirmar documentos»).
    const conEvento = await enPostulacion(72);
    await evento(conEvento.f.idExpediente, "documentos_confirmados", 10, { detalle: { documentos_vigentes: 1 } });

    // Abrir el portal no deja rastro (C24): sin interacción registrada, uno de la misma antigüedad sí entra.
    const sinInteraccion = await enPostulacion(72);
    const lista = (await pendientes()).recordatorios;
    for (const id of [conCarga.f.idExpediente, conBorrador.f.idExpediente, conEvento.f.idExpediente]) {
      expect(lista).not.toContain(id);
      expect((await recordar(id)).body.error.codigo).toBe("RECORDATORIO_NO_CORRESPONDE");
    }
    expect(lista).toContain(sinInteraccion.f.idExpediente);
  });

  it("HU0018-1.0 [parte: correo] (etapas) la subsanación, el agendamiento, la reprogramación de la académica y la cuota toman su ancla y su acción pendiente", async () => {
    const casos = [
      { x: await enSubsanacion(50), plazo: 7, accion: "subsanar las observaciones de tu expediente" },
      { x: await enAgendamiento(50), plazo: 7, accion: "agendar tus evaluaciones" },
      { x: await enReprogramacion(50), plazo: 7, accion: "reprogramar tu evaluación académica" },
      { x: await enCuota(50), plazo: 7, accion: "registrar el comprobante de la cuota de ingreso" },
    ];
    const lista = (await pendientes()).recordatorios;
    for (const { x, plazo, accion } of casos) {
      expect(lista).toContain(x.f.idExpediente);
      const res = await recordar(x.f.idExpediente);
      expect(res.status).toBe(201);
      expect(res.body.cuerpo).toContain(`Acción pendiente: ${accion}.`);
      expect(res.body.cuerpo).toContain(`Fecha límite: ${fechaLima(masDias(x.ancla, plazo))}.`);
    }
  });

  it("HU0018-1.0 [parte: correo] (sin acción de la familia) un expediente que espera al colegio no recibe recordatorio: en revisión sin observaciones, apto o con la cuota en conciliación", async () => {
    const revision = await e.familia("en_validacion");
    await fin(revision.idExpediente, 100, { item: { tipo: "validacion_documental", id: revision.idExpediente }, decision: "conforme" });
    const apto = await e.apto();
    await transicion(apto.idExpediente, "en_evaluacion", "apto", 100);
    const conciliacion = (await e.enConciliacion()).f;
    await transicion(conciliacion.idExpediente, "apto", "vacante_asignada", 100);

    const p = await pendientes();
    for (const id of [revision.idExpediente, apto.idExpediente, conciliacion.idExpediente]) {
      expect(p.recordatorios).not.toContain(id);
      expect(p.caducidades).not.toContain(id);
    }
  });

  it("HU0018-1.0 [parte: correo] (idempotencia) un solo recordatorio por etapa: dos revisiones no lo repiten, y una observación nueva abre otro período", async () => {
    const { f } = await enSubsanacion(100);
    const primero = await recordar(f.idExpediente);
    expect(primero.status).toBe(201);

    // La segunda revisión del día (o el webhook y el barrido a la vez): en curso.
    expect((await pendientes()).recordatorios).not.toContain(f.idExpediente);
    expect((await recordar(f.idExpediente)).body.error.codigo).toBe("RECORDATORIO_YA_REGISTRADO");
    expect((await interno.patch(`/internal/notificaciones/${primero.body.id_notificacion}`, { estado_envio: "enviado" })).status).toBe(200);
    expect((await recordar(f.idExpediente)).body.error.codigo).toBe("RECORDATORIO_YA_REGISTRADO");

    // Una observación nueva (hace 60 h, después del recordatorio) es otro período.
    await intentadaHace(db(), primero.body.id_notificacion, 90 * 60);
    await fin(f.idExpediente, 60, { item: { tipo: "documentacion_financiera", id: f.idExpediente }, decision: "observado" });
    expect((await pendientes()).recordatorios).toContain(f.idExpediente);
    expect((await recordar(f.idExpediente)).status).toBe(201);
    expect((await intentosDe(db(), f.idExpediente, "recordatorio_48h")).map((i) => i.estado_envio)).toEqual(["enviado", "pendiente"]);
  });

  it("HU0018-1.0 [parte: correo] (retoma, ADR-07) un intento pendiente de más de 10 min vuelve por el barrido de cada minuto con otra fila; con 6 intentos se cierra con la fila fallido y 409 AVISO_AGOTADO", async () => {
    const { f } = await enPostulacion(60);
    let ultimo = (await recordar(f.idExpediente)).body.id_notificacion as number;
    expect(await retomas()).not.toContainEqual({ id_expediente: f.idExpediente, tipo_evento: "recordatorio_48h" });

    for (let i = 2; i <= 6; i++) {
      await intentadaHace(db(), ultimo, 11);
      expect(await retomas()).toContainEqual({ id_expediente: f.idExpediente, tipo_evento: "recordatorio_48h" });
      const r = await interno.post(`/internal/expedientes/${f.idExpediente}/aviso-seguimiento`, { tipo_evento: "recordatorio_48h" });
      expect(r.status).toBe(201);
      ultimo = r.body.id_notificacion;
    }
    await intentadaHace(db(), ultimo, 11);
    const agotado = await interno.post(`/internal/expedientes/${f.idExpediente}/aviso-seguimiento`, { tipo_evento: "recordatorio_48h" });
    expect(agotado.status).toBe(409);
    expect(agotado.body.error.codigo).toBe("AVISO_AGOTADO");
    const filas = await intentosDe(db(), f.idExpediente, "recordatorio_48h");
    expect(filas.map((x) => x.estado_envio)).toEqual([...Array(6).fill("pendiente"), "fallido"]);
    expect(await retomas()).not.toContainEqual({ id_expediente: f.idExpediente, tipo_evento: "recordatorio_48h" });
    expect((await pendientes()).recordatorios).not.toContain(f.idExpediente);
  });

  it("HU0018-1.0 [parte: correo] (validación) las rutas internas exigen el token de servicio, no aceptan cuerpo y validan el tipo del aviso", async () => {
    const { f } = await enPostulacion(60);
    expect((await request(e.app).get("/internal/seguimiento/pendientes")).status).toBe(401);
    expect((await request(e.app).post(`/internal/expedientes/${f.idExpediente}/recordatorio-inactividad`).set("Authorization", `Bearer ${f.token}`)).status).toBe(401);
    expect((await interno.post(`/internal/expedientes/${f.idExpediente}/recordatorio-inactividad`, { id_expediente: 1 })).status).toBe(400);
    expect((await interno.post(`/internal/expedientes/${f.idExpediente}/aviso-seguimiento`, { tipo_evento: "carta_emitida" })).status).toBe(400);
    expect((await recordar(2147483000)).status).toBe(404);
  });
});

describe("HU0018-2.0 expiración de postulación por vencimiento del plazo de la etapa", () => {
  it("HU0018-2.0 al vencer el plazo de la postulación el expediente pasa a caducado con su transición en la bitácora y se notifica a los padres y al personal de admisión", async () => {
    const { f, ancla } = await enPostulacion(15 * DIA + 1);

    const p = await pendientes();
    expect(p.caducidades).toContain(f.idExpediente);
    expect(p.recordatorios).not.toContain(f.idExpediente);
    const res = await caducar(f.idExpediente);

    expect(res.status).toBe(201);
    expect(await estadoDe(db(), f.idExpediente)).toBe("caducado");
    const [familia, admision] = res.body.avisos;
    expect(familia).toMatchObject({ id_expediente: f.idExpediente, tipo_evento: "expediente_caducado", asunto: `Postulación caducada · Admisión ${e.campana}` });
    expect(familia.cuerpo).toContain(`Venció el plazo para completar la ficha de inscripción, cargar tus documentos y registrar el derecho de admisión (${fechaLima(masDias(ancla, 15))}).`);
    const codigo = `ADM-${e.campana}-${String(f.idExpediente).padStart(4, "0")}`;
    expect(admision).toMatchObject({ tipo_evento: "expediente_caducado_admision", asunto: `Expediente caducado ${codigo} · Admisión ${e.campana}` });
    expect(admision.cuerpo).not.toContain("María Fernanda");

    const t = (await eventosDe(db(), f.idExpediente)).at(-1)!;
    expect(t).toMatchObject({ tipo_evento: "transicion_estado", estado_anterior: "portal_habilitado", estado_nuevo: "caducado", id_personal: null });
    expect(t.detalle).toEqual({
      campo: "estado",
      motivo: "plazo_vencido",
      etapa: "postulacion",
      plazo_dias: 15,
      vence: masDias(ancla, 15).toISOString(),
      vacante_devuelta: false,
      citas_canceladas: [],
      citas_con_cupo_devuelto: [],
      id_notificacion: familia.id_notificacion,
      id_notificacion_admision: admision.id_notificacion,
    });
    // Contactos: la familia y el buzón de admisión (CORREO_ADMISION), sin WhatsApp para el personal.
    const contacto = (id: number) => interno.get(`/internal/expedientes/${f.idExpediente}/contacto?id_notificacion=${id}`);
    expect((await contacto(familia.id_notificacion)).body).toMatchObject({ correo: f.correo });
    expect((await contacto(admision.id_notificacion)).body).toEqual({ id_expediente: f.idExpediente, correo: "admision@ejemplo.test", autoriza_whatsapp: false });
    expect((await pendientes()).caducidades).not.toContain(f.idExpediente);
  });

  it("HU0018-2.0 con un día menos del plazo no caduca: recibe el recordatorio y la caducidad responde 409 CADUCIDAD_NO_CORRESPONDE", async () => {
    const { f } = await enPostulacion(14 * DIA);
    const p = await pendientes();
    expect(p.caducidades).not.toContain(f.idExpediente);
    expect(p.recordatorios).toContain(f.idExpediente);
    const res = await caducar(f.idExpediente);
    expect(res.status).toBe(409);
    expect(res.body.error.codigo).toBe("CADUCIDAD_NO_CORRESPONDE");
    expect(await estadoDe(db(), f.idExpediente)).toBe("portal_habilitado");
  });

  it("HU0018-2.0 (vacante, C25) al caducar en la cuota se devuelve la vacante con la fila del grado bloqueada, y autorizadas − disponibles sigue igual a los expedientes con vacante o carta", async () => {
    const { f } = await enCuota(8 * DIA);
    const idGrado = await gradoDe(f.idExpediente);
    const antes = await disponibles(idGrado);
    expect(await identidadC25(idGrado)).toEqual({ adjudicadas: 1, expedientes: 1 });

    const res = await caducar(f.idExpediente);

    expect(res.status).toBe(201);
    expect((await disponibles(idGrado)).disponibles).toBe(antes.disponibles + 1);
    expect(await identidadC25(idGrado)).toEqual({ adjudicadas: 0, expedientes: 0 });
    expect((await eventosDe(db(), f.idExpediente)).at(-1)!.detalle).toMatchObject({ etapa: "cuota", vacante_devuelta: true });
    // La cuota del expediente caducado ya no se puede elegir ni registrar.
    expect((await e.familiaApi(f.token).post(rutaModalidad(f.idExpediente), { modalidad: "unico" })).status).toBe(409);
  });

  it("HU0018-2.0 (concurrencia, C25 punto 1) caducar y adjudicar a la vez en el mismo grado: cada operación bloquea la fila del grado y la identidad de las adjudicadas se mantiene", async () => {
    const idGrado = await e.grado({ autorizadas: 2 });
    const conVacante = await e.apto(idGrado);
    expect((await e.direccion().post(`/direccion/expedientes/${conVacante.idExpediente}/adjudicacion`)).body.resultado).toBe("vacante_asignada");
    await transicion(conVacante.idExpediente, "apto", "vacante_asignada", 8 * DIA);
    const segundo = await e.apto(idGrado);
    const tercero = await e.apto(idGrado);

    const [c, a1, a2] = await Promise.all([
      caducar(conVacante.idExpediente),
      e.direccion().post(`/direccion/expedientes/${segundo.idExpediente}/adjudicacion`),
      e.direccion().post(`/direccion/expedientes/${tercero.idExpediente}/adjudicacion`),
    ]);

    expect(c.status).toBe(201);
    expect([a1.body.resultado, a2.body.resultado].sort()).toEqual(["vacante_asignada", "vacante_asignada"]);
    expect(await identidadC25(idGrado)).toEqual({ adjudicadas: 2, expedientes: 2 });
    expect((await disponibles(idGrado)).disponibles).toBe(0);
  });

  it("HU0018-2.0 (idempotencia) dos caducidades a la vez dejan una transición, una sola devolución de la vacante y un par de avisos; la segunda responde 409", async () => {
    const { f } = await enCuota(8 * DIA);
    const idGrado = await gradoDe(f.idExpediente);
    const antes = await disponibles(idGrado);

    const r = await Promise.all([caducar(f.idExpediente), caducar(f.idExpediente)]);

    expect(r.map((x) => x.status).sort()).toEqual([201, 409]);
    expect(r.find((x) => x.status === 409)!.body.error.codigo).toBe("CADUCIDAD_NO_CORRESPONDE");
    expect((await disponibles(idGrado)).disponibles).toBe(antes.disponibles + 1);
    expect((await eventosDe(db(), f.idExpediente)).filter((x) => x.estado_nuevo === "caducado")).toHaveLength(1);
    expect((await intentosDe(db(), f.idExpediente)).filter((x) => x.tipo_evento.startsWith("expediente_caducado"))).toHaveLength(2);
  });

  it("HU0018-2.0 (citas) al caducar sin reprogramar la académica se cancelan las citas reservadas y se liberan los cupos de los turnos futuros", async () => {
    const { f, a } = await enReprogramacion(8 * DIA);
    const turnos = [a.t.evaluacion_psicologica, a.t.entrevista_padres];
    const cupos = async () => (await db().query<{ cupos: number }>("SELECT cupos FROM horario_disponible WHERE id_horario = ANY($1::int[]) ORDER BY id_horario", [turnos])).rows.map((x) => x.cupos);
    expect(await cupos()).toEqual([0, 0]);

    const res = await caducar(f.idExpediente);

    expect(res.status).toBe(201);
    const { rows } = await db().query<{ tipo_cita: string; estado: string }>("SELECT tipo_cita::text, estado::text FROM cita WHERE id_expediente = $1 ORDER BY id_cita", [f.idExpediente]);
    expect(Object.fromEntries(rows.map((x) => [x.tipo_cita, x.estado]))).toEqual({
      evaluacion_academica: "no_asistio",
      evaluacion_psicologica: "cancelada",
      entrevista_padres: "cancelada",
    });
    expect(await cupos()).toEqual([1, 1]);
    const detalle = (await eventosDe(db(), f.idExpediente)).at(-1)!.detalle;
    expect(detalle).toMatchObject({ etapa: "reprogramacion", citas_canceladas: [a.cita("evaluacion_psicologica"), a.cita("entrevista_padres")].sort((x, y) => x - y) });
    expect(detalle.citas_con_cupo_devuelto).toHaveLength(2);
  });

  it("HU0018-2.0 (citas) una cita reservada cuyo turno ya pasó se cancela sin devolver el cupo", async () => {
    const { f, a } = await enReprogramacion(8 * DIA);
    const pasada = a.cita("evaluacion_psicologica");
    await db().query("UPDATE cita SET fecha_hora = now() - interval '2 hours' WHERE id_cita = $1", [pasada]);

    expect((await caducar(f.idExpediente)).status).toBe(201);

    const cupo = (await db().query<{ cupos: number }>("SELECT cupos FROM horario_disponible WHERE id_horario = $1", [a.t.evaluacion_psicologica])).rows[0]!.cupos;
    expect(cupo).toBe(0);
    expect((await eventosDe(db(), f.idExpediente)).at(-1)!.detalle.citas_con_cupo_devuelto).toEqual([a.cita("entrevista_padres")]);
  });

  it("HU0018-2.0 (etapas) la subsanación y el agendamiento caducan a los 7 días de su ancla", async () => {
    const sub = await enSubsanacion(7 * DIA + 1);
    const agenda = await enAgendamiento(7 * DIA + 1);
    const casi = await enSubsanacion(7 * DIA - 1);
    const p = await pendientes();
    expect(p.caducidades).toEqual(expect.arrayContaining([sub.f.idExpediente, agenda.f.idExpediente]));
    expect(p.caducidades).not.toContain(casi.f.idExpediente);
    for (const x of [sub, agenda]) expect((await caducar(x.f.idExpediente)).status).toBe(201);
    expect((await eventosDe(db(), agenda.f.idExpediente)).at(-1)).toMatchObject({ estado_anterior: "en_validacion", estado_nuevo: "caducado" });
  });

  it("HU0018-2.0 (fallo) si algo falla dentro de la caducidad no queda nada: ni la vacante devuelta, ni las citas canceladas, ni la transición, ni los avisos", async () => {
    const { f } = await enCuota(8 * DIA);
    const idGrado = await gradoDe(f.idExpediente);
    // Dato inconsistente a propósito: con todas las disponibles, devolver una más viola ck_grado_vacantes.
    await db().query("UPDATE grado SET vacantes_disponibles = vacantes_autorizadas WHERE id_grado = $1", [idGrado]);
    const eventosAntes = (await eventosDe(db(), f.idExpediente)).length;

    const res = await caducar(f.idExpediente);

    expect(res.status).toBe(500);
    expect(await estadoDe(db(), f.idExpediente)).toBe("vacante_asignada");
    expect((await eventosDe(db(), f.idExpediente)).length).toBe(eventosAntes);
    expect(await intentosDe(db(), f.idExpediente)).toEqual(expect.not.arrayContaining([expect.objectContaining({ tipo_evento: "expediente_caducado" })]));
    expect((await disponibles(idGrado)).disponibles).toBe((await disponibles(idGrado)).autorizadas);
  });

  it("HU0018-2.0 (retoma, ADR-07) los avisos de la caducidad pendientes de más de 10 min vuelven por el barrido de cada minuto, cada uno con su fila", async () => {
    const { f } = await enPostulacion(16 * DIA);
    const { avisos } = (await caducar(f.idExpediente)).body as { avisos: { id_notificacion: number; tipo_evento: string }[] };
    for (const a of avisos) await intentadaHace(db(), a.id_notificacion, 11);

    expect(await retomas()).toEqual(
      expect.arrayContaining([
        { id_expediente: f.idExpediente, tipo_evento: "expediente_caducado" },
        { id_expediente: f.idExpediente, tipo_evento: "expediente_caducado_admision" },
      ]),
    );
    const r = await interno.post(`/internal/expedientes/${f.idExpediente}/aviso-seguimiento`, { tipo_evento: "expediente_caducado_admision" });
    expect(r.status).toBe(201);
    expect(r.body.asunto).toContain("Expediente caducado");
    expect((await interno.post(`/internal/expedientes/${f.idExpediente}/aviso-seguimiento`, { tipo_evento: "expediente_caducado_admision" })).body.error.codigo).toBe("AVISO_NO_CORRESPONDE");
    // Sin caducidad, el aviso no existe.
    const otro = await enPostulacion(10);
    expect((await interno.post(`/internal/expedientes/${otro.f.idExpediente}/aviso-seguimiento`, { tipo_evento: "expediente_caducado" })).body.error.codigo).toBe("AVISO_NO_CORRESPONDE");
  });

  it("HU0018-2.0 (barridos) ningún otro barrido toma un expediente caducado: ni la observación pendiente, ni los avisos de las evaluaciones, ni la carta, ni la completitud", async () => {
    const { f } = await enSubsanacion(8 * DIA);
    const { rows } = await db().query<{ id_notificacion: number }>(
      "INSERT INTO notificacion (id_expediente, canal, tipo_evento, estado_envio, fecha_envio) VALUES ($1, 'correo', 'subsanacion_solicitada', 'pendiente', now() - interval '20 minutes') RETURNING id_notificacion",
      [f.idExpediente],
    );
    await fin(f.idExpediente, 8 * DIA - 1, { item: { tipo: "validacion_documental", id: f.idExpediente }, decision: "observado", id_notificacion: rows[0]!.id_notificacion });
    await fin(f.idExpediente, 7 * DIA + 1, { item: { tipo: "validacion_documental", id: f.idExpediente }, decision: "observado" });
    expect((await caducar(f.idExpediente)).status).toBe(201);

    for (const ruta of [
      "/internal/observaciones/pendientes",
      "/internal/evaluaciones/avisos-pendientes",
      "/internal/cartas/pendientes",
      "/internal/completitud/pendientes",
      "/internal/seguimiento/pendientes",
    ]) {
      const cuerpo = JSON.stringify((await interno.get(ruta)).body);
      expect(cuerpo, ruta).not.toMatch(new RegExp(`"id_expediente":${f.idExpediente}[,}]`));
    }
  });

  it("HU0018-2.0 (C78) P04 de un expediente caducado conserva el avance que tenía, no ofrece acciones ni «Subsanar», dice cuándo caducó y qué venció, y lo agrega al historial", async () => {
    const { f } = await enSubsanacion(8 * DIA);
    await db().query("UPDATE expediente SET estado_financiero = 'conforme' WHERE id_expediente = $1", [f.idExpediente]);
    const antes = await e.familiaApi(f.token).get(`/familia/expedientes/${f.idExpediente}/panel`);
    expect(antes.body.caducidad).toBeNull();

    expect((await caducar(f.idExpediente)).status).toBe(201);
    const res = await e.familiaApi(f.token).get(`/familia/expedientes/${f.idExpediente}/panel`);

    expect(res.status).toBe(200);
    expect(res.body.etapas.map((x: { estado: string }) => x.estado)).toEqual(antes.body.etapas.map((x: { estado: string }) => x.estado));
    expect(res.body.acciones).toEqual([]);
    expect(res.body.caducidad).toEqual({ fecha: expect.any(String), accion: "subsanar las observaciones de tu expediente" });
    expect(res.body.historial[0]).toMatchObject({ texto: "Tu postulación caducó por vencimiento del plazo" });
    // La familia ve el estado real: ya se le notificó.
    const lista = await e.familiaApi(f.token).get("/familia/expedientes");
    expect((lista.body as { id_expediente: number; estado: string }[]).find((x) => x.id_expediente === f.idExpediente)!.estado).toBe("caducado");
  });

  it("HU0018-2.0 (C78) con el expediente caducado las rutas de la familia rechazan la ficha, la carga de documentos y el agendamiento", async () => {
    const { f } = await enPostulacion(16 * DIA);
    expect((await caducar(f.idExpediente)).status).toBe(201);

    expect((await e.como(f.token).guardar(rutaFicha(f.idExpediente), { ...fichaCompleta(), modo: "borrador" })).body.error.codigo).toBe("FICHA_NO_EDITABLE");
    expect((await subir(e.app, rutaDocumentos(f.idExpediente), f.token, { id_requisito: 1 }, pdf())).status).toBe(409);
    expect((await e.familiaApi(f.token).post(rutaEvaluaciones(f.idExpediente), { horarios: [] })).status).toBeGreaterThanOrEqual(400);
  });

  it("C72 un expediente de la campaña DEMO con el plazo vencido y 48 h sin interacción no entra en la revisión diaria ni se puede recordar o caducar", async () => {
    const { rows } = await db().query<{ id_grado: number }>(
      "SELECT id_grado FROM grado WHERE campana_admision = 'DEMO' LIMIT 1",
    );
    const idGrado =
      rows[0]?.id_grado ??
      (
        await db().query<{ id_grado: number }>(
          `INSERT INTO grado (nivel, nombre_grado, campana_admision, vacantes_autorizadas, vacantes_disponibles, monto_cuota_ingreso)
           VALUES ('primaria', $1, 'DEMO', 10, 10, 7000) RETURNING id_grado`,
          [`Grado demo ${unico()}`],
        )
      ).rows[0]!.id_grado;
    const vencido = await e.familia("portal_habilitado", idGrado);
    await transicion(vencido.idExpediente, "visita_agendada", "portal_habilitado", 30 * DIA);
    const inactivo = await e.familia("portal_habilitado", idGrado);
    await transicion(inactivo.idExpediente, "visita_agendada", "portal_habilitado", 72);

    const p = await pendientes();
    expect([...p.caducidades, ...p.recordatorios]).not.toEqual(expect.arrayContaining([vencido.idExpediente]));
    expect([...p.caducidades, ...p.recordatorios]).not.toEqual(expect.arrayContaining([inactivo.idExpediente]));
    expect((await caducar(vencido.idExpediente)).body.error.codigo).toBe("CADUCIDAD_NO_CORRESPONDE");
    expect((await recordar(inactivo.idExpediente)).body.error.codigo).toBe("RECORDATORIO_NO_CORRESPONDE");
    expect(await estadoDe(db(), vencido.idExpediente)).toBe("portal_habilitado");
    expect(await intentosDe(db(), inactivo.idExpediente)).toEqual([]);
  });

  it("HU0018-2.0 (plazos, ADR-19) las variables PLAZO_* son enteros de 3 a 90 y, sin definir, valen 15, 7, 7, 7 y 7", async () => {
    const base = { ...process.env };
    for (const v of ["PLAZO_POSTULACION_DIAS", "PLAZO_SUBSANACION_DIAS", "PLAZO_AGENDAMIENTO_DIAS", "PLAZO_REPROGRAMACION_DIAS", "PLAZO_CUOTA_DIAS"]) {
      expect(variablesInvalidas({ ...base, [v]: "2" })).toContain(v);
      expect(variablesInvalidas({ ...base, [v]: "91" })).toContain(v);
      expect(variablesInvalidas({ ...base, [v]: "siete" })).toContain(v);
      expect(variablesInvalidas({ ...base, [v]: "3" })).toEqual([]);
    }
    const { plazosVigentes } = await import("../src/services/seguimiento");
    expect(plazosVigentes()).toEqual({ postulacion: 15, subsanacion: 7, agendamiento: 7, reprogramacion: 7, cuota: 7 });
  });
});
