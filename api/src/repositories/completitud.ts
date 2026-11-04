// Verificación de completitud (HU0017, R8, ADR-22). Cada verificación deja el evento `completitud_verificada` con
// `detalle = { resultado, faltantes: [{ id_requisito, id_apoderado }], derecho_registrado, id_notificacion? }`, solo ids.
// «Posterior» se decide por id_evento: la confirmación y la verificación insertan bajo el bloqueo del expediente, así que
// su orden de inserción es el de sus COMMIT.
// El aviso de faltantes de una verificación son las filas `documentos_faltantes` con id_notificacion ≥ la primera que
// insertó esa verificación (`detalle.id_notificacion`). No se usa un ancla de tiempo como en agendamiento: el cierre de
// un intento de la verificación anterior mueve su fecha_envio y caería después del ancla de la nueva.
import type { Consultable } from "../db/pool";
import type { IntentoAviso } from "./aviso";

export const TIPO_FALTANTES = "documentos_faltantes";

export interface Faltante {
  id_requisito: number;
  id_apoderado: number | null;
}

export interface Verificacion {
  id_evento: number;
  fecha_hora: Date;
  resultado: "completo" | "incompleto";
  faltantes: Faltante[];
  derecho_registrado: boolean;
  id_notificacion: number | null; // primera fila del aviso (solo si incompleto)
}

export async function ultimaVerificacion(db: Consultable, idExpediente: number): Promise<Verificacion | null> {
  const { rows } = await db.query<{ id_evento: string; fecha_hora: Date; detalle: Record<string, any> }>(
    `SELECT id_evento, fecha_hora, detalle FROM registro_auditoria
      WHERE id_expediente = $1 AND tipo_evento = 'completitud_verificada'
      ORDER BY id_evento DESC LIMIT 1`,
    [idExpediente],
  );
  const r = rows[0];
  if (!r) return null;
  return {
    id_evento: Number(r.id_evento),
    fecha_hora: r.fecha_hora,
    resultado: r.detalle.resultado,
    faltantes: r.detalle.faltantes ?? [],
    derecho_registrado: r.detalle.derecho_registrado === true,
    id_notificacion: r.detalle.id_notificacion ?? null,
  };
}

// id_evento de la última confirmación de P06 (null si nunca confirmó).
export async function idUltimaConfirmacion(db: Consultable, idExpediente: number): Promise<number | null> {
  const { rows } = await db.query<{ id_evento: string | null }>(
    "SELECT max(id_evento) AS id_evento FROM registro_auditoria WHERE id_expediente = $1 AND tipo_evento = 'documentos_confirmados'",
    [idExpediente],
  );
  return rows[0]?.id_evento ? Number(rows[0].id_evento) : null;
}

// ¿Cambió algo desde la verificación? (ajuste 2 y ADR-22): un documento vigente cargado después, el Pago del derecho
// que no estaba, o cualquier cambio de configuración de G09 (Secretaría pudo quitar o cambiar el requisito faltante).
export async function hayCambiosDesde(db: Consultable, idExpediente: number, v: Verificacion): Promise<boolean> {
  const { rows } = await db.query<{ cambios: boolean }>(
    `SELECT EXISTS (SELECT 1 FROM documento WHERE id_expediente = $1 AND vigente AND fecha_carga > $2)
         OR (NOT $3 AND EXISTS (SELECT 1 FROM pago WHERE id_expediente = $1 AND tipo_pago = 'derecho_admision'))
         OR EXISTS (SELECT 1 FROM registro_auditoria WHERE tipo_evento = 'cambio_configuracion' AND id_evento > $4) AS cambios`,
    [idExpediente, v.fecha_hora, v.derecho_registrado, v.id_evento],
  );
  return rows[0]!.cambios;
}

