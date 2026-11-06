// HU0012 a HU0015 · camino principal de la vacante y la cuota de ingreso contra el entorno dev (API, n8n, Keycloak, Mailpit):
// apto → vacante (G07) → modalidad y comprobante (P07) → conciliación conforme (G05).
// - Precondición «dictamen Apto» (C16): el expediente en apto con su dictamen se escribe en la base de dev, con las
//   conclusiones cifradas como en la API (ADR-03). Ese camino ya lo prueban e2e/dictamen.spec.ts y, hasta G07,
//   `HU0010-1.0 [parte: derivación]`. Desde ahí todo es real: G09, G07, P07, G05, n8n y los correos en Mailpit.
// - Usa 4.° de primaria: su máximo de fracciones se sube por la ruta real de G09 (el semilla vale 1).
// - Datos ficticios `hu0012-e2e-*@ejemplo.test`, y el personal de prueba de infra/keycloak/usuarios-prueba.json. Al terminar,
//   la bitácora no se borra (solo inserción): el expediente pasa a `caducado`, su vacante se devuelve (la identidad de C25 sigue
//   valiendo), se restaura el grado y se quita el usuario de Keycloak.
// - Capturas: docs/evidencias/HU0012/.
import { execFileSync } from "node:child_process";
import { createCipheriv, randomBytes } from "node:crypto";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test, type APIRequestContext, type BrowserContext, type Page } from "@playwright/test";
import { admin, contrasenaE2E, entrarEnGestion, FRONTEND, iniciarSesion, llamarApi, MAILPIT } from "./ayudantes";

const RAIZ = resolve(import.meta.dirname, "..");
const CAPTURAS = resolve(RAIZ, "docs/evidencias/HU0012");
const COMPOSE = ["compose", "-f", "docker-compose.yml", "-f", "docker-compose.dev.yml"];
const CAMPANA = process.env.CAMPANA_ACTIVA!;
const CONTRASENA = process.env.KEYCLOAK_TEST_USER_PASSWORD!;
const NOMBRE_GRADO = "4.° de primaria";
const GRADO_SQL = `g.nombre_grado = '${NOMBRE_GRADO}' AND g.campana_admision = '${CAMPANA}'`;
const SECRETARIA = "secretaria.prueba@ejemplo.test";
const TESORERIA = "tesoreria.prueba@ejemplo.test";
const DIRECTORA = "directora.prueba@ejemplo.test";
const PSICOLOGA = "psicologa.prueba@ejemplo.test";
const CONCLUSIONES = "Conclusiones ficticias del dictamen para Dirección";

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

async function esperarCorreo(request: APIRequestContext, correo: string, asunto: string, timeout = 120_000): Promise<string> {
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
  return String((await (await request.get(`${MAILPIT}/api/v1/message/${id}`)).json()).Text ?? "").replace(/\r\n/g, "\n");
}

