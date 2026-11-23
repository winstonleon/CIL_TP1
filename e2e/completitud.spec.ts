// HU0017 · verificación automática de completitud contra el entorno dev (API, n8n, Keycloak, Mailpit): la familia confirma
// con documentos faltantes → el expediente sigue en postulación y recibe el correo con lo que falta (P06 también lo
// muestra) → completa lo que faltaba (documento y derecho de admisión) y vuelve a confirmar → pasa a En validación con
// las ramas en pendiente. Más el registro de un fallo del subflujo (recepcion-registro, ADR-22).
// - Datos (C16): el expediente se prepara escribiendo directo en la base de dev, como en HU0006. Cada corrida deja un
//   apoderado `hu0017-e2e-*@ejemplo.test` con su cuenta, expediente, postulante, cuestionario, documentos, pago y avisos;
//   crea 2 requisitos «E2E hu0017 - …» en el grado «3.° de primaria» y un usuario de Keycloak (rol familia). Al terminar
//   quita los requisitos, los documentos de la corrida (y sus archivos) y el usuario.
// - Los archivos son ficticios y pequeños. Los DNI son ficticios y las capturas los ocultan.
//   Capturas: test-results/HU0017/capturas-e2e/ (ignorada por git).
// - El webhook de recepcion-registro se llama con el secreto (C11, C15): si no hay respuesta se lanza un error sin él.
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test, type APIRequestContext, type BrowserContext, type Page } from "@playwright/test";
import { admin, contrasenaE2E, FRONTEND, MAILPIT } from "./ayudantes";

const RAIZ = resolve(import.meta.dirname, "..");
const CAPTURAS = resolve(RAIZ, "test-results/HU0017/capturas-e2e");
const COMPOSE = ["compose", "-f", "docker-compose.yml", "-f", "docker-compose.dev.yml"];
const N8N = `http://127.0.0.1:${process.env.N8N_HOST_PORT || 5679}`;
const WEBHOOK_RECEPCION = `${N8N}/webhook/recepcion-registro`;
const SECRETO = process.env.N8N_WEBHOOK_SECRET!;
const CAMPANA = process.env.CAMPANA_ACTIVA!;
const PREFIJO = "E2E hu0017 - ";
const GRADO_SQL = `g.nombre_grado LIKE '3.%de primaria' AND g.campana_admision = '${CAMPANA}'`;
const DIRECTORIO_ARCHIVOS = "/var/lib/cil/archivos";
const AVISO_SIN_CAMBIOS = "No hay cambios desde la última verificación: carga los documentos que faltan antes de confirmar";

const docker = (args: string[]) => execFileSync("docker", [...COMPOSE, ...args], { cwd: RAIZ, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 1 << 28 });
const consultar = (usuario: string, base: string, sql: string) => docker(["exec", "-T", "postgres", "psql", "-U", usuario, "-d", base, "-tA", "-F", "\t", "-c", sql]).trim();
const consultarAdmision = (sql: string) => consultar("api_admision", "admision", sql);
const enApi = (...orden: string[]) => docker(["exec", "-T", "api", ...orden]);

// Hace un instante, en segundos Unix, con el reloj de Docker (el de Postgres, n8n y los logs).
const haceUnInstante = () => consultarAdmision("SELECT floor(extract(epoch FROM now())) - 5");
const logApi = (desde: string) => docker(["logs", "--no-color", "--since", desde, "api"]);

const pdf = (marca: string) => Buffer.from(`%PDF-1.4\n% ${marca}\n${" ".repeat(200)}`);
const jpg = () => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]), Buffer.from("JFIF\0"), Buffer.alloc(200, 0x20)]);
const dniE2E = () => String(10_000_000 + Math.floor(Math.random() * 80_000_000));

let correo: string;
let contrasena: string;
let idKeycloak: string;
let idExpediente: number;
let contexto: BrowserContext;
let page: Page;

async function capturar(nombre: string, ocultar: string[] = []) {
  mkdirSync(CAPTURAS, { recursive: true });
  await page.screenshot({ path: resolve(CAPTURAS, `${nombre}.png`), fullPage: true, mask: ocultar.map((s) => page.locator(s)) });
}

