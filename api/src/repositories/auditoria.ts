// registro_auditoria: bitácora de solo inserción (R6). Este repositorio solo inserta.
import type { Consultable } from "../db/pool";

// Catálogo de la sección 4.7 del modelo de datos (también lo exige un CHECK en la BD).
export type TipoEventoAuditoria =
  | "transicion_estado"
  | "atencion_inicio"
  | "atencion_fin"
  | "acceso_denegado"
  | "cambio_configuracion"
  | "gestion_usuario"
  | "notificacion_rebotada"
  | "documentos_confirmados"
  | "completitud_verificada"
  | "subsanacion_registrada"
  | "cita_reprogramada"
  | "cuota_registrada";

export interface EventoAuditoria {
  tipoEvento: TipoEventoAuditoria;
  idExpediente?: number | null;
  idPersonal?: number | null;
  estadoAnterior?: string | null;
  estadoNuevo?: string | null;
  detalle?: Record<string, unknown> | null;
  // La hora real de la inserción (clock_timestamp) y no la del inicio de la transacción. HU0017: la verificación se
  // compara con la fecha_carga de los documentos, que se fija con la misma hora real.
  horaReal?: boolean;
}

// ¿Ya se registró el rebote de esta notificación? (HU0002-2.0: repetir el aviso no duplica eventos).
export async function existeRebote(db: Consultable, idNotificacion: number): Promise<boolean> {
  const { rowCount } = await db.query(
    "SELECT 1 FROM registro_auditoria WHERE tipo_evento = 'notificacion_rebotada' AND (detalle->>'id_notificacion')::int = $1",
    [idNotificacion],
  );
  return (rowCount ?? 0) > 0;
}

// Fecha del último evento de ese tipo en el expediente (null si no hay). HU0006: «confirmado_en» de P06.
export async function fechaUltimoEvento(db: Consultable, idExpediente: number, tipoEvento: TipoEventoAuditoria): Promise<Date | null> {
  const { rows } = await db.query<{ fecha_hora: Date | null }>(
    "SELECT max(fecha_hora) AS fecha_hora FROM registro_auditoria WHERE id_expediente = $1 AND tipo_evento = $2",
    [idExpediente, tipoEvento],
  );
  return rows[0]?.fecha_hora ?? null;
}

// Último atencion_inicio de esa persona y ese ítem que ningún atencion_fin cerró todavía (§4.7, par inicio/fin).
export async function inicioAbierto(db: Consultable, idPersonal: number, item: { tipo: string; id: number | string }): Promise<number | null> {
  const { rows } = await db.query<{ id_evento: string }>(
    `SELECT i.id_evento FROM registro_auditoria i
      WHERE i.tipo_evento = 'atencion_inicio' AND i.id_personal = $1 AND i.detalle->'item' = $2::jsonb
        AND NOT EXISTS (SELECT 1 FROM registro_auditoria f
                         WHERE f.tipo_evento = 'atencion_fin' AND (f.detalle->>'id_evento_inicio')::bigint = i.id_evento)
      ORDER BY i.id_evento DESC LIMIT 1`,
    [idPersonal, JSON.stringify(item)],
  );
  return rows[0] ? Number(rows[0].id_evento) : null;
}

export interface EventoHistorial {
  tipo_evento: string;
  estado_nuevo: string | null;
  fecha_hora: Date;
  campo: string | null;
  item: string | null;
  decision: string | null;
  resultado: string | null;
  documentos: string | null;
  tipo_pago: string | null;
}

// Historial de P04 (HU0020-1.0): solo los campos que la lista blanca necesita, nunca `detalle` entero ni quién actuó. Lo más
// reciente primero, como el mockup.
export async function listarHistorial(db: Consultable, idExpediente: number, tipos: readonly string[]): Promise<EventoHistorial[]> {
  const { rows } = await db.query<EventoHistorial>(
    `SELECT r.tipo_evento, r.estado_nuevo, r.fecha_hora, r.detalle->>'campo' AS campo, r.detalle->'item'->>'tipo' AS item,
            r.detalle->>'decision' AS decision, r.detalle->>'resultado' AS resultado, r.detalle->>'documentos_vigentes' AS documentos,
            p.tipo_pago::text AS tipo_pago
       FROM registro_auditoria r
       LEFT JOIN pago p ON r.detalle->'item'->>'tipo' = 'pago' AND p.id_pago::text = r.detalle->'item'->>'id'
      WHERE r.id_expediente = $1 AND r.tipo_evento = ANY($2::text[])
      ORDER BY r.id_evento DESC`,
    [idExpediente, tipos],
  );
  return rows;
}

export async function insertarEvento(db: Consultable, e: EventoAuditoria): Promise<number> {
  const { rows } = await db.query<{ id_evento: string }>(
    `INSERT INTO registro_auditoria (id_expediente, id_personal, tipo_evento, estado_anterior, estado_nuevo, detalle, fecha_hora)
     VALUES ($1, $2, $3, $4, $5, $6, CASE WHEN $7::boolean THEN clock_timestamp() ELSE now() END)
     RETURNING id_evento`,
    [
      e.idExpediente ?? null,
      e.idPersonal ?? null,
      e.tipoEvento,
      e.estadoAnterior ?? null,
      e.estadoNuevo ?? null,
      e.detalle ? JSON.stringify(e.detalle) : null,
      e.horaReal === true,
    ],
  );
  return Number(rows[0]!.id_evento);
}
