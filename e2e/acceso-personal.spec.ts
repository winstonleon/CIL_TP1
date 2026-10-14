// HU0021 · G01 (acceso del personal): tema de login «cil» de Keycloak para el cliente gestion-interna.
// Requiere el entorno dev levantado con el realm reimportado (login_theme del cliente) y los usuarios de prueba.
// La prueba 4.0 deja una cuenta hu0021-e2e-*@ejemplo.test desactivada en dev (compromiso C16).
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";
import {
  contrasenaE2E,
  correoConEnlace,
  correoE2E,
  definirContrasena,
  FRONTEND,
  iniciarSesion,
  llamarApi,
} from "./ayudantes";

const usuarios: { username: string; rol: string }[] = JSON.parse(
  readFileSync(resolve(import.meta.dirname, "../infra/keycloak/usuarios-prueba.json"), "utf8"),
);
const usuarioDeRol = (rol: string) => usuarios.find((u) => u.rol === rol)!.username;
const HOSTS_LOCALES = new Set(["localhost", "127.0.0.1"]);

test.describe("HU0021 G01 · acceso del personal", () => {
  test("HU0021-1.0 /gestion abre el acceso del personal (G01) con sus textos, campos y botón, sin recursos externos", async ({ page }) => {
    const externos: string[] = [];
    page.on("request", (r) => {
      const host = new URL(r.url()).hostname;
      if (!HOSTS_LOCALES.has(host)) externos.push(host);
    });

    await page.goto(`${FRONTEND}/gestion`);
    await expect(page).toHaveURL(/\/realms\/cil-admision\/protocol\/openid-connect\/auth\?/);
    expect(new URL(page.url()).searchParams.get("client_id")).toBe("gestion-interna");

    await expect(page.getByRole("heading", { level: 1, name: "Gestión de Admisión" })).toBeVisible();
    await expect(page.getByText("Acceso exclusivo para el personal del colegio.")).toBeVisible();
    await expect(page.getByLabel("Correo institucional")).toHaveAttribute("id", "username");
    await expect(page.getByLabel("Contraseña")).toHaveAttribute("id", "password");
    await expect(page.getByRole("button", { name: "Ingresar" })).toHaveAttribute("id", "kc-login");
    await expect(page.getByText("Las cuentas las crea la Dirección. Si es tu primera vez, usa el enlace que llegó a tu correo para definir tu contraseña.")).toBeVisible();
    await expect(page.getByRole("complementary", { name: "Accesos por rol" }).locator("li")).toHaveText([
      "Secretaría: expedientes, visitas y configuración",
      "Tesorería: pagos y documentación financiera",
      "Psicología: evaluaciones, entrevistas y dictámenes",
      "Evaluación académica: resultados",
      "Dirección: vacantes, indicadores y usuarios",
    ]);
    // La recuperación de contraseña llega con HU0023 (realm.resetPasswordAllowed sigue en false).
    await expect(page.getByText("¿Olvidaste tu contraseña?")).toHaveCount(0);

    // Fuentes alojadas en el tema (plan HU0021, P9): cargan sin pedir nada fuera del entorno local.
    await page.evaluate(() => document.fonts.ready);
    expect(await page.evaluate(() => document.fonts.check("700 30px Fraunces") && document.fonts.check('400 15px "Public Sans"'))).toBe(true);
    expect(externos).toEqual([]);
  });

  test("G01 con usuario o contraseña incorrectos muestra el error de Keycloak junto a los campos y conserva el correo", async ({ page }) => {
    const usuario = usuarioDeRol("secretaria");
    await page.goto(`${FRONTEND}/gestion`);
    await page.getByLabel("Correo institucional").fill(usuario);
    await page.getByLabel("Contraseña").fill("contrasena-incorrecta");
    await page.getByRole("button", { name: "Ingresar" }).click();

    await expect(page.locator("#input-error")).toHaveText("Usuario o contraseña incorrectos.");
    await expect(page.getByLabel("Correo institucional")).toHaveValue(usuario);
    await expect(page.getByLabel("Contraseña")).toHaveAttribute("aria-invalid", "true");
  });

  test("HU0021-4.0 una cuenta desactivada ve en G01 el mensaje de Keycloak y no entra", async ({ browser, page, request }) => {
    test.setTimeout(120_000);
    const correo = correoE2E();
    const contrasena = contrasenaE2E();
    const tokenDirectora = await iniciarSesion(browser, usuarioDeRol("directora"), process.env.KEYCLOAK_TEST_USER_PASSWORD!);
    expect(tokenDirectora, "la directora de prueba no pudo iniciar sesión").toBeTruthy();

    const alta = await llamarApi(request, "post", "/personal", tokenDirectora!, { nombres: "Prueba", apellidos: "G01", correo, rol: "secretaria" });
    expect(alta.status()).toBe(201);
    const { id_personal } = await alta.json();
    const { enlace } = await correoConEnlace(request, correo);
    await definirContrasena(browser, enlace, contrasena);
    expect((await llamarApi(request, "post", `/personal/${id_personal}/desactivacion`, tokenDirectora!)).status()).toBe(200);

    await page.goto(`${FRONTEND}/gestion`);
    await page.getByLabel("Correo institucional").fill(correo);
    await page.getByLabel("Contraseña").fill(contrasena);
    await page.getByRole("button", { name: "Ingresar" }).click();

    await expect(page.getByRole("alert")).toHaveText("La cuenta está desactivada, contacte con el administrador.");
    await expect(page.getByRole("heading", { level: 1, name: "Gestión de Admisión" })).toBeVisible();
    expect(page.url()).not.toMatch(/\/gestion$/);
  });

  test("G01 control: portal-familias conserva el tema por defecto de Keycloak (P03 llega con HU0023)", async ({ page }) => {
    await page.goto(`${FRONTEND}/portal`);
    await expect(page).toHaveURL(/\/realms\/cil-admision\/protocol\/openid-connect\/auth\?/);
    expect(new URL(page.url()).searchParams.get("client_id")).toBe("portal-familias");
    await expect(page.locator("#kc-login")).toBeVisible();
    await expect(page.getByText("Gestión de Admisión")).toHaveCount(0);
    await expect(page.getByText("Acceso exclusivo para el personal del colegio.")).toHaveCount(0);
  });
});
