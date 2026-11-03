// P02, agendamiento de la visita guiada (HU0003). Pública: el expediente sale SOLO del token del enlace (ADR-18), nunca
// del cuerpo. Vigencia por estado (P2, C31): P02 acepta un expediente en `prospecto`; en `visita_agendada` (enlace ya
// usado) responde 409 VISITA_YA_AGENDADA, y cualquier otro estado, como un token inválido, el mismo 404 (ADR-17).
import { enTransaccion, obtenerPool } from "../db/pool";
import { leerTokenVisita } from "../crypto/enlaceVisita";
import { ErrorApi } from "../errores";
import { descontarCupo, insertarCitaVisita, listarHorariosVisita, motivoSinReserva, type HorarioVisita } from "../repositories/cita";
import { bloquearEstado, leerDatosFamilia } from "../repositories/expediente";
import { lugarDeLaVisita } from "./avisosVisita";
import { transicionarExpediente } from "./expedientes/transicionarExpediente";

const enlaceNoValido = () =>
  new ErrorApi(404, "ENLACE_NO_VALIDO", "Este enlace no es válido o ya no está vigente. Si deseas agendar tu visita, comunícate con Admisión.");
const visitaYaAgendada = () =>
  new ErrorApi(409, "VISITA_YA_AGENDADA", "Ya tienes una visita agendada. Revisa el correo de confirmación.");
const sinCupo = () => new ErrorApi(409, "HORARIO_SIN_CUPO", "El horario ya no tiene cupo. Elige otro horario o día.");

// El estado decide si el enlace vale. Lanza el error que corresponde si no admite reservar.
function exigirProspecto(estado: string | null | undefined): void {
  if (estado === "visita_agendada") throw visitaYaAgendada();
  if (estado !== "prospecto") throw enlaceNoValido();
}

function expedienteDelEnlace(token: string | undefined): number {
  const id = token ? leerTokenVisita(token) : null;
  if (id === null) throw enlaceNoValido();
  return id;
}

export interface DatosP02 {
  campana: string;
  apoderado: { nombres: string; apellidos: string };
  grado: { nombre_grado: string };
  lugar: string;
  horarios: HorarioVisita[];
}

// GET /publico/visita-guiada: lo que muestra P02. Los horarios son de la campaña activa (C25 6).
export async function datosVisitaGuiada(campana: string, token: string | undefined): Promise<DatosP02> {
  const familia = await leerDatosFamilia(obtenerPool(), expedienteDelEnlace(token));
  exigirProspecto(familia?.estado);
  return {
    campana,
    apoderado: { nombres: familia!.nombres, apellidos: familia!.apellidos },
    grado: { nombre_grado: familia!.nombre_grado },
    lugar: lugarDeLaVisita(),
    horarios: await listarHorariosVisita(obtenerPool(), campana),
  };
}

export interface Reserva {
  id_cita: number;
  respuesta: { estado: "reservada"; fecha: string; hora_inicio: string };
}

const esCitaDuplicada = (e: unknown) => {
  const err = e as { code?: string; constraint?: string };
  return err?.code === "23505" && err.constraint === "uq_cita_personal_fecha";
};

// POST /publico/visita-guiada/reserva (HU0003-1.0 y 2.0). En una transacción: bloquea el expediente, descuenta el cupo
// con una sola sentencia condicional, registra la cita y pasa el expediente a `visita_agendada` con su auditoría.
export async function reservarVisita(campana: string, token: string | undefined, d: { id_horario: number; asistentes: string }): Promise<Reserva> {
  const idExpediente = expedienteDelEnlace(token);
  try {
    return await enTransaccion(async (c) => {
      exigirProspecto(await bloquearEstado(c, idExpediente, "estado"));
      const cupo = await descontarCupo(c, d.id_horario, campana);
      if (!cupo) {
        const motivo = await motivoSinReserva(c, d.id_horario, campana);
        if (motivo === "sin_cupo") throw sinCupo();
        throw new ErrorApi(motivo === "no_existe" ? 404 : 409, "HORARIO_NO_DISPONIBLE", "El horario ya no está disponible. Elige otro horario o día.");
      }
      const idCita = await insertarCitaVisita(c, {
        idExpediente,
        idPersonal: cupo.id_personal,
        idHorario: d.id_horario,
        fechaHora: cupo.fecha_hora,
        asistentes: d.asistentes,
      });
      await transicionarExpediente(c, {
        idExpediente,
        campo: "estado",
        esperado: "prospecto",
        nuevo: "visita_agendada",
        idPersonal: null, // actor: la familia
        detalle: { id_cita: idCita, id_horario: d.id_horario },
      });
      return { id_cita: idCita, respuesta: { estado: "reservada" as const, fecha: cupo.fecha, hora_inicio: cupo.hora_inicio } };
    });
  } catch (e) {
    // B2: otra reserva del mismo responsable a la misma hora ganó (horario con cupos > 1); se revirtió el descuento.
    if (esCitaDuplicada(e)) throw sinCupo();
    throw e;
  }
}
