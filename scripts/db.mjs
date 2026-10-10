// Ejecuta dbmate contra la base admision (o admision_test con --test) desde el host,
// construyendo la URL con las variables de .env. No imprime la contraseña.
// Las migraciones las aplica el rol de migración, dueño del esquema (S0-B9), no el usuario de la API.
// Uso: node scripts/db.mjs <comando dbmate> [--test]     p. ej.: node scripts/db.mjs up
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { RAIZ, cargarEntorno, requerida } from "./lib/keycloak.mjs";

const args = process.argv.slice(2);
const esPrueba = args.includes("--test");
const comando = args.filter((a) => a !== "--test");
if (!comando.length) {
  console.error("Uso: node scripts/db.mjs <up|status|...> [--test]");
  process.exit(2);
}

cargarEntorno();
// Se parte del nombre base aunque el entorno ya traiga *_test (p. ej. cuando lo invoca Vitest).
const baseAdmision = requerida("ADMISION_DB").replace(/_test$/, "");
const base = esPrueba ? `${baseAdmision}_test` : baseAdmision;
const usuario = encodeURIComponent(requerida("ADMISION_MIGRATOR_USER"));
const clave = encodeURIComponent(requerida("ADMISION_MIGRATOR_PASSWORD"));
const puerto = process.env.POSTGRES_HOST_PORT || "55432";
const url = `postgres://${usuario}:${clave}@127.0.0.1:${puerto}/${base}?sslmode=disable`;

const require = createRequire(import.meta.url);
const cli = resolve(dirname(require.resolve("dbmate/package.json")), "dist/cli.js");
// La URL va por DATABASE_URL (la lee dbmate) y no por argumentos, para no exponer la contraseña.
const r = spawnSync(
  process.execPath,
  [cli, "--migrations-dir", resolve(RAIZ, "db/migrations"), "--no-dump-schema", "--wait", ...comando],
  { stdio: "inherit", env: { ...process.env, DATABASE_URL: url } },
);
process.exit(r.status ?? 1);
