// HU0003 + HU0004 · visita guiada contra el entorno dev: carpeta → P02 → agendamiento (confirmación) →
// seguimiento-recordatorios (recordatorio) → G04 → credenciales → primer ingreso al portal, y la inasistencia con la
// invitación a reprogramar. Requiere lo mismo que e2e/captacion.spec.ts (seed, usuarios de prueba, credenciales e
// importación de los flujos). Los secretos y la contraseña temporal nunca se imprimen.
// - Datos (C16): cada corrida deja en dev 3 prospectos hu0003-e2e-*, sus citas, 4 horarios de visita de la directora de
//   prueba (con citas: no se pueden quitar) y 2 cuentas de familia en Keycloak y en cuenta_acceso. La de la ruta de
//   errores recibe sus credenciales más tarde, cuando el barrido retoma el aviso (10 min).
// - Límite por IP (ADR-17): registra 3 prospectos por la IP del host y hace 4 reservas de P02 por la del frontend.
// - Detiene y arranca Mailpit en un finally (ruta de errores de D3), sin borrar volúmenes.
// - Capturas: test-results/HU0003-HU0004/capturas-e2e/ (ignorada por git); las de la corrida final se copian a
//   docs/evidencias/HU0003/ y docs/evidencias/HU0004/. Ninguna muestra el token de P02 ni la contraseña.
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test, type APIRequestContext, type Browser, type Page } from "@playwright/test";
import { API, contrasenaE2E, entrarEnGestion, FRONTEND, iniciarSesion, llamarApi, MAILPIT } from "./ayudantes";

const RAIZ = resolve(import.meta.dirname, "..");
const CAPTURAS = resolve(RAIZ, "test-results/HU0003-HU0004/capturas-e2e");
const COMPOSE = ["compose", "-f", "docker-compose.yml", "-f", "docker-compose.dev.yml"];
const N8N = `http://127.0.0.1:${process.env.N8N_HOST_PORT || 5679}`;
const SECRETO = process.env.N8N_WEBHOOK_SECRET!;
const CONTRASENA = process.env.KEYCLOAK_TEST_USER_PASSWORD!;
const CAMPANA = process.env.CAMPANA_ACTIVA!;
const GRADO = "3.° de primaria";
const ETIQUETA_CONTRASENA = "Contraseña temporal";

const usuarios: { username: string; rol: string }[] = JSON.parse(readFileSync(resolve(RAIZ, "infra/keycloak/usuarios-prueba.json"), "utf8"));
const secretaria = usuarios.find((u) => u.rol === "secretaria")!;

const correoE2E = () => `hu0003-e2e-${Date.now()}-${randomBytes(2).toString("hex")}@ejemplo.test`;

function docker(args: string[]): string {
  return execFileSync("docker", [...COMPOSE, ...args], { cwd: RAIZ, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 1 << 28 });
}
function consultar(usuario: string, base: string, sql: string): string {
  return docker(["exec", "-T", "postgres", "psql", "-U", usuario, "-d", base, "-tA", "-F", "\t", "-c", sql]).trim();
}
const consultarAdmision = (sql: string) => consultar("api_admision", "admision", sql);
const consultarN8n = (sql: string) => consultar("n8n", "n8n", sql);
const haceUnInstante = () => consultarAdmision("SELECT floor(extract(epoch FROM now())) - 5");
const logApi = (desde: string) => docker(["logs", "--no-color", "--since", desde, "api"]);

function idExpediente(correo: string): number {
  const id = consultarAdmision(`SELECT e.id_expediente FROM expediente e JOIN apoderado a ON a.id_apoderado = e.id_apoderado_titular WHERE a.correo = '${correo}'`);
  expect(id, `no se registró el prospecto ${correo}`).toMatch(/^\d+$/);
  return Number(id);
}
const ultimaCita = (id: number) => Number(consultarAdmision(`SELECT max(id_cita) FROM cita WHERE id_expediente = ${id}`));
const estadoExpediente = (id: number) => consultarAdmision(`SELECT estado FROM expediente WHERE id_expediente = ${id}`);
// Filas «tipo_evento estado_envio» de las notificaciones del expediente, en orden.
const avisos = (id: number) =>
  consultarAdmision(`SELECT tipo_evento || ' ' || estado_envio FROM notificacion WHERE id_expediente = ${id} ORDER BY id_notificacion`).split("\n").filter(Boolean);

