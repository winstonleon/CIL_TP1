// HU0006 y HU0007 · carga de documentos (P06) y registro del derecho de admisión (P07b) contra el entorno dev: la familia
// inicia sesión, completa su ficha, sube sus documentos (con el aviso ante un formato no admitido), los confirma, registra
// el comprobante (con el aviso de duplicado) y ve la constancia.
// - Datos (C16): el expediente se prepara escribiendo directo en la base de dev, como en HU0005 (aprobado por John,
//   02/11/2026). Cada corrida deja en dev un apoderado `hu0006-e2e-*@ejemplo.test` con su cuenta, expediente, postulante,
//   cuestionario, documentos y pago, más otra familia `hu0007-otra-*@ejemplo.test` con un pago, que solo existe para provocar
//   el duplicado. Crea 2 requisitos «E2E hu0006 - …» en el grado «3.° de primaria» y un usuario de Keycloak (rol familia);
//   al terminar quita los requisitos, los documentos de la corrida (y sus archivos) y el usuario.
// - Los archivos son ficticios y pequeños, creados en memoria. Los DNI son ficticios y las capturas los ocultan.
//   Capturas: test-results/HU0006-HU0007/capturas-e2e/ (ignorada por git).
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { admin, contrasenaE2E, FRONTEND } from "./ayudantes";

const RAIZ = resolve(import.meta.dirname, "..");
const CAPTURAS = resolve(RAIZ, "test-results/HU0006-HU0007/capturas-e2e");
const COMPOSE = ["compose", "-f", "docker-compose.yml", "-f", "docker-compose.dev.yml"];
const CAMPANA = process.env.CAMPANA_ACTIVA!;
const PREFIJO = "E2E hu0006 - ";
const GRADO_SQL = `g.nombre_grado LIKE '3.%de primaria' AND g.campana_admision = '${CAMPANA}'`;
const AVISO_ARCHIVO = "Solo se aceptan archivos PDF, JPG o PNG de hasta 10 MB.";
const DIRECTORIO_ARCHIVOS = "/var/lib/cil/archivos";

function consultarAdmision(sql: string): string {
  return execFileSync("docker", [...COMPOSE, "exec", "-T", "postgres", "psql", "-U", "api_admision", "-d", "admision", "-tA", "-F", "\t", "-c", sql], {
    cwd: RAIZ,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

const enApi = (...orden: string[]) => execFileSync("docker", [...COMPOSE, "exec", "-T", "api", ...orden], { cwd: RAIZ, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

const pdf = (marca: string) => Buffer.from(`%PDF-1.4\n% ${marca}\n${" ".repeat(200)}`);
const jpg = () => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]), Buffer.from("JFIF\0"), Buffer.alloc(200, 0x20)]);
const png = () => Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(200, 0x20)]);
const zip = () => Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00]), Buffer.from("[Content_Types].xml")]);
const dniE2E = () => String(10_000_000 + Math.floor(Math.random() * 80_000_000));

let correo: string;
let contrasena: string;
let idKeycloak: string;
let idExpediente: number;
let numeroOperacion: string;
let contexto: BrowserContext;
let page: Page;

async function capturar(nombre: string, ocultar: string[] = []) {
  mkdirSync(CAPTURAS, { recursive: true });
  await page.screenshot({ path: resolve(CAPTURAS, `${nombre}.png`), fullPage: true, mask: ocultar.map((s) => page.locator(s)) });
}

const fila = (tipo: string) => page.locator("li.requisito", { hasText: `${PREFIJO}${tipo}` });
// El input de «Subir archivo» / «Agregar otro archivo» (no el de «Reemplazar», que también es un input de archivo).
const agregar = (tipo: string) => fila(tipo).locator('input[data-testid^="archivo-"]');
const continuar = () => page.getByRole("button", { name: "Guardar y continuar" });
const claves = () => consultarAdmision(`SELECT url_archivo FROM documento WHERE id_expediente = ${idExpediente} ORDER BY id_documento`).split("\n").filter(Boolean);

