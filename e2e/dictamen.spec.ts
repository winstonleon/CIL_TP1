// HU0010 y HU0025 · resultados de las evaluaciones y dictamen de admisión (G06 y G11) contra el entorno dev (API, n8n,
// Keycloak, Mailpit). Dos caminos completos: en_evaluacion → resultados → dictamen Apto, y lo mismo con No apto y su correo.
// - Horarios y paso del tiempo (S3, decisión de John): los turnos se crean por la ruta real de G09 con la secretaria de
//   prueba, empiezan en 1 o 2 minutos y la prueba ESPERA a que empiecen. No se escribe en la BD para adelantar el reloj.
// - Precondición «las tres validaciones conformes» (B1): como en e2e/evaluaciones.spec.ts (C16), el expediente en
//   en_validacion con las ramas y el derecho conformes se escribe en la base de dev; ese camino ya lo prueba
//   e2e/validaciones.spec.ts. Desde ahí todo es real: la familia agenda en P08 y el personal registra en G11 y G06.
// - Datos ficticios `hu0010-e2e-*@ejemplo.test` y el personal de prueba de infra/keycloak/usuarios-prueba.json. Al terminar
//   se quitan los resultados, las citas, los turnos y el usuario de Keycloak.
// - Capturas: test-results/HU0010-HU0025/capturas-e2e/ (ignorada por git).
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test, type APIRequestContext, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { admin, contrasenaE2E, entrarEnGestion, FRONTEND, iniciarSesion, llamarApi, MAILPIT } from "./ayudantes";

const RAIZ = resolve(import.meta.dirname, "..");
const CAPTURAS = resolve(RAIZ, "test-results/HU0010-HU0025/capturas-e2e");
const COMPOSE = ["compose", "-f", "docker-compose.yml", "-f", "docker-compose.dev.yml"];
const CAMPANA = process.env.CAMPANA_ACTIVA!;
const CONTRASENA = process.env.KEYCLOAK_TEST_USER_PASSWORD!;
const GRADO_SQL = `g.nombre_grado LIKE '3.%de primaria' AND g.campana_admision = '${CAMPANA}'`;
const SECRETARIA = "secretaria.prueba@ejemplo.test";
const PSICOLOGA = "psicologa.prueba@ejemplo.test";
const EVALUADOR = "evaluador.prueba@ejemplo.test";
const MINUTO = 60_000;

const docker = (args: string[]) => execFileSync("docker", [...COMPOSE, ...args], { cwd: RAIZ, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 1 << 28 });
const consultarAdmision = (sql: string) => docker(["exec", "-T", "postgres", "psql", "-U", "api_admision", "-d", "admision", "-tA", "-F", "\t", "-c", sql]).trim();

async function capturar(page: Page, nombre: string) {
  mkdirSync(CAPTURAS, { recursive: true });
  await page.screenshot({ path: resolve(CAPTURAS, `${nombre}.png`), fullPage: true });
}

// Correo de Mailpit para `correo` con el asunto dado; devuelve su texto (sin imprimirlo).
async function esperarCorreo(request: APIRequestContext, correo: string, asunto: string, timeout = 150_000): Promise<string> {
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

// Fecha y hora de un instante en Lima.
function enLima(instante: number): { fecha: string; hora: string } {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", { timeZone: "America/Lima", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
      .formatToParts(new Date(instante))
      .map((x) => [x.type, x.value]),
  );
  return { fecha: `${p.year}-${p.month}-${p.day}`, hora: `${p.hour}:${p.minute}` };
}

interface Familia {
  correo: string;
  contrasena: string;
  idKeycloak: string;
  idExpediente: number;
  contexto: BrowserContext;
  page: Page;
}
const familias: Familia[] = [];
const horarios: number[] = [];

