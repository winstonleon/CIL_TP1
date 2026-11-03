// Citas de visita guiada (HU0003 y HU0004): horarios que ofrece P02, reserva del cupo, cita y registro de la asistencia
// (G04). Fecha y horas en la hora de Lima (§2 del modelo de datos), como texto para no convertir zonas en el cliente.
import type { Consultable } from "../db/pool";

const ZONA = "America/Lima";
// Inicio del horario como instante: fecha + hora de inicio en la hora de Lima. Es la fecha_hora de su cita.
const INICIO_HORARIO = `((h.fecha + h.hora_inicio) AT TIME ZONE '${ZONA}')`;
// ¿Ya hay una cita del mismo responsable a esa hora? (uq_cita_personal_fecha no mira el estado de la cita: B2, A1).
const HAY_CITA_A_ESA_HORA = `EXISTS (SELECT 1 FROM cita c WHERE c.id_personal = h.id_personal AND c.fecha_hora = ${INICIO_HORARIO})`;
// Responsable válido de una visita: cuenta activa con el rol directora (ADR-15; C25 7).
const RESPONSABLE_VALIDO = "p.activo AND p.rol = 'directora'";

export interface HorarioVisita {
  id_horario: number;
  fecha: string;
  hora_inicio: string;
  hora_fin: string;
  disponible: boolean;
}

// Horarios de visita futuros de la campaña cuyo responsable es una directora activa (P02). «Reservado» si no quedan
// cupos o si ya hay una cita de ese responsable a esa hora (A1).
export async function listarHorariosVisita(db: Consultable, campana: string): Promise<HorarioVisita[]> {
  const { rows } = await db.query<HorarioVisita>(
    `SELECT h.id_horario, to_char(h.fecha, 'YYYY-MM-DD') AS fecha, to_char(h.hora_inicio, 'HH24:MI') AS hora_inicio,
            to_char(h.hora_fin, 'HH24:MI') AS hora_fin, (h.cupos > 0 AND NOT ${HAY_CITA_A_ESA_HORA}) AS disponible
       FROM horario_disponible h JOIN personal p ON p.id_personal = h.id_personal
      WHERE h.campana_admision = $1 AND h.tipo_cita = 'visita' AND ${RESPONSABLE_VALIDO} AND ${INICIO_HORARIO} > now()
      ORDER BY h.fecha, h.hora_inicio, h.id_horario`,
    [campana],
  );
  return rows;
}

export interface CupoReservado {
  id_personal: number;
  fecha_hora: Date;
  fecha: string;
  hora_inicio: string;
}

// HU0003-2.0: descuenta el cupo con UNA sola sentencia condicional (cupos > 0). La fila queda bloqueada hasta el fin de
// la transacción: una reserva simultánea espera y vuelve a evaluar `cupos > 0` sobre el valor nuevo. null si no hubo
// cupo o el horario no se puede reservar.
export async function descontarCupo(db: Consultable, idHorario: number, campana: string): Promise<CupoReservado | null> {
  const { rows } = await db.query<CupoReservado>(
    `UPDATE horario_disponible h SET cupos = h.cupos - 1
       FROM personal p
      WHERE h.id_horario = $1 AND h.campana_admision = $2 AND h.tipo_cita = 'visita' AND h.cupos > 0
        AND p.id_personal = h.id_personal AND ${RESPONSABLE_VALIDO} AND ${INICIO_HORARIO} > now()
        AND NOT ${HAY_CITA_A_ESA_HORA}
      RETURNING h.id_personal, ${INICIO_HORARIO} AS fecha_hora, to_char(h.fecha, 'YYYY-MM-DD') AS fecha,
                to_char(h.hora_inicio, 'HH24:MI') AS hora_inicio`,
    [idHorario, campana],
  );
  return rows[0] ?? null;
}

// Por qué no se pudo reservar: no existe (o no es una visita de la campaña), ya no está disponible (pasó o su
// responsable no es una directora activa) o no tiene cupo.
export async function motivoSinReserva(db: Consultable, idHorario: number, campana: string): Promise<"no_existe" | "no_disponible" | "sin_cupo"> {
  const { rows } = await db.query<{ vigente: boolean; sin_cupo: boolean }>(
    `SELECT (${INICIO_HORARIO} > now() AND ${RESPONSABLE_VALIDO}) AS vigente, (h.cupos = 0 OR ${HAY_CITA_A_ESA_HORA}) AS sin_cupo
       FROM horario_disponible h JOIN personal p ON p.id_personal = h.id_personal
      WHERE h.id_horario = $1 AND h.campana_admision = $2 AND h.tipo_cita = 'visita'`,
    [idHorario, campana],
  );
  const h = rows[0];
  if (!h) return "no_existe";
  if (!h.vigente) return "no_disponible";
  return h.sin_cupo ? "sin_cupo" : "no_disponible";
}

