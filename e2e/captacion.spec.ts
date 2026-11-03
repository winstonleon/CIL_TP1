// HU0002 · carpeta informativa (flujo captacion de n8n) contra el entorno dev: P01 → API → n8n → Mailpit → BD → G04.
// Requiere los grados de la campaña activa (npm run db:seed), los usuarios de prueba, `npm run n8n:credenciales` y
// `npm run n8n:importar`. Los secretos salen de .env (playwright.config.ts) y nunca se imprimen.
// - Datos (C16): cada corrida deja en dev 7 prospectos hu0002-e2e-<marca>: 6 @ejemplo.test con su carpeta enviada y 1
//   @rebota.ejemplo.test, que queda en G04. Detiene y arranca n8n y Mailpit (siempre en un finally, sin borrar volúmenes).
// - BD: lee la base admision con el usuario de la API y la base n8n (sus ejecuciones con error), como
//   e2e/notificacion.spec.ts. La única escritura es la de C27 (P-a), aprobada por John (A3).
// - Límite por IP de P01 (ADR-17): la API cuenta en memoria 5 envíos por IP cada 10 minutos. En dev ve dos IP: la del
//   contenedor del frontend (P01 en el navegador y las llamadas por el /api de Vite) y la del host (llamadas directas al
//   puerto de la API). Este archivo registra 3 prospectos por la del frontend y 4 por la del host; en la corrida
//   completa, S0-C8 reinicia la API después y el contador vuelve a cero. Correr este archivo solo dos veces en menos de
//   10 minutos da 429 (C16).
// - Capturas: test-results/HU0002/capturas-e2e/ (ignorada por git); las de la corrida final se copian a
//   docs/evidencias/HU0002/. En la del correo, el token de P02 queda tapado antes de capturar.
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { API, entrarEnGestion, FRONTEND, MAILPIT } from "./ayudantes";

const RAIZ = resolve(import.meta.dirname, "..");
const CAPTURAS = resolve(RAIZ, "test-results/HU0002/capturas-e2e");
const COMPOSE = ["compose", "-f", "docker-compose.yml", "-f", "docker-compose.dev.yml"];
const N8N = `http://127.0.0.1:${process.env.N8N_HOST_PORT || 5679}`;
const WEBHOOK_CAPTACION = `${N8N}/webhook/captacion`;
const SECRETO = process.env.N8N_WEBHOOK_SECRET!;
const CONTRASENA = process.env.KEYCLOAK_TEST_USER_PASSWORD!;
const CAMPANA = process.env.CAMPANA_ACTIVA!;
const URL_CARPETA = process.env.CARPETA_INFORMATIVA_URL?.trim() || null;
const SIN_ENLACE_CARPETA = "[Enlace a la carpeta informativa: por definir con el colegio]";
const GRADO = "3.° de primaria";

const usuarios: { username: string; rol: string }[] = JSON.parse(
  readFileSync(resolve(RAIZ, "infra/keycloak/usuarios-prueba.json"), "utf8"),
);
const secretaria = usuarios.find((u) => u.rol === "secretaria")!;

const marca = () => `${Date.now()}-${randomBytes(2).toString("hex")}`;
const correoE2E = (dominio = "ejemplo.test") => `hu0002-e2e-${marca()}@${dominio}`;

function docker(args: string[]): string {
  return execFileSync("docker", [...COMPOSE, ...args], { cwd: RAIZ, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 1 << 28 });
}

// Consulta a una base del Postgres de dev desde dentro del contenedor (socket local).
function consultar(usuario: string, base: string, sql: string): string {
  return docker(["exec", "-T", "postgres", "psql", "-U", usuario, "-d", base, "-tA", "-F", "\t", "-c", sql]).trim();
}
const consultarAdmision = (sql: string) => consultar("api_admision", "admision", sql);

// Hace un instante, en segundos Unix, con el reloj de Docker (el de Postgres, n8n y los logs) y no con el del host: tras
// una suspensión, la VM puede quedar desfasada. Sirve para `docker logs --since` y para filtrar ejecuciones de n8n.
const haceUnInstante = () => consultarAdmision("SELECT floor(extract(epoch FROM now())) - 5");

