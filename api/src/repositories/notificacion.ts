// Datos que necesita el flujo notificacion-multicanal (F6) y registro de cada envío (R22). La carpeta informativa
// (captacion, HU0002) se reserva como `pendiente` antes del envío y se cierra con su resultado.
import type { Consultable } from "../db/pool";

export type CanalNotificacion = "correo" | "whatsapp";
export type EstadoEnvio = "pendiente" | "enviado" | "fallido";

export interface ContactoExpediente {
  id_expediente: number;
  correo: string;
  autoriza_whatsapp: boolean;
}

// Correo del apoderado titular y la autorización de WhatsApp de su consentimiento más reciente
// (Consentimiento es histórico: ante una nueva política se inserta otra fila).
export async function buscarContactoExpediente(db: Consultable, idExpediente: number): Promise<ContactoExpediente | null> {
  const { rows } = await db.query<ContactoExpediente>(
    `SELECT e.id_expediente,
            a.correo,
            coalesce((SELECT c.autoriza_whatsapp FROM consentimiento c
                       WHERE c.id_apoderado = a.id_apoderado
                       ORDER BY c.fecha_hora_aceptacion DESC, c.id_consentimiento DESC
                       LIMIT 1), false) AS autoriza_whatsapp
       FROM expediente e
       JOIN apoderado a ON a.id_apoderado = e.id_apoderado_titular
      WHERE e.id_expediente = $1`,
    [idExpediente],
  );
  return rows[0] ?? null;
}

export interface NuevaNotificacion {
  idExpediente: number;
  canal: CanalNotificacion;
  tipoEvento: string;
  estadoEnvio: EstadoEnvio;
}

export async function insertarNotificacion(db: Consultable, n: NuevaNotificacion): Promise<number> {
  const { rows } = await db.query<{ id_notificacion: number }>(
    `INSERT INTO notificacion (id_expediente, canal, tipo_evento, estado_envio)
     VALUES ($1, $2::canal_notificacion, $3, $4::estado_envio)
     RETURNING id_notificacion`,
    [n.idExpediente, n.canal, n.tipoEvento, n.estadoEnvio],
  );
  return rows[0]!.id_notificacion;
}

export interface FilaNotificacion {
  id_notificacion: number;
  id_expediente: number;
  canal: CanalNotificacion;
  tipo_evento: string;
  estado_envio: EstadoEnvio;
}

const COLUMNAS = "id_notificacion, id_expediente, canal::text AS canal, tipo_evento, estado_envio::text AS estado_envio";

// Sin bloqueo: el rebote la lee primero para bloquear el expediente antes que la notificación (mismo orden que la
// reserva de la carpeta, así no hay interbloqueos).
export async function leerNotificacion(db: Consultable, idNotificacion: number): Promise<FilaNotificacion | null> {
  const { rows } = await db.query<FilaNotificacion>(`SELECT ${COLUMNAS} FROM notificacion WHERE id_notificacion = $1`, [idNotificacion]);
  return rows[0] ?? null;
}

// Lee la notificación y bloquea la fila hasta el fin de la transacción (SELECT ... FOR UPDATE).
export async function bloquearNotificacion(db: Consultable, idNotificacion: number): Promise<FilaNotificacion | null> {
  const { rows } = await db.query<FilaNotificacion>(
    `SELECT ${COLUMNAS} FROM notificacion WHERE id_notificacion = $1 FOR UPDATE`,
    [idNotificacion],
  );
  return rows[0] ?? null;
}

// Cierra el envío: fecha_envio pasa a ser la hora del resultado (enviado o fallido), no la de la reserva.
export async function actualizarEstadoEnvio(db: Consultable, idNotificacion: number, estado: EstadoEnvio): Promise<void> {
  await db.query("UPDATE notificacion SET estado_envio = $2::estado_envio, fecha_envio = now() WHERE id_notificacion = $1", [
    idNotificacion,
    estado,
  ]);
}

// ---------- carpeta informativa (flujo captacion, HU0002) ----------

// La notificación de la carpeta del expediente (correo), con la fila bloqueada. `vencida`: sigue pendiente y su último
// intento (fecha_envio) fue hace más de `minutosReintento` minutos, así que se puede retomar (C27, D7).
export async function bloquearCarpeta(
  db: Consultable,
  idExpediente: number,
  tipoEvento: string,
  minutosReintento: number,
): Promise<{ id_notificacion: number; estado_envio: EstadoEnvio; vencida: boolean } | null> {
  const { rows } = await db.query<{ id_notificacion: number; estado_envio: EstadoEnvio; vencida: boolean }>(
    `SELECT id_notificacion, estado_envio::text AS estado_envio,
            (estado_envio = 'pendiente' AND fecha_envio < now() - make_interval(mins => $3)) AS vencida
       FROM notificacion
      WHERE id_expediente = $1 AND canal = 'correo' AND tipo_evento = $2
      ORDER BY id_notificacion
      LIMIT 1
        FOR UPDATE`,
    [idExpediente, tipoEvento, minutosReintento],
  );
  return rows[0] ?? null;
}

// Nuevo intento de una carpeta pendiente: fecha_envio marca el intento, así el barrido no la vuelve a tomar enseguida.
export async function retomarNotificacion(db: Consultable, idNotificacion: number): Promise<void> {
  await db.query("UPDATE notificacion SET fecha_envio = now() WHERE id_notificacion = $1", [idNotificacion]);
}

// Barrido de captacion (C27): prospectos sin carpeta registrados hace más de `minutosRegistro` minutos, y carpetas
// pendientes intentadas hace más de `minutosReintento` minutos. Los más antiguos primero.
export async function listarCarpetasPendientes(
  db: Consultable,
  o: { tipoEvento: string; minutosRegistro: number; minutosReintento: number; limite: number },
): Promise<number[]> {
  const { rows } = await db.query<{ id_expediente: number }>(
    `SELECT e.id_expediente
       FROM expediente e
       LEFT JOIN notificacion n
         ON n.id_expediente = e.id_expediente AND n.canal = 'correo' AND n.tipo_evento = $1
      WHERE e.estado = 'prospecto'
        AND ((n.id_notificacion IS NULL AND e.fecha_registro < now() - make_interval(mins => $2))
          OR (n.estado_envio = 'pendiente' AND n.fecha_envio < now() - make_interval(mins => $3)))
      ORDER BY e.fecha_registro, e.id_expediente
      LIMIT $4`,
    [o.tipoEvento, o.minutosRegistro, o.minutosReintento, o.limite],
  );
  return rows.map((r) => r.id_expediente);
}
