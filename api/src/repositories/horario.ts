// horario_disponible: turnos que ofrece el personal en la campaña (G09, HU0022). Son por campaña, no por grado.
import type { Consultable } from "../db/pool";

// Fecha y horas como texto ("2027-01-15", "09:00"): sin conversiones de zona horaria.
const COLUMNAS = `h.id_horario, h.id_personal, p.nombres || ' ' || p.apellidos AS responsable, h.tipo_cita::text AS tipo_cita,
  to_char(h.fecha, 'YYYY-MM-DD') AS fecha, to_char(h.hora_inicio, 'HH24:MI') AS hora_inicio,
  to_char(h.hora_fin, 'HH24:MI') AS hora_fin, h.cupos`;

export interface DatosHorario {
  id_personal: number;
  tipo_cita: string;
  fecha: string;
  hora_inicio: string;
  hora_fin: string;
  cupos: number;
}

export interface FilaHorario extends DatosHorario {
  id_horario: number;
  responsable: string;
}

export async function listarHorarios(db: Consultable, campana: string, tipoCita?: string): Promise<FilaHorario[]> {
  const { rows } = await db.query<FilaHorario>(
    `SELECT ${COLUMNAS} FROM horario_disponible h JOIN personal p ON p.id_personal = h.id_personal
      WHERE h.campana_admision = $1 AND ($2::tipo_cita IS NULL OR h.tipo_cita = $2::tipo_cita)
      ORDER BY h.fecha, h.hora_inicio, h.id_horario`,
    [campana, tipoCita ?? null],
  );
  return rows;
}

// Serializa las altas del mismo responsable en la misma fecha hasta el fin de la transacción, para que dos
// altas simultáneas no pasen ambas la comprobación de superposición.
export async function bloquearAgenda(db: Consultable, idPersonal: number, fecha: string): Promise<void> {
  await db.query("SELECT pg_advisory_xact_lock(hashtext('horario:' || $1::text || ':' || $2::text))", [idPersonal, fecha]);
}

// ¿El responsable ya tiene, ese día y en cualquier campaña, un horario que se cruza con [inicio, fin)?
// Los contiguos (9:00–10:00 y 10:00–11:00) no se cruzan.
export async function haySuperposicion(db: Consultable, d: Pick<DatosHorario, "id_personal" | "fecha" | "hora_inicio" | "hora_fin">): Promise<boolean> {
  const { rowCount } = await db.query(
    `SELECT 1 FROM horario_disponible
      WHERE id_personal = $1 AND fecha = $2::date AND hora_inicio < $4::time AND hora_fin > $3::time
      LIMIT 1`,
    [d.id_personal, d.fecha, d.hora_inicio, d.hora_fin],
  );
  return (rowCount ?? 0) > 0;
}

export async function insertarHorario(db: Consultable, campana: string, d: DatosHorario): Promise<FilaHorario> {
  const { rows } = await db.query<FilaHorario>(
    `WITH h AS (
       INSERT INTO horario_disponible (id_personal, tipo_cita, fecha, hora_inicio, hora_fin, cupos, campana_admision)
       VALUES ($1, $2::tipo_cita, $3::date, $4::time, $5::time, $6, $7)
       RETURNING *
     )
     SELECT ${COLUMNAS} FROM h JOIN personal p ON p.id_personal = h.id_personal`,
    [d.id_personal, d.tipo_cita, d.fecha, d.hora_inicio, d.hora_fin, d.cupos, campana],
  );
  return rows[0]!;
}

// Lee el horario de la campaña y lo bloquea hasta el fin de la transacción.
export async function bloquearHorario(db: Consultable, campana: string, idHorario: number): Promise<FilaHorario | null> {
  const { rows } = await db.query<FilaHorario>(
    `SELECT ${COLUMNAS} FROM horario_disponible h JOIN personal p ON p.id_personal = h.id_personal
      WHERE h.id_horario = $1 AND h.campana_admision = $2
      FOR UPDATE OF h`,
    [idHorario, campana],
  );
  return rows[0] ?? null;
}

// Hay citas (en cualquier estado) reservadas en el horario: no se puede quitar.
export async function horarioEnUso(db: Consultable, idHorario: number): Promise<boolean> {
  const { rowCount } = await db.query("SELECT 1 FROM cita WHERE id_horario = $1 LIMIT 1", [idHorario]);
  return (rowCount ?? 0) > 0;
}

export async function eliminarHorario(db: Consultable, idHorario: number): Promise<void> {
  await db.query("DELETE FROM horario_disponible WHERE id_horario = $1", [idHorario]);
}
