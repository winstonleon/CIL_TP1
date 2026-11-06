// Citas de evaluación (HU0009, P08): evaluaciones del grado, horarios que se ofrecen, bloqueo de horarios en orden por id,
// cupos, citas y anclas de sus avisos (ADR-07). Fecha y horas en la hora de Lima (§2 del modelo de datos), como en las
// citas de visita (repositories/cita.ts, que no se toca).
import type { Consultable } from "../db/pool";
import { RESPONSABLE_POR_TIPO, type TipoCita } from "../services/configuracion";

const ZONA = "America/Lima";
const INICIO = (h: string) => `((${h}.fecha + ${h}.hora_inicio) AT TIME ZONE '${ZONA}')`;
const FIN = (h: string) => `((${h}.fecha + ${h}.hora_fin) AT TIME ZONE '${ZONA}')`;

export type TipoEvaluacion = Exclude<TipoCita, "visita">;
// Orden de P08 (mockup: académica, psicológica y la entrevista al final; la jornada es de Inicial).
export const TIPOS_EVALUACION: readonly TipoEvaluacion[] = ["jornada_observacion", "evaluacion_academica", "evaluacion_psicologica", "entrevista_padres"];
// La jornada de observación es grupal (C40, decisión de John del 05/11/2026): no cuenta en uq_cita_personal_fecha.
export const TIPO_GRUPAL: TipoEvaluacion = "jornada_observacion";
// Estados de una cita que todavía ocupa su turno (los mismos que cuenta el índice parcial uq_cita_personal_fecha).
const CITA_ACTIVA = (c: string) => `${c}.estado NOT IN ('reprogramada', 'cancelada')`;

// Responsable válido: cuenta activa con el rol del tipo de cita (ADR-15; C25 7). El mapa es el de G09.
const ROL_DEL_TIPO = (h: string) =>
  `CASE ${h}.tipo_cita ${TIPOS_EVALUACION.map((t) => `WHEN '${t}' THEN '${RESPONSABLE_POR_TIPO[t]}'`).join(" ")} END`;
const RESPONSABLE_VALIDO = (h: string, p: string) => `(${p}.activo AND ${p}.rol::text = ${ROL_DEL_TIPO(h)})`;
// ¿Hay otra cita activa del mismo responsable a esa hora? Solo en los horarios individuales (C40).
const OCUPADO = (h: string) => `(${h}.tipo_cita <> '${TIPO_GRUPAL}' AND EXISTS (
    SELECT 1 FROM cita oc WHERE oc.id_personal = ${h}.id_personal AND oc.fecha_hora = ${INICIO(h)} AND ${CITA_ACTIVA("oc")}))`;

// Evaluaciones que exige el grado del expediente (R11 configurable en G09, ADR-14; C25 4): las de `requiere_*`, más la
// entrevista a los padres, que aplica siempre.
export async function evaluacionesDelGrado(db: Consultable, idExpediente: number): Promise<TipoEvaluacion[]> {
  const { rows } = await db.query<{ jornada: boolean; psicologica: boolean; academica: boolean }>(
    `SELECT g.requiere_jornada_observacion AS jornada, g.requiere_evaluacion_psicologica AS psicologica,
            g.requiere_evaluacion_academica AS academica
       FROM expediente e JOIN grado g ON g.id_grado = e.id_grado WHERE e.id_expediente = $1`,
    [idExpediente],
  );
  const g = rows[0];
  if (!g) return [];
  const exigidas = new Set<TipoEvaluacion>(["entrevista_padres"]);
  if (g.jornada) exigidas.add("jornada_observacion");
  if (g.psicologica) exigidas.add("evaluacion_psicologica");
  if (g.academica) exigidas.add("evaluacion_academica");
  return TIPOS_EVALUACION.filter((t) => exigidas.has(t));
}

export interface HorarioEvaluacion {
  id_horario: number;
  tipo_cita: TipoEvaluacion;
  fecha: string;
  hora_inicio: string;
  hora_fin: string;
  disponible: boolean;
}