function idExpediente(correo: string): number {
  const id = consultarAdmision(
    `SELECT e.id_expediente FROM expediente e JOIN apoderado a ON a.id_apoderado = e.id_apoderado_titular WHERE a.correo = '${correo}'`,
  );
  expect(id, `no se registró el prospecto ${correo}`).toMatch(/^\d+$/);
  return Number(id);
}

// Notificaciones del expediente: «canal estado_envio id_notificacion» por fila.
const notificaciones = (id: number) =>
  consultarAdmision(
    `SELECT canal, estado_envio, id_notificacion FROM notificacion WHERE id_expediente = ${id} ORDER BY id_notificacion`,
  )
    .split("\n")
    .filter(Boolean)
    .map((f) => f.split("\t"));

const estadoCarpeta = (id: number) =>
  consultarAdmision(
    `SELECT estado_envio FROM notificacion WHERE id_expediente = ${id} AND canal = 'correo' AND tipo_evento = 'carpeta_enviada'`,
  );

const eventos = (id: number, tipo: string) =>
  Number(consultarAdmision(`SELECT count(*) FROM registro_auditoria WHERE id_expediente = ${id} AND tipo_evento = '${tipo}'`));

const estadoExpediente = (id: number) => consultarAdmision(`SELECT estado FROM expediente WHERE id_expediente = ${id}`);

// Tras detener Mailpit, comprueba que de verdad no corre (C27 P-a falló una vez con la carpeta enviada aunque Mailpit debía
// estar detenido; causa no probada, C16). Si sigue arriba falla con ese mensaje y la hora, en vez de agotar un timeout.
function exigirMailpitDetenido() {
  const corriendo = docker(["ps", "-q", "--status", "running", "mailpit"]).trim();
  expect(corriendo, `Mailpit sigue en ejecución después de detenerlo (${new Date().toISOString()}): no se puede probar el escenario de SMTP caído`).toBe("");
}

// Ejecuciones con error de un flujo desde `desde` cuyo mensaje contiene `fragmento` (n8n guarda las de error, C10).
function ejecucionesConError(flujo: string, desde: string, fragmento: string): number[] {
  return consultar(
    "n8n",
    "n8n",
    `SELECT e.id FROM execution_entity e JOIN workflow_entity w ON w.id = e."workflowId"
       JOIN execution_data d ON d."executionId" = e.id
      WHERE w.name = '${flujo}' AND e.status = 'error' AND e."startedAt" >= to_timestamp(${desde}) AND d.data LIKE '%${fragmento}%'
      ORDER BY e.id`,
  )
    .split("\n")
    .filter(Boolean)
    .map(Number);
}

const logApi = (desde: string) => docker(["logs", "--no-color", "--since", desde, "api"]);

interface Mensaje {
  ID: string;
  Subject: string;
}

async function mensajesPara(request: APIRequestContext, correo: string): Promise<Mensaje[]> {
  const res = await request.get(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:"${correo}"`)}`);
  return (await res.json()).messages ?? [];
}

let idGrado: number | null = null;
async function gradoDePrueba(request: APIRequestContext): Promise<number> {
  if (idGrado === null) {
    const formulario = await (await request.get(`${API}/publico/solicitud-informacion`)).json();
    const grado = formulario.grados.find((g: { nombre_grado: string }) => g.nombre_grado === GRADO);
    expect(grado, `falta el grado ${GRADO}: ejecuta npm run db:seed`).toBeTruthy();
    idGrado = grado.id_grado as number;
  }
  return idGrado;
}

// Registra un prospecto por la ruta pública de P01, sin el navegador. `base` elige la IP que ve la API (ADR-17):
// API (el host) o `${FRONTEND}/api` (el contenedor del frontend, como P01 en el navegador).
async function registrar(request: APIRequestContext, base: string, correo: string, autorizaWhatsapp = false) {
  const res = await request.post(`${base}/publico/solicitud-informacion`, {
    data: {
      nombres: "Nombre E2e",
      apellidos: "Apellido Prueba",
      telefono: "987 654 321",
      correo,
      id_grado: await gradoDePrueba(request),
      autoriza_whatsapp: autorizaWhatsapp,
      acepta_politica: true,
    },
    failOnStatusCode: false,
  });
  expect(res.status(), "un 429 es el límite por IP de P01 (ADR-17): ver la cabecera de este archivo").toBe(201);
  return idExpediente(correo);
}

