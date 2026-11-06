// HU0008, HU0011 y HU0024 · validaciones en paralelo contra el entorno dev (API, n8n, Keycloak, Mailpit).
// Un expediente llega a En validación por el camino real (ficha, cargas de P06, derecho en P07b, «Confirmar documentos» y la
// verificación de HU0017 por n8n). Después:
//   - camino principal: Secretaría (G02 → G03) marca cada documento conforme y da conformidad; Tesorería (G05) marca conforme
//     el comprobante del derecho (HU0024-1.0) y la documentación financiera (HU0011-1.0), que habilita el agendamiento;
//   - observación (HU0008-2.0, parte correo): Secretaría observa un documento, el flujo verificacion-completitud envía el
//     correo, la familia reemplaza solo ese documento en P06 y G02 lo muestra como «Subsanado».
// - Datos (C16): como en HU0017, el expediente se prepara escribiendo en la base de dev. Cada familia deja un apoderado
//   `hu0008-e2e-*@ejemplo.test` con su cuenta, expediente, postulante, cuestionario, documentos, pago y avisos; las pruebas
//   crean 2 requisitos «E2E hu0008 - …» en el grado «3.° de primaria» y un usuario de Keycloak por familia (rol familia).
//   Al terminar quitan los requisitos, los documentos de la corrida (y sus archivos) y los usuarios.
// - El personal es el de prueba (`secretaria.prueba@`, `tesoreria.prueba@`, npm run kc:usuarios-prueba), con su fila activa.
// - Archivos y DNI ficticios. Capturas: test-results/HU0008-HU0011-HU0024/capturas-e2e/ (ignorada por git).
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test, type APIRequestContext, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { admin, contrasenaE2E, entrarEnGestion, FRONTEND, MAILPIT } from "./ayudantes";

const RAIZ = resolve(import.meta.dirname, "..");
const CAPTURAS = resolve(RAIZ, "test-results/HU0008-HU0011-HU0024/capturas-e2e");
const COMPOSE = ["compose", "-f", "docker-compose.yml", "-f", "docker-compose.dev.yml"];
const CAMPANA = process.env.CAMPANA_ACTIVA!;
const PREFIJO = "E2E hu0008 - ";
const GRADO_SQL = `g.nombre_grado LIKE '3.%de primaria' AND g.campana_admision = '${CAMPANA}'`;
const DIRECTORIO_ARCHIVOS = "/var/lib/cil/archivos";

const usuarios: { username: string; rol: string }[] = JSON.parse(readFileSync(resolve(RAIZ, "infra/keycloak/usuarios-prueba.json"), "utf8"));
const usuarioDeRol = (rol: string) => usuarios.find((u) => u.rol === rol)!.username;

const docker = (args: string[]) => execFileSync("docker", [...COMPOSE, ...args], { cwd: RAIZ, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 1 << 28 });
const consultarAdmision = (sql: string) => docker(["exec", "-T", "postgres", "psql", "-U", "api_admision", "-d", "admision", "-tA", "-F", "\t", "-c", sql]).trim();
const enApi = (...orden: string[]) => docker(["exec", "-T", "api", ...orden]);

const pdf = (marca: string) => Buffer.from(`%PDF-1.4\n% ${marca}\n${" ".repeat(200)}`);
const dniE2E = () => String(10_000_000 + Math.floor(Math.random() * 80_000_000));

interface Familia {
  correo: string;
  contrasena: string;
  idKeycloak: string;
  idExpediente: number;
  contexto: BrowserContext;
  page: Page;
}
const familias: Familia[] = [];

async function capturar(page: Page, nombre: string, ocultar: string[] = []) {
  mkdirSync(CAPTURAS, { recursive: true });
  await page.screenshot({ path: resolve(CAPTURAS, `${nombre}.png`), fullPage: true, mask: ocultar.map((s) => page.locator(s)) });
}

