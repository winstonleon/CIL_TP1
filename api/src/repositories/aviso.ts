// Avisos de la visita guiada (HU0003 y HU0004, ADR-07 y ADR-16): confirmación, invitación a reprogramar, credenciales y
// recordatorio. `notificacion` no tiene id_cita (B1): el aviso de una cita son las filas de su tipo con
// fecha_envio ≥ ancla, donde el ancla es la fecha_hora de la transicion_estado de esa cita (detalle.id_cita).
// Cada intento tiene su fila (ADR-07): un intento de resultado desconocido queda `pendiente`; el aviso se cierra con una
// fila `enviado` o `fallido`, así que cada aviso tiene como máximo una de las dos.
import type { Consultable } from "../db/pool";
import type { EstadoEnvio } from "./notificacion";

// Ancla de la transición más reciente de la cita (o de la que la llevó a `estadoNuevo`).
const ancla = (cita: string, estadoNuevo?: string) => `(SELECT r.fecha_hora FROM registro_auditoria r
    WHERE r.id_expediente = ${cita}.id_expediente AND r.tipo_evento = 'transicion_estado'
      AND r.detalle->>'id_cita' = ${cita}.id_cita::text${estadoNuevo ? ` AND r.estado_nuevo = '${estadoNuevo}'` : ""}
    ORDER BY r.id_evento DESC LIMIT 1)`;

// La última cita de visita del expediente: una cita anterior ya no tiene aviso pendiente.
const ES_ULTIMA_CITA = `c.id_cita = (SELECT max(c2.id_cita) FROM cita c2 WHERE c2.id_expediente = c.id_expediente AND c2.tipo_cita = 'visita')`;

// Aviso de `agendamiento` que corresponde al estado ACTUAL de cada cita de visita (null si ninguno), con su ancla.
const AVISO_ACTUAL = `
  SELECT c.id_cita, c.id_expediente,
         CASE WHEN c.estado = 'reservada' AND e.estado = 'visita_agendada' THEN 'visita_confirmada'
              WHEN c.estado = 'no_asistio' AND e.estado = 'prospecto' THEN 'visita_reprogramacion'
              WHEN c.estado = 'asistio' AND e.estado = 'portal_habilitado' THEN 'credenciales_portal' END AS tipo_evento,
         ${ancla("c")} AS ancla
    FROM cita c JOIN expediente e ON e.id_expediente = c.id_expediente
   WHERE c.tipo_cita = 'visita' AND ${ES_ULTIMA_CITA}`;

// Intentos del aviso: cuántas filas tiene, si ya se cerró y el estado y la fecha del último intento.
const INTENTOS = `CROSS JOIN LATERAL (
    SELECT count(*)::int AS intentos,
           coalesce(bool_or(n.estado_envio = 'enviado'), false) AS enviado,
           coalesce(bool_or(n.estado_envio = 'fallido'), false) AS fallido,
           (array_agg(n.estado_envio::text ORDER BY n.id_notificacion DESC))[1] AS ultimo_estado,
           (array_agg(n.fecha_envio ORDER BY n.id_notificacion DESC))[1] AS ultimo_intento
      FROM notificacion n
     WHERE n.id_expediente = aviso.id_expediente AND n.canal = 'correo'
       AND n.tipo_evento = aviso.tipo_evento AND n.fecha_envio >= aviso.ancla
  ) f`;

// Se toma un aviso, no una fila: sin intentos y con el ancla más vieja que `minutosRegistro` (deja pasar el webhook), o
// sin cerrar y con el último intento `pendiente` hace más de `minutosReintento` (incluye el que ya agotó los intentos:
// la reserva lo cierra y no vuelve). Una `pendiente` vieja con un intento más reciente o con el aviso cerrado no cuenta.
const VENCE = `((f.intentos = 0 AND aviso.ancla < now() - make_interval(mins => $1))
    OR (NOT f.enviado AND NOT f.fallido AND f.ultimo_estado = 'pendiente' AND f.ultimo_intento < now() - make_interval(mins => $2)))`;

export interface OpcionesBarrido {
  minutosRegistro: number;
  minutosReintento: number;
  limite: number;
}

