// Las pruebas de la API corren desde el host contra la BD admision_test (ADR-09),
// con claves de cifrado y token de servicio aleatorios propios de la corrida (no los de .env).
import { randomBytes } from "node:crypto";
import { resolve } from "node:path";
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
};
Object.assign(process.env, entornoPrueba);

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    env: entornoPrueba,
    globalSetup: ["test/globalSetup.ts"],
    // Una sola BD compartida: los archivos se ejecutan en serie.
    fileParallelism: false,
  },
});