// Registra un prospecto desde P01 en el navegador y devuelve el instante del envío (reloj de la prueba).
async function registrarEnP01(page: Page, correo: string): Promise<number> {
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.goto(`${FRONTEND}/solicitud-informacion`);
  await expect.poll(() => page.locator("#p01g option").count(), { message: "faltan los grados: ejecuta npm run db:seed" }).toBeGreaterThan(1);
  await page.getByLabel("Nombres del apoderado").fill("Nombre E2e");
  await page.getByLabel("Apellidos del apoderado").fill("Apellido Prueba");
  await page.getByLabel("Teléfono celular").fill("987 654 321");
  await page.getByLabel("Correo electrónico").fill(correo);
  await page.getByLabel("Nivel y grado de interés").selectOption({ label: `Primaria · ${GRADO}` });
  await page.locator("#p01ok").check();
  const respuesta = page.waitForResponse((r) => r.request().method() === "POST" && r.url().endsWith("/publico/solicitud-informacion"));
  const enviado = Date.now();
  await page.getByRole("button", { name: "Solicitar información" }).click();
  expect((await respuesta).status(), "un 429 es el límite por IP de P01 (ADR-17): ver la cabecera de este archivo").toBe(201);
  return enviado;
}

// Envía el evento de ADR-16 al webhook de captacion con su secreto, una credencial de larga duración (C11). Si la
// llamada no obtiene respuesta, el error de Playwright trae el registro de la llamada con las cabeceras y el secreto
// en texto plano (C15): se lanza otro error con solo la causa. Las respuestas HTTP se devuelven igual.
async function enviarEvento(request: APIRequestContext, cuerpo: unknown) {
  try {
    return await request.post(WEBHOOK_CAPTACION, { headers: { "X-Webhook-Secret": SECRETO }, data: cuerpo, failOnStatusCode: false });
  } catch (e) {
    const causa = String((e as Error)?.message ?? "").split("\n")[0]!;
    throw new Error(`No se pudo llamar al webhook de captacion (${WEBHOOK_CAPTACION}): ${SECRETO && causa.includes(SECRETO) ? "sin respuesta" : causa}`);
  }
}

async function esperarListo(request: APIRequestContext, url: string, servicio: string) {
  await expect
    .poll(async () => (await request.get(url, { failOnStatusCode: false }).catch(() => null))?.status(), {
      message: `${servicio} no volvió a responder`,
      timeout: 120_000,
      intervals: [2_000],
    })
    .toBe(200);
}

// Antes de cada captura: el texto visible no tiene tokens, secretos ni enlaces de P02 completos, y todos los correos que
// muestra son ficticios (@ejemplo.test o @rebota.ejemplo.test), como en las evidencias de HU0021.
async function capturar(page: Page, nombre: string) {
  const visible = await page.locator("body").innerText();
  for (const marca of ["eyJ", "Bearer", "access_token", "action-token", "key="]) {
    expect(visible.includes(marca), `la captura ${nombre} muestra «${marca}»`).toBe(false);
  }
  for (const secreto of [SECRETO, CONTRASENA]) expect(visible.includes(secreto), `la captura ${nombre} muestra un secreto`).toBe(false);
  expect(/visita-guiada\?t=v1\.[A-Za-z0-9_-]{8,}/.test(visible), `la captura ${nombre} muestra un token de P02 completo`).toBe(false);
  const correos = visible.match(/[^\s<>]+@[^\s<>]+/g) ?? [];
  expect(correos.filter((c) => !/@(rebota\.)?ejemplo\.test$/.test(c)), `la captura ${nombre} muestra correos no ficticios`).toEqual([]);
  mkdirSync(CAPTURAS, { recursive: true });
  await page.screenshot({ path: resolve(CAPTURAS, `${nombre}.png`), fullPage: true });
}

// Fecha de hoy como la muestra G04: dd/mm/aaaa en la hora de Lima (S9).
function hoyEnLima(): string {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("es-PE", { timeZone: "America/Lima", day: "2-digit", month: "2-digit", year: "numeric" })
      .formatToParts(new Date())
      .map((x) => [x.type, x.value]),
  );
  return `${p.day}/${p.month}/${p.year}`;
}

