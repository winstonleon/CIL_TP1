// Antes de toda corrida E2E: reinicia el contenedor `api` y espera a que esté healthy (C16, pedido de John del 05/11/2026).
// El límite por IP de las rutas públicas (P01 y P02, ADR-17) se cuenta en memoria de la API, y en dev todo el tráfico
// comparte ese contador: dos corridas seguidas (p. ej. test:e2e y luego evidencias:matriz) daban 429 en
// e2e/captacion.spec.ts. Reiniciar la API deja el contador vacío. Si no queda healthy a tiempo, el E2E no empieza.
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";

const RAIZ = resolve(import.meta.dirname, "..");
const COMPOSE = ["compose", "-f", "docker-compose.yml", "-f", "docker-compose.dev.yml"];
const TOPE_MS = 120_000;
const INTERVALO_MS = 2_000;

const docker = (args: string[]) => execFileSync("docker", args, { cwd: RAIZ, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms));

export default async function reiniciarApi(): Promise<void> {
  try {
    docker([...COMPOSE, "restart", "api"]);
  } catch (e) {
    throw new Error(`E2E abortado: no se pudo reiniciar el contenedor api (¿está levantado el entorno dev?). ${(e as Error).message}`);
  }
  const id = docker([...COMPOSE, "ps", "-q", "api"]);
  if (!id) throw new Error("E2E abortado: el contenedor api no existe. Levanta el entorno dev (docker compose … up -d).");

  const limite = Date.now() + TOPE_MS;
  let estado = "";
  while (Date.now() < limite) {
    estado = docker(["inspect", "--format", "{{.State.Health.Status}}", id]);
    if (estado === "healthy") return;
    await esperar(INTERVALO_MS);
  }
  throw new Error(
    `E2E abortado: el contenedor api no quedó healthy ${TOPE_MS / 1000} s después de reiniciarlo (último estado: «${estado}»). ` +
      "Revisa su log: docker compose -f docker-compose.yml -f docker-compose.dev.yml logs api",
  );
}
