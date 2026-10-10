import type { Consultable } from "../db/pool";

export async function verificarConexion(db: Consultable): Promise<void> {
  await db.query("SELECT 1");
}