// HU0005: login y ficha completa por la interfaz, para llegar a P06 como lo hace la familia.
async function iniciarYCompletarFicha(browser: Browser) {
  contexto = await browser.newContext();
  page = await contexto.newPage();
  await page.goto(`${FRONTEND}/portal/ficha`);
  await page.locator("#username").fill(correo);
  await page.locator("#password").fill(contrasena);
  await page.locator("#kc-login").click();
  await expect(page.getByRole("heading", { name: "Ficha de inscripción y cuestionario" })).toBeVisible();

  await page.locator("#p05n").fill("Sofia Valentina");
  await page.locator("#p05ap").fill("Quispe");
  await page.locator("#p05am").fill("Rojas");
  await page.locator("#p05d").fill(dniE2E());
  await page.locator("#p05f").fill("2018-03-14");
  await page.locator('input[name="p05proc"]').first().check(); // estudió en otro colegio del Perú
  await page.locator('input[name="p05cond"]').nth(1).check(); // sin condición especial
  await continuar().click();
  await page.locator("#p05bt-par").selectOption("madre");
  await page.locator("#p05bt-dni").fill(dniE2E());
  await page.locator('input[name="p05btcl"]').first().check(); // dependiente
  await continuar().click();
  await page.locator("#p05c").fill("Colegio Ficticio de Lima");
  await continuar().click();
  for (const id of ["p1", "p2", "p3"]) await page.locator(`#p05q-${id}`).fill(`Respuesta ficticia ${id}`);
  await continuar().click();
  await expect(page.getByTestId("paso-documentos")).toBeVisible({ timeout: 15_000 });
}

