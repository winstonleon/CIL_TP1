// Seguimiento programado (HU0018, R20 y R21; plan del bloque 11). Una sola definición de «acción pendiente de la familia»
// para el barrido diario, la reserva del recordatorio y la caducidad: así no pueden diferir (decisiones D1-A, D2-B y D3-A
// de John, 07/11/2026). Por cada expediente con una acción pendiente da su etapa, el ancla del plazo (fija: no se reinicia
// porque la familia interactúe, sí con una observación nueva), el vencimiento y la última interacción de la familia.
// - Etapas: postulación (ficha, documentos y derecho), subsanación (rama o derecho observado), agendamiento (las tres
//   ramas conformes, B1), reprogramación (la última cita académica en no_asistio, HU0025-2.0) y cuota (vacante con cuota
//   > 0 sin Pago o con el Pago observado). Un Pago en conciliación o conforme espera al colegio: no es una acción pendiente.
// - Interacción (D3-A, sin columnas nuevas): los eventos de la familia en la bitácora, la carga de un documento y el
//   guardado del cuestionario (también el autoguardado de P05). Abrir el portal no deja rastro (C24) y el registro del
//   derecho no tiene fecha (C49): no cuentan.
// - La campaña DEMO nunca entra (C72): sus expedientes no se recuerdan ni caducan.
// Lista cerrada de constantes en el SQL: nunca entra texto del usuario.
import type { Consultable } from "../db/pool";
import { CAMPANA_DEMO } from "../services/indicadores";

export const ETAPAS = ["postulacion", "subsanacion", "agendamiento", "reprogramacion", "cuota"] as const;
export type EtapaSeguimiento = (typeof ETAPAS)[number];
export type Plazos = Readonly<Record<EtapaSeguimiento, number>>;

export const TIPO_RECORDATORIO_INACTIVIDAD = "recordatorio_48h"; // R20
export const TIPO_CADUCADO_FAMILIA = "expediente_caducado";
export const TIPO_CADUCADO_ADMISION = "expediente_caducado_admision";
export const TIPOS_AVISO_SEGUIMIENTO = [TIPO_RECORDATORIO_INACTIVIDAD, TIPO_CADUCADO_FAMILIA, TIPO_CADUCADO_ADMISION] as const;
export type TipoAvisoSeguimiento = (typeof TIPOS_AVISO_SEGUIMIENTO)[number];

// R20: «si no hubo interacción en 48 horas». Es regla, no un valor provisional.
export const HORAS_SIN_INTERACCION = 48;

export interface SituacionSeguimiento {
  id_expediente: number;
  estado: string;
  etapa: EtapaSeguimiento;
  ancla: Date;
  vence: Date;
  ultima_interaccion: Date | null;
  caduca: boolean; // venció el plazo de la etapa (R21)
  recordar: boolean; // 48 h sin interacción, sin recordatorio en este período y antes del vencimiento (R20)
}

// Última transición del campo `estado` del expediente al estado dado (los cambios de las ramas llevan otro campo).
const transicionA = (e: string, estado: string) => `(SELECT r.fecha_hora FROM registro_auditoria r
      WHERE r.id_expediente = ${e}.id_expediente AND r.tipo_evento = 'transicion_estado'
        AND r.detalle->>'campo' = 'estado' AND r.estado_nuevo = ${estado} ORDER BY r.id_evento DESC LIMIT 1)`;

const ultimoFin = (e: string, condicion: string) => `(SELECT max(r.fecha_hora) FROM registro_auditoria r
      WHERE r.id_expediente = ${e}.id_expediente AND r.tipo_evento = 'atencion_fin' AND ${condicion})`;

