// HU0021-1.0, 3.0 y 4.0 desde la pantalla G10 (Usuarios y roles), con Keycloak, Mailpit y la API reales.
// Requiere el entorno dev levantado (el frontend con el proxy /api), `npm run kc:usuarios-prueba` y
// `npm run db:seed`. Deja una cuenta hu0021-e2e-*@ejemplo.test desactivada en dev (compromiso C16).
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test, type Browser, type Page } from "@playwright/test";
import { contrasenaE2E, correoConEnlace, correoE2E, definirContrasena, entrarEnGestion } from "./ayudantes";

const usuarios: { username: string; rol: string }[] = JSON.parse(
  readFileSync(resolve(import.meta.dirname, "../infra/keycloak/usuarios-prueba.json"), "utf8"),
);
const DIRECTORA = usuarios.find((u) => u.rol === "directora")!.username;
const CONTRASENA_PRUEBA = process.env.KEYCLOAK_TEST_USER_PASSWORD!;

test.describe.configure({ mode: "serial" });

// Abre G10 como la directora de prueba en un contexto propio.
async function abrirG10(browser: Browser): Promise<{ pagina: Page; cerrar: () => Promise<void> }> {
  const contexto = await browser.newContext();
  const pagina = await contexto.newPage();
  await entrarEnGestion(pagina, DIRECTORA, CONTRASENA_PRUEBA);
  await pagina.getByRole("link", { name: "Usuarios y roles" }).click();
  await expect(pagina).toHaveURL(/\/gestion\/usuarios$/);
  return { pagina, cerrar: () => contexto.close() };
}

// Opciones de la barra lateral que ve la persona al iniciar sesión.
async function opcionesAlEntrar(browser: Browser, usuario: string, contrasena: string, area: string): Promise<string[]> {
  const contexto = await browser.newContext();
  const pagina = await contexto.newPage();
  try {
    await entrarEnGestion(pagina, usuario, contrasena);
    const menu = pagina.getByRole("navigation", { name: `Menú de ${area}` });
    await expect(menu).toBeVisible();
    return (await menu.locator(".opcion").allTextContents()).map((t) => t.trim());
  } finally {
    await contexto.close();
  }
}

test.describe("HU0021 cuentas del personal desde G10", () => {
  const correo = correoE2E();
  const contrasena = contrasenaE2E();
  const filaDe = (pagina: Page) => pagina.locator("tbody tr", { hasText: correo });

  test("HU0021-1.0 la directora crea la cuenta en G10; la persona define su contraseña con el enlace y al iniciar sesión ve solo las opciones de su rol", async ({ browser, request }) => {
    test.setTimeout(120_000);
    const g10 = await abrirG10(browser);
    try {
      const { pagina } = g10;
      await pagina.getByLabel("Nombres").fill("Prueba");
      await pagina.getByLabel("Apellidos").fill("Pantalla");
      await pagina.getByLabel("Correo institucional").fill(correo);
      await pagina.getByRole("combobox", { name: /^Rol/ }).selectOption({ label: "Secretaría" });
      await pagina.getByRole("button", { name: "Crear usuario" }).click();

      await expect(filaDe(pagina)).toContainText("Prueba Pantalla");
      await expect(filaDe(pagina)).toContainText("Secretaría");
      await expect(filaDe(pagina)).toContainText("Activo");
      await expect(pagina.getByRole("status")).toContainText(correo);
    } finally {
      await g10.cerrar();
    }

    const { enlace } = await correoConEnlace(request, correo);
    await definirContrasena(browser, enlace, contrasena);

    expect(await opcionesAlEntrar(browser, correo, contrasena, "Secretaría de Admisión")).toEqual([
      "Bandeja de expedientes",
      "Visitas guiadas",
      "Configuración de campaña",
    ]);
  });

  test("HU0021-3.0 la directora cambia el rol en G10 y, en su siguiente inicio de sesión, la persona ve solo las opciones del rol nuevo", async ({ browser }) => {
    test.setTimeout(90_000);
    const g10 = await abrirG10(browser);
    try {
      const { pagina } = g10;
      await filaDe(pagina).getByRole("button", { name: "Editar Prueba Pantalla" }).click();
      await expect(pagina.getByRole("heading", { name: "Editar usuario" })).toBeVisible();
      await expect(pagina.getByLabel("Correo institucional")).toBeDisabled();
      await pagina.getByRole("combobox", { name: /^Rol/ }).selectOption({ label: "Tesorería" });
      await pagina.getByRole("button", { name: "Guardar cambios" }).click();

      await expect(filaDe(pagina)).toContainText("Tesorería");
      await expect(pagina.getByRole("status")).toHaveText("Cambios guardados.");
    } finally {
      await g10.cerrar();
    }

    expect(await opcionesAlEntrar(browser, correo, contrasena, "Tesorería")).toEqual(["Validaciones de Tesorería"]);
  });

  test("HU0021-4.0 la directora desactiva la cuenta en G10: su sesión abierta se cierra, no puede volver a entrar y G10 la muestra «Desactivado»", async ({ browser }) => {
    test.setTimeout(90_000);
    // La persona tiene una sesión abierta antes de la desactivación.
    const contextoPersona = await browser.newContext();
    const persona = await contextoPersona.newPage();
    await entrarEnGestion(persona, correo, contrasena);

    const g10 = await abrirG10(browser);
    try {
      const { pagina } = g10;
      await filaDe(pagina).getByRole("button", { name: "Desactivar Prueba Pantalla" }).click();
      const dialogo = pagina.getByRole("dialog");
      await expect(dialogo).toContainText("¿Desactivar la cuenta de Prueba Pantalla? No podrá iniciar sesión.");
      await dialogo.getByRole("button", { name: "Desactivar" }).click();

      await expect(filaDe(pagina)).toContainText("Desactivado");
      await expect(filaDe(pagina).getByRole("button")).toHaveCount(0);
    } finally {
      await g10.cerrar();
    }

    try {
      // Al recargar, el token en memoria se pierde y Keycloak ya no tiene su sesión: vuelve el formulario de acceso.
      await persona.reload();
      await expect(persona.locator("#kc-login")).toBeVisible();
      // Y con la contraseña correcta no entra.
      await persona.locator("#username").fill(correo);
      await persona.locator("#password").fill(contrasena);
      await persona.locator("#kc-login").click();
      await persona.waitForLoadState("networkidle");
      await expect(persona.locator("#kc-login")).toBeVisible();
      expect(persona.url()).not.toMatch(/\/gestion$/);
    } finally {
      await contextoPersona.close();
    }
  });

  test("G10 la matriz «Permisos por rol» con la API real coincide con el mockup", async ({ browser }) => {
    const g10 = await abrirG10(browser);
    try {
      const filas = g10.pagina.getByTestId("matriz-permisos").locator("tbody tr");
      await expect(filas).toHaveCount(5);
      const matriz: Record<string, string[]> = {};
      for (const fila of await filas.all()) {
        matriz[(await fila.locator("th").textContent())!.trim()] = (await fila.locator("td .solo-lector").allTextContents()).map((t) => t.trim());
      }
      const s = "Sí";
      const n = "No";
      expect(matriz).toEqual({
        Secretaría: [s, s, n, n, s, s, n],
        Tesorería: [s, n, s, n, n, n, n],
        Psicología: [s, n, n, s, n, n, n],
        "Evaluación académica": [s, n, n, n, n, n, n],
        Dirección: [s, n, n, s, n, n, s],
      });
    } finally {
      await g10.cerrar();
    }
  });
});
