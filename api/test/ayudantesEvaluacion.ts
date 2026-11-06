// Fixtures de HU0009 (P08): expediente con las tres validaciones conformes, responsables de las evaluaciones con su rol
// (ADR-15) y turnos de evaluación. Datos ficticios @ejemplo.test; n8n se simula con el disparador falso de entornoFicha.
// - `habilitadaReal`: llega a la unión por las rutas reales del bloque 5 (Secretaría y Tesorería), para el escenario
//   principal y C52.
// - `habilitada`: la misma precondición escrita por SQL (expediente en en_validacion, ramas conformes y derecho conforme),
//   para las pruebas cuyo foco es el agendamiento.
// Cada juego de turnos usa días propios: el mismo responsable atiende a todas las pruebas del archivo y
// uq_cita_personal_fecha no admite dos citas suyas a la misma hora.
import { randomUUID } from "node:crypto";
import request from "supertest";
import type { Consultable } from "../src/db/pool";
import { BANCOS } from "../src/services/derechoAdmision";
import { crearFirmante, crearPersonal, unico } from "./ayudantes";
import { horarioVisita } from "./ayudantesVisita";
import {
  CONFORME,
  entornoValidacion,
  rutaConformidadDocumental,
  rutaConformidadFinanciera,
  rutaDecisionPago,
  rutaDecisionSecretaria,
  rutaDecisionTesoreria,
  TOKEN_INTERNO,
} from "./ayudantesValidacion";

type Firmante = Awaited<ReturnType<typeof crearFirmante>>;
type Requiere = Partial<{ jornada: boolean; psicologica: boolean; academica: boolean }>;

// 3.° de primaria (R11, §5): evaluación psicológica y académica, más la entrevista.
const TERCERO: Requiere = { psicologica: true, academica: true };

let dia = 20;
const diasNuevos = () => (dia += 3);

