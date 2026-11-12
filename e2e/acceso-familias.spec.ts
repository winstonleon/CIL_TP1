// HU0023 · acceso de la familia al portal con el tema de Keycloak (P03, P03b y P03c) contra el entorno dev.
// - Cuentas: cada prueba crea su usuario de Keycloak por la Admin API (rol familia, contraseña temporal o definitiva) y su
//   expediente en la base de dev, como HU0005 (C16). Al terminar, en un `finally`, desbloquea la cuenta
//   (DELETE /attack-detection/brute-force/users/:id) y borra el usuario, así las corridas siguientes no heredan un bloqueo.
//   Quedan en dev el apoderado, su cuenta de acceso y su expediente `hu0023-e2e-*@ejemplo.test`.
// - Los intentos fallidos se separan 1,2 s: con menos de quickLoginCheckMilliSeconds (1 s) Keycloak bloquea por «ingreso
//   rápido» antes del quinto intento (como S0-A5).
// - Ninguna contraseña se imprime; las capturas las tapan. Capturas: test-results/HU0023/capturas-e2e/ (ignorada por git).
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { admin, contrasenaE2E, FRONTEND, MAILPIT } from "./ayudantes";

const RAIZ = resolve(import.meta.dirname, "..");
const CAPTURAS = resolve(RAIZ, "test-results/HU0023/capturas-e2e");
const COMPOSE = ["compose", "-f", "docker-compose.yml", "-f", "docker-compose.dev.yml"];
const CAMPANA = process.env.CAMPANA_ACTIVA!;
const GRADO_SQL = `g.nombre_grado LIKE '3.%de primaria' AND g.campana_admision = '${CAMPANA}'`;
const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms));