test.describe("HU0002 carpeta informativa (flujo captacion)", () => {
  test("HU0002-1.0 [parte: correo] desde P01, el correo con la carpeta y el enlace llega a Mailpit en menos de un minuto y queda enviado", async ({ page, request }) => {
    test.setTimeout(120_000);
    const correo = correoE2E();
    const enviado = await registrarEnP01(page, correo);

    // Reloj de la prueba: del clic en «Solicitar información» a la llegada a Mailpit.
    await expect
      .poll(async () => (await mensajesPara(request, correo)).length, { timeout: 60_000, intervals: [500] })
      .toBe(1);
    const segundos = (Date.now() - enviado) / 1000;
    expect(segundos, "la carpeta tardó más de un minuto").toBeLessThan(60);

    // El correo: remitente, destinatario, asunto, la carpeta y el enlace de P02 (el token no se imprime: ADR-18).
    const [{ ID }] = await mensajesPara(request, correo);
    const mensaje = await (await request.get(`${MAILPIT}/api/v1/message/${ID}`)).json();
    const remitente = process.env.SMTP_FROM!.match(/<([^>]+)>/)?.[1] ?? process.env.SMTP_FROM!;
    expect(mensaje.From.Address).toBe(remitente);
    expect(mensaje.To.map((d: { Address: string }) => d.Address)).toEqual([correo]);
    expect(mensaje.Subject).toBe(`Carpeta informativa · Admisión ${CAMPANA}`);
    const enlace = (mensaje.Text as string).match(/^Agenda tu visita guiada: (\S+)$/m)?.[1] ?? "";
    const token = enlace.match(/\/visita-guiada\?t=(.+)$/)?.[1] ?? "";
    expect(enlace.startsWith(`${FRONTEND}/visita-guiada?t=`), "el enlace de P02 no apunta a FRONTEND_PUBLIC_URL/visita-guiada").toBe(true);
    expect(/^v1\.[A-Za-z0-9_-]{43}$/.test(token), "el token de P02 no tiene el formato v1. + base64url de 32 bytes").toBe(true);
    const cuerpo = (mensaje.Text as string).replaceAll(token, "<token>").replace(/\r\n/g, "\n").split("\n");
    expect(cuerpo).toContain("Hola, Nombre E2e:");
    expect(cuerpo).toContain(`Grado de interés: ${GRADO}`);
    expect(cuerpo).toContain(`Carpeta informativa: ${URL_CARPETA ?? SIN_ENLACE_CARPETA}`);
    expect(cuerpo).toContain(`Agenda tu visita guiada: ${FRONTEND}/visita-guiada?t=<token>`);

    // En la BD: una sola notificación, la carpeta enviada a menos de un minuto del registro, y el expediente en prospecto.
    const id = idExpediente(correo);
    const fila = consultarAdmision(
      `SELECT n.canal, n.tipo_evento, n.estado_envio, extract(epoch FROM n.fecha_envio - e.fecha_registro) BETWEEN 0 AND 60, e.estado
         FROM notificacion n JOIN expediente e ON e.id_expediente = n.id_expediente WHERE n.id_expediente = ${id}`,
    );
    expect(fila.split("\t")).toEqual(["correo", "carpeta_enviada", "enviado", "t", "prospecto"]);

    // Captura del correo en Mailpit con el token tapado (evidencia de HU0002-1.0).
    await page.goto(`${MAILPIT}/view/${ID}`);
    await expect(page.getByText("Agenda tu visita guiada:")).toBeVisible();
    await page.evaluate(() => {
      const patron = /(visita-guiada\?t=v1\.)([A-Za-z0-9_-]{4})[A-Za-z0-9_-]+/g;
      const recorrido = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      for (let n = recorrido.nextNode(); n; n = recorrido.nextNode()) n.nodeValue = n.nodeValue!.replace(patron, "$1$2…[token oculto]");
      for (const a of document.querySelectorAll('a[href*="visita-guiada"]')) a.setAttribute("href", "#");
    });
    const visible = await page.locator("body").innerText();
    expect(visible.includes(token), "el token de P02 sigue visible en la captura").toBe(false);
    expect(visible).toContain("…[token oculto]");
    await capturar(page, "correo-carpeta-mailpit");
  });

  test("HU0002-1.0 [parte: sin WhatsApp] con la casilla marcada y el canal desactivado, o sin marcarla, no hay fila de WhatsApp y el flujo termina bien", async ({ request }) => {
    test.setTimeout(120_000);
    // Precondición del nombre: el canal está desactivado en el n8n de dev (WHATSAPP_ENABLED, ADR-07 y R22).
    expect(docker(["exec", "-T", "n8n", "sh", "-c", 'echo "$WHATSAPP_ENABLED"']).trim()).not.toBe("true");
    const desde = haceUnInstante();
    const marcada = correoE2E();
    const sinMarcar = correoE2E();
    const ids = [await registrar(request, API, marcada, true), await registrar(request, API, sinMarcar, false)];

    // Las dos carpetas se envían por correo (WHATSAPP_ENABLED=false en dev).
    for (const id of ids) await expect.poll(() => estadoCarpeta(id), { timeout: 60_000, intervals: [1_000] }).toBe("enviado");

    for (const [id, autoriza] of [[ids[0]!, "t"], [ids[1]!, "f"]] as const) {
      expect(
        consultarAdmision(
          `SELECT c.autoriza_whatsapp FROM consentimiento c JOIN expediente e ON e.id_apoderado_titular = c.id_apoderado WHERE e.id_expediente = ${id}`,
        ),
      ).toBe(autoriza);
      // Una sola fila, la del correo: ninguna de WhatsApp (R22).
      expect(notificaciones(id).map(([canal, estado]) => `${canal} ${estado}`)).toEqual(["correo enviado"]);
      // El flujo terminó bien: ninguna ejecución de captacion terminó con error por este expediente.
      expect(ejecucionesConError("captacion", desde, `expediente ${id},`)).toEqual([]);
    }
    expect((await mensajesPara(request, marcada)).length).toBe(1);
    expect((await mensajesPara(request, sinMarcar)).length).toBe(1);
  });

  test("HU0002-2.0 [parte: rechazo síncrono] un correo rechazado por el servidor deja la notificación fallida, el rebote auditado y el prospecto en G04", async ({ page, request }) => {
    test.setTimeout(150_000);
    // Mailpit rechaza con 550 todo destinatario que no sea @ejemplo.test (MP_SMTP_ALLOWED_RECIPIENTS, ADR-07).
    const correo = correoE2E("rebota.ejemplo.test");
    await registrarEnP01(page, correo);
    const id = idExpediente(correo);

    await expect.poll(() => estadoExpediente(id), { timeout: 60_000, intervals: [1_000] }).toBe("contacto_no_entregado");
    expect(notificaciones(id).map(([canal, estado]) => `${canal} ${estado}`)).toEqual(["correo fallido"]);
    const rebote = consultarAdmision(
      `SELECT id_personal IS NULL, detalle->>'canal', detalle->>'origen', (detalle->>'id_notificacion')::int = ${notificaciones(id)[0]![2]}
         FROM registro_auditoria WHERE id_expediente = ${id} AND tipo_evento = 'notificacion_rebotada'`,
    );
    expect(rebote.split("\t")).toEqual(["t", "correo", "smtp_rechazo", "t"]);
    const transicion = consultarAdmision(
      `SELECT estado_anterior, estado_nuevo, id_personal IS NULL FROM registro_auditoria
        WHERE id_expediente = ${id} AND tipo_evento = 'transicion_estado'`,
    );
    expect(transicion.split("\t")).toEqual(["prospecto", "contacto_no_entregado", "t"]);
    expect((await mensajesPara(request, correo)).length, "Mailpit no debe guardar el correo rechazado").toBe(0);

    // La alerta al personal: G04 con la sesión de la secretaría.
    await entrarEnGestion(page, secretaria.username, CONTRASENA);
    await page.getByRole("link", { name: "Visitas guiadas" }).click();
    await expect(page).toHaveURL(`${FRONTEND}/gestion/visitas`);
    const fila = page.locator(`[data-testid="prospecto-${id}"]`);
    await expect(fila).toBeVisible();
    // La alerta: la instrucción del mockup, sin las acciones (C32).
    await expect(page.getByText("El correo con la carpeta informativa rebotó. Corrige los datos de contacto y reenvía la carpeta.")).toBeVisible();
    const celdas = fila.locator("td");
    await expect(celdas.nth(0)).toContainText("Nombre E2e Apellido Prueba");
    await expect(celdas.nth(0)).toContainText(`Interés: ${GRADO}`);
    await expect(celdas.nth(1)).toContainText(correo);
    await expect(celdas.nth(1)).toContainText("Contacto no entregado");
    await expect(celdas.nth(2)).toHaveText("987 654 321");
    await expect(celdas.nth(3)).toHaveText(hoyEnLima());
    const pendientes = Number(
      consultarAdmision(
        `SELECT count(*) FROM expediente e JOIN grado g ON g.id_grado = e.id_grado
          WHERE e.estado = 'contacto_no_entregado' AND g.campana_admision = '${CAMPANA}'`,
      ),
    );
    await expect(page.locator('[data-testid="insignia-pendientes"] .solo-lector')).toHaveText(
      `${pendientes} ${pendientes === 1 ? "prospecto pendiente" : "prospectos pendientes"}`,
    );
    // El puntero queda sobre «Visitas guiadas» tras el clic: se aleja para que la captura muestre la opción activa.
    await page.mouse.move(1430, 900);
    await capturar(page, "g04-contacto-no-entregado");
  });

  test("C27 el mismo evento dos veces envía una sola carpeta", async ({ request }) => {
    test.setTimeout(120_000);
    const correo = correoE2E();
    // Por el /api de Vite: cuenta en el contador de la IP del frontend (ver la cabecera).
    const id = await registrar(request, `${FRONTEND}/api`, correo);

    // La API ya envió el evento después del registro; llegan dos más a la vez, como un reintento y el barrido.
    const respuestas = await Promise.all([enviarEvento(request, { id_expediente: id }), enviarEvento(request, { id_expediente: id })]);
    expect(respuestas.map((r) => r.status())).toEqual([202, 202]);

    await expect.poll(() => estadoCarpeta(id), { timeout: 60_000, intervals: [1_000] }).toBe("enviado");
    // Margen para que terminen las otras ejecuciones: la reserva de la API (C27 b) responde 409 a las que llegan tarde.
    await new Promise((r) => setTimeout(r, 10_000));
    expect(notificaciones(id).map(([canal, estado]) => `${canal} ${estado}`)).toEqual(["correo enviado"]);
    expect((await mensajesPara(request, correo)).length).toBe(1);
  });

  test("C27 sin el secreto del webhook (o con uno incorrecto) captacion responde 403 y no procesa el evento", async ({ request }) => {
    const desde = haceUnInstante();
    // Sin X-Webhook-Secret válido no se envía ninguna credencial, así que no hace falta enviarEvento() (C15).
    for (const cabeceras of [{}, { "X-Webhook-Secret": "incorrecto" }]) {
      const res = await request.post(WEBHOOK_CAPTACION, { headers: cabeceras, data: { id_expediente: 999999 }, failOnStatusCode: false });
      expect(res.status()).toBe(403);
    }
    // Si el evento se procesara, la reserva de un expediente inexistente terminaría en «Detener: reserva fallida»
    // (HTTP 404) y quedaría una ejecución con error. Se da un margen para que esa ejecución, si existiera, termine.
    await new Promise((r) => setTimeout(r, 5_000));
    expect(ejecucionesConError("captacion", desde, "no se pudo reservar la carpeta (HTTP 404")).toEqual([]);
  });

  test("C2 un fallo de captacion queda en el log de la API solo con identificadores", async ({ request }) => {
    test.setTimeout(90_000);
    const desde = haceUnInstante();
    const res = await enviarEvento(request, { id_expediente: "no-es-un-id" });
    expect(res.status()).toBe(400);
    expect((await res.json()).error.codigo).toBe("VALIDACION");

    // registro-errores (C2) recibe el fallo de «Detener: evento inválido» y la API lo deja en su log.
    let ejecucion = 0;
    await expect
      .poll(() => (ejecucion = ejecucionesConError("captacion", desde, "el cuerpo debe ser solo").at(-1) ?? 0), { timeout: 60_000, intervals: [1_000] })
      .toBeGreaterThan(0);
    let linea = "";
    await expect
      .poll(() => (linea = logApi(desde).split("\n").find((l) => l.includes(`ejecución=${ejecucion})`)) ?? ""), { timeout: 60_000, intervals: [1_000] })
      .not.toBe("");
    expect(linea).toContain(`Fallo en n8n (flujo=captacion, nodo=Detener: evento inválido, ejecución=${ejecucion})`);
    // Solo identificadores: ni el mensaje del error ni el cuerpo del evento.
    expect(linea).not.toContain("el cuerpo debe ser solo");
    expect(linea).not.toContain("no-es-un-id");
  });

  test("C27 con n8n detenido al registrar, la carpeta llega cuando n8n vuelve, gracias al barrido", async ({ request }) => {
    test.setTimeout(360_000);
    const desde = haceUnInstante();
    const correo = correoE2E();
    let id = 0;
    try {
      docker(["stop", "n8n"]);
      id = await registrar(request, API, correo);
      // La API reintenta el evento (ADR-16) y lo deja en su log solo con el id; el registro queda igual.
      await expect
        .poll(() => logApi(desde).includes(`Evento captacion no entregado a n8n (id_expediente=${id},`), { timeout: 30_000, intervals: [1_000] })
        .toBe(true);
      expect(logApi(desde)).not.toContain(correo);
      expect(notificaciones(id)).toEqual([]);
    } finally {
      docker(["start", "n8n"]);
      await esperarListo(request, `${N8N}/healthz`, "n8n");
    }

    // El barrido de cada minuto (C27 a) encuentra el prospecto sin carpeta registrado hace más de 1 minuto.
    await expect.poll(() => estadoCarpeta(id), { timeout: 240_000, intervals: [2_000] }).toBe("enviado");
    expect(notificaciones(id).map(([canal, estado]) => `${canal} ${estado}`)).toEqual(["correo enviado"]);
    expect((await mensajesPara(request, correo)).length).toBe(1);
    expect(estadoExpediente(id)).toBe("prospecto");
  });

  test("C27 (P-a) con Mailpit detenido, la carpeta queda pendiente (no fallida, sin rebote ni transición) y se envía cuando el barrido la retoma", async ({ request }) => {
    test.setTimeout(360_000);
    const desde = haceUnInstante();
    const correo = correoE2E();
    let id = 0;
    let idNotificacion = 0;
    try {
      docker(["stop", "mailpit"]);
      exigirMailpitDetenido();
      id = await registrar(request, API, correo);
      // El error técnico de SMTP termina en «Detener: envío pospuesto» (D7), con el motivo y los ids en el mensaje.
      await expect
        .poll(() => ejecucionesConError("captacion", desde, `smtp_pendiente, expediente ${id},`).length, { timeout: 150_000, intervals: [2_000] })
        .toBeGreaterThan(0);
      const filas = notificaciones(id);
      expect(filas.map(([canal, estado]) => `${canal} ${estado}`)).toEqual(["correo pendiente"]);
      idNotificacion = Number(filas[0]![2]);
      expect(eventos(id, "notificacion_rebotada")).toBe(0);
      expect(eventos(id, "transicion_estado")).toBe(0);
      expect(estadoExpediente(id)).toBe("prospecto");
    } finally {
      docker(["start", "mailpit"]);
      await esperarListo(request, `${MAILPIT}/api/v1/messages?limit=1`, "Mailpit");
    }

    // ÚNICA ESCRITURA DEL E2E EN LA BASE DE DEV (A3, aprobada por John; C16). El barrido retoma una carpeta pendiente
    // cuyo último intento fue hace más de 10 minutos (D7). Para no esperar 10 minutos reales, se adelanta la hora del
    // intento SOLO de la notificación de esta prueba: la del correo único hu0002-e2e-<marca>, y solo si sigue pendiente.
    // Va después de que Mailpit está listo: si el barrido la retomara antes, volvería a fallar y quedaría pendiente
    // otros 10 minutos (revisión de guardian-alcance).
    const adelantada = consultarAdmision(
      `UPDATE notificacion SET fecha_envio = now() - interval '11 minutes'
        WHERE id_notificacion = ${idNotificacion} AND estado_envio = 'pendiente' RETURNING id_notificacion`,
    );
    expect(adelantada.split("\n")[0]).toBe(String(idNotificacion));

    // El barrido la retoma con el mismo id_notificacion y esta vez el correo sale.
    await expect.poll(() => estadoCarpeta(id), { timeout: 180_000, intervals: [2_000] }).toBe("enviado");
    expect(notificaciones(id)).toEqual([["correo", "enviado", String(idNotificacion)]]);
    expect((await mensajesPara(request, correo)).length).toBe(1);
    expect(eventos(id, "notificacion_rebotada")).toBe(0);
    expect(estadoExpediente(id)).toBe("prospecto");
  });
});