// Nombre visible de cada faltante: el tipo de documento y, si es por apoderado, su parentesco (nunca su nombre, C11).
// Un requisito que G09 quitó después de la verificación ya no se muestra.
export async function resolverFaltantes(
  db: Consultable,
  idExpediente: number,
  faltantes: Faltante[],
): Promise<{ tipo_documento: string; parentesco: string | null }[]> {
  if (faltantes.length === 0) return [];
  const { rows } = await db.query<{ tipo_documento: string; parentesco: string | null }>(
    `SELECT r.tipo_documento, pa.parentesco
       FROM jsonb_to_recordset($2::jsonb) AS f(id_requisito int, id_apoderado int)
       JOIN requisito_documental r ON r.id_requisito = f.id_requisito
       JOIN expediente e ON e.id_expediente = $1
       LEFT JOIN postulante_apoderado pa ON pa.id_postulante = e.id_postulante AND pa.id_apoderado = f.id_apoderado
      ORDER BY r.id_requisito, f.id_apoderado NULLS FIRST`,
    [idExpediente, JSON.stringify(faltantes)],
  );
  return rows;
}

// Intentos del aviso de una verificación, en orden y bloqueados hasta el fin de la transacción.
export async function bloquearIntentosFaltantes(
  db: Consultable,
  a: { idExpediente: number; desde: number; minutosReintento: number },
): Promise<IntentoAviso[]> {
  const { rows } = await db.query<IntentoAviso>(
    `SELECT id_notificacion, estado_envio::text AS estado_envio, fecha_envio < now() - make_interval(mins => $3) AS vencido
       FROM notificacion
      WHERE id_expediente = $1 AND canal = 'correo' AND tipo_evento = '${TIPO_FALTANTES}' AND id_notificacion >= $2
      ORDER BY id_notificacion
        FOR UPDATE`,
    [a.idExpediente, a.desde, a.minutosReintento],
  );
  return rows;
}

// Barrido de recepcion-registro (ADR-16): expedientes en en_postulacion con (1) una confirmación sin verificar de hace más
// de `minutosRegistro` (deja pasar el webhook) o (2) el aviso de faltantes de su verificación vigente sin cerrar y con el
// último intento `pendiente` de hace más de `minutosReintento`. Los más antiguos primero.
export async function listarVerificacionesPendientes(
  db: Consultable,
  o: { minutosRegistro: number; minutosReintento: number; limite: number },
): Promise<number[]> {
  const { rows } = await db.query<{ id_expediente: number }>(
    `SELECT e.id_expediente
       FROM expediente e
      CROSS JOIN LATERAL (
             SELECT r.id_evento, r.fecha_hora FROM registro_auditoria r
              WHERE r.id_expediente = e.id_expediente AND r.tipo_evento = 'documentos_confirmados'
              ORDER BY r.id_evento DESC LIMIT 1) c
       LEFT JOIN LATERAL (
             SELECT r.id_evento, r.detalle FROM registro_auditoria r
              WHERE r.id_expediente = e.id_expediente AND r.tipo_evento = 'completitud_verificada'
              ORDER BY r.id_evento DESC LIMIT 1) v ON true
       LEFT JOIN LATERAL (
             SELECT coalesce(bool_or(n.estado_envio <> 'pendiente'), false) AS cerrado,
                    (array_agg(n.estado_envio::text ORDER BY n.id_notificacion DESC))[1] AS ultimo_estado,
                    (array_agg(n.fecha_envio ORDER BY n.id_notificacion DESC))[1] AS ultimo_intento
               FROM notificacion n
              WHERE n.id_expediente = e.id_expediente AND n.canal = 'correo' AND n.tipo_evento = '${TIPO_FALTANTES}'
                AND n.id_notificacion >= (v.detalle->>'id_notificacion')::int) f ON true
      WHERE e.estado = 'en_postulacion'
        AND (((v.id_evento IS NULL OR c.id_evento > v.id_evento) AND c.fecha_hora < now() - make_interval(mins => $1))
          OR (c.id_evento < v.id_evento AND v.detalle->>'resultado' = 'incompleto' AND NOT f.cerrado
              AND f.ultimo_estado = 'pendiente' AND f.ultimo_intento < now() - make_interval(mins => $2)))
      ORDER BY c.fecha_hora, e.id_expediente
      LIMIT $3`,
    [o.minutosRegistro, o.minutosReintento, o.limite],
  );
  return rows.map((r) => r.id_expediente);
}
