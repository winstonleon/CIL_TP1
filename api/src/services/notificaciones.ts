// Servicios que usa el flujo notificacion-multicanal de n8n a través de /internal/*.
import { obtenerPool } from "../db/pool";
import { ErrorApi } from "../errores";
import { buscarContactoExpediente, insertarNotificacion, type ContactoExpediente, type NuevaNotificacion } from "../repositories/notificacion";

export async function obtenerContactoExpediente(idExpediente: number): Promise<ContactoExpediente> {
  const contacto = await buscarContactoExpediente(obtenerPool(), idExpediente);
  if (!contacto) throw new ErrorApi(404, "EXPEDIENTE_NO_ENCONTRADO", "El expediente no existe");
  return contacto;
}

export async function registrarNotificacion(n: NuevaNotificacion): Promise<number> {
  try {
    return await insertarNotificacion(obtenerPool(), n);
  } catch (e) {
    // FK de notificacion.id_expediente: el expediente no existe.
    if ((e as { code?: string }).code === "23503") {
      throw new ErrorApi(404, "EXPEDIENTE_NO_ENCONTRADO", "El expediente no existe");
    }
    throw e;
  }
}