// Horarios que P08 ofrece: de los tipos pedidos, de la campaña activa, futuros y con un responsable activo con su rol.
// «disponible» = con cupo y, si es individual, sin otra cita activa a esa hora.
export async function listarHorariosEvaluacion(db: Consultable, campana: string, tipos: readonly TipoEvaluacion[]): Promise<HorarioEvaluacion[]> {
  if (!tipos.length) return [];
  const { rows } = await db.query<HorarioEvaluacion>(
    `SELECT h.id_horario, h.tipo_cita::text AS tipo_cita, to_char(h.fecha, 'YYYY-MM-DD') AS fecha,
            to_char(h.hora_inicio, 'HH24:MI') AS hora_inicio, to_char(h.hora_fin, 'HH24:MI') AS hora_fin,
            (h.cupos > 0 AND NOT ${OCUPADO("h")}) AS disponible
       FROM horario_disponible h JOIN personal p ON p.id_personal = h.id_personal
      WHERE h.campana_admision = $1 AND h.tipo_cita::text = ANY($2::text[]) AND ${RESPONSABLE_VALIDO("h", "p")} AND ${INICIO("h")} > now()
      ORDER BY h.fecha, h.hora_inicio, h.id_horario`,
    [campana, tipos],
  );
  return rows;
}

export interface HorarioBloqueado {
  id_horario: number;
  tipo_cita: string;
  id_personal: number;
  vigente: boolean; // de la campaña activa, futuro y con un responsable válido
  con_cupo: boolean; // cupos > 0 y, si es individual, sin otra cita activa a esa hora
  inicio: Date;
  fin: Date;
  fecha: string;
  hora_inicio: string;
}

// Bloquea los horarios SIEMPRE en orden por id: dos reservas que comparten horarios los toman en el mismo orden y no se
// interbloquean. El estado se lee DESPUÉS, en otra sentencia: en READ COMMITTED cada sentencia toma una instantánea nueva,
// así una reserva que esperó el bloqueo ve el cupo descontado y las citas que confirmó la otra.
export async function bloquearHorarios(db: Consultable, ids: readonly number[], campana: string): Promise<Map<number, HorarioBloqueado>> {
  await db.query("SELECT id_horario FROM horario_disponible WHERE id_horario = ANY($1::int[]) ORDER BY id_horario FOR UPDATE", [ids]);
  const { rows } = await db.query<HorarioBloqueado>(
    `SELECT h.id_horario, h.tipo_cita::text AS tipo_cita, h.id_personal,
            (h.campana_admision = $2 AND ${INICIO("h")} > now() AND ${RESPONSABLE_VALIDO("h", "p")}) AS vigente,
            (h.cupos > 0 AND NOT ${OCUPADO("h")}) AS con_cupo,
            ${INICIO("h")} AS inicio, ${FIN("h")} AS fin,
            to_char(h.fecha, 'YYYY-MM-DD') AS fecha, to_char(h.hora_inicio, 'HH24:MI') AS hora_inicio
       FROM horario_disponible h JOIN personal p ON p.id_personal = h.id_personal
      WHERE h.id_horario = ANY($1::int[])
      ORDER BY h.id_horario`,
    [ids, campana],
  );
  return new Map(rows.map((r) => [r.id_horario, r]));
}

// R12: descuenta el cupo de un horario ya bloqueado (con la condición como segunda capa).
export async function descontarCupoHorario(db: Consultable, idHorario: number): Promise<boolean> {
  const { rowCount } = await db.query("UPDATE horario_disponible SET cupos = cupos - 1 WHERE id_horario = $1 AND cupos > 0", [idHorario]);
  return (rowCount ?? 0) > 0;
}

// HU0009-2.0: «libera el turno anterior».
export async function devolverCupoHorario(db: Consultable, idHorario: number): Promise<void> {
  await db.query("UPDATE horario_disponible SET cupos = cupos + 1 WHERE id_horario = $1", [idHorario]);
}

export async function insertarCitaEvaluacion(
  db: Consultable,
  c: { idExpediente: number; idPersonal: number; idHorario: number; tipoCita: string; fechaHora: Date },
): Promise<number> {
  const { rows } = await db.query<{ id_cita: number }>(
    `INSERT INTO cita (id_expediente, id_personal, id_horario, tipo_cita, fecha_hora)
     VALUES ($1, $2, $3, $4::tipo_cita, $5) RETURNING id_cita`,
    [c.idExpediente, c.idPersonal, c.idHorario, c.tipoCita, c.fechaHora],
  );
  return rows[0]!.id_cita;
}

