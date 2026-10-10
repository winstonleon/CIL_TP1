// Datos que necesita el flujo notificacion-multicanal (F6) y registro de cada envío (R22).
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
