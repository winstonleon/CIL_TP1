// Las pruebas de la API corren desde el host contra la BD admision_test (ADR-09),
// con claves de cifrado y token de servicio aleatorios propios de la corrida (no los de .env).
import { randomBytes } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { defineConfig } from "vitest/config";

const RAIZ = resolve(import.meta.dirname, "..");
process.loadEnvFile(resolve(RAIZ, ".env"));

const baseAdmision = (process.env.ADMISION_DB ?? "admision").replace(/_test$/, "");
const entornoPrueba = {
  POSTGRES_HOST: "127.0.0.1",
  POSTGRES_PORT: process.env.POSTGRES_HOST_PORT || "55432",
  ADMISION_DB: `${baseAdmision}_test`,
  DATA_ENCRYPTION_KEY: randomBytes(32).toString("base64"),
  DATA_HMAC_KEY: randomBytes(32).toString("base64"),
  INTERNAL_API_TOKEN: randomBytes(32).toString("hex"),
  // Eventos hacia n8n (ADR-16, HU0001): secreto propio de la corrida y un puerto cerrado, para que ninguna prueba use
  // el secreto real de dev ni llegue al n8n de dev (C15). Las pruebas de HU0001 inyectan su n8n simulado.
  N8N_WEBHOOK_SECRET: randomBytes(32).toString("hex"),
  N8N_WEBHOOK_INTERNAL_URL: "http://127.0.0.1:9/webhook",
  // Carpeta informativa (HU0002, ADR-18): clave propia de la corrida y sin URL de la carpeta, para no depender del .env.
  ENLACE_VISITA_KEY: randomBytes(32).toString("base64"),
  CARPETA_INFORMATIVA_URL: "",
  // Visita guiada (HU0003, ADR-19): el valor de D4 y sin dirección del colegio, para no depender del .env.
  RECORDATORIO_VISITA_HORAS: "24",
  DIRECCION_COLEGIO: "",
  // Buzón de admisión (HU0010-2.0, ADR-25): el de dev, para no depender del .env.
  CORREO_ADMISION: "admision@ejemplo.test",
  // Buzón de Tesorería (HU0014-1.0, ADR-26): el de dev, para no depender del .env.
  CORREO_TESORERIA: "tesoreria@ejemplo.test",
  // Evaluaciones (HU0009-2.0, ADR-19): el valor del escenario («al menos 24 horas»), para no depender del .env.
  REPROGRAMACION_MIN_HORAS: "24",
  // Archivos (HU0006 y HU0007, ADR-21): directorio temporal y clave propios de la corrida, para no tocar los de dev.
  STORAGE_DRIVER: "local",
  STORAGE_LOCAL_DIR: mkdtempSync(join(tmpdir(), "cil-archivos-")),
  ARCHIVOS_ENCRYPTION_KEY: randomBytes(32).toString("base64"),
  ARCHIVOS_ENCRYPTION_KEY_ANTERIOR: "",
};
Object.assign(process.env, entornoPrueba);

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    env: entornoPrueba,
    globalSetup: ["test/globalSetup.ts"],
    // Una sola BD compartida: los archivos se ejecutan en serie.
    fileParallelism: false,
    // Los 5 s por defecto no alcanzan para generar la demo (60 expedientes) con la PC cargada (demo.test.ts, 17/11/2026).
    testTimeout: 30_000,
  },
});
