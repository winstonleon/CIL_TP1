// Fixtures con valores únicos para que las pruebas no choquen entre sí sobre la misma BD.
import { randomUUID } from "node:crypto";
import type { Consultable } from "../src/db/pool";

export const unico = () => randomUUID().slice(0, 8);

export async function crearGrado(db: Consultable, valores: Partial<{ autorizadas: number; disponibles: number }> = {}) {
  const { rows } = await db.query<{ id_grado: number }>(
    `INSERT INTO grado (nivel, nombre_grado, campana_admision, vacantes_autorizadas, vacantes_disponibles, monto_cuota_ingreso)
     VALUES ('primaria', $1, 'T', $2, $3, 7000) RETURNING id_grado`,
    [`G-${unico()}`, valores.autorizadas ?? 10, valores.disponibles ?? 10],
  );
  return rows[0]!.id_grado;
}

export async function crearApoderado(db: Consultable) {
  const { rows } = await db.query<{ id_apoderado: number }>(
    `INSERT INTO apoderado (nombres, apellidos, telefono, correo)
     VALUES ('Prueba', 'Ficticia', '900000000', $1) RETURNING id_apoderado`,
    [`apoderado-${unico()}@ejemplo.test`],
  );
  return rows[0]!.id_apoderado;
}

export async function crearPersonal(db: Consultable, rol = "secretaria", keycloakUserId: string = randomUUID()) {
  const { rows } = await db.query<{ id_personal: number }>(
    `INSERT INTO personal (nombres, apellidos, rol, correo, keycloak_user_id)
     VALUES ('Personal', 'Ficticio', $1::rol_personal, $2, $3::uuid) RETURNING id_personal`,
    [rol, `personal-${unico()}@ejemplo.test`, keycloakUserId],
  );
  return rows[0]!.id_personal;
}

export async function crearExpediente(db: Consultable) {
  const idGrado = await crearGrado(db);
  const idApoderado = await crearApoderado(db);
  const { rows } = await db.query<{ id_expediente: number }>(
    "INSERT INTO expediente (id_apoderado_titular, id_grado) VALUES ($1, $2) RETURNING id_expediente",
    [idApoderado, idGrado],
  );
  return { idExpediente: rows[0]!.id_expediente, idGrado, idApoderado };
}

export async function crearHorario(db: Consultable, idPersonal: number) {
  const { rows } = await db.query<{ id_horario: number }>(
    `INSERT INTO horario_disponible (id_personal, tipo_cita, fecha, hora_inicio, hora_fin, campana_admision)
     VALUES ($1, 'visita', '2027-01-15', '09:00', '10:00', 'T') RETURNING id_horario`,
    [idPersonal],
  );
  return rows[0]!.id_horario;
}

export async function eventosDe(db: Consultable, idExpediente: number) {
  const { rows } = await db.query(
    "SELECT * FROM registro_auditoria WHERE id_expediente = $1 ORDER BY id_evento",
    [idExpediente],
  );
  return rows;
}

// Espera que la promesa falle por la restricción indicada (CHECK, UNIQUE o FK).
export async function violacion(promesa: Promise<unknown>): Promise<{ code: string; constraint?: string }> {
  try {
    await promesa;
  } catch (e) {
    return e as { code: string; constraint?: string };
  }
  throw new Error("Se esperaba una violación de restricción y la operación se aceptó");
}