test.describe.serial("HU0006 y HU0007 P06 y P07b en el entorno dev", () => {
  test.beforeAll(async ({ browser }) => {
    test.setTimeout(180_000);
    correo = `hu0006-e2e-${Date.now()}-${randomBytes(2).toString("hex")}@ejemplo.test`;
    contrasena = contrasenaE2E();
    numeroOperacion = `E2E${Date.now()}`;

    // Usuario de la familia en Keycloak, con el rol familia y una contraseña definitiva (el primer ingreso es de D3).
    const api = await admin();
    const { res } = await api("POST", "/users", { username: correo, email: correo, firstName: "María Fernanda", lastName: "Quispe Rojas", enabled: true, emailVerified: true });
    idKeycloak = res.headers.get("location")!.split("/").pop()!;
    await api("PUT", `/users/${idKeycloak}/reset-password`, { type: "password", value: contrasena, temporary: false });
    const { datos: rol } = await api("GET", "/roles/familia");
    await api("POST", `/users/${idKeycloak}/role-mappings/realm`, [{ id: rol.id, name: rol.name }]);

    // Los requisitos del grado (un resto de una corrida fallida se limpia antes) y el expediente en portal_habilitado.
    await limpiar();
    consultarAdmision(
      `INSERT INTO requisito_documental (id_grado, tipo_documento, categoria, condicion_aplicacion, por_apoderado)
       SELECT g.id_grado, v.tipo, v.categoria::categoria_requisito, v.condicion::condicion_aplicacion, v.por_apoderado
         FROM grado g,
              (VALUES ('${PREFIJO}Partida de nacimiento', 'postulante_y_padres', 'todos', false),
                      ('${PREFIJO}Boletas de pago', 'financiero', 'si_dependiente', true)) AS v(tipo, categoria, condicion, por_apoderado)
        WHERE ${GRADO_SQL}`,
    );
    const id = consultarAdmision(
      `WITH a AS (INSERT INTO apoderado (nombres, apellidos, telefono, correo)
                  VALUES ('María Fernanda', 'Quispe Rojas', '+51987654321', '${correo}') RETURNING id_apoderado),
            c AS (INSERT INTO cuenta_acceso (id_apoderado, keycloak_user_id) SELECT id_apoderado, '${idKeycloak}'::uuid FROM a)
       INSERT INTO expediente (id_apoderado_titular, id_grado, estado)
       SELECT a.id_apoderado, g.id_grado, 'portal_habilitado' FROM a, grado g WHERE ${GRADO_SQL}
       RETURNING id_expediente`,
    ).split("\n")[0]!;
    expect(id, "no se creó el expediente de la prueba: ¿existe el grado «3.° de primaria» de la campaña activa (npm run db:seed)?").toMatch(/^\d+$/);
    idExpediente = Number(id);

    // Otra familia que ya registró este comprobante, solo para provocar el duplicado de HU0007-2.0.
    consultarAdmision(
      `WITH a AS (INSERT INTO apoderado (nombres, apellidos, telefono, correo)
                  VALUES ('Otra', 'Familia', '+51987654322', 'hu0007-otra-${Date.now()}@ejemplo.test') RETURNING id_apoderado),
            e AS (INSERT INTO expediente (id_apoderado_titular, id_grado) SELECT a.id_apoderado, g.id_grado FROM a, grado g WHERE ${GRADO_SQL} RETURNING id_expediente)
       INSERT INTO pago (id_expediente, tipo_pago, numero_fraccion, numero_operacion, banco, monto, fecha_pago, comprobante_url)
       SELECT id_expediente, 'derecho_admision', 1, '${numeroOperacion}', '[Banco 1]', 300, '2026-10-09', 'sin-archivo-e2e' FROM e`,
    );

    await iniciarYCompletarFicha(browser);
  });

  test.afterAll(async () => {
    await contexto?.close();
    await limpiar();
    if (idKeycloak) await (await admin())("DELETE", `/users/${idKeycloak}`);
  });

  // Quita los requisitos de la corrida, los documentos que los usan y sus archivos del volumen.
  async function limpiar() {
    const usados = consultarAdmision(
      `SELECT d.url_archivo FROM documento d JOIN requisito_documental r ON r.id_requisito = d.id_requisito WHERE r.tipo_documento LIKE '${PREFIJO}%'`,
    ).split("\n").filter(Boolean);
    for (const clave of usados) enApi("rm", "-f", `${DIRECTORIO_ARCHIVOS}/${clave}`);
    consultarAdmision(`DELETE FROM documento WHERE id_requisito IN (SELECT id_requisito FROM requisito_documental WHERE tipo_documento LIKE '${PREFIJO}%')`);
    consultarAdmision(`DELETE FROM requisito_documental WHERE tipo_documento LIKE '${PREFIJO}%'`);
  }

  test("HU0006-1.0 la familia sube sus documentos asociados a cada requisito (uno por apoderado, varios archivos) y confirma", async () => {
    test.setTimeout(120_000);
    await page.getByTestId("ir-a-documentos").click();
    await expect(page).toHaveURL(`${FRONTEND}/portal/documentos`);
    await expect(page.getByRole("heading", { name: "Documentos del expediente" })).toBeVisible();
    await expect(fila("Partida de nacimiento")).toBeVisible();
    await expect(fila("Boletas de pago")).toContainText("María Fernanda Quispe Rojas"); // la madre es dependiente
    await expect(page.getByTestId("seccion-financiero")).toContainText("Solo la revisa Tesorería");
    await capturar("p06-lista-de-documentos", ["#username"]);

    await agregar("Partida de nacimiento").setInputFiles({ name: "partida.pdf", mimeType: "application/pdf", buffer: pdf("partida ficticia") });
    await expect(fila("Partida de nacimiento")).toContainText("Archivo 1 · PDF");
    // Dos boletas en el mismo requisito: un JPG y un PNG.
    await agregar("Boletas de pago").setInputFiles({ name: "boleta-junio.jpg", mimeType: "image/jpeg", buffer: jpg() });
    await expect(fila("Boletas de pago")).toContainText("Archivo 1 · JPG");
    await agregar("Boletas de pago").setInputFiles({ name: "boleta-julio.png", mimeType: "image/png", buffer: png() });
    await expect(fila("Boletas de pago")).toContainText("Archivo 2 · PNG");

    await page.getByRole("button", { name: "Confirmar documentos" }).click();
    await expect(page.getByTestId("confirmado")).toContainText("Confirmaste tus documentos el");
    await capturar("p06-documentos-confirmados");

    // Tres archivos vigentes asociados a su requisito; el de las boletas, a la madre. Guardados con clave aleatoria y cifrados.
    expect(consultarAdmision(`SELECT concat_ws('|', r.tipo_documento, d.formato, d.vigente, d.id_apoderado IS NOT NULL) FROM documento d JOIN requisito_documental r USING (id_requisito) WHERE d.id_expediente = ${idExpediente} ORDER BY d.id_documento`))
      .toBe([`${PREFIJO}Partida de nacimiento|pdf|t|f`, `${PREFIJO}Boletas de pago|jpg|t|t`, `${PREFIJO}Boletas de pago|png|t|t`].join("\n"));
    const guardadas = claves();
    expect(guardadas).toHaveLength(3);
    for (const clave of guardadas) {
      expect(clave).toMatch(/^[0-9a-f-]{36}$/);
      expect(enApi("head", "-c", "4", `${DIRECTORIO_ARCHIVOS}/${clave}`)).toBe("CILF");
    }
    // La confirmación deja el evento para HU0017 y el expediente sigue en postulación.
    expect(consultarAdmision(`SELECT count(*) FROM registro_auditoria WHERE id_expediente = ${idExpediente} AND tipo_evento = 'documentos_confirmados'`)).toBe("1");
    expect(consultarAdmision(`SELECT estado FROM expediente WHERE id_expediente = ${idExpediente}`)).toBe("en_postulacion");
  });

  test("HU0006-2.0 un archivo de formato no admitido se rechaza con el aviso en el campo y no se guarda", async () => {
    const antes = claves().length;
    const partida = fila("Partida de nacimiento");

    await agregar("Partida de nacimiento").setInputFiles({ name: "comprimido.zip", mimeType: "application/zip", buffer: zip() });
    await expect(partida.getByRole("alert")).toHaveText(AVISO_ARCHIVO);
    await expect(partida).toHaveClass(/invalido/);
    await capturar("p06-formato-no-admitido");

    // Lo mismo con un ZIP que se hace pasar por PDF: se reconoce por su contenido.
    await agregar("Partida de nacimiento").setInputFiles({ name: "partida-falsa.pdf", mimeType: "application/pdf", buffer: zip() });
    await expect(partida.getByRole("alert")).toHaveText(AVISO_ARCHIVO);
    expect(claves()).toHaveLength(antes);
    expect(consultarAdmision(`SELECT count(*) FROM documento WHERE id_expediente = ${idExpediente} AND vigente`)).toBe("3");
  });

  test("HU0007-2.0 un comprobante ya registrado para el mismo banco se bloquea con la alerta y el campo marcado", async () => {
    await page.getByTestId("menu-pagos").click();
    await page.getByTestId("ir-derecho").click();
    await expect(page).toHaveURL(`${FRONTEND}/portal/pagos/derecho-admision`);
    await expect(page.getByRole("heading", { name: "Registrar el derecho de admisión" })).toBeVisible();
    await expect(page.locator("main")).toContainText("S/ 300 (no reembolsable)");

    await page.locator("#p07b-banco").selectOption("[Banco 1]");
    await page.locator("#p07b-operacion").fill(numeroOperacion);
    await page.locator("#p07b-fecha").fill("2026-10-10");
    await page.locator("#p07b-comprobante").setInputFiles({ name: "voucher.pdf", mimeType: "application/pdf", buffer: pdf("voucher ficticio") });
    await page.getByRole("button", { name: "Enviar comprobante" }).click();

    await expect(page.getByTestId("alerta-duplicado")).toContainText("Este comprobante ya fue registrado.");
    await expect(page.locator("#p07b-operacion-error")).toHaveText("Este N.° de operación ya está registrado.");
    await capturar("p07b-comprobante-duplicado");
    expect(consultarAdmision(`SELECT count(*) FROM pago WHERE id_expediente = ${idExpediente}`)).toBe("0");
  });

  test("HU0007-1.0 la familia corrige el número, registra el comprobante y ve la constancia con el pago pendiente de Tesorería", async () => {
    // El mismo número en otro banco es otro comprobante (R19 por banco): se cambia el banco, no el número.
    await page.locator("#p07b-banco").selectOption("[Banco 2]");
    await page.getByRole("button", { name: "Enviar comprobante" }).click();

    const constancia = page.getByTestId("constancia");
    await expect(constancia).toBeVisible();
    await expect(constancia).toContainText("Constancia de registro del comprobante");
    await expect(constancia).toContainText("Recibimos tu comprobante");
    await expect(constancia).toContainText("S/ 300");
    await expect(constancia).toContainText(numeroOperacion);
    await expect(constancia).toContainText("10/10/2026");
    await expect(constancia).toContainText("Pendiente de validación");
    await expect(page.getByTestId("codigo-constancia")).toHaveText(new RegExp(`^CONST-ADM-${CAMPANA}-\\d{4}-\\d+$`));
    await capturar("p07b-constancia");

    expect(consultarAdmision(`SELECT concat_ws('|', tipo_pago, numero_fraccion, monto, banco, estado_validacion, id_personal_validador IS NULL) FROM pago WHERE id_expediente = ${idExpediente}`))
      .toBe("derecho_admision|1|300.00|[Banco 2]|pendiente|t");
    const clave = consultarAdmision(`SELECT comprobante_url FROM pago WHERE id_expediente = ${idExpediente}`);
    expect(enApi("head", "-c", "4", `${DIRECTORIO_ARCHIVOS}/${clave}`)).toBe("CILF");
    expect(consultarAdmision(`SELECT concat_ws('|', estado, estado_financiero, estado_documental) FROM expediente WHERE id_expediente = ${idExpediente}`)).toBe("en_postulacion|pendiente|pendiente");
  });
});