test.describe.serial("HU0012 a HU0015 vacante y cuota de ingreso", () => {
  let correo = "";
  let idKeycloak = "";
  let idExpediente = 0;
  let codigo = "";
  let tokenSecretaria = "";
  let idGrado = 0;
  let maxOriginal = "1";
  let familia: { contexto: BrowserContext; page: Page };
  let operacion = "";

  test.beforeAll(async ({ browser }) => {
    tokenSecretaria = (await iniciarSesion(browser, SECRETARIA, CONTRASENA))!;
    const [id, max] = consultarAdmision(`SELECT g.id_grado, g.max_fracciones FROM grado g WHERE ${GRADO_SQL}`).split("\t");
    expect(id, `falta el grado «${NOMBRE_GRADO}»: ejecuta npm run db:seed`).toMatch(/^\d+$/);
    idGrado = Number(id);
    maxOriginal = max!;

    correo = `hu0012-e2e-${Date.now()}-${randomBytes(2).toString("hex")}@ejemplo.test`;
    const contrasena = contrasenaE2E();
    const api = await admin();
    const { res } = await api("POST", "/users", { username: correo, email: correo, firstName: "María Fernanda", lastName: "Quispe Rojas", enabled: true, emailVerified: true });
    idKeycloak = res.headers.get("location")!.split("/").pop()!;
    await api("PUT", `/users/${idKeycloak}/reset-password`, { type: "password", value: contrasena, temporary: false });
    const { datos: rol } = await api("GET", "/roles/familia");
    await api("POST", `/users/${idKeycloak}/role-mappings/realm`, [{ id: rol.id, name: rol.name }]);

    idExpediente = Number(
      consultarAdmision(
        `WITH a AS (INSERT INTO apoderado (nombres, apellidos, telefono, correo)
                    VALUES ('María Fernanda', 'Quispe Rojas', '+51987654321', '${correo}') RETURNING id_apoderado),
              c AS (INSERT INTO cuenta_acceso (id_apoderado, keycloak_user_id) SELECT id_apoderado, '${idKeycloak}'::uuid FROM a)
         INSERT INTO expediente (id_apoderado_titular, id_grado, estado, estado_documental, estado_financiero)
         SELECT a.id_apoderado, g.id_grado, 'apto', 'conforme', 'conforme' FROM a, grado g WHERE ${GRADO_SQL}
         RETURNING id_expediente`,
      ).split("\n")[0],
    );
    codigo = `ADM-${CAMPANA}-${String(idExpediente).padStart(4, "0")}`;
    consultarAdmision(
      `INSERT INTO pago (id_expediente, tipo_pago, numero_fraccion, numero_operacion, banco, monto, fecha_pago, comprobante_url, estado_validacion)
       VALUES (${idExpediente}, 'derecho_admision', 1, 'E2E${Date.now()}${randomBytes(2).toString("hex")}', '[Banco 1]', 300, '2026-10-10', 'e2e-sin-archivo', 'conforme')`,
    );
    consultarAdmision(
      `INSERT INTO dictamen_admision (id_expediente, id_personal, dictamen, conclusiones)
       SELECT ${idExpediente}, p.id_personal, 'apto', '${cifrarColumna(CONCLUSIONES)}' FROM personal p WHERE p.correo = '${PSICOLOGA}'`,
    );

    const contexto = await browser.newContext();
    const page = await contexto.newPage();
    familia = { contexto, page };
    await page.goto(`${FRONTEND}/portal/pagos`);
    await page.locator("#username").fill(correo);
    await page.locator("#password").fill(contrasena);
    await page.locator("#kc-login").click();
    await expect(page.getByRole("heading", { name: "Pagos" })).toBeVisible();
    await expect(page.getByTestId("cuota-no-disponible")).toBeVisible();
  });

  test.afterAll(async () => {
    await familia?.contexto.close();
    if (idExpediente) {
      const estado = consultarAdmision(`SELECT estado FROM expediente WHERE id_expediente = ${idExpediente}`);
      if (estado === "vacante_asignada") consultarAdmision(`UPDATE grado SET vacantes_disponibles = vacantes_disponibles + 1 WHERE id_grado = ${idGrado}`);
      consultarAdmision(`UPDATE expediente SET estado = 'caducado' WHERE id_expediente = ${idExpediente}`);
    }
    if (idGrado) consultarAdmision(`UPDATE grado SET max_fracciones = ${maxOriginal} WHERE id_grado = ${idGrado}`);
    if (idKeycloak) await (await admin())("DELETE", `/users/${idKeycloak}`);
  });

  test("HU0022-1.0 [parte: adjudicación] la secretaría sube el máximo de fracciones en G09 y la familia con vacante lo recibe en el aviso y en P07", async ({ browser, request }) => {
    test.setTimeout(180_000);
    const guardado = await llamarApi(request, "patch", "/configuracion/grados", tokenSecretaria, { grados: [{ id_grado: idGrado, max_fracciones: 3 }] });
    expect(guardado.status(), await guardado.text()).toBe(200);

    const contexto = await browser.newContext();
    const directora = await contexto.newPage();
    await entrarEnGestion(directora, DIRECTORA, CONTRASENA);
    await directora.getByRole("link", { name: "Adjudicación de vacantes" }).click();
    await expect(directora).toHaveURL(`${FRONTEND}/gestion/vacantes`);
    const fila = directora.getByTestId(`apto-${idExpediente}`);
    await expect(fila).toContainText(codigo);
    await expect(fila.getByTestId("adjudicar")).toHaveText("Aprobar y asignar vacante");
    await fila.getByRole("button", { name: "Ver dictamen" }).click();
    await expect(directora.getByTestId("conclusiones")).toHaveText(CONCLUSIONES);
    await directora.getByTestId("nivel-primaria").click();
    await capturar(directora, "HU0012-1.0-g07-aptos-e-inventario");

    await fila.getByTestId("adjudicar").click();
    await expect(directora.getByTestId("resultado")).toContainText(`Vacante asignada a`);
    await expect(fila).toHaveCount(0);
    await capturar(directora, "HU0012-1.0-g07-vacante-asignada");
    await contexto.close();

    expect(consultarAdmision(`SELECT estado FROM expediente WHERE id_expediente = ${idExpediente}`)).toBe("vacante_asignada");
    const texto = await esperarCorreo(request, correo, `Vacante otorgada · Admisión ${CAMPANA}`);
    expect(texto).toContain("Cuota de ingreso de Primaria: S/ 7,000.00");
    expect(texto).toContain("Pago fraccionado, hasta 3 fracciones");
    expect(texto).not.toContain(CONCLUSIONES);
  });

  test("HU0012-1.0 la vacante descontada coincide con los expedientes del grado en vacante_asignada o carta_emitida (C25)", async () => {
    const [autorizadas, disponibles] = consultarAdmision(`SELECT vacantes_autorizadas, vacantes_disponibles FROM grado WHERE id_grado = ${idGrado}`).split("\t");
    const adjudicados = consultarAdmision(`SELECT count(*) FROM expediente WHERE id_grado = ${idGrado} AND estado IN ('vacante_asignada', 'carta_emitida')`);
    expect(Number(autorizadas) - Number(disponibles)).toBe(Number(adjudicados));
  });

  test("HU0022-2.0 [parte: adjudicación real] con la vacante adjudicada, G09 rechaza fijar menos autorizadas e informa el mínimo", async ({ browser, request }) => {
    const adjudicadas = Number(consultarAdmision(`SELECT vacantes_autorizadas - vacantes_disponibles FROM grado WHERE id_grado = ${idGrado}`));
    const res = await llamarApi(request, "patch", "/configuracion/grados", tokenSecretaria, { grados: [{ id_grado: idGrado, vacantes_autorizadas: adjudicadas - 1 }] });
    expect(res.status()).toBe(422);
    expect((await res.json()).error).toMatchObject({ codigo: "VACANTES_MENORES_QUE_ADJUDICADAS", detalle: [{ id_grado: idGrado, minimo: adjudicadas }] });

    const contexto = await browser.newContext();
    const secretaria = await contexto.newPage();
    await entrarEnGestion(secretaria, SECRETARIA, CONTRASENA);
    await secretaria.goto(`${FRONTEND}/gestion/configuracion`);
    const grados = secretaria.locator("#g09-panel-grados");
    await grados.getByLabel(`Vacantes autorizadas de ${NOMBRE_GRADO}`).fill(String(adjudicadas - 1));
    await grados.getByRole("button", { name: "Guardar" }).click();
    await expect(grados).toContainText(`Ya hay ${adjudicadas} adjudicadas`);
    await capturar(secretaria, "HU0022-2.0-g09-rechazo-con-adjudicacion-real");
    await contexto.close();
  });

  test("HU0013-1.0 la familia revisa el monto de su nivel, elige pago fraccionado y confirma: ve el monto de cada pago y se habilita la carga", async () => {
    const { page } = familia;
    await page.reload();
    await expect(page.getByTestId("estado-cuota")).toHaveText("Vacante otorgada");
    await expect(page.getByTestId("monto-cuota")).toHaveText("S/ 7,000");
    await expect(page.getByTestId("form-modalidad")).toContainText("Hasta 3 fracciones");

    await page.getByTestId("modalidad-fraccionado").check();
    await page.locator("#p07-fracciones").fill("4");
    await page.getByTestId("confirmar-modalidad").click();
    await expect(page.getByTestId("error-modalidad")).toHaveText("El número máximo de fracciones permitido es 3");
    await expect(page.getByTestId("form-comprobante")).toHaveCount(0);

    await page.locator("#p07-fracciones").fill("3");
    await page.getByTestId("confirmar-modalidad").click();
    await expect(page.getByTestId("modalidad-elegida")).toContainText("Fracción 3 de 3");
    await expect(page.getByTestId("modalidad-elegida")).toContainText("S/ 2,333.34");
    await expect(page.locator("#p07-monto")).toHaveValue("2333.33");
    await capturar(page, "HU0013-1.0-p07-modalidad");
  });

  test("HU0014-1.0 la familia registra el comprobante de la primera fracción: queda «en conciliación» y se avisa a Tesorería", async ({ request }) => {
    const { page } = familia;
    operacion = `E2E${Date.now()}${randomBytes(2).toString("hex")}`;
    await page.locator("#p07-banco").selectOption("[Banco 1]");
    await page.locator("#p07-operacion").fill(operacion);
    await page.locator("#p07-fecha").fill("2026-10-20");
    await page.locator("#p07-comprobante").setInputFiles({ name: "voucher.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4\n% voucher ficticio\n") });
    await page.getByTestId("confirmar-pago").click();

    await expect(page.getByTestId("estado-cuota")).toHaveText("Cuota en conciliación");
    await expect(page.getByTestId("comprobante-cuota")).toContainText(operacion);
    await expect(page.getByTestId("cambiar-modalidad")).toHaveCount(0);
    await capturar(page, "HU0014-1.0-p07-en-conciliacion");

    const texto = await esperarCorreo(request, process.env.CORREO_TESORERIA!, `Cuota de ingreso por conciliar: ${codigo}`);
    expect(texto).toContain("/gestion/tesoreria");
    expect(texto).not.toContain("Quispe");
  });

  test("HU0015-1.0 [parte: conciliación] Tesorería contrasta el abono en la pestaña «Cuota de ingreso» de G05 y concilia: la familia ve «Cuota acreditada»", async ({ browser }) => {
    const contexto = await browser.newContext();
    const tesoreria = await contexto.newPage();
    await entrarEnGestion(tesoreria, TESORERIA, CONTRASENA);
    await tesoreria.goto(`${FRONTEND}/gestion/tesoreria`);
    await tesoreria.getByTestId("pestana-cuota").click();
    const idPago = consultarAdmision(`SELECT id_pago FROM pago WHERE id_expediente = ${idExpediente} AND tipo_pago = 'cuota_ingreso'`);
    const fila = tesoreria.getByTestId(`item-cuota_ingreso-${idPago}`);
    await expect(fila).toContainText("Cuota de ingreso · 1.ª fracción");
    await expect(fila).toContainText("Por conciliar");
    await fila.getByRole("button").click();

    const panel = tesoreria.getByTestId("panel-comprobante");
    await expect(panel.getByTestId("numero-operacion")).toHaveText(operacion);
    await expect(panel.getByTestId("monto-corresponde")).toHaveText("S/ 2333.33");
    await capturar(tesoreria, "HU0015-1.0-g05-conciliacion");
    await panel.getByTestId("comprobante-conforme").click();
    await expect(panel.getByTestId("aviso")).toHaveText("Pago conciliado. La cuota de ingreso quedó acreditada.");
    await contexto.close();

    expect(consultarAdmision(`SELECT estado_validacion FROM pago WHERE id_pago = ${idPago}`)).toBe("conforme");
    // HU0016 toma la carta desde los datos (C62): el expediente no cambia de estado en este bloque.
    expect(consultarAdmision(`SELECT estado FROM expediente WHERE id_expediente = ${idExpediente}`)).toBe("vacante_asignada");
    const { page } = familia;
    await page.reload();
    await expect(page.getByTestId("estado-cuota")).toHaveText("Cuota acreditada");
    await capturar(page, "HU0015-1.0-p07-cuota-acreditada");
  });
});