const consultarAdmision = (sql: string) =>
  execFileSync("docker", [...COMPOSE, "exec", "-T", "postgres", "psql", "-U", "api_admision", "-d", "admision", "-tA", "-c", sql], {
    cwd: RAIZ,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();

async function capturar(page: Page, nombre: string) {
  mkdirSync(CAPTURAS, { recursive: true });
  await page.screenshot({ path: resolve(CAPTURAS, `${nombre}.png`), fullPage: true, mask: [page.locator("input[type='password']")] });
}

// Usuario de Keycloak con su rol y, si es una familia, con su expediente en portal_habilitado.
async function cuenta(rol: "familia" | "secretaria", contrasena: string, temporal: boolean) {
  const correo = `hu0023-e2e-${Date.now()}-${randomBytes(2).toString("hex")}@ejemplo.test`;
  const api = await admin();
  const { res } = await api("POST", "/users", { username: correo, email: correo, firstName: "María Fernanda", lastName: "Quispe Rojas", enabled: true, emailVerified: true });
  const id = res.headers.get("location")!.split("/").pop()!;
  await api("PUT", `/users/${id}/reset-password`, { type: "password", value: contrasena, temporary: temporal });
  const { datos: r } = await api("GET", `/roles/${rol}`);
  await api("POST", `/users/${id}/role-mappings/realm`, [{ id: r.id, name: r.name }]);
  if (rol === "familia") {
    const exp = consultarAdmision(
      `WITH a AS (INSERT INTO apoderado (nombres, apellidos, telefono, correo)
                  VALUES ('María Fernanda', 'Quispe Rojas', '+51987654321', '${correo}') RETURNING id_apoderado),
            c AS (INSERT INTO cuenta_acceso (id_apoderado, keycloak_user_id) SELECT id_apoderado, '${id}'::uuid FROM a)
       INSERT INTO expediente (id_apoderado_titular, id_grado, estado)
       SELECT a.id_apoderado, g.id_grado, 'portal_habilitado' FROM a, grado g WHERE ${GRADO_SQL} RETURNING id_expediente`,
    ).split("\n")[0]!;
    expect(exp, "no se creó el expediente: ¿existe el grado «3.° de primaria» de la campaña activa (npm run db:seed)?").toMatch(/^\d+$/);
  }
  return { id, correo };
}

// Desbloquea (por si una aserción falló a mitad del bloqueo) y borra el usuario.
async function quitar(id: string | undefined) {
  if (!id) return;
  const api = await admin();
  await api("DELETE", `/attack-detection/brute-force/users/${id}`);
  await api("DELETE", `/users/${id}`);
}

async function intentar(page: Page, correo: string, contrasena: string) {
  await page.locator("#username").fill(correo);
  await page.locator("#password").fill(contrasena);
  await page.locator("#kc-login").click();
  await page.waitForLoadState("domcontentloaded");
}

test.describe.serial("HU0023 acceso de la familia al portal (tema de Keycloak)", () => {
  test("HU0023-1.0 [parte: cambio obligatorio] con las credenciales temporales, P03 lleva a P03b, que exige crear una contraseña nueva, y al guardarla da acceso al portal", async ({ browser }) => {
    test.setTimeout(120_000);
    const temporal = contrasenaE2E();
    const nueva = contrasenaE2E();
    let id: string | undefined;
    const contexto = await browser.newContext();
    const page = await contexto.newPage();
    try {
      const c = await cuenta("familia", temporal, true);
      id = c.id;
      await page.goto(`${FRONTEND}/portal`);
      // P03
      await expect(page.locator('[data-pantalla="P03"]')).toBeVisible();
      await expect(page.getByRole("heading", { level: 1, name: "Portal de Postulación" })).toBeVisible();
      await expect(page.getByText(`Colegio Internacional de Lima · Admisión ${CAMPANA}`)).toBeVisible();
      await expect(page.getByText("Ingresa con las credenciales que te enviamos después de tu visita guiada.")).toBeVisible();
      await expect(page.getByText("Si es tu primer ingreso, al continuar te pediremos crear una contraseña nueva.")).toBeVisible();
      await expect(page.getByRole("link", { name: "¿Olvidaste tu contraseña?" })).toBeVisible();
      await expect(page.getByRole("link", { name: "Aún no visito el colegio" })).toHaveAttribute("href", `${FRONTEND}/solicitud-informacion`);
      await capturar(page, "p03-acceso");
      await intentar(page, c.correo, temporal);

      // P03b: la contraseña temporal no da acceso hasta crear una nueva.
      await expect(page.locator('[data-pantalla="P03b"]')).toBeVisible();
      await expect(page.getByRole("heading", { level: 1, name: "Crea tu contraseña nueva" })).toBeVisible();
      await expect(page.getByText("Es tu primer ingreso. Reemplaza la contraseña temporal que te enviamos por una propia.")).toBeVisible();
      // C6: la política sigue provisional; los requisitos van entre corchetes, como en el mockup.
      await expect(page.getByText("Tu contraseña debe cumplir con:")).toBeVisible();
      await expect(page.getByText("[Requisito 1 de la política por definir]")).toBeVisible();
      await capturar(page, "p03b-nueva-contrasena");
      // Una confirmación distinta no se acepta.
      await page.locator("#password-new").fill(nueva);
      await page.locator("#password-confirm").fill(`${nueva}x`);
      await page.getByRole("button", { name: "Guardar contraseña e ingresar" }).click();
      await expect(page.locator('[data-pantalla="P03b"]')).toBeVisible();
      await expect(page.locator("#error-password-confirm")).toBeVisible();
      await page.locator("#password-new").fill(nueva);
      await page.locator("#password-confirm").fill(nueva);
      await page.getByRole("button", { name: "Guardar contraseña e ingresar" }).click();

      await expect(page).toHaveURL(`${FRONTEND}/portal/panel`);
      await expect(page.getByTestId("etapa-ficha")).toBeVisible();
      const { datos: usuario } = await (await admin())("GET", `/users/${id}`);
      expect(usuario.requiredActions ?? []).toEqual([]);
    } finally {
      await contexto.close();
      await quitar(id);
    }
  });

  test("HU0023-1.0 [parte: cambio obligatorio] el personal con una contraseña temporal sigue viendo la página de Keycloak, no P03b", async ({ browser }) => {
    test.setTimeout(90_000);
    let id: string | undefined;
    const contexto = await browser.newContext();
    const page = await contexto.newPage();
    try {
      const temporal = contrasenaE2E();
      const c = await cuenta("secretaria", temporal, true);
      id = c.id;
      await page.goto(`${FRONTEND}/gestion`);
      await expect(page.getByRole("heading", { level: 1, name: "Gestión de Admisión" })).toBeVisible();
      await intentar(page, c.correo, temporal);
      await expect(page.locator("#kc-passwd-update-form")).toBeVisible();
      await expect(page.locator('[data-pantalla="P03b"]')).toHaveCount(0);
      await expect(page.locator("#password-new")).toBeVisible();
    } finally {
      await contexto.close();
      await quitar(id);
    }
  });

  test("HU0023-2.0 tras cinco intentos fallidos consecutivos la cuenta se bloquea temporalmente y P03c informa cómo recuperar el acceso", async ({ browser, request }) => {
    test.setTimeout(180_000);
    const contrasena = contrasenaE2E();
    let id: string | undefined;
    const contexto = await browser.newContext();
    const page = await contexto.newPage();
    try {
      const c = await cuenta("familia", contrasena, false);
      id = c.id;
      await page.goto(`${FRONTEND}/portal`);
      for (let i = 1; i <= 5; i++) {
        await esperar(1_200);
        await intentar(page, c.correo, `incorrecta-${i}`);
        await expect(page.locator('[data-pantalla="P03"]')).toBeVisible();
        await expect(page.locator("#input-error")).toHaveText("Usuario o contraseña incorrectos.");
      }
      await esperar(1_200);
      // Superados los cinco intentos, ni la contraseña correcta entra.
      await intentar(page, c.correo, contrasena);
      await expect(page.locator('[data-pantalla="P03c"]')).toBeVisible();
      await expect(page).not.toHaveURL(new RegExp(`^${FRONTEND}/portal`));
      await expect(page.getByRole("heading", { level: 1, name: "Cuenta bloqueada temporalmente" })).toBeVisible();
      await expect(page.getByText(`Por tu seguridad bloqueamos el acceso de ${c.correo} después de 5 intentos fallidos consecutivos.`)).toBeVisible();
      await expect(page.getByText("Podrás volver a intentarlo en [tiempo de bloqueo por definir]. Si no recuerdas tu contraseña, recupérala ahora: te enviaremos un enlace a tu correo.")).toBeVisible();
      await expect(page.getByText("¿Necesitas ayuda? Secretaría de Admisión · [Teléfono y correo de admisión]")).toBeVisible();
      await expect(page.getByRole("link", { name: "Volver al inicio de sesión" })).toBeVisible();
      await capturar(page, "p03c-cuenta-bloqueada");
      const { datos: bloqueo } = await (await admin())("GET", `/attack-detection/brute-force/users/${id}`);
      expect(bloqueo.disabled).toBe(true);

      // Cómo recuperar el acceso: el enlace de recuperación llega al correo (lo envía Keycloak, D7-A).
      await page.getByRole("link", { name: "Recuperar contraseña" }).click();
      await page.locator("#username").fill(c.correo);
      await page.locator("form [type='submit']").first().click();
      await expect
        .poll(async () => (await (await request.get(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:"${c.correo}"`)}`)).json()).messages?.length ?? 0, {
          message: "no llegó el correo de recuperación de Keycloak",
          timeout: 30_000,
        })
        .toBe(1);
      const lista = await (await request.get(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:"${c.correo}"`)}`)).json();
      const texto = String((await (await request.get(`${MAILPIT}/api/v1/message/${lista.messages[0].ID}`)).json()).Text ?? "");
      expect(texto).toMatch(/https?:\/\/\S+\/login-actions\/action-token\?\S+/);

      // Al terminar se desbloquea por la Admin API (no se espera el tiempo de bloqueo) y la cuenta vuelve a entrar.
      await (await admin())("DELETE", `/attack-detection/brute-force/users/${id}`);
      await esperar(1_200);
      await page.goto(`${FRONTEND}/portal`);
      await intentar(page, c.correo, contrasena);
      await expect(page).toHaveURL(`${FRONTEND}/portal/panel`);
    } finally {
      await contexto.close();
      await quitar(id);
    }
  });

  test("HU0023-2.0 en G01 una cuenta del personal bloqueada sigue viendo el mensaje genérico, sin P03c", async ({ browser }) => {
    test.setTimeout(120_000);
    const contrasena = contrasenaE2E();
    let id: string | undefined;
    const contexto = await browser.newContext();
    const page = await contexto.newPage();
    try {
      const c = await cuenta("secretaria", contrasena, false);
      id = c.id;
      await page.goto(`${FRONTEND}/gestion`);
      for (let i = 1; i <= 5; i++) {
        await esperar(1_200);
        await intentar(page, c.correo, `incorrecta-${i}`);
      }
      await esperar(1_200);
      await intentar(page, c.correo, contrasena);
      await expect(page.getByRole("heading", { level: 1, name: "Gestión de Admisión" })).toBeVisible();
      await expect(page.locator("#input-error")).toHaveText("Usuario o contraseña incorrectos.");
      await expect(page.getByText("Cuenta bloqueada temporalmente")).toHaveCount(0);
      const { datos: bloqueo } = await (await admin())("GET", `/attack-detection/brute-force/users/${id}`);
      expect(bloqueo.disabled).toBe(true);
    } finally {
      await contexto.close();
      await quitar(id);
    }
  });
});