// Familia con su cuenta y su expediente listo para agendar (precondición C16), ya dentro de P08.
async function familiaEnP08(browser: Browser): Promise<Familia> {
  const correo = `hu0010-e2e-${Date.now()}-${randomBytes(2).toString("hex")}@ejemplo.test`;
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
     INSERT INTO expediente (id_apoderado_titular, id_grado, estado, estado_documental, estado_financiero)
     SELECT a.id_apoderado, g.id_grado, 'en_validacion', 'conforme', 'conforme' FROM a, grado g WHERE ${GRADO_SQL}
     RETURNING id_expediente`,
  ).split("\n")[0]!;
  expect(id, "no se creó el expediente: ¿existe el grado «3.° de primaria» de la campaña activa (npm run db:seed)?").toMatch(/^\d+$/);
  consultarAdmision(
    `INSERT INTO pago (id_expediente, tipo_pago, numero_fraccion, numero_operacion, banco, monto, fecha_pago, comprobante_url, estado_validacion)
     VALUES (${id}, 'derecho_admision', 1, 'E2E${Date.now()}${randomBytes(2).toString("hex")}', '[Banco 1]', 300, '2026-10-10', 'e2e-sin-archivo', 'conforme')`,
  );

  const contexto = await browser.newContext();
  const page = await contexto.newPage();
  const familia = { correo, contrasena, idKeycloak, idExpediente: Number(id), contexto, page };
  familias.push(familia);
  await page.goto(`${FRONTEND}/portal/evaluaciones`);
  await page.locator("#username").fill(correo);
  await page.locator("#password").fill(contrasena);
  await page.locator("#kc-login").click();
  await expect(page.getByRole("heading", { name: "Agenda tus evaluaciones" })).toBeVisible();
  return familia;
}

interface Turno {
  id: number;
  fecha: string;
  inicio: number; // instante en que empieza (ms)
}

// S3: turnos por la ruta real de G09 que empiezan en 1 o 2 minutos. La académica y la psicológica duran un minuto, y la
// entrevista empieza cuando terminan (decisión O: «al final»).
async function crearTurnos(request: APIRequestContext, tokenSecretaria: string): Promise<Record<"evaluacion_academica" | "evaluacion_psicologica" | "entrevista_padres", Turno>> {
  const inicio = Math.ceil(Date.now() / MINUTO) * MINUTO + MINUTO;
  const fin = inicio + 2 * MINUTO;
  const dia = enLima(inicio).fecha;
  expect(enLima(fin).fecha, "la corrida cruza la medianoche de Lima: los turnos no caen en un mismo día; vuelve a correrla después de las 00:00").toBe(dia);
  const idPersonal = (correo: string) => {
    const id = consultarAdmision(`SELECT id_personal FROM personal WHERE correo = '${correo}' AND activo`);
    expect(id, `falta el personal de prueba ${correo}: ejecuta npm run kc:usuarios-prueba y npm run db:seed`).toMatch(/^\d+$/);
    return Number(id);
  };
  const crear = async (correo: string, tipo_cita: string, desde: number, hasta: number): Promise<Turno> => {
    const res = await llamarApi(request, "post", "/configuracion/horarios", tokenSecretaria, {
      id_personal: idPersonal(correo),
      tipo_cita,
      fecha: dia,
      hora_inicio: enLima(desde).hora,
      hora_fin: enLima(hasta).hora,
      cupos: 1,
    });
    expect(res.status(), await res.text()).toBe(201);
    const id = ((await res.json()) as { id_horario: number }).id_horario;
    horarios.push(id);
    return { id, fecha: dia, inicio: desde };
  };
  return {
    evaluacion_academica: await crear(EVALUADOR, "evaluacion_academica", inicio, inicio + MINUTO),
    evaluacion_psicologica: await crear(PSICOLOGA, "evaluacion_psicologica", inicio, inicio + MINUTO),
    entrevista_padres: await crear(PSICOLOGA, "entrevista_padres", inicio + MINUTO, fin),
  };
}

// La familia elige un turno por evaluación y confirma: el expediente queda en en_evaluacion.
async function agendar(f: Familia, turnos: Record<string, Turno>): Promise<Record<string, number>> {
  await f.page.reload();
  for (const [tipo, turno] of Object.entries(turnos)) {
    const seccion = f.page.getByTestId(`evaluacion-${tipo}`);
    await seccion.locator(`[data-fecha="${turno.fecha}"]`).click();
    await seccion.getByTestId(`horario-${turno.id}`).click();
  }
  await f.page.getByTestId("confirmar-citas").click();
  await expect(f.page.getByTestId("confirmacion")).toHaveText("Citas confirmadas. Te enviamos la confirmación con las pautas previas por correo.");
  expect(consultarAdmision(`SELECT estado FROM expediente WHERE id_expediente = ${f.idExpediente}`)).toBe("en_evaluacion");
  const filas = consultarAdmision(`SELECT tipo_cita, id_cita FROM cita WHERE id_expediente = ${f.idExpediente}`).split("\n");
  return Object.fromEntries(filas.map((l) => l.split("\t")).map(([tipo, id]) => [tipo!, Number(id)]));
}

// S3: espera real a que empiece la cita, con un margen por la diferencia de reloj con el contenedor.
async function esperarInicio(page: Page, turno: Turno) {
  const falta = turno.inicio + 2_000 - Date.now();
  if (falta > 0) await page.waitForTimeout(falta);
}

async function registrarResultado(page: Page, idCita: number, resultado: string, observaciones: string) {
  await page.getByTestId(`cita-${idCita}`).click();
  await page.getByTestId("campo-resultado").fill(resultado);
  await page.getByTestId("campo-observaciones").fill(observaciones);
  await page.getByTestId("guardar-resultado").click();
  await expect(page.getByTestId("resultado-registrado")).toContainText(resultado);
}

// G11 (HU0025-1.0) y G06 (S1): los tres resultados del grado, cada uno a su hora, y G06 queda con el dictamen habilitado.
async function resultadosDelGrado(browser: Browser, turnos: Record<string, Turno>, citas: Record<string, number>, sufijo: string) {
  const contextoEvaluador = await browser.newContext();
  const evaluador = await contextoEvaluador.newPage();
  await esperarInicio(evaluador, turnos.evaluacion_academica!);
  await entrarEnGestion(evaluador, EVALUADOR, CONTRASENA);
  await evaluador.goto(`${FRONTEND}/gestion/evaluacion-academica`);
  await evaluador.getByTestId(`cita-${citas.evaluacion_academica}`).click();
  await expect(evaluador.getByTestId("nota-r3")).toContainText("No tienes acceso al informe psicológico ni a la documentación financiera.");
  await capturar(evaluador, `HU0025-1.0-g11-formulario-${sufijo}`);
  await registrarResultado(evaluador, citas.evaluacion_academica!, "Satisfactorio", "Resolvió los ejercicios de comprensión lectora");
  await expect(evaluador.getByTestId(`fila-${citas.evaluacion_academica}`)).toContainText("Registrada");
  await capturar(evaluador, `HU0025-1.0-g11-registrada-${sufijo}`);
  await contextoEvaluador.close();

  const contexto = await browser.newContext();
  const page = await contexto.newPage();
  await entrarEnGestion(page, PSICOLOGA, CONTRASENA);
  await page.goto(`${FRONTEND}/gestion/psicologia`);
  await registrarResultado(page, citas.evaluacion_psicologica!, "Adecuado", "Observación ficticia de la evaluación psicológica");
  await esperarInicio(page, turnos.entrevista_padres!);
  await page.reload();
  await registrarResultado(page, citas.entrevista_padres!, "Realizada", "Observación ficticia de la entrevista a los padres");
  await page.getByTestId("abrir-dictamen").click();
  const panel = page.getByTestId("panel-dictamen");
  await expect(panel.getByTestId("componente-evaluacion_academica")).toContainText("Registrada");
  await expect(panel.getByTestId("componente-evaluacion_academica")).toContainText("Resolvió los ejercicios de comprensión lectora");
  await expect(panel.getByTestId("guardar-dictamen")).toBeVisible();
  return { contexto, page, panel };
}

test.afterAll(async () => {
  for (const f of familias) {
    await f.contexto.close();
    consultarAdmision(`DELETE FROM resultado_evaluacion WHERE id_cita IN (SELECT id_cita FROM cita WHERE id_expediente = ${f.idExpediente})`);
    consultarAdmision(`DELETE FROM cita WHERE id_expediente = ${f.idExpediente}`);
    await (await admin())("DELETE", `/users/${f.idKeycloak}`);
  }
  if (horarios.length) consultarAdmision(`DELETE FROM horario_disponible WHERE id_horario IN (${horarios.join(",")})`);
});

test.describe.serial("HU0010 y HU0025 resultados de las evaluaciones y dictamen", () => {
  test("HU0010-1.0 [parte: dictamen, informe restringido y estado] con los resultados del grado registrados en G11 y G06, la psicóloga elige Apto, guarda las conclusiones y el informe, y el expediente pasa a apto con el informe restringido", async ({ browser, request }) => {
    test.setTimeout(420_000);
    const tokenSecretaria = (await iniciarSesion(browser, SECRETARIA, CONTRASENA))!;
    const f = await familiaEnP08(browser);
    const turnos = await crearTurnos(request, tokenSecretaria);
    const citas = await agendar(f, turnos);

    const { contexto, page, panel } = await resultadosDelGrado(browser, turnos, citas, "apto");
    const conclusiones = `Integra adecuadamente las evaluaciones ${randomBytes(3).toString("hex")}`;
    await panel.getByTestId("opcion-apto").check();
    await panel.getByTestId("campo-conclusiones").fill(conclusiones);
    await panel.getByTestId("campo-informe").setInputFiles({ name: "informe_psicopedagogico.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4\n% informe ficticio de prueba\n") });
    await capturar(page, "HU0010-1.0-g06-dictamen-apto");
    await panel.getByTestId("guardar-dictamen").click();

    await expect(page.getByTestId("dictamen-emitido")).toContainText("Dictamen emitido: Apto");
    await expect(page.getByTestId("dictamen-emitido")).toContainText(conclusiones);
    await expect(page.getByTestId("ver-informe")).toBeVisible();
    await expect(panel.getByTestId("guardar-dictamen")).toHaveCount(0);
    expect(consultarAdmision(`SELECT estado FROM expediente WHERE id_expediente = ${f.idExpediente}`)).toBe("apto");
    // D1: en la base las conclusiones están cifradas.
    const guardadas = consultarAdmision(`SELECT conclusiones FROM dictamen_admision WHERE id_expediente = ${f.idExpediente}`);
    expect(guardadas).toMatch(/^v1:/);
    expect(guardadas).not.toContain(conclusiones);
    await capturar(page, "HU0010-1.0-g06-dictamen-emitido");
    await contexto.close();

    // R3: la psicóloga descarga el informe; el evaluador académico recibe 403.
    const ruta = `/psicologia/expedientes/${f.idExpediente}/dictamen/informe`;
    expect((await llamarApi(request, "get", ruta, (await iniciarSesion(browser, PSICOLOGA, CONTRASENA))!)).status()).toBe(200);
    expect((await llamarApi(request, "get", ruta, (await iniciarSesion(browser, EVALUADOR, CONTRASENA))!)).status()).toBe(403);
  });

  test("HU0010-3.0 la psicóloga elige No apto y registra las conclusiones: el expediente queda en no_apto y la familia recibe el resultado sin el contenido del informe psicológico", async ({ browser, request }) => {
    test.setTimeout(420_000);
    const tokenSecretaria = (await iniciarSesion(browser, SECRETARIA, CONTRASENA))!;
    const f = await familiaEnP08(browser);
    const turnos = await crearTurnos(request, tokenSecretaria);
    const citas = await agendar(f, turnos);

    const { contexto, page, panel } = await resultadosDelGrado(browser, turnos, citas, "no-apto");
    const conclusiones = `No cumple el perfil de admisión ${randomBytes(3).toString("hex")}`;
    await panel.getByTestId("opcion-no_apto").check();
    await panel.getByTestId("campo-conclusiones").fill(conclusiones);
    await panel.getByTestId("guardar-dictamen").click();

    await expect(page.getByTestId("dictamen-emitido")).toContainText("Dictamen emitido: No apto");
    await expect(panel.getByTestId("guardar-dictamen")).toHaveCount(0);
    expect(consultarAdmision(`SELECT estado FROM expediente WHERE id_expediente = ${f.idExpediente}`)).toBe("no_apto");
    await capturar(page, "HU0010-3.0-g06-dictamen-emitido");
    await contexto.close();

    // El correo real por agendamiento → notificacion-multicanal, sin conclusiones, observaciones ni el informe (C11).
    const correo = await esperarCorreo(request, f.correo, `Resultado del proceso de admisión · Admisión ${CAMPANA}`);
    expect(correo).toContain("[Comunicación del resultado del proceso de admisión: por definir con el colegio]");
    for (const prohibido of [conclusiones, "Observación ficticia", "comprensión lectora", "informe", "Satisfactorio"]) expect(correo).not.toContain(prohibido);
  });
});
