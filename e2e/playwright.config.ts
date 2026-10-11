// E2E contra el entorno dev levantado con docker compose (frontend en FRONTEND_PUBLIC_URL, Keycloak,
// API y n8n). Requiere los usuarios de prueba: npm run kc:usuarios-prueba.
import { resolve } from "node:path";
import { defineConfig, devices } from "@playwright/test";

process.loadEnvFile(resolve(import.meta.dirname, "..", ".env"));

// El E2E escribe en la instancia de dev y detiene contenedores (docs/compromisos.md C16): solo se permite
// contra el entorno local. Las demás URLs de los specs ya se arman con 127.0.0.1.
const HOSTS_LOCALES = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);
for (const nombre of ["FRONTEND_PUBLIC_URL", "KEYCLOAK_PUBLIC_URL"]) {
  const valor = process.env[nombre];
  let host: string;
  try {
    host = new URL(valor ?? "").hostname;
  } catch {
    throw new Error(`E2E abortado: ${nombre} no está definida o no es una URL válida.`);
  }
  if (!HOSTS_LOCALES.has(host)) {
    throw new Error(`E2E abortado: ${nombre} apunta a «${host}». El E2E solo corre contra el entorno local (localhost).`);
  }
}

export default defineConfig({
  testDir: ".",
  testMatch: "*.spec.ts",
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: process.env.FRONTEND_PUBLIC_URL,
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
