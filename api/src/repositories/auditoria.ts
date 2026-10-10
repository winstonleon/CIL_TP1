// registro_auditoria: bitácora de solo inserción (R6). Este repositorio solo inserta.
import type { Consultable } from "../db/pool";

// Catálogo de la sección 4.7 del modelo de datos (también lo exige un CHECK en la BD).
export type TipoEventoAuditoria =
  | "transicion_estado"
  | "atencion_inicio"
  | "atencion_fin"
  | "acceso_denegado"
  | "inicio_sesion"
  | "cambio_configuracion"
  | "gestion_usuario"
  | "notificacion_rebotada";

export interface EventoAuditoria {
  tipoEvento: TipoEventoAuditoria;
  idExpediente?: number | null;
  idPersonal?: number | null;
  estadoAnterior?: string | null;
  estadoNuevo?: string | null;
  detalle?: Record<string, unknown> | null;
}

export async function insertarEvento(db: Consultable, e: EventoAuditoria): Promise<number> {
  const { rows } = await db.query<{ id_evento: string }>(
    `INSERT INTO registro_auditoria (id_expediente, id_personal, tipo_evento, estado_anterior, estado_nuevo, detalle)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id_evento`,
    [
      e.idExpediente ?? null,
      e.idPersonal ?? null,
      e.tipoEvento,
      e.estadoAnterior ?? null,
      e.estadoNuevo ?? null,
      e.detalle ? JSON.stringify(e.detalle) : null,
    ],
  );
  return Number(rows[0]!.id_evento);
}
