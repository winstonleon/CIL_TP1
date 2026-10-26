// HU0001 · P01 (solicitud de información y consentimiento) contra el entorno dev, sin sesión: la familia llega desde un
// enlace de las redes del colegio. Requiere los grados de la campaña activa (npm run db:seed).
// Datos (C16): la 1.0 deja en dev un prospecto hu0001-e2e-<marca>@ejemplo.test por corrida (apoderado, consentimiento y
// expediente). El E2E solo lee la BD (psql dentro del contenedor, como e2e/notificacion.spec.ts, que no se toca porque
// es la evidencia de S0-C7 y S0-C8). El límite por IP de /publico (ADR-17) es compartido en dev: solo la 1.0 envía.
// Capturas: test-results/HU0001/capturas-e2e/ (ignorada por git). Las de la corrida final se copian a
// docs/evidencias/HU0001/, para que cada corrida no reescriba los PNG versionados.
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { FRONTEND } from "./ayudantes";

const RAIZ = resolve(import.meta.dirname, "..");
const CAPTURAS = resolve(RAIZ, "test-results/HU0001/capturas-e2e");
const COMPOSE = ["compose", "-f", "docker-compose.yml", "-f", "docker-compose.dev.yml"];
const P01 = `${FRONTEND}/solicitud-informacion`;
const correoE2E = () => `hu0001-e2e-${Date.now()}-${randomBytes(2).toString("hex")}@ejemplo.test`;

const MENSAJE_TELEFONO = "Ingresa un celular válido: 9 dígitos que empiecen con 9, o el número internacional con +código de país.";
const CONFIRMACION =
  "Solicitud registrada. Te enviaremos la carpeta informativa al correo que indicaste, con el enlace para agendar tu visita guiada.";