// Quita los requisitos de la corrida, los documentos que los usan y sus archivos del volumen.
function limpiar() {
  const usados = consultarAdmision(
    `SELECT d.url_archivo FROM documento d JOIN requisito_documental r ON r.id_requisito = d.id_requisito WHERE r.tipo_documento LIKE '${PREFIJO}%'`,
  ).split("\n").filter(Boolean);
  for (const clave of usados) enApi("rm", "-f", `${DIRECTORIO_ARCHIVOS}/${clave}`);
  consultarAdmision(`DELETE FROM documento WHERE id_requisito IN (SELECT id_requisito FROM requisito_documental WHERE tipo_documento LIKE '${PREFIJO}%')`);
  consultarAdmision(`DELETE FROM requisito_documental WHERE tipo_documento LIKE '${PREFIJO}%'`);
}

function crearRequisitos() {
  consultarAdmision(
    `INSERT INTO requisito_documental (id_grado, tipo_documento, categoria, condicion_aplicacion, por_apoderado)
     SELECT g.id_grado, v.tipo, v.categoria::categoria_requisito, v.condicion::condicion_aplicacion, v.por_apoderado
       FROM grado g,
            (VALUES ('${PREFIJO}Partida de nacimiento', 'postulante_y_padres', 'todos', false),
                    ('${PREFIJO}Boletas de pago', 'financiero', 'si_dependiente', true)) AS v(tipo, categoria, condicion, por_apoderado)
      WHERE ${GRADO_SQL}
        AND NOT EXISTS (SELECT 1 FROM requisito_documental r WHERE r.id_grado = g.id_grado AND r.tipo_documento LIKE '${PREFIJO}%')`,
  );
}

// Lleva una familia hasta En validación por el camino real y devuelve su sesión de P06.
async function prepararFamilia(browser: Browser, marca: string): Promise<Familia> {
  const correo = `hu0008-e2e-${marca}-${Date.now()}-${randomBytes(2).toString("hex")}@ejemplo.test`;
  const contrasena = contrasenaE2E();
  const api = await admin();
  const { res } = await api("POST", "/users", { username: correo, email: correo, firstName: "María Fernanda", lastName: "Quispe Rojas", enabled: true, emailVerified: true });
  const idKeycloak = res.headers.get("location")!.split("/").pop()!;
  await api("PUT", `/users/${idKeycloak}/reset-password`, { type: "password", value: contrasena, temporary: false });
  const { datos: rol } = await api("GET", "/roles/familia");
  await api("POST", `/users/${idKeycloak}/role-mappings/realm`, [{ id: rol.id, name: rol.name }]);

  const id = consultarAdmision(
    `WITH a AS (INSERT INTO apoderado (nombres, apellidos, telefono, correo)
                VALUES ('María Fernanda', 'Quispe Rojas', '+51987654321', '${correo}') RETURNING id_apoderado),
          c AS (INSERT INTO cuenta_acceso (id_apoderado, keycloak_user_id) SELECT id_apoderado, '${idKeycloak}'::uuid FROM a)
     INSERT INTO expediente (id_apoderado_titular, id_grado, estado)
     SELECT a.id_apoderado, g.id_grado, 'portal_habilitado' FROM a, grado g WHERE ${GRADO_SQL}
     RETURNING id_expediente`,
  ).split("\n")[0]!;
  expect(id, "no se creó el expediente de la prueba: ¿existe el grado «3.° de primaria» de la campaña activa (npm run db:seed)?").toMatch(/^\d+$/);

  const contexto = await browser.newContext();
  const page = await contexto.newPage();
  const familia: Familia = { correo, contrasena, idKeycloak, idExpediente: Number(id), contexto, page };
  familias.push(familia);

  const continuar = () => page.getByRole("button", { name: "Guardar y continuar" });
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
  await page.locator('input[name="p05proc"]').first().check();
  await page.locator('input[name="p05cond"]').nth(1).check();
  await continuar().click();
  await page.locator("#p05bt-par").selectOption("madre");
  await page.locator("#p05bt-dni").fill(dniE2E());
  await page.locator('input[name="p05btcl"]').first().check(); // dependiente: la madre debe sus boletas
  await continuar().click();
  await page.locator("#p05c").fill("Colegio Ficticio de Lima");
  await continuar().click();
  for (const p of ["p1", "p2", "p3"]) await page.locator(`#p05q-${p}`).fill(`Respuesta ficticia ${p}`);
  await continuar().click();
  await expect(page.getByTestId("paso-documentos")).toBeVisible({ timeout: 15_000 });

  // P06: un archivo a cada requisito obligatorio (los de la corrida y los que haya en el grado de dev).
  await page.getByTestId("ir-a-documentos").click();
  await expect(page.getByRole("heading", { name: "Documentos del expediente" })).toBeVisible();
  const filas = page.locator("li.requisito");
  await expect(filas.first()).toBeVisible();
  const total = await filas.count();
  for (let i = 0; i < total; i++) {
    const f = filas.nth(i);
    const texto = await f.innerText();
    if (texto.includes("(opcional)") || texto.includes("Archivo 1 ·")) continue;
    await f.locator('input[data-testid^="archivo-"]').setInputFiles({ name: `doc-${i}.pdf`, mimeType: "application/pdf", buffer: pdf(`documento ficticio ${i}`) });
    await expect(f).toContainText("Archivo 1 · PDF");
  }

  // P07b: el derecho de admisión cuenta para la completitud (ADR-22, D2-a).
  await page.getByTestId("menu-pagos").click();
  await page.getByTestId("ir-derecho").click();
  await page.locator("#p07b-banco").selectOption("[Banco 1]");
  await page.locator("#p07b-operacion").fill(`E2E${Date.now()}${randomBytes(2).toString("hex")}`);
  await page.locator("#p07b-fecha").fill("2026-10-10");
  await page.locator("#p07b-comprobante").setInputFiles({ name: "voucher.pdf", mimeType: "application/pdf", buffer: pdf("voucher ficticio") });
  await page.getByRole("button", { name: "Enviar comprobante" }).click();
  await expect(page.getByTestId("constancia")).toBeVisible();

  await page.getByTestId("menu-documentos").click();
  await expect(page.getByRole("heading", { name: "Documentos del expediente" })).toBeVisible();
  await page.getByRole("button", { name: "Confirmar documentos" }).click();
  await expect(page.getByTestId("confirmado")).toContainText("Confirmaste tus documentos el");

  // La verificación de HU0017 la hace n8n: el expediente pasa a En validación con las tres ramas en pendiente.
  await expect
    .poll(() => consultarAdmision(`SELECT estado FROM expediente WHERE id_expediente = ${id}`), { timeout: 90_000, intervals: [1_000] })
    .toBe("en_validacion");
  return familia;
}