const fila = (tipo: string) => page.locator("li.requisito", { hasText: `${PREFIJO}${tipo}` });
const agregar = (tipo: string) => fila(tipo).locator('input[data-testid^="archivo-"]');
// El grado de dev puede tener más requisitos obligatorios que los dos de la prueba (de G09 o de otras corridas): se sube un
// archivo a cada requisito obligatorio de P06 que aún no tenga uno, salvo el de `salvo` (que se deja pendiente a propósito).
async function subirTodoMenos(salvo: string) {
  const filas = page.locator("li.requisito");
  await expect(filas.first()).toBeVisible(); // count() no espera a que P06 termine de cargar
  const total = await filas.count();
  expect(total, "P06 no muestra requisitos").toBeGreaterThan(0);
  for (let i = 0; i < total; i++) {
    const f = filas.nth(i);
    const texto = await f.innerText();
    if (texto.includes("(opcional)") || texto.includes(`${PREFIJO}${salvo}`) || texto.includes("Archivo 1 ·")) continue;
    await f.locator('input[data-testid^="archivo-"]').setInputFiles({ name: `doc-${i}.pdf`, mimeType: "application/pdf", buffer: pdf(`documento ficticio ${i}`) });
    await expect(f).toContainText("Archivo 1 · PDF");
  }
}
const continuar = () => page.getByRole("button", { name: "Guardar y continuar" });
const estado = () => consultarAdmision(`SELECT estado FROM expediente WHERE id_expediente = ${idExpediente}`);
const eventos = (tipo: string) => consultarAdmision(`SELECT count(*) FROM registro_auditoria WHERE id_expediente = ${idExpediente} AND tipo_evento = '${tipo}'`);
const faltantes = () => consultarAdmision(`SELECT estado_envio FROM notificacion WHERE id_expediente = ${idExpediente} AND tipo_evento = 'documentos_faltantes' ORDER BY id_notificacion`).split("\n").filter(Boolean);

// Los correos de la familia en Mailpit, con su texto.
async function correosDeLaFamilia(request: APIRequestContext) {
  const lista = await (await request.get(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:"${correo}"`)}`)).json();
  const mensajes: { asunto: string; texto: string }[] = [];
  for (const m of lista.messages ?? []) {
    const detalle = await (await request.get(`${MAILPIT}/api/v1/message/${m.ID}`)).json();
    mensajes.push({ asunto: detalle.Subject, texto: detalle.Text });
  }
  return mensajes;
}

// Envía el evento de ADR-16 al webhook de recepcion-registro con su secreto. Si la llamada no obtiene respuesta, el error
// de Playwright trae el registro con las cabeceras y el secreto en texto plano (C15): se lanza otro con solo la causa.
async function enviarEvento(request: APIRequestContext, cuerpo: unknown, cabeceras: Record<string, string> = { "X-Webhook-Secret": SECRETO }) {
  try {
    return await request.post(WEBHOOK_RECEPCION, { headers: cabeceras, data: cuerpo, failOnStatusCode: false });
  } catch (e) {
    const causa = String((e as Error)?.message ?? "").split("\n")[0]!;
    throw new Error(`No se pudo llamar al webhook de recepcion-registro (${WEBHOOK_RECEPCION}): ${SECRETO && causa.includes(SECRETO) ? "sin respuesta" : causa}`);
  }
}

