// HU0016 y HU0020 · camino completo de la Carta de Vacante contra el entorno dev (API, n8n, Keycloak, Mailpit):
// cuota en conciliación → observación y subsanación → conciliación conforme en G05 → generacion-carta → correo → descarga desde P04.
// - Precondición (C16): el expediente con la vacante otorgada y el comprobante en conciliación se escribe en la base de dev. Ese
//   camino ya lo prueba e2e/vacante-cuota.spec.ts. Desde ahí todo es real: G05, P04, P07, G07, n8n y Mailpit.
// - La firma ficticia de la directora de prueba se carga con el mismo script de la instalación (idempotente).
// - Datos ficticios `hu0016-e2e-*@ejemplo.test`. Al terminar, la bitácora no se borra (solo inserción): el expediente pasa a
//   `caducado`, su vacante se devuelve (la identidad de C25 sigue valiendo) y se quita el usuario de Keycloak.
// - No se imprime el secreto del webhook. Capturas: docs/evidencias/HU0016/.
import { execFileSync } from "node:child_process";
import { createCipheriv, randomBytes } from "node:crypto";
import { mkdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test, type APIRequestContext, type BrowserContext, type Page } from "@playwright/test";
import { admin, contrasenaE2E, entrarEnGestion, FRONTEND, MAILPIT } from "./ayudantes";

const RAIZ = resolve(import.meta.dirname, "..");
const CAPTURAS = resolve(RAIZ, "docs/evidencias/HU0016");
const COMPOSE = ["compose", "-f", "docker-compose.yml", "-f", "docker-compose.dev.yml"];
const CAMPANA = process.env.CAMPANA_ACTIVA!;
const CONTRASENA = process.env.KEYCLOAK_TEST_USER_PASSWORD!;
const N8N = `http://127.0.0.1:${process.env.N8N_HOST_PORT || 5679}`;
const TESORERIA = "tesoreria.prueba@ejemplo.test";
const DIRECTORA = "directora.prueba@ejemplo.test";
const CINCO_MINUTOS = 5 * 60 * 1000;
const ASUNTO = `Carta de Vacante emitida · Admisión ${CAMPANA}`;
const MOTIVO = "El número de operación no coincide con el estado de cuenta";

