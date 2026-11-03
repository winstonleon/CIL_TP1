// Alta del expediente (HU0001), lectura y escritura de los tres estados (solo las usa transicionarExpediente; el
// rebote de HU0002 también lee el estado con bloqueo), datos para la carpeta informativa (HU0002) y comprobación de
// existencia (la usa la política de acceso restringido, HU0021-2.0).
import type { Consultable } from "../db/pool";

// Nace en `prospecto`, sin postulante y con fecha_registro = now() (valores por omisión del esquema). La creación no se
// audita (plan HU0001, P2): la fecha queda en fecha_registro.
export async function insertarExpediente(db: Consultable, e: { idApoderadoTitular: number; idGrado: number }): Promise<number> {
  const { rows } = await db.query<{ id_expediente: number }>(
    "INSERT INTO expediente (id_apoderado_titular, id_grado) VALUES ($1, $2) RETURNING id_expediente",
    [e.idApoderadoTitular, e.idGrado],
  );
  return rows[0]!.id_expediente;
}

// Datos para armar la carpeta informativa (HU0002-1.0), con el expediente bloqueado: serializa las reservas simultáneas
// del mismo expediente (reintento de la API, barrido y webhook a la vez). El DNI no se lee.
export async function bloquearDatosCarpeta(
  db: Consultable,
  idExpediente: number,
): Promise<{ estado: string; nombres: string; nombre_grado: string; campana_admision: string } | null> {
  const { rows } = await db.query<{ estado: string; nombres: string; nombre_grado: string; campana_admision: string }>(
    `SELECT e.estado::text AS estado, a.nombres, g.nombre_grado, g.campana_admision
       FROM expediente e
       JOIN apoderado a ON a.id_apoderado = e.id_apoderado_titular
       JOIN grado g ON g.id_grado = e.id_grado
      WHERE e.id_expediente = $1
        FOR UPDATE OF e`,
    [idExpediente],
  );
  return rows[0] ?? null;
}

export interface DatosFamilia {
  estado: string;
  id_apoderado: number;
  nombres: string;
  apellidos: string;
  correo: string;
  nombre_grado: string;
  campana_admision: string;
}

const DATOS_FAMILIA = `SELECT e.estado::text AS estado, a.id_apoderado, a.nombres, a.apellidos, a.correo, g.nombre_grado, g.campana_admision
       FROM expediente e
       JOIN apoderado a ON a.id_apoderado = e.id_apoderado_titular
       JOIN grado g ON g.id_grado = e.id_grado
      WHERE e.id_expediente = $1`;

// Datos del apoderado titular y del grado para P02 (HU0003). El DNI no se lee.
export async function leerDatosFamilia(db: Consultable, idExpediente: number): Promise<DatosFamilia | null> {
  const { rows } = await db.query<DatosFamilia>(DATOS_FAMILIA, [idExpediente]);
  return rows[0] ?? null;
}

// Los mismos datos con el expediente bloqueado (G04 y avisos de la visita): primero el expediente y después la cita,
// el mismo orden que la reserva de P02, así no hay interbloqueos.
export async function bloquearDatosFamilia(db: Consultable, idExpediente: number): Promise<DatosFamilia | null> {
  const { rows } = await db.query<DatosFamilia>(`${DATOS_FAMILIA} FOR UPDATE OF e`, [idExpediente]);
  return rows[0] ?? null;
}

export async function existeExpediente(db: Consultable, idExpediente: number): Promise<boolean> {
  const { rowCount } = await db.query("SELECT 1 FROM expediente WHERE id_expediente = $1", [idExpediente]);
  return (rowCount ?? 0) > 0;
}

export type CampoEstado = "estado" | "estado_documental" | "estado_financiero";

// Nombre de columna y tipo enum de cada campo: lista cerrada, nunca entra texto del usuario al SQL.
const CAMPOS: Record<CampoEstado, { columna: string; tipo: string }> = {
  estado: { columna: "estado", tipo: "estado_expediente" },
  estado_documental: { columna: "estado_documental", tipo: "estado_revision" },
  estado_financiero: { columna: "estado_financiero", tipo: "estado_revision" },
};

