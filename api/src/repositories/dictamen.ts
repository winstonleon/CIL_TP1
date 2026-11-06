// Resultados de las evaluaciones y dictamen de admisión (HU0010 y HU0025, ADR-25). Las columnas de texto con datos de
// salud de menores se cifran y descifran SOLO aquí (ADR-03, D1-A; rules/api.md): resultado_evaluacion.observaciones,
// dictamen_admision.conclusiones y dictamen_admision.requisitos_complementarios. `resultado` no se cifra (escala del
// colegio, varchar(50)). Fechas y horas en la hora de Lima (§2 del modelo de datos), como las citas de HU0009.
import type { Consultable } from "../db/pool";
import { cifrar, descifrar } from "../crypto/columnas";
import type { TipoEvaluacion } from "./evaluaciones";

const ZONA = "America/Lima";
const cifrarOpcional = (v: string | null) => (v === null ? null : cifrar(v));
const descifrarOpcional = (v: string | null) => (v === null ? null : descifrar(v));

// ---------------------------------------------------------------- agenda (G06 y G11)

export interface CitaDeAgenda {
  id_cita: number;
  id_expediente: number;
  campana: string;
  postulante_nombres: string | null;
  postulante_apellidos: string | null;
  grado: string;
  tipo_cita: TipoEvaluacion;
  fecha: string;
  hora_inicio: string;
  hora_fin: string;
  estado: string;
  estado_expediente: string;
  resultado_registrado: boolean;
}

const COLUMNAS_AGENDA = `c.id_cita, c.id_expediente, g.campana_admision AS campana,
  p.nombres AS postulante_nombres, nullif(concat_ws(' ', p.apellido_paterno, p.apellido_materno), '') AS postulante_apellidos,
  g.nombre_grado AS grado, c.tipo_cita::text AS tipo_cita,
  to_char(c.fecha_hora AT TIME ZONE '${ZONA}', 'YYYY-MM-DD') AS fecha, to_char(c.fecha_hora AT TIME ZONE '${ZONA}', 'HH24:MI') AS hora_inicio,
  to_char(h.hora_fin, 'HH24:MI') AS hora_fin, c.estado::text AS estado, e.estado::text AS estado_expediente,
  EXISTS (SELECT 1 FROM resultado_evaluacion r WHERE r.id_cita = c.id_cita) AS resultado_registrado`;

const DESDE_CITA = `FROM cita c
  JOIN horario_disponible h ON h.id_horario = c.id_horario
  JOIN expediente e ON e.id_expediente = c.id_expediente
  JOIN grado g ON g.id_grado = e.id_grado
  LEFT JOIN postulante p ON p.id_postulante = e.id_postulante`;

// Citas del responsable en un día (hora de Lima), de los tipos de su rol. No muestra las reprogramadas ni las canceladas:
// ya no ocupan su turno (las mismas que no cuenta uq_cita_personal_fecha).
export async function agendaDelResponsable(db: Consultable, idPersonal: number, fecha: string, tipos: readonly string[]): Promise<CitaDeAgenda[]> {
  const { rows } = await db.query<CitaDeAgenda>(
    `SELECT ${COLUMNAS_AGENDA} ${DESDE_CITA}
      WHERE c.id_personal = $1 AND c.tipo_cita::text = ANY($3::text[]) AND c.estado NOT IN ('reprogramada', 'cancelada')
        AND (c.fecha_hora AT TIME ZONE '${ZONA}')::date = $2::date
      ORDER BY c.fecha_hora, c.id_cita`,
    [idPersonal, fecha, tipos],
  );
  return rows;
}

export interface CitaDelResponsable extends CitaDeAgenda {
  id_personal: number;
  iniciada: boolean; // la hora de la cita ya llegó (S3)
}

// Una cita con sus datos para G06 o G11. `bloquear` la toma FOR UPDATE (después del expediente: el orden de HU0009).
export async function leerCitaDelResponsable(db: Consultable, idCita: number, bloquear = false): Promise<CitaDelResponsable | null> {
  const { rows } = await db.query<CitaDelResponsable>(
    `SELECT ${COLUMNAS_AGENDA}, c.id_personal, c.fecha_hora <= now() AS iniciada ${DESDE_CITA}
      WHERE c.id_cita = $1 AND c.tipo_cita <> 'visita' ${bloquear ? "FOR UPDATE OF c" : ""}`,
    [idCita],
  );
  return rows[0] ?? null;
}

// ---------------------------------------------------------------- resultados

export interface ResultadoLeido {
  id_resultado: number;
  resultado: string;
  observaciones: string | null; // descifradas
  fecha_registro: Date;
}