export async function marcarCitaReprogramada(db: Consultable, idCita: number): Promise<void> {
  await db.query("UPDATE cita SET estado = 'reprogramada' WHERE id_cita = $1", [idCita]);
}

export interface CitaEvaluacion {
  id_cita: number;
  id_expediente: number;
  id_personal: number;
  id_horario: number;
  tipo_cita: TipoEvaluacion;
  estado: string;
  inicio: Date;
  fin: Date;
  fecha: string;
  hora_inicio: string;
  horas_restantes: number; // horas que faltan para la cita (negativo si ya pasó)
}

const COLUMNAS_CITA = `c.id_cita, c.id_expediente, c.id_personal, c.id_horario, c.tipo_cita::text AS tipo_cita, c.estado::text AS estado,
  c.fecha_hora AS inicio, ${FIN("h")} AS fin,
  to_char(c.fecha_hora AT TIME ZONE '${ZONA}', 'YYYY-MM-DD') AS fecha, to_char(c.fecha_hora AT TIME ZONE '${ZONA}', 'HH24:MI') AS hora_inicio,
  (extract(epoch FROM c.fecha_hora - now()) / 3600)::float8 AS horas_restantes`;

// Citas de evaluación vigentes del expediente (la agenda vigente), en el orden de la fecha: la más reciente de cada tipo
// que no se reprogramó ni canceló. Una inasistencia reprogramada (HU0025-2.0, D2-A) deja la cita vieja en no_asistio y
// la nueva es la vigente; sin inasistencias hay una sola por tipo, como en HU0009.
export async function citasActivas(db: Consultable, idExpediente: number): Promise<CitaEvaluacion[]> {
  const { rows } = await db.query<CitaEvaluacion>(
    `SELECT * FROM (
       SELECT DISTINCT ON (c.tipo_cita) ${COLUMNAS_CITA} FROM cita c JOIN horario_disponible h ON h.id_horario = c.id_horario
        WHERE c.id_expediente = $1 AND c.tipo_cita <> 'visita' AND ${CITA_ACTIVA("c")}
        ORDER BY c.tipo_cita, c.id_cita DESC) vigentes
      ORDER BY inicio, id_cita`,
    [idExpediente],
  );
  return rows;
}

export async function leerCitaEvaluacion(db: Consultable, idCita: number): Promise<CitaEvaluacion | null> {
  const { rows } = await db.query<CitaEvaluacion>(
    `SELECT ${COLUMNAS_CITA} FROM cita c JOIN horario_disponible h ON h.id_horario = c.id_horario WHERE c.id_cita = $1`,
    [idCita],
  );
  return rows[0] ?? null;
}

// La cita bloqueada (después del expediente: el orden de P02, G04 y la reserva de P08).
export async function bloquearCitaEvaluacion(db: Consultable, idCita: number): Promise<CitaEvaluacion | null> {
  const { rows } = await db.query<CitaEvaluacion>(
    `SELECT ${COLUMNAS_CITA} FROM cita c JOIN horario_disponible h ON h.id_horario = c.id_horario WHERE c.id_cita = $1 FOR UPDATE OF c`,
    [idCita],
  );
  return rows[0] ?? null;
}

// ---- Avisos de las evaluaciones (ADR-07, ADR-23)

export const TIPO_HABILITACION = "evaluaciones_habilitadas";
export const TIPO_CONFIRMACION_EVALUACIONES = "evaluaciones_confirmadas";
export const TIPO_REPROGRAMACION_FAMILIA = "evaluacion_reprogramada";
export const TIPO_REPROGRAMACION_RESPONSABLE = "evaluacion_reprogramada_responsable";
export const TIPO_LIBERACION_RESPONSABLE = "evaluacion_liberada_responsable";
// HU0025-2.0 y HU0010 (ADR-25): inasistencia a la evaluación académica (familia), dictamen En observación (buzón de
// admisión, CORREO_ADMISION) y dictamen No apto (familia).
export const TIPO_INASISTENCIA = "evaluacion_inasistencia";
export const TIPO_DICTAMEN_OBSERVACION = "dictamen_en_observacion";
export const TIPO_DICTAMEN_NO_APTO = "dictamen_no_apto";