interface Mensaje {
  ID: string;
  Subject: string;
}
async function mensajesPara(request: APIRequestContext, correo: string): Promise<Mensaje[]> {
  return (await (await request.get(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:"${correo}"`)}`)).json()).messages ?? [];
}
// Espera el correo con ese asunto y devuelve su texto (sin imprimirlo).
async function esperarCorreo(request: APIRequestContext, correo: string, asunto: string, timeout = 90_000): Promise<{ id: string; texto: string }> {
  let id = "";
  await expect
    .poll(async () => (id = (await mensajesPara(request, correo)).find((m) => m.Subject === asunto)?.ID ?? ""), { message: `no llegó «${asunto}»`, timeout, intervals: [1_000] })
    .not.toBe("");
  const texto = String((await (await request.get(`${MAILPIT}/api/v1/message/${id}`)).json()).Text ?? "").replace(/\r\n/g, "\n");
  return { id, texto };
}
const cuantosCon = async (request: APIRequestContext, correo: string, asunto: string) => (await mensajesPara(request, correo)).filter((m) => m.Subject === asunto).length;

let idGrado: number | null = null;
async function registrar(request: APIRequestContext, correo: string): Promise<number> {
  if (idGrado === null) {
    const formulario = await (await request.get(`${API}/publico/solicitud-informacion`)).json();
    idGrado = formulario.grados.find((g: { nombre_grado: string }) => g.nombre_grado === GRADO)?.id_grado ?? null;
    expect(idGrado, `falta el grado ${GRADO}: ejecuta npm run db:seed`).not.toBeNull();
  }
  const res = await request.post(`${API}/publico/solicitud-informacion`, {
    data: { nombres: "María Fernanda", apellidos: "Quispe E2e", telefono: "987 654 321", correo, id_grado: idGrado, acepta_politica: true },
    failOnStatusCode: false,
  });
  expect(res.status(), "un 429 es el límite por IP de P01 (ADR-17)").toBe(201);
  return idExpediente(correo);
}

// El enlace de P02 del correo de la carpeta (HU0002). No se imprime: lleva el token (ADR-18).
async function enlaceDeLaCarpeta(request: APIRequestContext, correo: string): Promise<string> {
  const { texto } = await esperarCorreo(request, correo, `Carpeta informativa · Admisión ${CAMPANA}`);
  const enlace = texto.match(/^Agenda tu visita guiada: (\S+)$/m)?.[1] ?? "";
  expect(enlace.startsWith(`${FRONTEND}/visita-guiada?t=v1.`), "el correo de la carpeta no trae el enlace de P02").toBe(true);
  return enlace;
}
const tokenDe = (enlace: string) => new URL(enlace).searchParams.get("t")!;