// Barrido de agendamiento: citas cuyo aviso actual hay que intentar (primero los más antiguos).
export async function listarAvisosPendientes(db: Consultable, o: OpcionesBarrido): Promise<number[]> {
  const { rows } = await db.query<{ id_cita: number }>(
    `WITH aviso AS (${AVISO_ACTUAL})
     SELECT aviso.id_cita FROM aviso ${INTENTOS}
      WHERE aviso.tipo_evento IS NOT NULL AND aviso.ancla IS NOT NULL AND ${VENCE}
      ORDER BY aviso.ancla, aviso.id_cita
      LIMIT $3`,
    [o.minutosRegistro, o.minutosReintento, o.limite],
  );
  return rows.map((r) => r.id_cita);
}

// Barrido de seguimiento-recordatorios: citas reservadas dentro de la ventana [fecha_hora − horas, fecha_hora) cuyo
// recordatorio hay que intentar. Su ancla es la reserva. Sin espera inicial: no hay webhook que adelantarse.
export async function listarRecordatoriosPendientes(db: Consultable, o: OpcionesBarrido & { horas: number }): Promise<number[]> {
  const { rows } = await db.query<{ id_cita: number }>(
    `WITH aviso AS (
       SELECT c.id_cita, c.id_expediente, 'recordatorio_visita'::text AS tipo_evento, ${ancla("c", "visita_agendada")} AS ancla
         FROM cita c JOIN expediente e ON e.id_expediente = c.id_expediente
        WHERE c.tipo_cita = 'visita' AND c.estado = 'reservada' AND e.estado = 'visita_agendada' AND ${ES_ULTIMA_CITA}
          AND now() >= c.fecha_hora - make_interval(hours => $4) AND now() < c.fecha_hora)
     SELECT aviso.id_cita FROM aviso ${INTENTOS}
      WHERE aviso.ancla IS NOT NULL AND ${VENCE}
      ORDER BY aviso.ancla, aviso.id_cita
      LIMIT $3`,
    [o.minutosRegistro, o.minutosReintento, o.limite, o.horas],
  );
  return rows.map((r) => r.id_cita);
}

// Ancla de la cita (la de su última transición, o la de la reserva para el recordatorio).
export async function anclaDeCita(db: Consultable, idCita: number, estadoNuevo?: "visita_agendada"): Promise<Date | null> {
  const { rows } = await db.query<{ ancla: Date | null }>(
    `SELECT ${ancla("c", estadoNuevo)} AS ancla FROM cita c WHERE c.id_cita = $1`,
    [idCita],
  );
  return rows[0]?.ancla ?? null;
}

export async function esUltimaCitaDeVisita(db: Consultable, idCita: number): Promise<boolean> {
  const { rowCount } = await db.query(`SELECT 1 FROM cita c WHERE c.id_cita = $1 AND ${ES_ULTIMA_CITA}`, [idCita]);
  return (rowCount ?? 0) > 0;
}

export async function enVentanaDeRecordatorio(db: Consultable, idCita: number, horas: number): Promise<boolean> {
  const { rowCount } = await db.query(
    "SELECT 1 FROM cita WHERE id_cita = $1 AND now() >= fecha_hora - make_interval(hours => $2) AND now() < fecha_hora",
    [idCita, horas],
  );
  return (rowCount ?? 0) > 0;
}

export interface IntentoAviso {
  id_notificacion: number;
  estado_envio: EstadoEnvio;
  vencido: boolean; // `pendiente` intentado hace más de `minutosReintento`
}

// Intentos del aviso, en orden y bloqueados hasta el fin de la transacción.
export async function bloquearIntentos(
  db: Consultable,
  a: { idExpediente: number; tipoEvento: string; ancla: Date; minutosReintento: number },
): Promise<IntentoAviso[]> {
  const { rows } = await db.query<IntentoAviso>(
    `SELECT id_notificacion, estado_envio::text AS estado_envio, fecha_envio < now() - make_interval(mins => $4) AS vencido
       FROM notificacion
      WHERE id_expediente = $1 AND canal = 'correo' AND tipo_evento = $2 AND fecha_envio >= $3
      ORDER BY id_notificacion
        FOR UPDATE`,
    [a.idExpediente, a.tipoEvento, a.ancla, a.minutosReintento],
  );
  return rows;
}

// Un intento nuevo, o la fila de cierre `fallido` del tope (ADR-07). clock_timestamp(): la hora real de la inserción,
// no la del inicio de la transacción, que pudo empezar antes del ancla si esperó el bloqueo del expediente.
export async function insertarIntento(
  db: Consultable,
  a: { idExpediente: number; tipoEvento: string; estadoEnvio: "pendiente" | "fallido" },
): Promise<number> {
  const { rows } = await db.query<{ id_notificacion: number }>(
    `INSERT INTO notificacion (id_expediente, canal, tipo_evento, estado_envio, fecha_envio)
     VALUES ($1, 'correo', $2, $3::estado_envio, clock_timestamp())
     RETURNING id_notificacion`,
    [a.idExpediente, a.tipoEvento, a.estadoEnvio],
  );
  return rows[0]!.id_notificacion;
}