export async function leerResultadoDeCita(db: Consultable, idCita: number): Promise<ResultadoLeido | null> {
  const { rows } = await db.query<ResultadoLeido>(
    "SELECT id_resultado, resultado, observaciones, fecha_registro FROM resultado_evaluacion WHERE id_cita = $1",
    [idCita],
  );
  const r = rows[0];
  return r ? { ...r, observaciones: descifrarOpcional(r.observaciones) } : null;
}

export async function insertarResultado(
  db: Consultable,
  r: { idCita: number; idPersonal: number; tipo: TipoEvaluacion; resultado: string; observaciones: string | null },
): Promise<number> {
  const { rows } = await db.query<{ id_resultado: number }>(
    `INSERT INTO resultado_evaluacion (id_cita, id_personal, tipo_evaluacion, resultado, observaciones)
     VALUES ($1, $2, $3::tipo_cita, $4, $5) RETURNING id_resultado`,
    [r.idCita, r.idPersonal, r.tipo, r.resultado, cifrarOpcional(r.observaciones)],
  );
  return rows[0]!.id_resultado;
}

export async function marcarCita(db: Consultable, idCita: number, estado: "asistio" | "no_asistio"): Promise<void> {
  await db.query("UPDATE cita SET estado = $2::estado_cita WHERE id_cita = $1", [idCita, estado]);
}

export interface ComponenteEvaluacion {
  id_cita: number;
  tipo_cita: TipoEvaluacion;
  estado: string;
  fecha: string;
  hora_inicio: string;
  resultado: string | null;
  observaciones: string | null; // descifradas
}

// Componentes del dictamen: la cita vigente de cada tipo de evaluación del expediente (la más reciente que no se
// reprogramó ni canceló: después de una inasistencia reprogramada, la nueva) con su resultado.
export async function componentesDelExpediente(db: Consultable, idExpediente: number): Promise<ComponenteEvaluacion[]> {
  const { rows } = await db.query<ComponenteEvaluacion>(
    `SELECT DISTINCT ON (c.tipo_cita) c.id_cita, c.tipo_cita::text AS tipo_cita, c.estado::text AS estado,
            to_char(c.fecha_hora AT TIME ZONE '${ZONA}', 'YYYY-MM-DD') AS fecha, to_char(c.fecha_hora AT TIME ZONE '${ZONA}', 'HH24:MI') AS hora_inicio,
            r.resultado, r.observaciones
       FROM cita c LEFT JOIN resultado_evaluacion r ON r.id_cita = c.id_cita
      WHERE c.id_expediente = $1 AND c.tipo_cita <> 'visita' AND c.estado NOT IN ('reprogramada', 'cancelada')
      ORDER BY c.tipo_cita, c.id_cita DESC`,
    [idExpediente],
  );
  return rows.map((r) => ({ ...r, observaciones: descifrarOpcional(r.observaciones) }));
}

// ---------------------------------------------------------------- dictamen

export interface CabeceraDictamen {
  estado: string;
  campana: string;
  grado: string;
  postulante_nombres: string | null;
  postulante_apellidos: string | null;
  edad: number | null; // años cumplidos hoy en Lima (G06: «… · 8 años»); null si la ficha no tiene la fecha de nacimiento
}

export async function leerCabeceraDictamen(db: Consultable, idExpediente: number): Promise<CabeceraDictamen | null> {
  const { rows } = await db.query<CabeceraDictamen>(
    `SELECT e.estado::text AS estado, g.campana_admision AS campana, g.nombre_grado AS grado, p.nombres AS postulante_nombres,
            nullif(concat_ws(' ', p.apellido_paterno, p.apellido_materno), '') AS postulante_apellidos,
            extract(year FROM age((now() AT TIME ZONE '${ZONA}')::date, p.fecha_nacimiento))::int AS edad
       FROM expediente e JOIN grado g ON g.id_grado = e.id_grado LEFT JOIN postulante p ON p.id_postulante = e.id_postulante
      WHERE e.id_expediente = $1`,
    [idExpediente],
  );
  return rows[0] ?? null;
}

export type TipoDictamen = "apto" | "en_observacion" | "no_apto";

export interface DictamenLeido {
  id_dictamen: number;
  id_personal: number;
  dictamen: TipoDictamen;
  conclusiones: string | null; // descifradas
  requisitos_complementarios: string | null; // descifrados
  informe_url: string | null;
  fecha_emision: Date;
}

const COLUMNAS_DICTAMEN = `id_dictamen, id_personal, dictamen::text AS dictamen, conclusiones, requisitos_complementarios, informe_url,
  fecha_emision`;