// Un horario de visita libre de una directora activa, creado por G09 (HU0022). Prueba horarios de 5 min con paso de 5 min
// desde `desdeHoras` + 1 h (hora redondeada hacia abajo) hasta 23 h 30 min desde ahora, para que la reserva caiga dentro de la
// ventana del recordatorio de 24 h (D4): unos 250 posibles. Cada intento choca (409 HORARIO_SUPERPUESTO) con los horarios que
// dejaron otras corridas, porque no se pueden quitar (tienen citas). Una sola consulta calcula todos los intentos.
async function horarioLibre(request: APIRequestContext, token: string, desdeHoras: number) {
  const responsables = (await (await llamarApi(request, "get", "/configuracion/responsables", token)).json()) as { id_personal: number; rol: string }[];
  const directora = responsables.find((r) => r.rol === "directora");
  expect(directora, "no hay una directora activa: ejecuta npm run db:seed").toBeTruthy();
  const inicioVentana = `(date_trunc('hour', now() AT TIME ZONE 'America/Lima') + interval '${desdeHoras + 1} hours')`;
  const finVentana = `(now() AT TIME ZONE 'America/Lima' + interval '23 hours 30 minutes')`;
  const intentos = consultarAdmision(
    `SELECT to_char(t, 'YYYY-MM-DD'), to_char(t, 'HH24:MI') FROM generate_series(${inicioVentana}, ${finVentana}, interval '5 minutes') t
      WHERE t::time < time '23:55' ORDER BY t`,
  )
    .split("\n")
    .map((linea) => linea.split("\t") as [string, string]);
  for (const [fecha, inicio] of intentos) {
    const [h, m] = inicio.split(":").map(Number) as [number, number];
    const fin = `${String(h + Math.floor((m + 5) / 60)).padStart(2, "0")}:${String((m + 5) % 60).padStart(2, "0")}`;
    const res = await llamarApi(request, "post", "/configuracion/horarios", token, {
      id_personal: directora!.id_personal, tipo_cita: "visita", fecha, hora_inicio: inicio, hora_fin: fin, cupos: 1,
    });
    if (res.status() === 201) return { ...((await res.json()) as { id_horario: number }), fecha, inicio };
    expect(res.status(), await res.text()).toBe(409);
  }
  const ocupados = consultarAdmision(
    `SELECT count(*) FROM horario_disponible WHERE id_personal = ${directora!.id_personal} AND tipo_cita = 'visita'
       AND (fecha + hora_inicio) >= ${inicioVentana} AND (fecha + hora_inicio) <= ${finVentana}`,
  );
  throw new Error(`no se encontró un horario libre para la directora: ${ocupados} horarios suyos en la ventana (${intentos.length} intentos de 5 min)`);
}


const MESES = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];

// Reserva en P02 desde el navegador: navega al mes del horario, elige el día y el horario y confirma.
async function reservarEnP02(page: Page, enlace: string, horario: { id_horario: number; fecha: string }, asistentes: string, captura?: string) {
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.goto(enlace).catch(() => {
    throw new Error("No se pudo abrir el enlace de P02"); // el mensaje de Playwright traería la URL con el token
  });
  const [anio, mes] = horario.fecha.split("-").map(Number) as [number, number];
  const objetivo = `${MESES[mes - 1]} ${anio}`;
  await expect(page.getByTestId("mes")).toBeVisible();
  for (let i = 0; i < 3 && (await page.getByTestId("mes").innerText()) !== objetivo; i++) await page.getByRole("button", { name: "Mes siguiente" }).click();
  await expect(page.getByTestId("mes")).toHaveText(objetivo);
  await page.locator(`button.dia[data-fecha="${horario.fecha}"]`).click();
  await page.getByTestId(`horario-${horario.id_horario}`).click();
  await page.locator("#p02as").fill(asistentes);
  if (captura) await capturar(page, captura);
  const respuesta = page.waitForResponse((r) => r.request().method() === "POST" && r.url().endsWith("/publico/visita-guiada/reserva"));
  await page.getByRole("button", { name: "Confirmar visita" }).click();
  expect((await respuesta).status()).toBe(201);
  await expect(page.getByTestId("visita-reservada")).toBeVisible();
}

async function capturar(page: Page, nombre: string, ocultos: string[] = []) {
  const visible = await page.locator("body").innerText();
  for (const marca of ["eyJ", "Bearer", "access_token", "action-token", "key="]) expect(visible.includes(marca), `la captura ${nombre} muestra «${marca}»`).toBe(false);
  for (const secreto of [SECRETO, CONTRASENA, ...ocultos]) expect(visible.includes(secreto), `la captura ${nombre} muestra un secreto`).toBe(false);
  expect(/t=v1\.[A-Za-z0-9_-]{8,}/.test(visible), `la captura ${nombre} muestra un token de P02`).toBe(false);
  const correos = visible.match(/[^\s<>]+@[^\s<>]+/g) ?? [];
  expect(correos.filter((c) => !/@(rebota\.)?ejemplo\.test$/.test(c)), `la captura ${nombre} muestra correos no ficticios`).toEqual([]);
  mkdirSync(CAPTURAS, { recursive: true });
  await page.screenshot({ path: resolve(CAPTURAS, `${nombre}.png`), fullPage: true });
}

