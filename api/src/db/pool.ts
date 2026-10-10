// Acceso a la base admision con pg, sin ORM (ADR-01).
import pg from "pg";
import { obtenerConfig } from "../config";

export type Consultable = pg.Pool | pg.PoolClient;

let pool: pg.Pool | undefined;

export function obtenerPool(): pg.Pool {
  if (!pool) {
    const c = obtenerConfig();
    pool = new pg.Pool({
      host: c.POSTGRES_HOST,
      port: c.POSTGRES_PORT,
      database: c.ADMISION_DB,
      user: c.ADMISION_DB_USER,
      password: c.ADMISION_DB_PASSWORD,
      max: 10,
    });
  }
  return pool;
}

// Ejecuta fn dentro de una transacción: COMMIT si termina bien, ROLLBACK si lanza.
export async function enTransaccion<T>(fn: (cliente: pg.PoolClient) => Promise<T>): Promise<T> {
  const cliente = await obtenerPool().connect();
  try {
    await cliente.query("BEGIN");
    const resultado = await fn(cliente);
    await cliente.query("COMMIT");
    return resultado;
  } catch (e) {
    await cliente.query("ROLLBACK");
    throw e;
  } finally {
    cliente.release();
  }
}

export async function cerrarPool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = undefined;
  }
}