// Sesión del personal de prueba en la gestión interna.
async function abrirGestion(browser: Browser, rol: "secretaria" | "tesoreria") {
  const contexto = await browser.newContext();
  const page = await contexto.newPage();
  await entrarEnGestion(page, usuarioDeRol(rol), process.env.KEYCLOAK_TEST_USER_PASSWORD!);
  return { contexto, page };
}

// Marca «Conforme» cada documento de la lista que aún no lo está (un clic por documento, esperando a que la pantalla lo refleje).
async function marcarTodosConformes(zona: ReturnType<Page["locator"]>) {
  const botones = zona.getByRole("button", { name: "Conforme", exact: true });
  await expect(botones.first()).toBeVisible();
  for (let n = await botones.count(); n > 0; n = await botones.count()) {
    await botones.first().click();
    await expect(botones).toHaveCount(n - 1);
  }
}

const estadoRamas = (id: number) =>
  consultarAdmision(
    `SELECT concat_ws('|', e.estado, e.estado_documental, e.estado_financiero, (SELECT p.estado_validacion FROM pago p WHERE p.id_expediente = e.id_expediente AND p.tipo_pago = 'derecho_admision'))
       FROM expediente e WHERE e.id_expediente = ${id}`,
  );
const eventos = (id: number, tipo: string) => consultarAdmision(`SELECT count(*) FROM registro_auditoria WHERE id_expediente = ${id} AND tipo_evento = '${tipo}'`);

test.beforeAll(async () => {
  limpiar();
  crearRequisitos();
});

test.afterAll(async () => {
  for (const f of familias) await f.contexto.close();
  limpiar();
  const api = await admin();
  for (const f of familias) await api("DELETE", `/users/${f.idKeycloak}`);
});