export type EstadoAviso = "enviado" | "fallido" | "pendiente";

// Etiqueta de G04 del aviso de cada cita según su propio estado (también una cita anterior, p. ej. un «No asistió» de una
// familia que volvió a reservar): el cierre (`enviado` o `fallido`) si existe; si no, `pendiente` si hubo algún intento.
// Las filas van del ancla de la cita a la transición siguiente del expediente, para no mezclar los avisos de otra cita.
// Las citas sin intentos no aparecen.
export async function estadoDeAvisos(db: Consultable, idsCita: number[]): Promise<Map<number, { tipo_evento: string; estado_envio: EstadoAviso }>> {
  if (!idsCita.length) return new Map();
  const { rows } = await db.query<{ id_cita: number; tipo_evento: string; estado_envio: EstadoAviso }>(
    `WITH aviso AS (
       SELECT c.id_cita, c.id_expediente,
              CASE c.estado WHEN 'reservada' THEN 'visita_confirmada' WHEN 'no_asistio' THEN 'visita_reprogramacion'
                            WHEN 'asistio' THEN 'credenciales_portal' END AS tipo_evento,
              r.fecha_hora AS ancla,
              (SELECT min(s.fecha_hora) FROM registro_auditoria s
                WHERE s.id_expediente = c.id_expediente AND s.tipo_evento = 'transicion_estado' AND s.id_evento > r.id_evento) AS hasta
         FROM cita c
         CROSS JOIN LATERAL (
           SELECT r.fecha_hora, r.id_evento FROM registro_auditoria r
            WHERE r.id_expediente = c.id_expediente AND r.tipo_evento = 'transicion_estado' AND r.detalle->>'id_cita' = c.id_cita::text
            ORDER BY r.id_evento DESC LIMIT 1) r
        WHERE c.id_cita = ANY($1::int[]) AND c.tipo_cita = 'visita')
     SELECT aviso.id_cita, aviso.tipo_evento,
            CASE WHEN f.enviado THEN 'enviado' WHEN f.fallido THEN 'fallido' ELSE 'pendiente' END AS estado_envio
       FROM aviso CROSS JOIN LATERAL (
         SELECT count(*)::int AS intentos,
                coalesce(bool_or(n.estado_envio = 'enviado'), false) AS enviado,
                coalesce(bool_or(n.estado_envio = 'fallido'), false) AS fallido
           FROM notificacion n
          WHERE n.id_expediente = aviso.id_expediente AND n.canal = 'correo' AND n.tipo_evento = aviso.tipo_evento
            AND n.fecha_envio >= aviso.ancla AND (aviso.hasta IS NULL OR n.fecha_envio < aviso.hasta)) f
      WHERE aviso.tipo_evento IS NOT NULL AND f.intentos > 0`,
    [idsCita],
  );
  return new Map(rows.map((r) => [r.id_cita, { tipo_evento: r.tipo_evento, estado_envio: r.estado_envio }]));
}

// Definición de C8 para HU0019: así se cuentan los avisos en los indicadores. Hoy solo la usa su prueba
// («HU0003-1.0 (indicadores) …»), que fija la definición; HU0019 debe usar esta consulta y no contar filas por su cuenta.
// Avisos cerrados por tipo y resultado en la campaña: cuenta las filas `enviado` y `fallido`, una por aviso (ADR-07);
// las `pendiente` son intentos de resultado desconocido y no cuentan como envíos.
export async function contarAvisosCerrados(db: Consultable, campana: string): Promise<{ tipo_evento: string; estado_envio: string; avisos: number }[]> {
  const { rows } = await db.query<{ tipo_evento: string; estado_envio: string; avisos: number }>(
    `SELECT n.tipo_evento, n.estado_envio::text AS estado_envio, count(*)::int AS avisos
       FROM notificacion n
       JOIN expediente e ON e.id_expediente = n.id_expediente
       JOIN grado g ON g.id_grado = e.id_grado
      WHERE g.campana_admision = $1 AND n.estado_envio IN ('enviado', 'fallido')
      GROUP BY n.tipo_evento, n.estado_envio
      ORDER BY n.tipo_evento, n.estado_envio`,
    [campana],
  );
  return rows;
}
