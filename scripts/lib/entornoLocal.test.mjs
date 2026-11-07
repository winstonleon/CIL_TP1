// Guardas de los scripts de dev (HU0019, D4-A): `npm run dev:demo` debe negarse a correr fuera de dev.
import assert from "node:assert/strict";
import { test } from "node:test";
import { motivoFueraDeDev, motivoNoLocal, prepararEntornoHost } from "./entornoLocal.mjs";

const DEV = { KEYCLOAK_PUBLIC_URL: "http://localhost:8080", FRONTEND_PUBLIC_URL: "http://127.0.0.1:5173", ADMISION_DB: "admision" };

test("C74 los scripts del host llegan por el puerto publicado y tienen lo que config.ts exige", () => {
  const entorno = { POSTGRES_HOST: "postgres", POSTGRES_PORT: "5432", POSTGRES_HOST_PORT: "55432" };
  prepararEntornoHost(entorno);
  assert.equal(entorno.POSTGRES_HOST, "127.0.0.1");
  assert.equal(entorno.POSTGRES_PORT, "55432");
  assert.equal(entorno.STORAGE_LOCAL_DIR, "/var/lib/cil/archivos");

  const conDirectorio = { STORAGE_LOCAL_DIR: "/otro" };
  prepararEntornoHost(conDirectorio);
  assert.equal(conDirectorio.POSTGRES_PORT, "55432");
  assert.equal(conDirectorio.STORAGE_LOCAL_DIR, "/otro");
});

test("las URLs locales pasan", () => {
  assert.equal(motivoNoLocal(DEV), null);
  assert.equal(motivoFueraDeDev(DEV), null);
});

test("una URL pública, ausente o inválida lo impide y el mensaje no trae su valor", () => {
  const motivo = motivoNoLocal({ ...DEV, FRONTEND_PUBLIC_URL: "https://admision.colegio.pe" });
  assert.equal(motivo, "FRONTEND_PUBLIC_URL no apunta al entorno local");
  assert.equal(motivoNoLocal({ ...DEV, KEYCLOAK_PUBLIC_URL: undefined }), "KEYCLOAK_PUBLIC_URL no apunta al entorno local");
  assert.equal(motivoNoLocal({ ...DEV, KEYCLOAK_PUBLIC_URL: "no es url" }), "KEYCLOAK_PUBLIC_URL no apunta al entorno local");
});

test("dev:demo se niega con NODE_ENV=production o con otra base", () => {
  assert.equal(motivoFueraDeDev({ ...DEV, NODE_ENV: "production" }), "NODE_ENV es production");
  assert.equal(motivoFueraDeDev({ ...DEV, ADMISION_DB: "admision_test" }), "ADMISION_DB no es la base de dev");
  assert.equal(motivoFueraDeDev({ ...DEV, ADMISION_DB: "admision_prod" }), "ADMISION_DB no es la base de dev");
});