// $1..$5: plazos en días por etapa; $6: id del expediente o null (todos); $7: la campaña excluida (DEMO, C72).
const SITUACION = `
  WITH base AS (
    SELECT e.id_expediente, e.estado::text AS estado, e.fecha_registro,
           e.estado_documental::text AS documental, e.estado_financiero::text AS financiera,
           pd.estado_validacion::text AS derecho, pc.id_pago AS id_pago_cuota, pc.estado_validacion::text AS cuota,
           g.monto_cuota_ingreso
      FROM expediente e
      JOIN grado g ON g.id_grado = e.id_grado
      LEFT JOIN pago pd ON pd.id_expediente = e.id_expediente AND pd.tipo_pago = 'derecho_admision' AND pd.numero_fraccion = 1
      LEFT JOIN pago pc ON pc.id_expediente = e.id_expediente AND pc.tipo_pago = 'cuota_ingreso' AND pc.numero_fraccion = 1
     WHERE g.campana_admision <> $7
       AND e.estado IN ('portal_habilitado', 'en_postulacion', 'en_validacion', 'en_evaluacion', 'vacante_asignada')
       AND ($6::int IS NULL OR e.id_expediente = $6)),
  etapa AS (
    SELECT b.*, CASE
      WHEN b.estado IN ('portal_habilitado', 'en_postulacion') THEN 'postulacion'
      WHEN b.estado = 'en_validacion' AND (b.documental = 'observado' OR b.financiera = 'observado' OR b.derecho = 'observado') THEN 'subsanacion'
      WHEN b.estado = 'en_validacion' AND b.documental = 'conforme' AND b.financiera = 'conforme' AND b.derecho = 'conforme' THEN 'agendamiento'
      WHEN b.estado = 'en_evaluacion' AND (SELECT c.estado::text FROM cita c
             WHERE c.id_expediente = b.id_expediente AND c.tipo_cita = 'evaluacion_academica'
             ORDER BY c.id_cita DESC LIMIT 1) = 'no_asistio' THEN 'reprogramacion'
      WHEN b.estado = 'vacante_asignada' AND b.monto_cuota_ingreso > 0 AND (b.cuota IS NULL OR b.cuota = 'observado') THEN 'cuota'
    END AS etapa
      FROM base b),
  anclada AS (
    SELECT x.*, coalesce(CASE x.etapa
      WHEN 'postulacion' THEN ${transicionA("x", "'portal_habilitado'")}
      WHEN 'subsanacion' THEN greatest(${transicionA("x", "x.estado")}, ${ultimoFin("x", "r.detalle->>'decision' = 'observado'")})
      WHEN 'agendamiento' THEN greatest(${transicionA("x", "x.estado")}, ${ultimoFin("x", "r.detalle->>'habilita_agendamiento' = 'true'")})
      WHEN 'reprogramacion' THEN greatest(${transicionA("x", "x.estado")}, ${ultimoFin("x", "r.detalle->>'decision' = 'inasistencia'")})
      WHEN 'cuota' THEN greatest(${transicionA("x", "x.estado")}, ${ultimoFin(
        "x",
        "r.detalle->>'decision' = 'observado' AND r.detalle->'item'->>'tipo' = 'pago' AND r.detalle->'item'->>'id' = x.id_pago_cuota::text",
      )})
    END, x.fecha_registro) AS ancla,
    CASE x.etapa WHEN 'postulacion' THEN $1::int WHEN 'subsanacion' THEN $2::int WHEN 'agendamiento' THEN $3::int WHEN 'reprogramacion' THEN $4::int ELSE $5::int END AS plazo,
    greatest(
      (SELECT max(r.fecha_hora) FROM registro_auditoria r
        WHERE r.id_expediente = x.id_expediente
          AND (r.tipo_evento IN ('documentos_confirmados', 'subsanacion_registrada', 'cuota_registrada', 'cita_reprogramada')
            OR (r.tipo_evento = 'transicion_estado' AND r.detalle->>'campo' = 'estado' AND r.estado_nuevo = 'en_postulacion'))),
      (SELECT max(d.fecha_carga) FROM documento d WHERE d.id_expediente = x.id_expediente),
      (SELECT q.fecha_actualizacion FROM cuestionario_expectativas q WHERE q.id_expediente = x.id_expediente)
    ) AS ultima_interaccion
      FROM etapa x
     WHERE x.etapa IS NOT NULL),
  situacion AS (
    SELECT a.id_expediente, a.estado, a.etapa, a.ancla, a.ancla + make_interval(days => a.plazo) AS vence, a.ultima_interaccion
      FROM anclada a)
  SELECT s.*, now() >= s.vence AS caduca,
         now() < s.vence
           AND now() >= greatest(s.ancla, s.ultima_interaccion) + make_interval(hours => ${HORAS_SIN_INTERACCION})
           AND NOT EXISTS (SELECT 1 FROM notificacion n
                            WHERE n.id_expediente = s.id_expediente AND n.canal = 'correo'
                              AND n.tipo_evento = '${TIPO_RECORDATORIO_INACTIVIDAD}' AND n.fecha_envio >= s.ancla) AS recordar
    FROM situacion s`;

