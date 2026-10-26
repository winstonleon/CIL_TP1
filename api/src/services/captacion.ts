// Flujo captacion de n8n (HU0002) a través de /internal/*: reserva y armado de la carpeta informativa, barrido de
// pendientes (C27) y registro del rebote síncrono del correo (HU0002-2.0).
// - La reserva crea la notificación `pendiente` ANTES de enviar, con el expediente bloqueado: un reintento de la API
//   (ADR-16), el barrido y el webhook a la vez no duplican la carpeta (C27 b).
// - Una `pendiente` intentada hace más de 10 min se retoma (D7: un 500 o un error técnico de SMTP la dejan pendiente).
//   Se acepta «al menos una vez»: si n8n cae justo después de enviar, la retoma puede repetir un correo (S4).
// - Orden de bloqueo: expediente y luego notificación, en la reserva y en el rebote (sin interbloqueos).
import { obtenerConfig } from "../config";
import { enTransaccion, obtenerPool } from "../db/pool";
import { ErrorApi } from "../errores";
import { existeRebote, insertarEvento } from "../repositories/auditoria";
import { bloquearDatosCarpeta, bloquearEstado } from "../repositories/expediente";
import {
  actualizarEstadoEnvio,
  bloquearCarpeta,
  bloquearNotificacion,
  insertarNotificacion,
  leerNotificacion,
  listarCarpetasPendientes,
  retomarNotificacion,
  type EstadoEnvio,
} from "../repositories/notificacion";
import { componerCarpeta, enlaceVisita } from "./carpetaInformativa";
import { transicionarExpediente } from "./expedientes/transicionarExpediente";

// Ejemplo de la nota de Notificacion.tipo_evento (S1).
export const TIPO_EVENTO_CARPETA = "carpeta_enviada";
export const MINUTOS_REGISTRO = 1; // el barrido deja pasar el camino normal del webhook (menos de un minuto)
export const MINUTOS_REINTENTO = 10;
export const MAXIMO_PENDIENTES = 20;

export interface CarpetaReservada {
  id_notificacion: number;
  tipo_evento: string;
  asunto: string;
  cuerpo: string;
}

export async function reservarCarpeta(idExpediente: number): Promise<CarpetaReservada> {
  return enTransaccion(async (c) => {
    const datos = await bloquearDatosCarpeta(c, idExpediente);
    if (!datos) throw new ErrorApi(404, "EXPEDIENTE_NO_ENCONTRADO", "El expediente no existe");
    if (datos.estado !== "prospecto") {
      throw new ErrorApi(409, "ESTADO_NO_PERMITE_CARPETA", "El expediente no está en prospecto");
    }
    const previa = await bloquearCarpeta(c, idExpediente, TIPO_EVENTO_CARPETA, MINUTOS_REINTENTO);
    let idNotificacion: number;
    if (!previa) {
      idNotificacion = await insertarNotificacion(c, {
        idExpediente,
        canal: "correo",
        tipoEvento: TIPO_EVENTO_CARPETA,
        estadoEnvio: "pendiente",
      });
    } else if (previa.vencida) {
      await retomarNotificacion(c, previa.id_notificacion);
      idNotificacion = previa.id_notificacion;
    } else {
      throw new ErrorApi(409, "CARPETA_YA_REGISTRADA", "La carpeta informativa de este expediente ya está registrada o en curso");
    }
    const { asunto, cuerpo } = componerCarpeta({
      nombres: datos.nombres,
      nombreGrado: datos.nombre_grado,
      campana: datos.campana_admision,
      enlaceVisita: enlaceVisita(idExpediente),
      urlCarpeta: obtenerConfig().CARPETA_INFORMATIVA_URL,
    });
    return { id_notificacion: idNotificacion, tipo_evento: TIPO_EVENTO_CARPETA, asunto, cuerpo };
  });
}

// Solo ids: n8n pide los datos de cada expediente al reservar su carpeta.
export async function carpetasPendientes(): Promise<{ expedientes: { id_expediente: number }[] }> {
  const ids = await listarCarpetasPendientes(obtenerPool(), {
    tipoEvento: TIPO_EVENTO_CARPETA,
    minutosRegistro: MINUTOS_REGISTRO,
    minutosReintento: MINUTOS_REINTENTO,
    limite: MAXIMO_PENDIENTES,
  });
  return { expedientes: ids.map((id_expediente) => ({ id_expediente })) };
}

export const ORIGENES_REBOTE = ["smtp_rechazo"] as const; // D1: solo el rechazo síncrono (el asíncrono es C34)

export interface ReboteRegistrado {
  id_notificacion: number;
  estado_envio: EstadoEnvio;
  transicion: boolean;
}

// HU0002-2.0: la notificación queda fallida, se audita notificacion_rebotada y, si el expediente sigue en prospecto,
// pasa a contacto_no_entregado (S3). Todo en una transacción; repetir el aviso no inserta nada.
export async function registrarRebote(idNotificacion: number, origen: (typeof ORIGENES_REBOTE)[number]): Promise<ReboteRegistrado> {
  return enTransaccion(async (c) => {
    const vista = await leerNotificacion(c, idNotificacion);
    if (!vista) throw new ErrorApi(404, "NOTIFICACION_NO_ENCONTRADA", "La notificación no existe");
    const estado = await bloquearEstado(c, vista.id_expediente, "estado");
    const n = (await bloquearNotificacion(c, idNotificacion))!;
    if (n.canal !== "correo" || n.tipo_evento !== TIPO_EVENTO_CARPETA) {
      throw new ErrorApi(409, "NO_ES_CARPETA", "La notificación no es el correo de la carpeta informativa");
    }
    if (await existeRebote(c, idNotificacion)) {
      return { id_notificacion: idNotificacion, estado_envio: n.estado_envio, transicion: false };
    }
    if (n.estado_envio !== "fallido") await actualizarEstadoEnvio(c, idNotificacion, "fallido");
    await insertarEvento(c, {
      tipoEvento: "notificacion_rebotada",
      idExpediente: n.id_expediente,
      idPersonal: null, // actor: el sistema (n8n)
      detalle: { id_notificacion: idNotificacion, canal: n.canal, origen },
    });
    let transicion = false;
    if (estado === "prospecto") {
      await transicionarExpediente(c, {
        idExpediente: n.id_expediente,
        campo: "estado",
        esperado: "prospecto",
        nuevo: "contacto_no_entregado",
        idPersonal: null,
        detalle: { motivo: "rebote_carpeta", id_notificacion: idNotificacion },
      });
      transicion = true;
    }
    return { id_notificacion: idNotificacion, estado_envio: "fallido", transicion };
  });
}