export const TIPOS_AVISO_EVALUACION = [
  TIPO_HABILITACION,
  TIPO_CONFIRMACION_EVALUACIONES,
  TIPO_REPROGRAMACION_FAMILIA,
  TIPO_REPROGRAMACION_RESPONSABLE,
  TIPO_LIBERACION_RESPONSABLE,
  TIPO_INASISTENCIA,
  TIPO_DICTAMEN_OBSERVACION,
  TIPO_DICTAMEN_NO_APTO,
] as const;
export type TipoAvisoEvaluacion = (typeof TIPOS_AVISO_EVALUACION)[number];
// Avisos dirigidos al personal: su contacto es el correo del responsable, nunca el de la familia.
export const TIPOS_AL_RESPONSABLE: readonly string[] = [TIPO_REPROGRAMACION_RESPONSABLE, TIPO_LIBERACION_RESPONSABLE];

// Clave del detalle de `cita_reprogramada` que guarda el primer intento de cada aviso de la reprogramación.
export const CLAVE_REPROGRAMACION: Record<string, string> = {
  [TIPO_REPROGRAMACION_FAMILIA]: "id_notificacion",
  [TIPO_REPROGRAMACION_RESPONSABLE]: "id_notificacion_responsable",
  [TIPO_LIBERACION_RESPONSABLE]: "id_notificacion_responsable_anterior",
};

// Fuente de cada aviso con primer intento reservado por la acción (como la observación de ADR-23): una fila por aviso,
// con el evento que lo originó y su primer intento (`desde`). Sus intentos son las filas del tipo con id ≥ desde, y
// solo se retoma el de la fuente más reciente de cada tipo (supuesto 3 del plan, riesgo aceptado en ADR-24).
// La habilitación (C52) no está aquí: no reserva en la transacción de la unión (no toca el bloque 5) y usa un ancla de
// tiempo (`ANCLA_HABILITACION`).
const FUENTES = `SELECT r.id_evento, r.id_expediente, x.tipo, x.desde::int AS desde, r.detalle
    FROM registro_auditoria r
   CROSS JOIN LATERAL (VALUES
     ('${TIPO_CONFIRMACION_EVALUACIONES}', CASE WHEN r.tipo_evento = 'transicion_estado' AND r.estado_nuevo = 'en_evaluacion' THEN r.detalle->>'id_notificacion' END),
     ('${TIPO_REPROGRAMACION_FAMILIA}', CASE WHEN r.tipo_evento = 'cita_reprogramada' THEN r.detalle->>'id_notificacion' END),
     ('${TIPO_REPROGRAMACION_RESPONSABLE}', CASE WHEN r.tipo_evento = 'cita_reprogramada' THEN r.detalle->>'id_notificacion_responsable' END),
     ('${TIPO_LIBERACION_RESPONSABLE}', CASE WHEN r.tipo_evento = 'cita_reprogramada' THEN r.detalle->>'id_notificacion_responsable_anterior' END),
     ('${TIPO_INASISTENCIA}', CASE WHEN r.tipo_evento = 'atencion_fin' AND r.detalle->>'decision' = 'inasistencia' THEN r.detalle->>'id_notificacion' END),
     ('${TIPO_DICTAMEN_OBSERVACION}', CASE WHEN r.tipo_evento = 'transicion_estado' AND r.estado_nuevo = 'en_observacion' THEN r.detalle->>'id_notificacion' END),
     ('${TIPO_DICTAMEN_NO_APTO}', CASE WHEN r.tipo_evento = 'transicion_estado' AND r.estado_nuevo = 'no_apto' THEN r.detalle->>'id_notificacion' END)
   ) AS x(tipo, desde)
   WHERE r.tipo_evento IN ('transicion_estado', 'cita_reprogramada', 'atencion_fin') AND x.desde IS NOT NULL`;

// Ancla de la habilitación: el atencion_fin que completó la unión (B1: una sola vez por expediente).
const ANCLA_HABILITACION = (e: string) => `(SELECT r.fecha_hora FROM registro_auditoria r
    WHERE r.id_expediente = ${e}.id_expediente AND r.tipo_evento = 'atencion_fin' AND r.detalle->>'habilita_agendamiento' = 'true'
    ORDER BY r.id_evento DESC LIMIT 1)`;