export async function leerDictamen(db: Consultable, idExpediente: number): Promise<DictamenLeido | null> {
  const { rows } = await db.query<DictamenLeido>(`SELECT ${COLUMNAS_DICTAMEN} FROM dictamen_admision WHERE id_expediente = $1`, [idExpediente]);
  const d = rows[0];
  return d ? { ...d, conclusiones: descifrarOpcional(d.conclusiones), requisitos_complementarios: descifrarOpcional(d.requisitos_complementarios) } : null;
}

// El dictamen vigente TAL COMO ESTÁ GUARDADO (columnas de texto cifradas), bloqueado: es la copia que un nuevo dictamen
// deja en atencion_fin.detalle.dictamen_anterior (D4a-A). Nunca se descifra para la auditoría.
export interface DictamenGuardado {
  id_dictamen: number;
  dictamen: TipoDictamen;
  conclusiones: string | null;
  requisitos_complementarios: string | null;
  informe_url: string | null;
  fecha_emision: Date;
}

export async function bloquearDictamenGuardado(db: Consultable, idExpediente: number): Promise<DictamenGuardado | null> {
  const { rows } = await db.query<DictamenGuardado>(
    `SELECT id_dictamen, dictamen::text AS dictamen, conclusiones, requisitos_complementarios, informe_url, fecha_emision
       FROM dictamen_admision WHERE id_expediente = $1 FOR UPDATE`,
    [idExpediente],
  );
  return rows[0] ?? null;
}

export interface DatosDictamen {
  idExpediente: number;
  idPersonal: number;
  dictamen: TipoDictamen;
  conclusiones: string;
  requisitosComplementarios: string | null;
  informeUrl: string | null; // null en un nuevo dictamen sin archivo: se conserva el anterior
}

export async function insertarDictamen(db: Consultable, d: DatosDictamen): Promise<number> {
  const { rows } = await db.query<{ id_dictamen: number }>(
    `INSERT INTO dictamen_admision (id_expediente, id_personal, dictamen, conclusiones, requisitos_complementarios, informe_url)
     VALUES ($1, $2, $3::tipo_dictamen, $4, $5, $6) RETURNING id_dictamen`,
    [d.idExpediente, d.idPersonal, d.dictamen, cifrar(d.conclusiones), cifrarOpcional(d.requisitosComplementarios), d.informeUrl],
  );
  return rows[0]!.id_dictamen;
}

// Nuevo dictamen sobre la misma fila (nota de Dictamen_Admision). Sin archivo nuevo se conserva el informe anterior.
export async function actualizarDictamen(db: Consultable, d: DatosDictamen): Promise<number> {
  const { rows } = await db.query<{ id_dictamen: number }>(
    `UPDATE dictamen_admision
        SET id_personal = $2, dictamen = $3::tipo_dictamen, conclusiones = $4, requisitos_complementarios = $5,
            informe_url = coalesce($6, informe_url), fecha_emision = clock_timestamp()
      WHERE id_expediente = $1 RETURNING id_dictamen`,
    [d.idExpediente, d.idPersonal, d.dictamen, cifrar(d.conclusiones), cifrarOpcional(d.requisitosComplementarios), d.informeUrl],
  );
  return rows[0]!.id_dictamen;
}

// Lo que ve Secretaría de un dictamen en observación (R13, D4b-B): solo los requisitos complementarios, descifrados.
// Nunca lee `conclusiones` ni `informe_url` (R3).
export interface RequisitosDeObservacion {
  id_expediente: number;
  campana: string;
  postulante_nombres: string | null;
  postulante_apellidos: string | null;
  grado: string;
  requisitos_complementarios: string;
  fecha_emision: Date;
}

export async function leerRequisitosDeObservacion(db: Consultable, idExpediente: number): Promise<RequisitosDeObservacion | null> {
  const { rows } = await db.query<RequisitosDeObservacion & { requisitos_complementarios: string | null }>(
    `SELECT e.id_expediente, g.campana_admision AS campana, p.nombres AS postulante_nombres,
            nullif(concat_ws(' ', p.apellido_paterno, p.apellido_materno), '') AS postulante_apellidos, g.nombre_grado AS grado,
            d.requisitos_complementarios, d.fecha_emision
       FROM expediente e
       JOIN grado g ON g.id_grado = e.id_grado
       JOIN dictamen_admision d ON d.id_expediente = e.id_expediente
       LEFT JOIN postulante p ON p.id_postulante = e.id_postulante
      WHERE e.id_expediente = $1 AND e.estado = 'en_observacion' AND d.dictamen = 'en_observacion'`,
    [idExpediente],
  );
  const r = rows[0];
  if (!r || r.requisitos_complementarios === null) return null;
  return { ...r, requisitos_complementarios: descifrar(r.requisitos_complementarios) };
}