// La campaña excluida es siempre DEMO (C72); validarDemo (scripts/demoGenerador.ts) pasa la campaña que valida, que en
// `npm run dev:demo` es DEMO, para comprobar el barrido como lo hará n8n.
const parametros = (p: Plazos, id: number | null, campanaExcluida: string = CAMPANA_DEMO) => [
  p.postulacion,
  p.subsanacion,
  p.agendamiento,
  p.reprogramacion,
  p.cuota,
  id,
  campanaExcluida,
];

// La situación de un expediente (null si no tiene una acción pendiente de la familia o es de la campaña DEMO). Con el
// expediente ya bloqueado, la lectura es la vigente: la caducidad y la reserva la recalculan bajo el bloqueo.
export async function situacionDe(db: Consultable, plazos: Plazos, idExpediente: number): Promise<SituacionSeguimiento | null> {
  const { rows } = await db.query<SituacionSeguimiento>(SITUACION, parametros(plazos, idExpediente));
  return rows[0] ?? null;
}

// Revisión diaria (R20 y R21): primero las caducidades y después los recordatorios, los más antiguos primero.
export async function listarSeguimientoPendiente(
  db: Consultable,
  plazos: Plazos,
  limite: number,
  campanaExcluida: string = CAMPANA_DEMO,
): Promise<{ caducidades: number[]; recordatorios: number[] }> {
  const { rows } = await db.query<{ id_expediente: number; caduca: boolean }>(
    `SELECT id_expediente, caduca FROM (${SITUACION}) s WHERE caduca OR recordar ORDER BY caduca DESC, ancla, id_expediente LIMIT $8`,
    [...parametros(plazos, null, campanaExcluida), limite],
  );
  return {
    caducidades: rows.filter((r) => r.caduca).map((r) => r.id_expediente),
    recordatorios: rows.filter((r) => !r.caduca).map((r) => r.id_expediente),
  };
}

// Retoma de los avisos (ADR-07, cada minuto): el último intento `pendiente` hace más de `minutosReintento` y el aviso sin
// cerrar. El recordatorio, solo el del período vigente y antes del vencimiento; los de la caducidad, mientras el
// expediente siga en `caducado` (es final: todas las filas del tipo son de esa caducidad).
export async function listarAvisosSeguimientoPendientes(
  db: Consultable,
  plazos: Plazos,
  o: { minutosReintento: number; limite: number; campanaExcluida?: string },
): Promise<{ id_expediente: number; tipo_evento: TipoAvisoSeguimiento }[]> {
  const { rows } = await db.query<{ id_expediente: number; tipo_evento: TipoAvisoSeguimiento }>(
    `WITH aviso AS (
       SELECT s.id_expediente, '${TIPO_RECORDATORIO_INACTIVIDAD}'::text AS tipo, s.ancla FROM (${SITUACION}) s WHERE NOT s.caduca
       UNION ALL
       SELECT e.id_expediente, t.tipo, '-infinity'::timestamptz
         FROM expediente e JOIN grado g ON g.id_grado = e.id_grado
        CROSS JOIN (VALUES ('${TIPO_CADUCADO_FAMILIA}'), ('${TIPO_CADUCADO_ADMISION}')) t(tipo)
        WHERE e.estado = 'caducado' AND g.campana_admision <> $7)
     SELECT aviso.id_expediente, aviso.tipo AS tipo_evento
       FROM aviso
      CROSS JOIN LATERAL (
             SELECT count(*)::int AS intentos,
                    coalesce(bool_or(n.estado_envio <> 'pendiente'), false) AS cerrado,
                    (array_agg(n.estado_envio::text ORDER BY n.id_notificacion DESC))[1] AS ultimo_estado,
                    (array_agg(n.fecha_envio ORDER BY n.id_notificacion DESC))[1] AS ultimo_intento
               FROM notificacion n
              WHERE n.id_expediente = aviso.id_expediente AND n.canal = 'correo' AND n.tipo_evento = aviso.tipo
                AND n.fecha_envio >= aviso.ancla) f
      WHERE f.intentos > 0 AND NOT f.cerrado AND f.ultimo_estado = 'pendiente'
        AND f.ultimo_intento < now() - make_interval(mins => $8)
      ORDER BY f.ultimo_intento, aviso.id_expediente, aviso.tipo
      LIMIT $9`,
    [...parametros(plazos, null, o.campanaExcluida), o.minutosReintento, o.limite],
  );
  return rows;
}