test.describe.serial("HU0008, HU0011 y HU0024 camino principal: las tres validaciones conformes habilitan el agendamiento", () => {
  let familia: Familia;
  let idPago: string;

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(240_000);
    familia = await prepararFamilia(browser, "principal");
    idPago = consultarAdmision(`SELECT id_pago FROM pago WHERE id_expediente = ${familia.idExpediente} AND tipo_pago = 'derecho_admision'`);
    expect(estadoRamas(familia.idExpediente)).toBe("en_validacion|pendiente|pendiente|pendiente");
  });

  test("HU0008-1.0 Secretaría abre el expediente desde la bandeja, marca cada documento conforme y da conformidad al expediente", async ({ browser }) => {
    test.setTimeout(120_000);
    const { contexto, page } = await abrirGestion(browser, "secretaria");
    try {
      await page.getByRole("link", { name: "Bandeja de expedientes" }).first().click();
      await expect(page).toHaveURL(`${FRONTEND}/gestion/bandeja`);
      const fila = page.getByTestId(`expediente-${familia.idExpediente}`);
      await expect(fila).toContainText("Completo · en revisión");
      await fila.getByRole("link", { name: /^Revisar/ }).click();
      await expect(page).toHaveURL(`${FRONTEND}/gestion/bandeja/${familia.idExpediente}`);
      await expect(page.getByTestId("chips-ramas")).toBeVisible();
      await expect(page.getByTestId("nota-restringida")).toBeVisible();
      // R2: la documentación financiera no se muestra a Secretaría.
      await expect(page.getByTestId("seccion-financiero")).toHaveCount(0);
      await expect(page.getByTestId("dar-conformidad")).toBeDisabled();

      await marcarTodosConformes(page.locator(".documentos"));
      await expect(page.getByTestId("dar-conformidad")).toBeEnabled();
      await capturar(page, "g03-documentos-conformes");
      await page.getByTestId("dar-conformidad").click();
      await expect(page.getByTestId("aviso")).toContainText("Validación registrada como conforme");
      await expect(page.getByTestId("agendamiento-habilitado")).toHaveCount(0); // faltan las validaciones de Tesorería
    } finally {
      await contexto.close();
    }
    expect(estadoRamas(familia.idExpediente)).toBe("en_validacion|conforme|pendiente|pendiente");
    expect(consultarAdmision(`SELECT count(*) FROM registro_auditoria WHERE id_expediente = ${familia.idExpediente} AND tipo_evento = 'atencion_inicio'`)).not.toBe("0");
    expect(consultarAdmision(`SELECT count(*) FROM registro_auditoria WHERE id_expediente = ${familia.idExpediente} AND tipo_evento = 'atencion_fin' AND detalle->>'habilita_agendamiento' = 'true'`)).toBe("0");
  });

  test("HU0024-1.0 Tesorería abre el comprobante del derecho de admisión en G05 y lo marca conforme", async ({ browser }) => {
    test.setTimeout(120_000);
    const { contexto, page } = await abrirGestion(browser, "tesoreria");
    try {
      await page.getByRole("link", { name: "Validaciones de Tesorería" }).first().click();
      await expect(page).toHaveURL(`${FRONTEND}/gestion/tesoreria`);
      const fila = page.getByTestId(`item-derecho_admision-${idPago}`);
      await expect(fila).toContainText("Por validar");
      await fila.getByRole("button", { name: /Derecho de admisión/ }).click();
      const panel = page.getByTestId("panel-comprobante");
      await expect(panel).toContainText("S/ 300");
      await expect(page.getByTestId("numero-operacion")).toContainText("E2E");
      await capturar(page, "g05-comprobante");
      await page.getByTestId("comprobante-conforme").click();
      await expect(panel.getByTestId("aviso")).toContainText("Comprobante conforme.");
      await expect(panel.getByTestId("aviso")).not.toContainText("quedó habilitado"); // falta la documentación financiera
    } finally {
      await contexto.close();
    }
    expect(estadoRamas(familia.idExpediente)).toBe("en_validacion|conforme|pendiente|conforme");
    expect(consultarAdmision(`SELECT count(*) FROM pago WHERE id_pago = ${idPago} AND id_personal_validador IS NOT NULL`)).toBe("1");
  });

  test("HU0011-1.0 Tesorería marca cada documento financiero conforme y confirma: con las tres ramas conformes queda habilitado el agendamiento", async ({ browser }) => {
    test.setTimeout(120_000);
    const { contexto, page } = await abrirGestion(browser, "tesoreria");
    try {
      await page.getByRole("link", { name: "Validaciones de Tesorería" }).first().click();
      const fila = page.getByTestId(`item-documentacion_financiera-${familia.idExpediente}`);
      await expect(fila).toContainText("Por revisar");
      await fila.getByRole("button", { name: "Documentación financiera" }).click();
      const panel = page.getByTestId("panel-financiera");
      await expect(panel).toContainText("Solo Tesorería");
      await expect(page.getByTestId("marcar-conforme")).toBeDisabled();
      await marcarTodosConformes(panel);
      await capturar(page, "g05-financiera-conforme");
      await page.getByTestId("marcar-conforme").click();
      await expect(panel.getByTestId("aviso")).toContainText("el agendamiento de evaluaciones quedó habilitado");
    } finally {
      await contexto.close();
    }
    // El expediente sigue en En validación (HU0009 lo mueve) con las tres ramas conformes.
    expect(estadoRamas(familia.idExpediente)).toBe("en_validacion|conforme|conforme|conforme");
    // Una sola decisión habilita el agendamiento: la última (atencion_fin con habilita_agendamiento = true).
    expect(consultarAdmision(`SELECT count(*) FROM registro_auditoria WHERE id_expediente = ${familia.idExpediente} AND tipo_evento = 'atencion_fin' AND detalle->>'habilita_agendamiento' = 'true'`)).toBe("1");
    expect(consultarAdmision(`SELECT count(*) FROM registro_auditoria WHERE id_expediente = ${familia.idExpediente} AND tipo_evento = 'transicion_estado' AND estado_anterior = 'en_validacion'`)).toBe("0");
  });
});

