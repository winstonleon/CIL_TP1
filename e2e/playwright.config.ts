// E2E contra el entorno dev levantado con docker compose (frontend en FRONTEND_PUBLIC_URL, Keycloak,
// API y n8n). Requiere los usuarios de prueba: npm run kc:usuarios-prueba.
import { resolve } from "node:path";
import { defineConfig, devices } from "@playwright/test";

process.loadEnvFile(resolve(import.meta.dirname, "..", ".env"));

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