const docker = (args: string[]) => execFileSync("docker", [...COMPOSE, ...args], { cwd: RAIZ, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
const consultarAdmision = (sql: string) => docker(["exec", "-T", "postgres", "psql", "-U", "api_admision", "-d", "admision", "-tA", "-F", "\t", "-c", sql]);

async function capturar(page: Page, nombre: string) {
  mkdirSync(CAPTURAS, { recursive: true });
  await page.screenshot({ path: resolve(CAPTURAS, `${nombre}.png`), fullPage: true });
}

// El mismo formato de api/src/crypto/columnas.ts (ADR-03): solo para escribir la precondición en la base de dev.
function cifrarColumna(texto: string): string {
  const iv = randomBytes(12);
  const cifrador = createCipheriv("aes-256-gcm", Buffer.from(process.env.DATA_ENCRYPTION_KEY!, "base64"), iv, { authTagLength: 16 });
  const cifrado = Buffer.concat([cifrador.update(texto, "utf8"), cifrador.final()]);
  return ["v1", iv.toString("base64"), cifrador.getAuthTag().toString("base64"), cifrado.toString("base64")].join(":");
}

async function esperarCorreo(request: APIRequestContext, correo: string, asunto: string, timeout: number) {
  let id = "";
  await expect
    .poll(
      async () => {
        const lista = await (await request.get(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:"${correo}"`)}`)).json();
        id = (lista.messages ?? []).find((m: { Subject: string }) => m.Subject === asunto)?.ID ?? "";
        return id;
      },
      { message: `no llegó «${asunto}»`, timeout, intervals: [2_000] },
    )
    .not.toBe("");
  return (await (await request.get(`${MAILPIT}/api/v1/message/${id}`)).json()) as { Text: string; Attachments: unknown[] };
}

test.describe.serial("HU0016 y HU0020 carta de vacante y panel de seguimiento", () => {
  let correo = "";
  let idKeycloak = "";
  let idExpediente = 0;
  let idGrado = 0;
  let idPago = 0;
  let codigo = "";
  let familia: { contexto: BrowserContext; page: Page };

  async function abrirEnG05(browser: import("@playwright/test").Browser) {
    const contexto = await browser.newContext();
    const tesoreria = await contexto.newPage();
    await entrarEnGestion(tesoreria, TESORERIA, CONTRASENA);
    await tesoreria.goto(`${FRONTEND}/gestion/tesoreria`);
    await tesoreria.getByTestId("pestana-cuota").click();
    await tesoreria.getByTestId(`item-cuota_ingreso-${idPago}`).getByRole("button").click();
    return { contexto, tesoreria, panel: tesoreria.getByTestId("panel-comprobante") };
  }

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(120_000);
    docker(["exec", "-T", "api", "npm", "run", "--silent", "firma:ficticia", "--workspace", "api"]);

    const [grado] = consultarAdmision(`SELECT id_grado FROM grado WHERE campana_admision = '${CAMPANA}' AND vacantes_disponibles > 0 AND monto_cuota_ingreso > 0 ORDER BY id_grado DESC LIMIT 1`).split("\n");
    expect(grado, "no hay un grado con vacantes: ejecuta npm run db:seed").toMatch(/^\d+$/);
    idGrado = Number(grado);

    correo = `hu0016-e2e-${Date.now()}-${randomBytes(2).toString("hex")}@ejemplo.test`;
    const contrasena = contrasenaE2E();
    const api = await admin();
    const { res } = await api("POST", "/users", { username: correo, email: correo, firstName: "María Fernanda", lastName: "Quispe Rojas", enabled: true, emailVerified: true });
    idKeycloak = res.headers.get("location")!.split("/").pop()!;
    await api("PUT", `/users/${idKeycloak}/reset-password`, { type: "password", value: contrasena, temporary: false });
    const { datos: rol } = await api("GET", "/roles/familia");
    await api("POST", `/users/${idKeycloak}/role-mappings/realm`, [{ id: rol.id, name: rol.name }]);

    const hash = randomBytes(32).toString("hex");
    idExpediente = Number(
      consultarAdmision(
        `WITH a AS (INSERT INTO apoderado (nombres, apellidos, telefono, correo)
                    VALUES ('María Fernanda', 'Quispe Rojas', '+51987654321', '${correo}') RETURNING id_apoderado),
              c AS (INSERT INTO cuenta_acceso (id_apoderado, keycloak_user_id) SELECT id_apoderado, '${idKeycloak}'::uuid FROM a),
              p AS (INSERT INTO postulante (dni_cifrado, dni_hash, nombres, apellido_paterno, apellido_materno, fecha_nacimiento, ficha_completa)
                    VALUES ('${cifrarColumna("00000001")}', '${hash}', 'Sofía', 'Quispe', 'Rojas', '2019-03-14', true) RETURNING id_postulante)
         INSERT INTO expediente (id_apoderado_titular, id_postulante, id_grado, estado, estado_documental, estado_financiero, modalidad_pago_cuota, numero_fracciones)
         SELECT a.id_apoderado, p.id_postulante, ${idGrado}, 'vacante_asignada', 'conforme', 'conforme', 'unico', 1 FROM a, p
         RETURNING id_expediente`,
      ).split("\n")[0],
    );
    codigo = `ADM-${CAMPANA}-${String(idExpediente).padStart(4, "0")}`;
    consultarAdmision(`UPDATE grado SET vacantes_disponibles = vacantes_disponibles - 1 WHERE id_grado = ${idGrado}`);
    consultarAdmision(
      `INSERT INTO registro_auditoria (id_expediente, id_personal, tipo_evento, estado_anterior, estado_nuevo, detalle)
       SELECT ${idExpediente}, d.id_personal, 'transicion_estado', 'apto', 'vacante_asignada', '{"campo":"estado"}'::jsonb FROM personal d WHERE d.correo = '${DIRECTORA}'`,
    );
    const operacion = (t: string) => `E2E${t}${Date.now()}${randomBytes(2).toString("hex")}`;
    consultarAdmision(
      `INSERT INTO pago (id_expediente, tipo_pago, numero_fraccion, numero_operacion, banco, monto, fecha_pago, comprobante_url, estado_validacion)
       VALUES (${idExpediente}, 'derecho_admision', 1, '${operacion("D")}', '[Banco 1]', 300, '2026-10-10', 'e2e-sin-archivo', 'conforme')`,
    );
    idPago = Number(
      consultarAdmision(
        `INSERT INTO pago (id_expediente, tipo_pago, numero_fraccion, numero_operacion, banco, monto, fecha_pago, comprobante_url, estado_validacion)
         SELECT ${idExpediente}, 'cuota_ingreso', 1, '${operacion("C")}', '[Banco 1]', g.monto_cuota_ingreso, '2026-10-20', 'e2e-sin-archivo', 'pendiente'
           FROM grado g WHERE g.id_grado = ${idGrado} RETURNING id_pago`,
      ).split("\n")[0],
    );

    // La familia entra por /portal y llega a P04 (D7-A).
    const contexto = await browser.newContext({ acceptDownloads: true });
    const page = await contexto.newPage();
    familia = { contexto, page };
    await page.goto(`${FRONTEND}/portal`);
    await page.locator("#username").fill(correo);
    await page.locator("#password").fill(contrasena);
    await page.locator("#kc-login").click();
    await expect(page).toHaveURL(`${FRONTEND}/portal/panel`);
    await expect(page.getByTestId("saludo")).toHaveText("Hola, María Fernanda");
  });

  test.afterAll(async () => {
    await familia?.contexto.close();
    if (idExpediente) {
      consultarAdmision(`UPDATE grado SET vacantes_disponibles = vacantes_disponibles + 1 WHERE id_grado = ${idGrado}`);
      consultarAdmision(`UPDATE expediente SET estado = 'caducado' WHERE id_expediente = ${idExpediente}`);
    }
    if (idKeycloak) await (await admin())("DELETE", `/users/${idKeycloak}`);
  });

  test("HU0020-1.0 la familia abre el panel: ve las seis etapas, el estado de cada validación y el historial con su fecha", async () => {
    const { page } = familia;

    await expect(page.locator(".etapa")).toHaveCount(6);
    await expect(page.getByTestId("etapa-ficha")).toContainText("Completado");
    await expect(page.getByTestId("etapa-resultado")).toContainText("Completado");
    await expect(page.getByTestId("etapa-carta")).toContainText("En revisión");
    await expect(page.getByTestId("validacion-derecho")).toContainText("Conforme");
    await expect(page.getByTestId("historial")).toContainText("Se otorgó la vacante");
    await expect(page.getByTestId("descargar-carta")).toHaveCount(0);
    await capturar(page, "HU0020-1.0-p04-panel");
  });

  test("HU0016-2.0 con la cuota sin conciliar, G07 deshabilita «Generar Carta de Vacante», muestra la alerta y no se crea el documento", async ({ browser }) => {
    const contexto = await browser.newContext();
    const directora = await contexto.newPage();
    await entrarEnGestion(directora, DIRECTORA, CONTRASENA);
    await directora.goto(`${FRONTEND}/gestion/vacantes`);

    const fila = directora.getByTestId(`otorgada-${idExpediente}`);
    await expect(fila).toContainText("Cuota en conciliación");
    await expect(fila.getByTestId("generar-carta")).toBeDisabled();
    await expect(fila.getByTestId("cuota-no-conciliada")).toHaveText("La cuota de ingreso no está conciliada");
    await capturar(directora, "HU0016-2.0-g07-boton-deshabilitado");
    await contexto.close();

    expect(consultarAdmision(`SELECT count(*) FROM carta_vacante WHERE id_expediente = ${idExpediente}`)).toBe("0");
    expect(consultarAdmision(`SELECT estado FROM expediente WHERE id_expediente = ${idExpediente}`)).toBe("vacante_asignada");
  });

  test("HU0020-2.0 Tesorería observa el comprobante: el panel muestra el motivo y lleva a la pantalla donde la familia lo subsana", async ({ browser }) => {
    test.setTimeout(120_000);
    const { contexto, tesoreria, panel } = await abrirEnG05(browser);
    await panel.getByRole("button", { name: "Rechazar comprobante" }).click();
    await tesoreria.getByTestId("panel-observacion").locator("textarea").fill(MOTIVO);
    await tesoreria.getByTestId("panel-observacion").getByRole("button", { name: /Rechazar|Observar|Enviar/ }).click();
    await expect.poll(() => consultarAdmision(`SELECT estado_validacion FROM pago WHERE id_pago = ${idPago}`)).toBe("observado");
    await contexto.close();

    const { page } = familia;
    await page.reload();
    await expect(page.getByTestId("etapa-carta")).toContainText("Observado");
    const accion = page.getByTestId("accion").first();
    await expect(accion).toContainText("Tesorería observó el comprobante de tu cuota de ingreso");
    await expect(accion.getByTestId("motivo")).toHaveText(`Motivo: ${MOTIVO}`);
    await capturar(page, "HU0020-2.0-p04-accion-pendiente");

    await accion.getByTestId("ir-accion").click();
    await expect(page).toHaveURL(`${FRONTEND}/portal/pagos`);
    await expect(page.getByTestId("observacion")).toContainText(MOTIVO);

    await page.getByTestId("regularizar-cuota").click();
    await page.locator("#p07-banco").selectOption("BCP");
    await page.locator("#p07-operacion").fill(`E2ER${Date.now()}${randomBytes(2).toString("hex")}`);
    await page.locator("#p07-fecha").fill("2026-10-21");
    await page.locator("#p07-comprobante").setInputFiles({ name: "voucher.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4\n% voucher ficticio\n") });
    await page.getByTestId("confirmar-pago").click();
    await expect(page.getByTestId("estado-cuota")).toHaveText("Cuota en conciliación");
  });

  test("HU0016-1.0 Tesorería concilia: generacion-carta emite la carta, llega el correo con el enlace en menos de cinco minutos y el expediente queda en carta_emitida", async ({ browser, request }) => {
    test.setTimeout(CINCO_MINUTOS + 60_000);
    const { contexto, panel } = await abrirEnG05(browser);
    const inicio = Date.now();
    await panel.getByTestId("comprobante-conforme").click();
    await expect(panel.getByTestId("aviso")).toHaveText("Pago conciliado. La cuota de ingreso quedó acreditada.");
    await contexto.close();

    const mensaje = await esperarCorreo(request, correo, ASUNTO, CINCO_MINUTOS);
    const demora = Date.now() - inicio;
    console.log(`HU0016-1.0: de la conciliación al correo, ${Math.round(demora / 1000)} s`);
    expect(demora).toBeLessThan(CINCO_MINUTOS);

    const texto = mensaje.Text.replace(/\r\n/g, "\n");
    expect(texto).toContain(`${FRONTEND}/portal/panel`);
    expect(texto).not.toContain("Sofía");
    expect(mensaje.Attachments ?? []).toEqual([]); // D1-A: el PDF no viaja por correo ni por n8n
    expect(consultarAdmision(`SELECT estado FROM expediente WHERE id_expediente = ${idExpediente}`)).toBe("carta_emitida");
    expect(consultarAdmision(`SELECT count(*) FROM carta_vacante WHERE id_expediente = ${idExpediente}`)).toBe("1");
    await expect.poll(() => consultarAdmision(`SELECT estado_envio FROM notificacion WHERE id_expediente = ${idExpediente} AND tipo_evento = 'carta_emitida'`)).toBe("enviado");
  });

  test("HU0016-1.0 (descarga) desde P04, la familia descarga su Carta de Vacante en PDF y el panel la muestra completa", async () => {
    const { page } = familia;
    await page.goto(`${FRONTEND}/portal/panel`);
    await expect(page.getByTestId("etapa-carta")).toContainText("Completado");
    await expect(page.getByTestId("historial")).toContainText("Se emitió la Carta de Vacante");
    await expect(page.getByTestId("historial")).toContainText("Tesorería concilió la cuota de ingreso");
    await capturar(page, "HU0016-1.0-p04-carta-emitida");

    const [descarga] = await Promise.all([page.waitForEvent("download"), page.getByTestId("descargar-carta").click()]);

    expect(descarga.suggestedFilename()).toBe(`carta-vacante-${codigo}.pdf`);
    const contenido = readFileSync((await descarga.path())!);
    expect(contenido.subarray(0, 5).toString("latin1")).toBe("%PDF-");
    mkdirSync(CAPTURAS, { recursive: true });
    await descarga.saveAs(resolve(CAPTURAS, "HU0016-1.0-carta-ficticia.pdf"));
  });

  test("HU0015-1.0 [parte: carta] P07 sigue mostrando la cuota acreditada con la carta emitida, y G07 ya no ofrece emitirla", async ({ browser }) => {
    const { page } = familia;
    await page.goto(`${FRONTEND}/portal/pagos`);
    await expect(page.getByTestId("estado-cuota")).toHaveText("Cuota acreditada");
    await expect(page.getByTestId("cuota-no-disponible")).toHaveCount(0);

    const contexto = await browser.newContext();
    const directora = await contexto.newPage();
    await entrarEnGestion(directora, DIRECTORA, CONTRASENA);
    await directora.goto(`${FRONTEND}/gestion/vacantes`);
    await expect(directora.getByTestId("vacantes-otorgadas")).toBeVisible();
    await expect(directora.getByTestId(`otorgada-${idExpediente}`)).toHaveCount(0);
    await contexto.close();
  });

  test("C11 el webhook generacion-carta rechaza una llamada sin el secreto o con uno incorrecto", async ({ request }) => {
    const sinSecreto = await request.post(`${N8N}/webhook/generacion-carta`, { data: { id_expediente: 1 }, failOnStatusCode: false });
    expect(sinSecreto.status()).toBe(403);
    const otro = await request.post(`${N8N}/webhook/generacion-carta`, { headers: { "X-Webhook-Secret": "no-es-el-secreto" }, data: { id_expediente: 1 }, failOnStatusCode: false });
    expect(otro.status()).toBe(403);
  });
});