// Tras detener Mailpit, comprueba que de verdad no corre (C27 P-a falló una vez con la carpeta enviada aunque Mailpit debía
// estar detenido; causa no probada, C16). Si sigue arriba falla con ese mensaje y la hora, en vez de agotar un timeout.
function exigirMailpitDetenido() {
  const corriendo = docker(["ps", "-q", "--status", "running", "mailpit"]).trim();
  expect(corriendo, `Mailpit sigue en ejecución después de detenerlo (${new Date().toISOString()}): no se puede probar el escenario de SMTP caído`).toBe("");
}

// Busca un valor en la base n8n (execution_data) cada 3 s hasta que no aparezca, con un tope de 3 min: una ejecución
// que no se guarda queda legible hasta el siguiente ciclo de borrado físico (R1, ≤ 1 min con la configuración de
// docker-compose.yml). `excluirR2` deja fuera las ejecuciones con error de notificacion-multicanal (R2 aceptado).
// `desde` (segundos desde la época, como haceUnInstante) limita la búsqueda a las ejecuciones de esta corrida: al buscar por
// una etiqueta y no por el valor, una ejecución de una corrida anterior (p. ej. una cancelada por la suspensión del equipo,
// R4) la haría coincidir para siempre. No excluye ningún estado: una ejecución cancelada de esta corrida también cuenta.
async function esperarQueNoAparezcaEnN8n(valor: string, excluirR2: boolean, desde?: string) {
  const condiciones = [
    ...(excluirR2 ? [`NOT (w.name = 'notificacion-multicanal' AND e.status = 'error')`] : []),
    ...(desde ? [`e."startedAt" >= to_timestamp(${desde})`] : []),
  ];
  const filtro = condiciones.length ? `WHERE ${condiciones.join(" AND ")}` : "";
  const aparece = () =>
    consultarN8n(
      `SELECT coalesce(string_agg(d."workflowData"::text || d.data, ' '), '') FROM execution_data d
         JOIN execution_entity e ON e.id = d."executionId" JOIN workflow_entity w ON w.id = e."workflowId" ${filtro}`,
    ).includes(valor);
  await expect.poll(aparece, { message: "el valor sigue en las ejecuciones de n8n después de 3 min", timeout: 180_000, intervals: [3_000] }).toBe(false);
}

async function tokenSecretaria(browser: Browser): Promise<string> {
  const token = await iniciarSesion(browser, secretaria.username, CONTRASENA);
  expect(token, "la secretaria de prueba no pudo iniciar sesión").toBeTruthy();
  return token!;
}

// Estado compartido entre las pruebas en serie del camino principal.
const principal = { correo: "", id: 0, idCita: 0, fecha: "", contrasena: "", desde: "" };

