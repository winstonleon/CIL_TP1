// Flujo seguimiento-recordatorios de n8n (HU0003-1.0, D4) a través de /internal/*: un Schedule pide las citas cuyo
// recordatorio toca y reserva cada uno. Sin nodos Wait: el recordatorio queda «programado» por los datos (cita
// reservada y la ventana [fecha_hora − RECORDATORIO_VISITA_HORAS, fecha_hora)). Un solo recordatorio por cita: su ancla
// es la reserva (ADR-16) y siguen las reglas de intentos de ADR-07 (las mismas de agendamiento). Pasada la hora de la
// visita deja de intentarse y sus filas conservan su estado.
import { obtenerConfig } from "../config";
import { enTransaccion, obtenerPool } from "../db/pool";
import { ErrorApi } from "../errores";
import { anclaDeCita, enVentanaDeRecordatorio, esUltimaCitaDeVisita, insertarIntento, listarRecordatoriosPendientes } from "../repositories/aviso";
import { bloquearCita, leerCita } from "../repositories/cita";
import { bloquearDatosFamilia } from "../repositories/expediente";
import { avisoAgotado, decidirIntento, MAXIMO_PENDIENTES, MINUTOS_REINTENTO, type AvisoReservado } from "./agendamiento";
import { componerRecordatorio } from "./avisosVisita";

export const TIPO_RECORDATORIO = "recordatorio_visita";

const recordatorioYaRegistrado = () =>
  new ErrorApi(409, "RECORDATORIO_YA_REGISTRADO", "El recordatorio de esta cita ya está registrado o en curso");

// POST /internal/citas/:id/recordatorio. Los conflictos se lanzan después del COMMIT (la fila de cierre queda guardada).
export async function reservarRecordatorio(idCita: number): Promise<AvisoReservado> {
  const horas = obtenerConfig().RECORDATORIO_VISITA_HORAS;
  const r = await enTransaccion<{ reservado: AvisoReservado } | { conflicto: ErrorApi }>(async (c) => {
    const previa = await leerCita(c, idCita);
    if (!previa || previa.tipo_cita !== "visita") throw new ErrorApi(404, "CITA_NO_ENCONTRADA", "La cita no existe");
    const familia = (await bloquearDatosFamilia(c, previa.id_expediente))!;
    const cita = (await bloquearCita(c, idCita))!;
    const ancla = await anclaDeCita(c, idCita, "visita_agendada");
    if (
      cita.estado !== "reservada" ||
      familia.estado !== "visita_agendada" ||
      !ancla ||
      !(await esUltimaCitaDeVisita(c, idCita)) ||
      !(await enVentanaDeRecordatorio(c, idCita, horas))
    ) {
      return { conflicto: new ErrorApi(409, "FUERA_DE_VENTANA", "La cita no está reservada dentro de la ventana del recordatorio") };
    }
    const idExpediente = cita.id_expediente;
    const decision = await decidirIntento(c, { idExpediente, tipoEvento: TIPO_RECORDATORIO, ancla });
    if (decision.accion === "cerrado" || decision.accion === "en_curso") return { conflicto: recordatorioYaRegistrado() };
    if (decision.accion === "agotar") {
      await insertarIntento(c, { idExpediente, tipoEvento: TIPO_RECORDATORIO, estadoEnvio: "fallido" });
      return { conflicto: avisoAgotado() };
    }
    const idNotificacion = await insertarIntento(c, { idExpediente, tipoEvento: TIPO_RECORDATORIO, estadoEnvio: "pendiente" });
    const mensaje = componerRecordatorio({
      nombres: familia.nombres,
      campana: familia.campana_admision,
      fecha: cita.fecha,
      hora: cita.hora_inicio,
      asistentes: cita.asistentes ?? "",
    });
    return { reservado: { id_expediente: idExpediente, id_cita: idCita, id_notificacion: idNotificacion, tipo_evento: TIPO_RECORDATORIO, ...mensaje } };
  });
  if ("conflicto" in r) throw r.conflicto;
  return r.reservado;
}

// GET /internal/recordatorios/pendientes: solo ids de cita.
export async function recordatoriosPendientes(): Promise<{ citas: { id_cita: number }[] }> {
  const ids = await listarRecordatoriosPendientes(obtenerPool(), {
    minutosRegistro: 0,
    minutosReintento: MINUTOS_REINTENTO,
    limite: MAXIMO_PENDIENTES,
    horas: obtenerConfig().RECORDATORIO_VISITA_HORAS,
  });
  return { citas: ids.map((id_cita) => ({ id_cita })) };
}