test.describe.serial("HU0008-2.0 observación con subsanación", () => {
  const MOTIVO = "El documento está borroso y no se lee el nombre completo.";
  let familia: Familia;
  let idDocumento: string;

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(240_000);
    familia = await prepararFamilia(browser, "observacion");
    idDocumento = consultarAdmision(
      `SELECT d.id_documento FROM documento d JOIN requisito_documental r USING (id_requisito) WHERE d.id_expediente = ${familia.idExpediente} AND r.tipo_documento = '${PREFIJO}Partida de nacimiento' AND d.vigente`,
    );
  });

  test("HU0008-2.0 [parte: correo] Secretaría observa un documento con su motivo, la familia recibe el correo con el enlace, reemplaza solo ese documento y G02 lo muestra como Subsanado", async ({ browser, request }) => {
    test.setTimeout(180_000);
    const id = familia.idExpediente;

    // Secretaría observa el documento en G03.
    const { contexto, page } = await abrirGestion(browser, "secretaria");
    try {
      await page.getByRole("link", { name: "Bandeja de expedientes" }).first().click();
      await page.getByTestId(`expediente-${id}`).getByRole("link", { name: /^Revisar/ }).click();
      await expect(page).toHaveURL(`${FRONTEND}/gestion/bandeja/${id}`);
      const documento = page.getByTestId(`documento-${idDocumento}`);
      await documento.getByRole("button", { name: "Observar" }).click();
      const panel = page.getByTestId("panel-observacion");
      // Sin motivo no se envía.
      await panel.getByRole("button", { name: "Solicitar subsanación" }).click();
      await expect(panel.getByRole("alert")).toBeVisible();
      await panel.getByLabel(/Motivo de la observación/).fill(MOTIVO);
      await capturar(page, "g03-observar-documento");
      await panel.getByRole("button", { name: "Solicitar subsanación" }).click();
      await expect(page.getByTestId("aviso")).toContainText("Se solicitó la subsanación");
      await expect(documento).toContainText("Observado");
      await expect(documento.getByTestId("motivo-vigente")).toContainText(MOTIVO);
    } finally {
      await contexto.close();
    }
    expect(estadoRamas(id)).toBe("en_validacion|observado|pendiente|pendiente");

    // El flujo verificacion-completitud (rama validación) envía el correo con el motivo y el enlace a P06.
    const asunto = `Observaciones en tu expediente · Admisión ${CAMPANA}`;
    const correos = await esperarCorreos(request, familia.correo, asunto);
    expect(correos).toHaveLength(1);
    expect(correos[0]!.texto).toContain(MOTIVO);
    expect(correos[0]!.texto).toContain(`${PREFIJO}Partida de nacimiento`);
    expect(correos[0]!.texto).toContain(`${FRONTEND}/portal/documentos`);
    expect(consultarAdmision(`SELECT estado_envio FROM notificacion WHERE id_expediente = ${id} AND tipo_evento = 'subsanacion_solicitada' ORDER BY id_notificacion`).split("\n").filter(Boolean)).toContain("enviado");

    // La familia ve el motivo en P06 y reemplaza solo ese documento.
    const p = familia.page;
    await p.reload();
    const archivo = p.locator("li.archivo", { has: p.getByTestId("motivo-vigente") });
    await expect(archivo).toHaveCount(1);
    await expect(archivo).toContainText(MOTIVO);
    await expect(p.getByTestId(`reemplazo-${idDocumento}`)).toHaveCount(1);
    await capturar(p, "p06-documento-observado", ["#username"]);
    await p.getByTestId(`reemplazo-${idDocumento}`).setInputFiles({ name: "partida-nueva.pdf", mimeType: "application/pdf", buffer: pdf("partida ficticia nueva") });
    await expect(p.locator("li.archivo", { hasText: "Motivo anterior" })).toHaveCount(0); // el anterior ya no es vigente
    await expect(p.getByTestId("motivo-vigente")).toHaveCount(0);
    await expect(p.getByTestId("motivo-anterior")).toHaveCount(1);
    await expect(p.getByTestId("motivo-anterior")).toContainText(MOTIVO);
    await capturar(p, "p06-documento-reemplazado", ["#username"]);

    // La rama documental vuelve a pendiente, queda el rastro y solo se reemplazó ese documento.
    expect(estadoRamas(id)).toBe("en_validacion|pendiente|pendiente|pendiente");
    expect(eventos(id, "subsanacion_registrada")).toBe("1");
    expect(consultarAdmision(`SELECT count(*) FROM documento WHERE id_expediente = ${id} AND id_documento = ${idDocumento} AND NOT vigente`)).toBe("1");
    expect(consultarAdmision(`SELECT count(*) FROM documento d JOIN requisito_documental r USING (id_requisito) WHERE d.id_expediente = ${id} AND r.tipo_documento LIKE '${PREFIJO}%' AND d.vigente`)).toBe("2");

    // G02 lo muestra como «Subsanado», con el motivo anterior y no como observación vigente.
    const g02 = await abrirGestion(browser, "secretaria");
    try {
      await g02.page.getByRole("link", { name: "Bandeja de expedientes" }).first().click();
      const fila = g02.page.getByTestId(`expediente-${id}`);
      await expect(fila).toContainText("Subsanado");
      await expect(fila.getByTestId("motivo-anterior")).toHaveText(`Motivo anterior: ${MOTIVO}`);
      await expect(fila).not.toContainText("Observado");
      await capturar(g02.page, "g02-subsanado");
    } finally {
      await g02.contexto.close();
    }
  });
});

// Espera en Mailpit los correos de `correo` con el asunto dado y devuelve su texto.
async function esperarCorreos(request: APIRequestContext, correo: string, asunto: string) {
  let ids: string[] = [];
  await expect
    .poll(
      async () => {
        const lista = await (await request.get(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:"${correo}"`)}`)).json();
        ids = (lista.messages ?? []).filter((m: { Subject: string }) => m.Subject === asunto).map((m: { ID: string }) => m.ID);
        return ids.length;
      },
      { timeout: 90_000, intervals: [1_000] },
    )
    .toBeGreaterThan(0);
  const correos: { asunto: string; texto: string }[] = [];
  for (const mid of ids) {
    const detalle = await (await request.get(`${MAILPIT}/api/v1/message/${mid}`)).json();
    correos.push({ asunto: detalle.Subject, texto: detalle.Text });
  }
  return correos;
}