test.describe.serial("HU0003 + HU0004 visita guiada (camino principal)", () => {
  test("HU0003-1.0 desde el enlace del correo de la carpeta, la familia reserva en P02 y recibe la confirmación y un solo recordatorio", async ({ page, request, browser }) => {
    test.setTimeout(420_000);
    principal.desde = haceUnInstante();
    principal.correo = correoE2E();
    principal.id = await registrar(request, principal.correo);
    const enlace = await enlaceDeLaCarpeta(request, principal.correo);
    // Dentro de las próximas 24 h: el recordatorio (D4) toca enseguida.
    const horario = await horarioLibre(request, await tokenSecretaria(browser), 1);
    principal.fecha = horario.fecha;

    await reservarEnP02(page, enlace, horario, "María Fernanda Quispe E2e, José Luis Quispe Huamán", "p02-agenda-visita");
    await capturar(page, "p02-visita-reservada");

    principal.idCita = ultimaCita(principal.id);
    expect(estadoExpediente(principal.id)).toBe("visita_agendada");
    const { texto } = await esperarCorreo(request, principal.correo, `Visita guiada confirmada · Admisión ${CAMPANA}`, 60_000);
    const lineas = texto.split("\n");
    expect(lineas).toContain("Hola, María Fernanda:");
    expect(lineas).toContain("Asistentes: María Fernanda Quispe E2e, José Luis Quispe Huamán");
    expect(lineas.some((l) => /^Fecha: \S+ \d+ de \S+ de \d{4}$/.test(l))).toBe(true);
    expect(lineas.some((l) => /^Hora: \d{1,2}:\d{2} [ap]\. m\.$/.test(l))).toBe(true);
    expect(lineas.some((l) => l.startsWith("Lugar: "))).toBe(true);

    const asuntoRecordatorio = `Recordatorio de tu visita guiada · Admisión ${CAMPANA}`;
    await esperarCorreo(request, principal.correo, asuntoRecordatorio, 150_000);
    await expect.poll(() => avisos(principal.id).filter((a) => a.startsWith("recordatorio_visita")), { timeout: 60_000 }).toEqual(["recordatorio_visita enviado"]);
    // Nunca dos: el aviso ya está cerrado y, durante dos ciclos del barrido (cada minuto), no llega otro.
    const hasta = Date.now() + 130_000;
    while (Date.now() < hasta) {
      expect(await cuantosCon(request, principal.correo, asuntoRecordatorio), "llegó un segundo recordatorio").toBe(1);
      await page.waitForTimeout(5_000);
    }
    // El barrido del recordatorio corre cada minuto: puede registrarse antes o después de la confirmación.
    expect([...avisos(principal.id)].sort()).toEqual(["carpeta_enviada enviado", "recordatorio_visita enviado", "visita_confirmada enviado"]);
  });

  test("HU0004-1.0 la secretaria registra «Asistió - Interesado» en G04 y llegan al correo de la familia el usuario, la contraseña temporal y el enlace al portal", async ({ page, request }) => {
    test.setTimeout(240_000);
    await page.setViewportSize({ width: 1440, height: 1080 });
    await entrarEnGestion(page, secretaria.username, CONTRASENA);
    await page.goto(`${FRONTEND}/gestion/visitas?fecha=${principal.fecha}`);
    const fila = page.getByTestId(`visita-${principal.idCita}`);
    await expect(fila).toContainText("Por registrar");
    await fila.getByRole("button", { name: "Asistió", exact: true }).click(); // sin exact también encuentra «No asistió»
    await expect(page.getByTestId("registrar-visita")).toContainText("¿La familia desea postular?");
    await capturar(page, "g04-registrar-visita");

    await page.getByRole("button", { name: "Registrar y habilitar portal" }).click();
    await expect(fila).toContainText("Portal habilitado");
    await capturar(page, "g04-portal-habilitado");
    expect(estadoExpediente(principal.id)).toBe("portal_habilitado");
    expect(consultarAdmision(`SELECT count(*) FROM cuenta_acceso ca JOIN expediente e ON e.id_apoderado_titular = ca.id_apoderado WHERE e.id_expediente = ${principal.id}`)).toBe("1");

    const { texto } = await esperarCorreo(request, principal.correo, `Acceso al portal de postulación · Admisión ${CAMPANA}`);
    const lineas = texto.split("\n");
    expect(lineas).toContain(`Portal de postulación: ${FRONTEND}/portal`);
    expect(lineas).toContain(`Usuario: ${principal.correo}`);
    expect(lineas).toContain("Si recibes más de un correo, usa el más reciente.");
    principal.contrasena = texto.match(new RegExp(`^${ETIQUETA_CONTRASENA}: (\\S+)$`, "m"))?.[1] ?? "";
    expect(principal.contrasena, "el correo no trae la contraseña temporal").toHaveLength(16);
    expect(principal.contrasena).not.toMatch(/[0O1lI]/);
    await expect.poll(() => avisos(principal.id).at(-1)).toBe("credenciales_portal enviado");
  });

  test("D3 primer ingreso: con la contraseña temporal del correo, Keycloak exige cambiarla y la familia llega a /portal con el rol familia", async ({ browser }) => {
    test.setTimeout(120_000);
    const contexto = await browser.newContext();
    const page = await contexto.newPage();
    try {
      await page.goto(`${FRONTEND}/portal`);
      await page.locator("#username").fill(principal.correo);
      await page.locator("#password").fill(principal.contrasena);
      await page.locator("#kc-login").click();
      // UPDATE_PASSWORD: Keycloak pide la contraseña nueva antes de volver al portal (tema por defecto, D3).
      const nueva = contrasenaE2E();
      await page.locator("#password-new").fill(nueva);
      await page.locator("#password-confirm").fill(nueva);
      await page.locator("form [type='submit']").first().click();
      // D7-A: la familia entra por P04, que solo se abre con el rol familia.
      await expect(page).toHaveURL(`${FRONTEND}/portal/panel`);
      await expect(page.getByTestId("etapa-ficha")).toBeVisible();
      await capturar(page, "portal-primer-ingreso", [principal.contrasena, nueva]);
    } finally {
      await contexto.close();
    }
  });

  test("D3 la contraseña temporal no aparece en notificacion, registro_auditoria, los logs de la API ni la base n8n", async () => {
    test.setTimeout(240_000);
    const valor = principal.contrasena;
    expect(valor).toHaveLength(16);
    const tabla = (t: string) => consultarAdmision(`SELECT coalesce(string_agg(row_to_json(x)::text, ' '), '') FROM ${t} x`);
    expect(tabla("notificacion").includes(valor), "la contraseña temporal aparece en notificacion").toBe(false);
    expect(tabla("registro_auditoria").includes(valor), "la contraseña temporal aparece en registro_auditoria").toBe(false);
    expect(logApi(principal.desde).includes(valor), "la contraseña temporal aparece en el log de la API").toBe(false);
    // Base n8n: se consulta hasta que la fila de la ejecución no guardada desaparezca (R1), y después el volcado completo.
    await esperarQueNoAparezcaEnN8n(valor, false);
    const volcado = docker(["exec", "-T", "postgres", "pg_dump", "-U", "n8n", "-d", "n8n", "--data-only"]);
    expect(volcado.includes(valor), "la contraseña temporal aparece en texto plano en la base n8n").toBe(false);
  });
});