export function esCampoEstado(valor: string): valor is CampoEstado {
  return Object.hasOwn(CAMPOS, valor);
}

export async function esValorDeEstado(db: Consultable, campo: CampoEstado, valor: string): Promise<boolean> {
  const { rows } = await db.query<{ valido: boolean }>(
    `SELECT $1::text = ANY (enum_range(NULL::${CAMPOS[campo].tipo})::text[]) AS valido`,
    [valor],
  );
  return rows[0]!.valido;
}

// Lee el estado actual y bloquea la fila hasta el fin de la transacción (SELECT ... FOR UPDATE).
export async function bloquearEstado(db: Consultable, idExpediente: number, campo: CampoEstado): Promise<string | null> {
  const { rows } = await db.query<{ valor: string }>(
    `SELECT ${CAMPOS[campo].columna}::text AS valor FROM expediente WHERE id_expediente = $1 FOR UPDATE`,
    [idExpediente],
  );
  return rows[0]?.valor ?? null;
}

export async function actualizarEstado(db: Consultable, idExpediente: number, campo: CampoEstado, valor: string): Promise<void> {
  const { columna, tipo } = CAMPOS[campo];
  await db.query(`UPDATE expediente SET ${columna} = $2::${tipo} WHERE id_expediente = $1`, [idExpediente, valor]);
}

// ====================================================================== portal de la familia (HU0005)

export interface ExpedienteDeFamilia {
  id_expediente: number;
  id_apoderado_titular: number;
  id_postulante: number | null;
  estado: string;
  nombre_grado: string;
  nivel: string;
  campana_admision: string;
}

const EXPEDIENTE_DE_FAMILIA = `SELECT e.id_expediente, e.id_apoderado_titular, e.id_postulante, e.estado::text AS estado,
       g.nombre_grado, g.nivel::text AS nivel, g.campana_admision
  FROM expediente e
  JOIN grado g ON g.id_grado = e.id_grado
  JOIN cuenta_acceso ca ON ca.id_apoderado = e.id_apoderado_titular`;

// Los expedientes cuyo titular tiene la cuenta de Keycloak `keycloakUserId` (§4.6: la familia solo ve los suyos).
export async function listarExpedientesDeFamilia(db: Consultable, keycloakUserId: string): Promise<ExpedienteDeFamilia[]> {
  const { rows } = await db.query<ExpedienteDeFamilia>(
    `${EXPEDIENTE_DE_FAMILIA} WHERE ca.keycloak_user_id = $1::uuid ORDER BY e.id_expediente`,
    [keycloakUserId],
  );
  return rows;
}

// El expediente solo si es de esa cuenta: un id ajeno da el mismo null que uno inexistente.
export async function leerExpedienteDeFamilia(
  db: Consultable,
  keycloakUserId: string,
  idExpediente: number,
): Promise<ExpedienteDeFamilia | null> {
  const { rows } = await db.query<ExpedienteDeFamilia>(
    `${EXPEDIENTE_DE_FAMILIA} WHERE ca.keycloak_user_id = $1::uuid AND e.id_expediente = $2`,
    [keycloakUserId, idExpediente],
  );
  return rows[0] ?? null;
}

// Bloquea el expediente mientras se guarda la ficha: dos guardados simultáneos se serializan (ADR-20: gana el último).
export async function bloquearFichaDeExpediente(
  db: Consultable,
  idExpediente: number,
): Promise<{ estado: string; id_postulante: number | null } | null> {
  const { rows } = await db.query<{ estado: string; id_postulante: number | null }>(
    "SELECT estado::text AS estado, id_postulante FROM expediente WHERE id_expediente = $1 FOR UPDATE",
    [idExpediente],
  );
  return rows[0] ?? null;
}

export async function vincularPostulante(db: Consultable, idExpediente: number, idPostulante: number): Promise<void> {
  await db.query("UPDATE expediente SET id_postulante = $2 WHERE id_expediente = $1", [idExpediente, idPostulante]);
}