// R21: las citas reservadas del expediente pasan a `cancelada`. Orden de bloqueo: el expediente (ya bloqueado), los
// horarios en orden por id (el de «Confirmar citas», HU0009) y las citas. El cupo vuelve solo si el turno es futuro: uno
// que ya pasó no se puede volver a reservar (como la inasistencia, ADR-25).
export async function cancelarCitasReservadas(db: Consultable, idExpediente: number): Promise<{ canceladas: number[]; cupos_devueltos: number[] }> {
  const { rows: citas } = await db.query<{ id_cita: number; id_horario: number | null }>(
    "SELECT id_cita, id_horario FROM cita WHERE id_expediente = $1 AND estado = 'reservada' ORDER BY id_cita",
    [idExpediente],
  );
  if (!citas.length) return { canceladas: [], cupos_devueltos: [] };
  const horarios = [...new Set(citas.map((c) => c.id_horario).filter((h): h is number => h !== null))].sort((a, b) => a - b);
  if (horarios.length) await db.query("SELECT id_horario FROM horario_disponible WHERE id_horario = ANY($1::int[]) ORDER BY id_horario FOR UPDATE", [horarios]);
  const { rows } = await db.query<{ id_cita: number; id_horario: number | null; futura: boolean }>(
    `UPDATE cita SET estado = 'cancelada'
      WHERE id_expediente = $1 AND estado = 'reservada'
      RETURNING id_cita, id_horario, fecha_hora > now() AS futura`,
    [idExpediente],
  );
  const devueltos: number[] = [];
  for (const c of rows.sort((a, b) => a.id_cita - b.id_cita)) {
    if (c.futura && c.id_horario !== null) {
      await db.query("UPDATE horario_disponible SET cupos = cupos + 1 WHERE id_horario = $1", [c.id_horario]);
      devueltos.push(c.id_cita);
    }
  }
  return { canceladas: rows.map((r) => r.id_cita).sort((a, b) => a - b), cupos_devueltos: devueltos };
}

export interface Caducidad {
  fecha: Date;
  estado_anterior: string | null;
  etapa: EtapaSeguimiento | null;
  vence: string | null;
}

// La transición a `caducado` del expediente (P04, C78; y el texto de los avisos de la caducidad).
export async function leerCaducidad(db: Consultable, idExpediente: number): Promise<Caducidad | null> {
  const { rows } = await db.query<Caducidad>(
    `SELECT fecha_hora AS fecha, estado_anterior, detalle->>'etapa' AS etapa, detalle->>'vence' AS vence FROM registro_auditoria
      WHERE id_expediente = $1 AND tipo_evento = 'transicion_estado' AND detalle->>'campo' = 'estado' AND estado_nuevo = 'caducado'
      ORDER BY id_evento DESC LIMIT 1`,
    [idExpediente],
  );
  return rows[0] ?? null;
}