test.describe("HU0004-2.0 inasistencia y reprogramación", () => {
  test("HU0004-2.0 «No asistió» en G04 envía la invitación con un enlace nuevo de P02 que vuelve a reservar", async ({ page, request, browser }) => {
    test.setTimeout(300_000);
    const correo = correoE2E();
    const id = await registrar(request, correo);
    const token = tokenDe(await enlaceDeLaCarpeta(request, correo));
    const secretariaToken = await tokenSecretaria(browser);
    const primero = await horarioLibre(request, secretariaToken, 3);
    const reserva = await request.post(`${FRONTEND}/api/publico/visita-guiada/reserva`, {
      headers: { "X-Enlace-Visita": token },
      data: { id_horario: primero.id_horario, asistentes: "Elena Castro E2e" },
      failOnStatusCode: false,
    });
    expect(reserva.status()).toBe(201);
    const idCita = ultimaCita(id);

    await page.setViewportSize({ width: 1440, height: 1080 });
    await entrarEnGestion(page, secretaria.username, CONTRASENA);
    await page.goto(`${FRONTEND}/gestion/visitas?fecha=${primero.fecha}`);
    const fila = page.getByTestId(`visita-${idCita}`);
    // Se espera la respuesta de la API antes de leer la BD, y el texto se busca en la etiqueta de estado de la fila: el
    // botón «No asistió» ya está en la fila, así que mirar la fila entera pasaría sin que se hubiera registrado nada.
    const registro = page.waitForResponse((r) => r.request().method() === "POST" && r.url().endsWith(`/visitas/${idCita}/asistencia`));
    await fila.getByRole("button", { name: "No asistió" }).click();
    expect((await registro).status()).toBe(200);
    await expect(fila.locator("span.chip-observado")).toHaveText("No asistió");
    expect(estadoExpediente(id)).toBe("prospecto");

    const { texto } = await esperarCorreo(request, correo, `Reprograma tu visita guiada · Admisión ${CAMPANA}`);
    const enlace = texto.match(/agenda una nueva visita: (\S+)$/m)?.[1] ?? "";
    expect(enlace.startsWith(`${FRONTEND}/visita-guiada?t=v1.`), "la invitación no trae un enlace de P02").toBe(true);
    expect(tokenDe(enlace), "el enlace de la invitación debe ser nuevo").not.toBe(token);
    await page.reload();
    await expect(fila).toContainText("Invitación a reprogramar enviada");
    await capturar(page, "g04-invitacion-reprogramar");

    const segundo = await horarioLibre(request, secretariaToken, 5);
    await reservarEnP02(page, enlace, segundo, "Elena Castro E2e");
    expect(estadoExpediente(id)).toBe("visita_agendada");
    expect(ultimaCita(id)).not.toBe(idCita);
  });
});