// Login y ficha completa por la interfaz (HU0005), para llegar a P06 como lo hace la familia.
async function iniciarYCompletarFicha(browser: import("@playwright/test").Browser) {
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

test.describe.serial("HU0017 verificación de completitud en el entorno dev", () => {
  test.beforeAll(async ({ browser }) => {
    test.setTimeout(180_000);
    correo = `hu0017-e2e-${Date.now()}-${randomBytes(2).toString("hex")}@ejemplo.test`;
    contrasena = contrasenaE2E();

    // Usuario de la familia en Keycloak, con el rol familia y una contraseña definitiva (el primer ingreso es de D3).
    const api = await admin();
    const { res } = await api("POST", "/users", { username: correo, email: correo, firstName: "María Fernanda", lastName: "Quispe Rojas", enabled: true, emailVerified: true });
    idKeycloak = res.headers.get("location")!.split("/").pop()!;
    await api("PUT", `/users/${idKeycloak}/reset-password`, { type: "password", value: contrasena, temporary: false });
    const { datos: rol } = await api("GET", "/roles/familia");
    await api("POST", `/users/${idKeycloak}/role-mappings/realm`, [{ id: rol.id, name: rol.name }]);

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

  test("HU0017-2.0 con documentos faltantes el expediente sigue en postulación, la familia recibe el correo con lo que falta y P06 lo muestra; confirmar sin cambios no repite el aviso", async ({ request }) => {
    test.setTimeout(150_000);
    await page.getByTestId("ir-a-documentos").click();
    await expect(page.getByRole("heading", { name: "Documentos del expediente" })).toBeVisible();
    // Todo lo obligatorio menos las boletas de pago (y el derecho de admisión, que se registra en P07b).
    await subirTodoMenos("Boletas de pago");

    await page.getByRole("button", { name: "Confirmar documentos" }).click();
    await expect(page.getByTestId("confirmado")).toContainText("Confirmaste tus documentos el");

    // El evento sale después de responder; n8n pide la verificación y envía el aviso por notificacion-multicanal.
    await expect.poll(faltantes, { timeout: 90_000, intervals: [1_000] }).toEqual(["enviado"]);
    expect(await estado()).toBe("en_postulacion");
    expect(consultarAdmision(`SELECT count(*) FROM registro_auditoria WHERE id_expediente = ${idExpediente} AND tipo_evento = 'transicion_estado' AND estado_anterior = 'en_postulacion'`)).toBe("0");
    expect(consultarAdmision(`SELECT detalle->>'resultado' FROM registro_auditoria WHERE id_expediente = ${idExpediente} AND tipo_evento = 'completitud_verificada'`)).toBe("incompleto");

    const correos = await correosDeLaFamilia(request);
    expect(correos.map((c) => c.asunto)).toEqual([`Documentos pendientes · Admisión ${CAMPANA}`]);
    const lineas = correos[0]!.texto.replace(/\r/g, "").split("\n");
    expect(lineas).toContain(`- ${PREFIJO}Boletas de pago (madre)`);
    expect(lineas).toContain("- Comprobante del derecho de admisión");
    expect(lineas.filter((l) => l.startsWith("- "))).toEqual([`- ${PREFIJO}Boletas de pago (madre)`, "- Comprobante del derecho de admisión"]);
    expect(correos[0]!.texto).toContain(`${FRONTEND}/portal/documentos`);
    expect(correos[0]!.texto).toContain(`${FRONTEND}/portal/pagos/derecho-admision`);

    // P06 muestra lo mismo, con el parentesco y no el nombre del apoderado.
    await page.reload();
    const lista = page.getByTestId("faltantes");
    await expect(lista).toContainText("Boletas de pago (madre)");
    await expect(lista).toContainText("Comprobante del derecho de admisión");
    await capturar("p06-faltantes-despues-de-la-verificacion", ["#username"]);

    // Sin cambios, confirmar otra vez se rechaza con el mensaje de la API: sin evento nuevo ni otro correo.
    await page.getByRole("button", { name: "Confirmar documentos" }).click();
    await expect(page.getByTestId("error-confirmacion")).toHaveText(AVISO_SIN_CAMBIOS);
    await capturar("p06-confirmar-sin-cambios");
    expect(eventos("documentos_confirmados")).toBe("1");
    expect(faltantes()).toEqual(["enviado"]);
  });

  test("HU0017-1.0 [parte: estado y ramas] la familia completa lo que faltaba y vuelve a confirmar: el expediente pasa a En validación con las tres validaciones abiertas en pendiente", async () => {
    test.setTimeout(150_000);
    await agregar("Boletas de pago").setInputFiles({ name: "boleta-junio.jpg", mimeType: "image/jpeg", buffer: jpg() });
    await expect(fila("Boletas de pago")).toContainText("Archivo 1 · JPG");

    // El derecho de admisión cuenta para la completitud (ADR-22, D2-a): se registra en P07b mientras sigue en postulación.
    await page.getByTestId("menu-pagos").click();
    await page.getByTestId("ir-derecho").click();
    await page.locator("#p07b-banco").selectOption("BCP");
    await page.locator("#p07b-operacion").fill(`E2E${Date.now()}`);
    await page.locator("#p07b-fecha").fill("2026-10-10");
    await page.locator("#p07b-comprobante").setInputFiles({ name: "voucher.pdf", mimeType: "application/pdf", buffer: pdf("voucher ficticio") });
    await page.getByRole("button", { name: "Enviar comprobante" }).click();
    await expect(page.getByTestId("constancia")).toBeVisible();

    await page.getByTestId("menu-documentos").click();
    await expect(page.getByRole("heading", { name: "Documentos del expediente" })).toBeVisible();
    await page.getByRole("button", { name: "Confirmar documentos" }).click();
    await expect(page.getByTestId("confirmado")).toContainText("Confirmaste tus documentos el");

    await expect.poll(estado, { timeout: 90_000, intervals: [1_000] }).toBe("en_validacion");
    expect(consultarAdmision(`SELECT concat_ws('|', estado_documental, estado_financiero) FROM expediente WHERE id_expediente = ${idExpediente}`)).toBe("pendiente|pendiente");
    expect(consultarAdmision(`SELECT estado_validacion FROM pago WHERE id_expediente = ${idExpediente}`)).toBe("pendiente");
    expect(consultarAdmision(`SELECT string_agg(detalle->>'resultado', '|' ORDER BY id_evento) FROM registro_auditoria WHERE id_expediente = ${idExpediente} AND tipo_evento = 'completitud_verificada'`)).toBe("incompleto|completo");
    expect(consultarAdmision(`SELECT count(*) FROM registro_auditoria WHERE id_expediente = ${idExpediente} AND tipo_evento = 'transicion_estado' AND estado_anterior = 'en_postulacion' AND estado_nuevo = 'en_validacion'`)).toBe("1");
    expect(consultarAdmision(`SELECT id_personal IS NULL FROM registro_auditoria WHERE id_expediente = ${idExpediente} AND tipo_evento = 'transicion_estado' AND estado_nuevo = 'en_validacion'`)).toBe("t");
    // Completo no se notifica: sigue el único aviso de faltantes de la primera verificación.
    expect(faltantes()).toEqual(["enviado"]);

    // P06 queda en solo lectura: ya no se carga ni se confirma.
    await page.reload();
    await expect(page.getByTestId("no-editable")).toBeVisible();
    await expect(page.getByRole("button", { name: "Confirmar documentos" })).toHaveCount(0);
    await capturar("p06-en-validacion", ["#username"]);
  });
});

// Un expediente cuya verificación falla (ADR-22, C41): recepcion-registro lo deja registrado con solo identificadores y
// sigue con los demás. El id no existe, así que la API responde 404 y verificacion-completitud termina en
// «Detener: verificación fallida»; el Execute Workflow de recepcion-registro sigue por su salida de error.
test.describe("HU0017 un expediente cuya verificación falla", () => {
  const ID_INEXISTENTE = 2_147_483_000;
  const EN_LOG = (flujo: string) => new RegExp(String.raw`^Fallo en n8n \(flujo=${flujo}, nodo=[^)]+, ejecución=\d+\)$`);

  test("C41 (HU0017) el fallo de la verificación de un expediente se registra en la API solo con identificadores, sin el id del expediente, y el webhook sin el secreto responde 403", async ({ request }) => {
    test.setTimeout(150_000);
    const desde = haceUnInstante();

    // C11: sin el secreto (o con uno incorrecto) el webhook no procesa el evento.
    for (const cabeceras of [{}, { "X-Webhook-Secret": "incorrecto" }]) {
      expect((await enviarEvento(request, { id_expediente: ID_INEXISTENTE }, cabeceras)).status()).toBe(403);
    }
    // Un cuerpo inválido recibe 400 (ADR-16).
    expect((await enviarEvento(request, { id_expediente: "no-es-un-id" })).status()).toBe(400);
    expect((await enviarEvento(request, { id_expediente: ID_INEXISTENTE })).status()).toBe(202);

    // Salida de error de «Verificar completitud» → «Registrar fallo en la API» → línea del log de la API.
    let linea = "";
    await expect
      .poll(() => (linea = logApi(desde).split("\n").find((l) => l.includes("Fallo en n8n (flujo=recepcion-registro, nodo=Verificar completitud")) ?? ""), { timeout: 90_000, intervals: [1_000] })
      .not.toBe("");
    expect(linea.replace(/^.*?\| /, "")).toMatch(/^Fallo en n8n \(flujo=recepcion-registro, nodo=Verificar completitud, ejecución=\d+\)$/);

    // Margen para que registro-errores registre también la ejecución fallida del subflujo, si corresponde.
    await new Promise((r) => setTimeout(r, 15_000));
    const lineas = logApi(desde).split("\n").filter((l) => l.includes("Fallo en n8n ("));
    for (const l of lineas) {
      const texto = l.replace(/^.*?\| /, "");
      expect(texto).toMatch(EN_LOG("(recepcion-registro|verificacion-completitud)"));
      // Solo identificadores: ni el id del expediente ni el mensaje del error.
      expect(texto).not.toContain(String(ID_INEXISTENTE));
      expect(texto).not.toContain("HTTP 404");
    }
    test.info().annotations.push({ type: "lineas-de-log", description: lineas.map((l) => l.replace(/^.*?\| /, "")).join(" // ") });
  });
});
