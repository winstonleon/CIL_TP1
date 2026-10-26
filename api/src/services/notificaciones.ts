// Servicios que usa el flujo notificacion-multicanal de n8n a través de /internal/*.
import { enTransaccion, obtenerPool } from "../db/pool";
import { ErrorApi } from "../errores";
import {
  actualizarEstadoEnvio,
  bloquearNotificacion,
  buscarContactoExpediente,
  insertarNotificacion,
  type ContactoExpediente,
  type NuevaNotificacion,
} from "../repositories/notificacion";

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

// Cierra una notificación reservada antes del envío (carpeta informativa, HU0002): de `pendiente` a `enviado` o
// `fallido`. Repetir el mismo valor no cambia nada (un reintento de n8n tras perder la respuesta, C8); pasar de un
// estado cerrado a otro es un conflicto.
export async function cerrarNotificacion(idNotificacion: number, estado: "enviado" | "fallido") {
  return enTransaccion(async (c) => {
    const n = await bloquearNotificacion(c, idNotificacion);
    if (!n) throw new ErrorApi(404, "NOTIFICACION_NO_ENCONTRADA", "La notificación no existe");
    if (n.estado_envio !== estado) {
      if (n.estado_envio !== "pendiente") {
        throw new ErrorApi(409, "NOTIFICACION_CERRADA", "La notificación ya tiene un resultado distinto");
      }
      await actualizarEstadoEnvio(c, idNotificacion, estado);
    }
    return { id_notificacion: idNotificacion, estado_envio: estado };
  });
}