test.describe("D3 ruta de errores y C11", () => {
  test("D3 con el envío de credenciales fallido (Mailpit detenido después de «Reservar aviso»), la contraseña no aparece en lo que registra /internal/errores-flujo ni en las ejecuciones de registro-errores, y agendamiento no guarda la ejecución", async ({ request, browser }) => {
    test.setTimeout(720_000);
    const correo = correoE2E();
    const id = await registrar(request, correo);
    const token = tokenDe(await enlaceDeLaCarpeta(request, correo));
    const secretariaToken = await tokenSecretaria(browser);
    const horario = await horarioLibre(request, secretariaToken, 7);
    const reserva = await request.post(`${FRONTEND}/api/publico/visita-guiada/reserva`, {
      headers: { "X-Enlace-Visita": token },
      data: { id_horario: horario.id_horario, asistentes: "Ricardo Núñez E2e" },
      failOnStatusCode: false,
    });
    expect(reserva.status()).toBe(201);
    const idCita = ultimaCita(id);
    // La confirmación sale antes de detener Mailpit.
    await expect.poll(() => avisos(id).includes("visita_confirmada enviado"), { timeout: 90_000, intervals: [1_000] }).toBe(true);

    const desde = haceUnInstante();
    docker(["stop", "mailpit"]);
    try {
      exigirMailpitDetenido();
      const res = await llamarApi(request, "post", `/visitas/${idCita}/asistencia`, secretariaToken, { resultado: "asistio_interesado" });
      expect(res.status()).toBe(200);

      // notificacion-multicanal no llega al SMTP (error técnico: el intento queda pendiente) y agendamiento termina en
      // «Detener: envío pospuesto», que registro-errores informa a /internal/errores-flujo solo con identificadores.
      let linea = "";
      await expect
        .poll(() => (linea = logApi(desde).split("\n").find((l) => l.includes("Fallo en n8n (flujo=agendamiento")) ?? ""), { timeout: 240_000, intervals: [2_000] })
        .not.toBe("");
      expect(linea.replace(/^.*?\| /, "")).toMatch(/^Fallo en n8n \(flujo=agendamiento, nodo=Detener: envío pospuesto, ejecución=\d+\)$/);
      expect(avisos(id).at(-1)).toBe("credenciales_portal pendiente");

      // La contraseña de este intento nunca llegó a un lugar observable (por eso se busca por su etiqueta): no está en el
      // log de la API ni, pasada la ventana de R1, en ninguna ejecución de n8n salvo las de error de notificacion-multicanal (R2).
      expect(logApi(desde).includes(ETIQUETA_CONTRASENA), "el log de la API trae el cuerpo de las credenciales").toBe(false);
      await esperarQueNoAparezcaEnN8n(ETIQUETA_CONTRASENA, true, desde);
      // M1: agendamiento no guarda ninguna ejecución, tampoco la de error.
      expect(
        consultarN8n(`SELECT count(*) FROM execution_entity e JOIN workflow_entity w ON w.id = e."workflowId"
                       WHERE w.name = 'agendamiento' AND e."deletedAt" IS NULL AND e."startedAt" >= to_timestamp(${desde})`),
      ).toBe("0");
    } finally {
      docker(["start", "mailpit"]);
      await expect
        .poll(async () => (await request.get(`${MAILPIT}/api/v1/messages?limit=1`, { failOnStatusCode: false }).catch(() => null))?.status(), {
          message: "Mailpit no volvió a responder",
          timeout: 120_000,
          intervals: [2_000],
        })
        .toBe(200);
    }
  });

  test("C11 el webhook agendamiento rechaza una llamada sin el secreto o con uno incorrecto", async ({ request }) => {
    const sinSecreto = await request.post(`${N8N}/webhook/agendamiento`, { data: { id_cita: 1 }, failOnStatusCode: false });
    expect(sinSecreto.status()).toBe(403);
    const otro = await request.post(`${N8N}/webhook/agendamiento`, { headers: { "X-Webhook-Secret": "no-es-el-secreto" }, data: { id_cita: 1 }, failOnStatusCode: false });
    expect(otro.status()).toBe(403);
  });
});