export interface FuenteAviso {
  id_evento: number;
  tipo: TipoAvisoEvaluacion;
  desde: number;
  detalle: Record<string, unknown>;
}

// La fuente más reciente del aviso de ese tipo en el expediente (null si nunca hubo una).
export async function ultimaFuente(db: Consultable, idExpediente: number, tipo: string): Promise<FuenteAviso | null> {
  const { rows } = await db.query<FuenteAviso>(
    `SELECT f.id_evento::int AS id_evento, f.tipo, f.desde, f.detalle FROM (${FUENTES}) f
      WHERE f.id_expediente = $1 AND f.tipo = $2 ORDER BY f.id_evento DESC LIMIT 1`,
    [idExpediente, tipo],
  );
  return rows[0] ?? null;
}

// La fuente del aviso al que pertenece un intento: la más reciente del tipo con desde ≤ ese intento.
export async function fuenteDeIntento(db: Consultable, idExpediente: number, tipo: string, idNotificacion: number): Promise<FuenteAviso | null> {
  const { rows } = await db.query<FuenteAviso>(
    `SELECT f.id_evento::int AS id_evento, f.tipo, f.desde, f.detalle FROM (${FUENTES}) f
      WHERE f.id_expediente = $1 AND f.tipo = $2 AND f.desde <= $3 ORDER BY f.id_evento DESC LIMIT 1`,
    [idExpediente, tipo, idNotificacion],
  );
  return rows[0] ?? null;
}

export async function anclaHabilitacion(db: Consultable, idExpediente: number): Promise<Date | null> {
  const { rows } = await db.query<{ ancla: Date | null }>(`SELECT ${ANCLA_HABILITACION("e")} AS ancla FROM expediente e WHERE e.id_expediente = $1`, [idExpediente]);
  return rows[0]?.ancla ?? null;
}

// Estado del expediente en el que cada aviso sigue vigente: la habilitación mientras no agende; los de las citas en
// evaluación; los del dictamen, en el estado al que pasó (un nuevo dictamen deja sin efecto el aviso de la observación).
export const ESTADO_DEL_AVISO: Record<TipoAvisoEvaluacion, string> = {
  [TIPO_HABILITACION]: "en_validacion",
  [TIPO_CONFIRMACION_EVALUACIONES]: "en_evaluacion",
  [TIPO_REPROGRAMACION_FAMILIA]: "en_evaluacion",
  [TIPO_REPROGRAMACION_RESPONSABLE]: "en_evaluacion",
  [TIPO_LIBERACION_RESPONSABLE]: "en_evaluacion",
  [TIPO_INASISTENCIA]: "en_evaluacion",
  [TIPO_DICTAMEN_OBSERVACION]: "en_observacion",
  [TIPO_DICTAMEN_NO_APTO]: "no_apto",
};
// El mismo mapa en SQL (lista cerrada de constantes: nunca entra texto del usuario).
const ESTADO_DEL_AVISO_SQL = (tipo: string) =>
  `CASE ${tipo} ${Object.entries(ESTADO_DEL_AVISO).map(([t, e]) => `WHEN '${t}' THEN '${e}'`).join(" ")} END`;