export interface NuevaCita {
  idExpediente: number;
  idPersonal: number;
  idHorario: number;
  fechaHora: Date;
  asistentes: string;
}

export async function insertarCitaVisita(db: Consultable, c: NuevaCita): Promise<number> {
  const { rows } = await db.query<{ id_cita: number }>(
    `INSERT INTO cita (id_expediente, id_personal, id_horario, tipo_cita, fecha_hora, asistentes)
     VALUES ($1, $2, $3, 'visita', $4, $5) RETURNING id_cita`,
    [c.idExpediente, c.idPersonal, c.idHorario, c.fechaHora, c.asistentes],
  );
  return rows[0]!.id_cita;
}

export interface FilaCita {
  id_cita: number;
  id_expediente: number;
  tipo_cita: string;
  estado: string;
  fecha: string;
  hora_inicio: string;
  asistentes: string | null;
}

const COLUMNAS_CITA = `c.id_cita, c.id_expediente, c.tipo_cita::text AS tipo_cita, c.estado::text AS estado,
  to_char(c.fecha_hora AT TIME ZONE '${ZONA}', 'YYYY-MM-DD') AS fecha, to_char(c.fecha_hora AT TIME ZONE '${ZONA}', 'HH24:MI') AS hora_inicio,
  c.asistentes`;

// Sin bloqueo: sirve para saber qué expediente bloquear primero (orden expediente → cita, como en la reserva).
export async function leerCita(db: Consultable, idCita: number): Promise<FilaCita | null> {
  const { rows } = await db.query<FilaCita>(`SELECT ${COLUMNAS_CITA} FROM cita c WHERE c.id_cita = $1`, [idCita]);
  return rows[0] ?? null;
}

export async function bloquearCita(db: Consultable, idCita: number): Promise<FilaCita | null> {
  const { rows } = await db.query<FilaCita>(`SELECT ${COLUMNAS_CITA} FROM cita c WHERE c.id_cita = $1 FOR UPDATE`, [idCita]);
  return rows[0] ?? null;
}

export async function actualizarEstadoCita(db: Consultable, idCita: number, estado: "asistio" | "no_asistio"): Promise<void> {
  await db.query("UPDATE cita SET estado = $2::estado_cita WHERE id_cita = $1", [idCita, estado]);
}

export interface FilaVisita {
  id_cita: number;
  fecha: string;
  hora_inicio: string;
  estado_cita: string;
  id_expediente: number;
  estado_expediente: string;
  nombres: string;
  apellidos: string;
  telefono: string;
  nombre_grado: string;
  asistentes: string | null;
}

const COLUMNAS_VISITA = `c.id_cita, to_char(c.fecha_hora AT TIME ZONE '${ZONA}', 'YYYY-MM-DD') AS fecha,
  to_char(c.fecha_hora AT TIME ZONE '${ZONA}', 'HH24:MI') AS hora_inicio, c.estado::text AS estado_cita, e.id_expediente,
  e.estado::text AS estado_expediente, a.nombres, a.apellidos, a.telefono, g.nombre_grado, c.asistentes`;

const VISITAS_DE_LA_CAMPANA = `FROM cita c
  JOIN horario_disponible h ON h.id_horario = c.id_horario
  JOIN expediente e ON e.id_expediente = c.id_expediente
  JOIN apoderado a ON a.id_apoderado = e.id_apoderado_titular
  JOIN grado g ON g.id_grado = e.id_grado
 WHERE c.tipo_cita = 'visita' AND h.campana_admision = $1`;

// G04: visitas de la campaña entre dos fechas de Lima (ambas incluidas). Sin DNI.
export async function listarVisitas(db: Consultable, campana: string, desde: string, hasta: string): Promise<FilaVisita[]> {
  const { rows } = await db.query<FilaVisita>(
    `SELECT ${COLUMNAS_VISITA} ${VISITAS_DE_LA_CAMPANA}
        AND (c.fecha_hora AT TIME ZONE '${ZONA}')::date BETWEEN $2::date AND $3::date
      ORDER BY c.fecha_hora, c.id_cita`,
    [campana, desde, hasta],
  );
  return rows;
}

// G04, «Sin registrar» (A5): visitas todavía en `reservada` con fecha anterior a `antesDe`.
export async function listarVisitasSinRegistrar(db: Consultable, campana: string, antesDe: string): Promise<FilaVisita[]> {
  const { rows } = await db.query<FilaVisita>(
    `SELECT ${COLUMNAS_VISITA} ${VISITAS_DE_LA_CAMPANA}
        AND c.estado = 'reservada' AND (c.fecha_hora AT TIME ZONE '${ZONA}')::date < $2::date
      ORDER BY c.fecha_hora, c.id_cita`,
    [campana, antesDe],
  );
  return rows;
}
