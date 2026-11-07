// HU0019 · tablero de indicadores contra el entorno dev (API, Keycloak y Postgres): la directora abre G08, actualiza las métricas
// con la campaña activa y descarga el reporte ejecutivo. Solo lee: no crea datos. Los cálculos con números exactos los prueban
// api/test/indicadores*.test.ts; aquí se comprueba el camino real, comparando el embudo con la base de dev.
// - Capturas: docs/evidencias/HU0019/.
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";
import { entrarEnGestion } from "./ayudantes";

const RAIZ = resolve(import.meta.dirname, "..");
const CAPTURAS = resolve(RAIZ, "docs/evidencias/HU0019");
const COMPOSE = ["compose", "-f", "docker-compose.yml", "-f", "docker-compose.dev.yml"];
const CAMPANA = process.env.CAMPANA_ACTIVA!;
const CONTRASENA = process.env.KEYCLOAK_TEST_USER_PASSWORD!;
const DIRECTORA = "directora.prueba@ejemplo.test";

const consultarAdmision = (sql: string) =>
  execFileSync("docker", [...COMPOSE, "exec", "-T", "postgres", "psql", "-U", "api_admision", "-d", "admision", "-tA", "-c", sql], {
    cwd: RAIZ,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();

test.describe("HU0019 tablero de indicadores", () => {
  test.beforeEach(async ({ page }) => {
    await entrarEnGestion(page, DIRECTORA, CONTRASENA);
    await page.getByRole("link", { name: "Indicadores" }).click();
    await expect(page.getByRole("heading", { name: "Embudo de admisión" })).toBeVisible();
  });

  test("HU0019-1.0 la directora abre el tablero, actualiza las métricas de la campaña activa y ve embudo, tiempos y vacantes", async ({ page }) => {
    await expect(page.getByTestId("filtro-campana")).toHaveValue(CAMPANA);

    await page.getByTestId("actualizar").click();

    const prospectos = consultarAdmision(
      `SELECT count(*) FROM expediente e JOIN grado g ON g.id_grado = e.id_grado WHERE g.campana_admision = '${CAMPANA}'`,
    );
    await expect(page.getByTestId("embudo-prospectos")).toContainText(prospectos);
    await expect(page.getByRole("heading", { name: "Lead time y cycle time por etapa" })).toBeVisible();
    await expect(page.getByTestId("etapa-captacion_visita").getByTestId("cycle")).toHaveText("No se mide: sin atención del personal");
    await expect(page.getByRole("table", { name: "Ocupación de vacantes por grado" })).toBeVisible();
    await expect(page.getByTestId("aviso-demo")).toHaveCount(0);

    mkdirSync(CAPTURAS, { recursive: true });
    await page.screenshot({ path: resolve(CAPTURAS, "g08-tablero.png"), fullPage: true });
  });

  test("HU0019-2.0 la directora aplica un rango de fechas y descarga el reporte ejecutivo en Excel", async ({ page }) => {
    await page.getByTestId("filtro-desde").fill("2026-01-01");
    await page.getByTestId("filtro-hasta").fill("2026-12-31");
    await page.getByTestId("actualizar").click();
    await expect(page.getByText("No incluye datos personales de los postulantes.")).toBeVisible();

    const descarga = page.waitForEvent("download");
    await page.getByTestId("exportar").click();
    const archivo = await descarga;

    expect(archivo.suggestedFilename()).toMatch(new RegExp(`^indicadores-${CAMPANA}-\\d{4}-\\d{2}-\\d{2}\\.xlsx$`));
    const contenido = readFileSync(await archivo.path());
    expect(contenido.subarray(0, 2).toString("latin1")).toBe("PK"); // un .xlsx es un ZIP
    expect(contenido.length).toBeGreaterThan(1000);
    await expect(page.getByTestId("error")).toHaveCount(0);
  });
});