// Consulta de solo lectura a la base admision de dev, con el usuario de la API.
function consultarAdmision(sql: string): string {
  return execFileSync("docker", [...COMPOSE, "exec", "-T", "postgres", "psql", "-U", "api_admision", "-d", "admision", "-tA", "-F", "\t", "-c", sql], {
    cwd: RAIZ,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

async function capturar(page: Page, nombre: string, completa = false) {
  mkdirSync(CAPTURAS, { recursive: true });
  await page.screenshot({ path: resolve(CAPTURAS, `${nombre}.png`), fullPage: completa });
}

// Registra cada POST de la página a la ruta pública: en 2.0 y 3.0 no debe salir ninguno.
function vigilarEnvios(page: Page): string[] {
  const envios: string[] = [];
  page.on("request", (r) => {
    if (r.method() === "POST" && new URL(r.url()).pathname.endsWith("/publico/solicitud-informacion")) envios.push(r.url());
  });
  return envios;
}

async function abrirP01(page: Page, consulta = "?origen=facebook", ancho = 1440, alto = 960) {
  await page.setViewportSize({ width: ancho, height: alto });
  await page.goto(`${P01}${consulta}`);
  await expect(page.getByRole("heading", { name: "Solicita información" })).toBeVisible();
  // Los grados de la campaña activa llegan de la API.
  await expect.poll(() => page.locator("#p01g option").count(), { message: "faltan los grados: ejecuta npm run db:seed" }).toBeGreaterThan(1);
}

async function completar(page: Page, correo: string) {
  await page.getByLabel("Nombres del apoderado").fill("Nombre E2e");
  await page.getByLabel("Apellidos del apoderado").fill("Apellido Prueba");
  await page.getByLabel("Teléfono celular").fill("987 654 321");
  await page.getByLabel("Correo electrónico").fill(correo);
  await page.getByLabel("Nivel y grado de interés").selectOption({ label: "Primaria · 3.° de primaria" });
}

const botonEnviar = (page: Page) => page.getByRole("button", { name: "Solicitar información" });
const casillaWhatsapp = (page: Page) => page.getByRole("checkbox", { name: /WhatsApp/ });

test.describe("HU0001 P01 · solicitud de información y consentimiento", () => {
  test("HU0001-1.0 desde un enlace de Instagram, la familia registra sus datos, autoriza WhatsApp y acepta la política: ve la confirmación y quedan el apoderado, el consentimiento y el expediente en prospecto", async ({ page }) => {
    const correo = correoE2E();
    await abrirP01(page, "?origen=instagram");
    await completar(page, correo);
    await casillaWhatsapp(page).check();

    // Lee la política antes de aceptarla (versión provisional, C29).
    await page.getByRole("link", { name: "Política de privacidad" }).click();
    const dialogo = page.getByRole("dialog", { name: "Política de privacidad" });
    await expect(dialogo).toContainText("Versión borrador-1");
    await capturar(page, "p01-politica");
    await dialogo.getByRole("button", { name: "Cerrar" }).click();

    await page.locator("#p01ok").check();
    await capturar(page, "p01-formulario");
    const respuesta = page.waitForResponse((r) => r.request().method() === "POST" && r.url().endsWith("/publico/solicitud-informacion"));
    await botonEnviar(page).click();
    expect((await respuesta).status()).toBe(201);
    await expect(page.getByRole("status")).toHaveText(CONFIRMACION);
    await capturar(page, "p01-confirmacion");

    // Lo que quedó en la BD: teléfono en E.164, sin DNI, la versión vigente, el canal del enlace, WhatsApp autorizado,
    // el expediente en prospecto sin postulante y ningún evento de auditoría (plan HU0001, P2).
    const fila = consultarAdmision(
      `SELECT a.telefono, a.dni_hash IS NULL, c.version_politica, c.canal_origen, c.autoriza_whatsapp, e.estado,
              e.id_postulante IS NULL, g.nombre_grado,
              (SELECT count(*) FROM registro_auditoria r WHERE r.id_expediente = e.id_expediente)
         FROM apoderado a
         JOIN consentimiento c ON c.id_apoderado = a.id_apoderado
         JOIN expediente e ON e.id_apoderado_titular = a.id_apoderado
         JOIN grado g ON g.id_grado = e.id_grado
        WHERE a.correo = '${correo}'`,
    );
    expect(fila.split("\t")).toEqual(["+51987654321", "t", "borrador-1", "instagram", "t", "prospecto", "t", "3.° de primaria", "0"]);
  });

  test("HU0001-2.0 con campos vacíos o con formato inválido, P01 resalta los campos con el color del estado observado de los prototipos, muestra los mensajes y no envía nada", async ({ page }) => {
    const envios = vigilarEnvios(page);
    await abrirP01(page);
    // Color del estado «observado» de los prototipos (#8A4B08, --observado), el de P06, G03, G05 y P07b (HU0001-2.0, ADR-17).
    const observado = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--observado").trim());
    expect(observado).toBe("#8a4b08");
    const enObservado = "rgb(138, 75, 8)";

    // Campos vacíos (y sin consentimiento).
    await botonEnviar(page).click();
    await expect(page.getByRole("alert")).toHaveText("Revisa los campos marcados.");
    const vacios: [string, string][] = [
      ["p01n", "Este campo es obligatorio."],
      ["p01a", "Este campo es obligatorio."],
      ["p01t", "Este campo es obligatorio."],
      ["p01c", "Este campo es obligatorio."],
      ["p01g", "Selecciona el nivel y grado de interés."],
    ];
    for (const [id, mensaje] of vacios) {
      const campo = page.locator(`#${id}`);
      await expect(campo).toHaveAttribute("aria-invalid", "true");
      await expect(campo).toHaveAttribute("aria-describedby", `${id}-error`);
      await expect(campo).toHaveCSS("border-top-color", enObservado);
      await expect(page.locator(`#${id}-error`)).toHaveText(mensaje);
      await expect(page.locator(`#${id}-error`)).toHaveCSS("color", enObservado);
    }
    await expect(page.locator("#p01n")).toBeFocused();
    await capturar(page, "p01-campos-vacios", true);

    // Correo y celular con formato inválido; lo demás, correcto.
    await completar(page, "familia@ejemplo");
    await page.getByLabel("Teléfono celular").fill("887654321");
    await page.locator("#p01ok").check();
    await botonEnviar(page).click();
    await expect(page.locator("#p01t-error")).toHaveText(MENSAJE_TELEFONO);
    await expect(page.locator("#p01c-error")).toHaveText("Ingresa un correo válido.");
    for (const id of ["p01t", "p01c"]) await expect(page.locator(`#${id}`)).toHaveCSS("border-top-color", enObservado);
    for (const id of ["p01n", "p01a", "p01g", "p01ok"]) await expect(page.locator(`#${id}`)).toHaveAttribute("aria-invalid", "false");
    await expect(page.locator("#p01t")).toBeFocused();
    await capturar(page, "p01-formato-invalido", true);

    expect(envios).toEqual([]);
  });

  test("HU0001-3.0 sin marcar el consentimiento, P01 indica que es obligatorio para continuar, no envía nada y no se guarda ningún dato", async ({ page }) => {
    const envios = vigilarEnvios(page);
    const correo = correoE2E();
    await abrirP01(page);
    await expect(page.locator("#p01ok")).not.toBeChecked();
    await expect(casillaWhatsapp(page)).not.toBeChecked();

    await completar(page, correo);
    await botonEnviar(page).click();
    await expect(page.locator("#p01ok-error")).toHaveText("El consentimiento es obligatorio para continuar.");
    await expect(page.locator("#p01ok")).toHaveAttribute("aria-invalid", "true");
    await expect(page.locator("#p01ok")).toBeFocused();
    await expect(page.locator(".consentimiento")).toHaveCSS("border-top-color", "rgb(138, 75, 8)");
    await capturar(page, "p01-sin-consentimiento", true);

    expect(envios).toEqual([]);
    expect(Number(consultarAdmision(`SELECT count(*) FROM apoderado WHERE correo = '${correo}'`))).toBe(0);
  });

  test("P01 en Chromium: el campo trampa queda fuera de pantalla, fuera del orden de tabulación y fuera del árbol de accesibilidad", async ({ page }) => {
    await abrirP01(page);
    const caja = await page.locator("#p01-comentario").boundingBox();
    expect(caja, "el campo trampa no está en el DOM").not.toBeNull();
    expect(caja!.x + caja!.width).toBeLessThan(0);

    await page.getByRole("link", { name: "Portal de postulación" }).focus();
    const enfocados: string[] = [];
    for (let i = 0; i < 10; i++) {
      await page.keyboard.press("Tab");
      enfocados.push(await page.evaluate(() => document.activeElement?.id ?? ""));
    }
    expect(enfocados.slice(0, 7)).toEqual(["p01n", "p01a", "p01t", "p01c", "p01g", "p01wa", "p01ok"]);
    expect(enfocados).not.toContain("p01-comentario");

    expect(await page.locator("form").ariaSnapshot()).not.toMatch(/comentario/i);
  });

  test("P01 en Chromium: por debajo de 960 px el panel y el formulario se apilan, sin scroll horizontal", async ({ page }) => {
    for (const [ancho, apilado] of [
      [1440, false],
      [960, false],
      [959, true],
      [390, true],
    ] as const) {
      await abrirP01(page, "?origen=facebook", ancho, 900);
      const panel = (await page.locator(".panel").boundingBox())!;
      const tarjeta = (await page.locator(".tarjeta").boundingBox())!;
      expect(tarjeta.y >= panel.y + panel.height, `${ancho} px: la tarjeta va debajo del panel`).toBe(apilado);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), `${ancho} px sin scroll horizontal`).toBe(true);
    }
    await capturar(page, "p01-movil", true);
  });
});