// Barrido (ADR-16): avisos de evaluación por intentar, los más antiguos primero.
// - Con primer intento reservado: sin cerrar y con el último intento `pendiente` hace más de `minutosReintento` (también
//   el primero, si el webhook no llegó), solo el de la fuente más reciente de cada tipo.
// - Habilitación (C52): expediente en en_validacion con las tres ramas conformes; sin intentos y con la unión de hace más
//   de `minutosRegistro`, o sin cerrar y con el último intento `pendiente` vencido.
export async function listarAvisosEvaluacionPendientes(
  db: Consultable,
  o: { minutosRegistro: number; minutosReintento: number; limite: number },
): Promise<{ id_expediente: number; tipo_evento: string }[]> {
  const { rows } = await db.query<{ id_expediente: number; tipo_evento: string }>(
    `WITH ultima AS (
       SELECT DISTINCT ON (f.id_expediente, f.tipo) f.id_expediente, f.tipo, f.desde, NULL::timestamptz AS ancla
         FROM (${FUENTES}) f ORDER BY f.id_expediente, f.tipo, f.id_evento DESC),
     habilitacion AS (
       SELECT e.id_expediente, '${TIPO_HABILITACION}'::text AS tipo, 0 AS desde, ${ANCLA_HABILITACION("e")} AS ancla
         FROM expediente e
         LEFT JOIN pago p ON p.id_expediente = e.id_expediente AND p.tipo_pago = 'derecho_admision' AND p.numero_fraccion = 1
        WHERE e.estado = 'en_validacion' AND e.estado_documental = 'conforme' AND e.estado_financiero = 'conforme'
          AND p.estado_validacion = 'conforme'),
     aviso AS (SELECT * FROM ultima UNION ALL SELECT * FROM habilitacion WHERE ancla IS NOT NULL)
     SELECT aviso.id_expediente, aviso.tipo AS tipo_evento
       FROM aviso
       JOIN expediente e ON e.id_expediente = aviso.id_expediente
      CROSS JOIN LATERAL (
             SELECT count(*)::int AS intentos,
                    coalesce(bool_or(n.estado_envio <> 'pendiente'), false) AS cerrado,
                    (array_agg(n.estado_envio::text ORDER BY n.id_notificacion DESC))[1] AS ultimo_estado,
                    (array_agg(n.fecha_envio ORDER BY n.id_notificacion DESC))[1] AS ultimo_intento
               FROM notificacion n
              WHERE n.id_expediente = aviso.id_expediente AND n.canal = 'correo' AND n.tipo_evento = aviso.tipo
                AND n.id_notificacion >= aviso.desde) f
      WHERE e.estado::text = ${ESTADO_DEL_AVISO_SQL("aviso.tipo")}
        AND ((f.intentos = 0 AND aviso.ancla IS NOT NULL AND aviso.ancla < now() - make_interval(mins => $1))
          OR (NOT f.cerrado AND f.ultimo_estado = 'pendiente' AND f.ultimo_intento < now() - make_interval(mins => $2)))
      ORDER BY coalesce(f.ultimo_intento, aviso.ancla), aviso.id_expediente, aviso.tipo
      LIMIT $3`,
    [o.minutosRegistro, o.minutosReintento, o.limite],
  );
  return rows;
}

// Intentos de un aviso de evaluación (filas del tipo con id ≥ desde), en orden y bloqueados hasta el fin de la transacción.
export async function bloquearIntentosEvaluacion(
  db: Consultable,
  a: { idExpediente: number; tipo: string; desde: number; minutosReintento: number },
): Promise<{ id_notificacion: number; estado_envio: "pendiente" | "enviado" | "fallido"; vencido: boolean }[]> {
  const { rows } = await db.query<{ id_notificacion: number; estado_envio: "pendiente" | "enviado" | "fallido"; vencido: boolean }>(
    `SELECT id_notificacion, estado_envio::text AS estado_envio, fecha_envio < now() - make_interval(mins => $4) AS vencido
       FROM notificacion
      WHERE id_expediente = $1 AND canal = 'correo' AND tipo_evento = $2 AND id_notificacion >= $3
      ORDER BY id_notificacion
        FOR UPDATE`,
    [a.idExpediente, a.tipo, a.desde, a.minutosReintento],
  );
  return rows;
}

// Correo del responsable de una cita (avisos al personal de HU0009-2.0). Solo el correo: el aviso no lleva su nombre.
export async function correoDelResponsable(db: Consultable, idCita: number): Promise<string | null> {
  const { rows } = await db.query<{ correo: string }>(
    "SELECT p.correo FROM cita c JOIN personal p ON p.id_personal = c.id_personal WHERE c.id_cita = $1",
    [idCita],
  );
  return rows[0]?.correo ?? null;
}

export async function tipoDeNotificacion(db: Consultable, idNotificacion: number, idExpediente: number): Promise<string | null> {
  const { rows } = await db.query<{ tipo_evento: string }>(
    "SELECT tipo_evento FROM notificacion WHERE id_notificacion = $1 AND id_expediente = $2",
    [idNotificacion, idExpediente],
  );
  return rows[0]?.tipo_evento ?? null;
}
