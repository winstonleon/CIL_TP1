// Antes de la corrida: recrea el esquema de admision_test y aplica las migraciones con dbmate.
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import pg from "pg";

export default async function () {
  const base = process.env.ADMISION_DB!;
  if (!base.endsWith("_test")) throw new Error(`Las pruebas solo pueden reiniciar una base *_test (recibí ${base})`);

  const cliente = new pg.Client({
    host: process.env.POSTGRES_HOST,
    port: Number(process.env.POSTGRES_PORT),
    database: base,
    user: process.env.ADMISION_DB_USER,
    password: process.env.ADMISION_DB_PASSWORD,
  });
  await cliente.connect();
  await cliente.query("DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;");
  await cliente.end();

  execFileSync(process.execPath, [resolve(import.meta.dirname, "../../scripts/db.mjs"), "up", "--test"], {
    stdio: "inherit",
  });
}