export async function entornoEvaluacion(db: Consultable, firmante: Firmante) {
  const e = await entornoValidacion(db, firmante);
  // Responsables con su token (bloque 7: G06 y G11 los usan para registrar los resultados de sus citas).
  const subPsicologa = randomUUID();
  const subEvaluador = randomUUID();
  const psicologa = await crearPersonal(db, "psicologa", subPsicologa);
  const evaluador = await crearPersonal(db, "evaluador_academico", subEvaluador);
  const tokenPsicologa = await firmante.token(subPsicologa, ["psicologa"]);
  const tokenEvaluador = await firmante.token(subEvaluador, ["evaluador_academico"]);

  const configurar = (idGrado: number, r: Requiere) =>
    db.query(
      `UPDATE grado SET requiere_jornada_observacion = $2, requiere_evaluacion_psicologica = $3, requiere_evaluacion_academica = $4
        WHERE id_grado = $1`,
      [idGrado, r.jornada ?? false, r.psicologica ?? false, r.academica ?? false],
    );

  // Precondición por SQL: «las tres validaciones del expediente concluyeron conformes» (B1).
  async function habilitada(o: { requiere?: Requiere; idGrado?: number; ramas?: Partial<{ documental: string; financiera: string; derecho: string }> } = {}) {
    const f = await e.familia("en_validacion", o.idGrado);
    if (o.idGrado === undefined) await configurar(f.idGrado, o.requiere ?? TERCERO);
    await db.query("UPDATE expediente SET estado_documental = $2::estado_revision, estado_financiero = $3::estado_revision WHERE id_expediente = $1", [
      f.idExpediente,
      o.ramas?.documental ?? "conforme",
      o.ramas?.financiera ?? "conforme",
    ]);
    await db.query(
      `INSERT INTO pago (id_expediente, tipo_pago, numero_fraccion, numero_operacion, banco, monto, fecha_pago, comprobante_url, estado_validacion)
       VALUES ($1, 'derecho_admision', 1, $2, $3, 300, '2026-10-10', $4, $5::estado_revision)`,
      [f.idExpediente, `OP-${unico()}`, BANCOS[0], `clave-${unico()}`, o.ramas?.derecho ?? "conforme"],
    );
    return f;
  }

  // La unión por las rutas reales del bloque 5: Secretaría y Tesorería marcan todo conforme y confirman sus ramas.
  async function habilitadaReal(r: Requiere = TERCERO) {
    const x = await e.enValidacion();
    await configurar(x.f.idGrado, r);
    const sec = e.api(e.secretaria.token);
    const tes = e.api(e.tesoreria.token);
    const ok = (res: { status: number }) => {
      if (res.status !== 200) throw new Error(`Validación de prueba fallida (${res.status})`);
    };
    for (const doc of [x.docs.partida, x.docs.dni]) ok(await sec.post(rutaDecisionSecretaria(x.f.idExpediente, doc), CONFORME));
    for (const doc of x.docs.boletas) ok(await tes.post(rutaDecisionTesoreria(x.f.idExpediente, doc), CONFORME));
    ok(await tes.post(rutaDecisionPago(x.idPago), CONFORME));
    ok(await tes.post(rutaConformidadFinanciera(x.f.idExpediente)));
    ok(await sec.post(rutaConformidadDocumental(x.f.idExpediente)));
    e.eventos.disparar.mockClear();
    return x.f;
  }

  type Turno = Partial<{ dias: number; inicio: string; fin: string; cupos: number; campana: string; idPersonal: number }>;
  const RESPONSABLE: Record<string, number> = {
    jornada_observacion: psicologa,
    evaluacion_psicologica: psicologa,
    entrevista_padres: psicologa,
    evaluacion_academica: evaluador,
  };
  // Un horario de evaluación a `dias` días de hoy (hora de Lima), sin pasar por G09.
  const horario = async (tipo: string, o: Turno = {}) =>
    (await horarioVisita(db, o.idPersonal ?? RESPONSABLE[tipo]!, o.campana ?? e.campana, { ...o, tipo })).id_horario;

  // Turnos de 3.° en días propios: académica 09:00–10:00 y psicológica 10:30–11:30 del día d; entrevista 15:00–16:00 del
  // día d + 1 (después de las demás: decisión O).
  async function turnosTercero(cupos = 1) {
    const d = diasNuevos();
    return {
      dia: d,
      evaluacion_academica: await horario("evaluacion_academica", { dias: d, inicio: "09:00", fin: "10:00", cupos }),
      evaluacion_psicologica: await horario("evaluacion_psicologica", { dias: d, inicio: "10:30", fin: "11:30", cupos }),
      entrevista_padres: await horario("entrevista_padres", { dias: d + 1, inicio: "15:00", fin: "16:00", cupos }),
    };
  }

  const pedidos = (t: Record<string, number>, tipos: string[] = ["evaluacion_academica", "evaluacion_psicologica", "entrevista_padres"]) => ({
    horarios: tipos.map((tipo_cita) => ({ tipo_cita, id_horario: t[tipo_cita]! })),
  });

  // Peticiones de la familia con su token.
  const familiaApi = (token: string) => ({
    get: (ruta: string) => request(e.app).get(ruta).set("Authorization", `Bearer ${token}`),
    post: (ruta: string, cuerpo: object = {}) => request(e.app).post(ruta).set("Authorization", `Bearer ${token}`).send(cuerpo),
  });

  // Rutas de n8n (/internal) con el token de servicio.
  const interno = {
    aviso: (idExpediente: number, cuerpo: object) =>
      request(e.app).post(`/internal/expedientes/${idExpediente}/aviso-evaluacion`).set("Authorization", `Bearer ${TOKEN_INTERNO()}`).send(cuerpo),
    pendientes: async () =>
      (await request(e.app).get("/internal/evaluaciones/avisos-pendientes").set("Authorization", `Bearer ${TOKEN_INTERNO()}`)).body.avisos as {
        id_expediente: number;
        tipo_evento: string;
      }[],
    contacto: (idExpediente: number, idNotificacion?: number) =>
      request(e.app)
        .get(`/internal/expedientes/${idExpediente}/contacto${idNotificacion !== undefined ? `?id_notificacion=${idNotificacion}` : ""}`)
        .set("Authorization", `Bearer ${TOKEN_INTERNO()}`),
  };

  // Agenda los turnos de 3.° de una familia habilitada (precondición de HU0009-2.0).
  async function agendada(cupos = 1) {
    const f = await habilitada();
    const t = await turnosTercero(cupos);
    const res = await familiaApi(f.token).post(rutaEvaluaciones(f.idExpediente), pedidos(t));
    if (res.status !== 201) throw new Error(`Agendamiento de prueba fallido (${res.status} ${JSON.stringify(res.body)})`);
    e.eventos.disparar.mockClear();
    const citas = res.body.citas as { id_cita: number; tipo_cita: string }[];
    const cita = (tipo: string) => citas.find((c) => c.tipo_cita === tipo)!.id_cita;
    return { f, t, citas, cita };
  }

  return { ...e, psicologa, evaluador, subPsicologa, subEvaluador, tokenPsicologa, tokenEvaluador, configurar, habilitada, habilitadaReal, horario, turnosTercero, pedidos, familiaApi, interno, agendada, diasNuevos };
}

export type EntornoEvaluacion = Awaited<ReturnType<typeof entornoEvaluacion>>;

export const rutaEvaluaciones = (id: number) => `/familia/expedientes/${id}/evaluaciones`;
export const rutaReprogramacion = (id: number, idCita: number) => `/familia/expedientes/${id}/citas/${idCita}/reprogramacion`;
