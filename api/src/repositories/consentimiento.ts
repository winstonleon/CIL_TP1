// consentimiento: evidencia del consentimiento del apoderado (Ley N.° 29733 y DS 016-2024-JUS). Es un registro
// histórico: no se actualiza, y ante una nueva versión de la política se inserta otra fila (modelo de datos v1.1).
// La fecha y hora de aceptación la pone la BD (default now()), nunca el cliente.
import type { Consultable } from "../db/pool";

// `alta_manual`: cuenta creada por un técnico con `familias:crear`, no por la familia en P01 (canal_origen es varchar(30) sin CHECK).
export type CanalOrigen = "facebook" | "instagram" | "formulario_web" | "alta_manual";

export interface NuevoConsentimiento {
  idApoderado: number;
  versionPolitica: string;
  canalOrigen: CanalOrigen;
  autorizaWhatsapp: boolean;
}

export async function insertarConsentimiento(db: Consultable, c: NuevoConsentimiento): Promise<number> {
  const { rows } = await db.query<{ id_consentimiento: number }>(
    `INSERT INTO consentimiento (id_apoderado, version_politica, canal_origen, autoriza_whatsapp)
     VALUES ($1, $2, $3, $4)
     RETURNING id_consentimiento`,
    [c.idApoderado, c.versionPolitica, c.canalOrigen, c.autorizaWhatsapp],
  );
  return rows[0]!.id_consentimiento;
}
