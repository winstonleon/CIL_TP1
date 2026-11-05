// HU0009 · agendamiento y reprogramación de las evaluaciones (P08) contra el entorno dev (API, n8n, Keycloak, Mailpit).
// - Precondición «las tres validaciones conformes» (B1): como en HU0017 (C16), se escribe en la base de dev: el expediente
//   en en_validacion con las ramas documental y financiera conformes, el derecho de admisión conforme y el atencion_fin de
//   la decisión que completa la unión (`habilita_agendamiento`), con la hora real. El camino de las validaciones por la
//   gestión interna ya lo prueba e2e/validaciones.spec.ts. Desde ahí todo es real: el barrido de agendamiento (n8n) envía
//   «Ya puedes agendar» (C52), la familia agenda en P08 y n8n envía la confirmación y los avisos de la reprogramación.
// - Datos ficticios: un apoderado `hu0009-e2e-*@ejemplo.test` con su usuario de Keycloak (rol familia), cuenta, expediente
//   y pago; turnos de los usuarios de prueba `psicologa.prueba@` y `evaluador.prueba@` (npm run kc:usuarios-prueba y
//   npm run db:seed) en días lejanos. Al terminar se quitan las citas, los turnos y el usuario de Keycloak.
// - Capturas: test-results/HU0009/capturas-e2e/ (ignorada por git).
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test, type APIRequestContext, type BrowserContext, type Page } from "@playwright/test";
import { admin, contrasenaE2E, FRONTEND, MAILPIT } from "./ayudantes";

const RAIZ = resolve(import.meta.dirname, "..");
const CAPTURAS = resolve(RAIZ, "test-results/HU0009/capturas-e2e");
const COMPOSE = ["compose", "-f", "docker-compose.yml", "-f", "docker-compose.dev.yml"];
const CAMPANA = process.env.CAMPANA_ACTIVA!;
const GRADO_SQL = `g.nombre_grado LIKE '3.%de primaria' AND g.campana_admision = '${CAMPANA}'`;
const PSICOLOGA = "psicologa.prueba@ejemplo.test";
const EVALUADOR = "evaluador.prueba@ejemplo.test";

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

interface Familia {
  correo: string;
  idKeycloak: string;
  idExpediente: number;
  codigo: string;
  contexto: BrowserContext;
  page: Page;
}
let familia: Familia | null = null;
const horarios: number[] = [];

// Un turno de evaluación a `dias` días (hora de Lima) del responsable con ese correo; devuelve su id y su fecha.
function crearTurno(correo: string, tipo: string, dias: number, inicio: string, fin: string): { id: number; fecha: string } {
  const [id, fecha] = consultarAdmision(
    `INSERT INTO horario_disponible (id_personal, tipo_cita, fecha, hora_inicio, hora_fin, cupos, campana_admision)
     SELECT p.id_personal, '${tipo}', (now() AT TIME ZONE 'America/Lima')::date + ${dias}, '${inicio}', '${fin}', 1, '${CAMPANA}'
       FROM personal p WHERE p.correo = '${correo}' AND p.activo
     RETURNING id_horario, to_char(fecha, 'YYYY-MM-DD')`,
  )
    .split("\n")[0]!
    .split("\t");
  expect(id, `falta el personal de prueba ${correo}: ejecuta npm run kc:usuarios-prueba y npm run db:seed`).toMatch(/^\d+$/);
  horarios.push(Number(id));
  return { id: Number(id), fecha: fecha! };
}

// Días lejanos y propios de la corrida, para no cruzarse con otros turnos de los mismos responsables.
const DIA = 60 + (Math.floor(Date.now() / 60_000) % 240);
let turnos: Record<string, { id: number; fecha: string }>;

test.beforeAll(() => {
  turnos = {
    evaluacion_academica: crearTurno(EVALUADOR, "evaluacion_academica", DIA, "08:00", "09:00"),
    academica_nueva: crearTurno(EVALUADOR, "evaluacion_academica", DIA, "13:00", "14:00"),
    evaluacion_psicologica: crearTurno(PSICOLOGA, "evaluacion_psicologica", DIA, "09:30", "10:30"),
    entrevista_padres: crearTurno(PSICOLOGA, "entrevista_padres", DIA + 1, "15:00", "16:00"),
  };
});

test.afterAll(async () => {
  await familia?.contexto.close();
  if (familia) consultarAdmision(`DELETE FROM cita WHERE id_expediente = ${familia.idExpediente}`);
  if (horarios.length) consultarAdmision(`DELETE FROM horario_disponible WHERE id_horario IN (${horarios.join(",")})`);
  if (familia) await (await admin())("DELETE", `/users/${familia.idKeycloak}`);
});

test.describe.serial("HU0009 agendamiento y reprogramación de las evaluaciones", () => {
  test("HU0009-1.0 con las tres validaciones conformes la familia recibe «Ya puedes agendar», elige un turno por evaluación en P08 y «Confirmar citas» reserva los turnos, pasa el expediente a En evaluación y envía la confirmación con las pautas previas", async ({ browser, request }) => {
    test.setTimeout(300_000);
    const correo = `hu0009-e2e-${Date.now()}-${randomBytes(2).toString("hex")}@ejemplo.test`;
    const contrasena = contrasenaE2E();
    const api = await admin();
    const { res } = await api("POST", "/users", { username: correo, email: correo, firstName: "María Fernanda", lastName: "Quispe Rojas", enabled: true, emailVerified: true });
    const idKeycloak = res.headers.get("location")!.split("/").pop()!;
    await api("PUT", `/users/${idKeycloak}/reset-password`, { type: "password", value: contrasena, temporary: false });
    const { datos: rol } = await api("GET", "/roles/familia");
    await api("POST", `/users/${idKeycloak}/role-mappings/realm`, [{ id: rol.id, name: rol.name }]);

    // Precondición (C16): en validación con las tres ramas conformes y la marca de la unión, con la hora real.
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
    consultarAdmision(
      `INSERT INTO registro_auditoria (id_expediente, id_personal, tipo_evento, detalle)
       SELECT ${id}, p.id_personal, 'atencion_fin',
              jsonb_build_object('item', jsonb_build_object('tipo', 'documentacion_financiera', 'id', ${id}), 'decision', 'conforme', 'id_evento_inicio', null, 'habilita_agendamiento', true)
         FROM personal p WHERE p.correo = 'tesoreria.prueba@ejemplo.test'`,
    );
    const codigo = `ADM-${CAMPANA}-${id.padStart(4, "0")}`;
    const contexto = await browser.newContext();
    const page = await contexto.newPage();
    familia = { correo, idKeycloak, idExpediente: Number(id), codigo, contexto, page };

    // C52: el barrido de agendamiento (n8n) avisa a la familia que ya puede agendar, con el enlace a P08.
    const habilitacion = await esperarCorreo(request, correo, `Ya puedes agendar tus evaluaciones · Admisión ${CAMPANA}`);
    expect(habilitacion).toContain(`${FRONTEND}/portal/evaluaciones`);

    // P08: el grado 3.° de primaria pide la evaluación académica, la psicológica y la entrevista (C25 4).
    await page.goto(`${FRONTEND}/portal/evaluaciones`);
    await page.locator("#username").fill(correo);
    await page.locator("#password").fill(contrasena);
    await page.locator("#kc-login").click();
    await expect(page.getByRole("heading", { name: "Agenda tus evaluaciones" })).toBeVisible();
    await expect(page.getByTestId("habilitado")).toHaveText("Documentos, derecho de admisión y documentación financiera validados: ya puedes agendar.");
    await expect(page.locator('[data-testid^="evaluacion-"] h2')).toHaveText(["Evaluación académica", "Evaluación psicológica", "Entrevista a los padres"]);
    for (const tipo of ["evaluacion_academica", "evaluacion_psicologica", "entrevista_padres"]) {
      const seccion = page.getByTestId(`evaluacion-${tipo}`);
      await seccion.locator(`[data-fecha="${turnos[tipo]!.fecha}"]`).click();
      await seccion.getByTestId(`horario-${turnos[tipo]!.id}`).click();
      await expect(seccion).toContainText("Seleccionada");
    }
    await capturar(page, "HU0009-1.0-p08-turnos-elegidos");

    await page.getByTestId("confirmar-citas").click();

    await expect(page.getByTestId("confirmacion")).toHaveText("Citas confirmadas. Te enviamos la confirmación con las pautas previas por correo.");
    await expect(page.getByTestId("cita")).toHaveCount(3);
    expect(consultarAdmision(`SELECT estado FROM expediente WHERE id_expediente = ${id}`)).toBe("en_evaluacion");
    expect(consultarAdmision(`SELECT count(*) FROM cita WHERE id_expediente = ${id} AND estado = 'reservada'`)).toBe("3");
    expect(consultarAdmision(`SELECT sum(cupos) FROM horario_disponible WHERE id_horario IN (${turnos.evaluacion_academica!.id}, ${turnos.evaluacion_psicologica!.id}, ${turnos.entrevista_padres!.id})`)).toBe("0");
    await capturar(page, "HU0009-1.0-p08-citas-confirmadas");

    const confirmacion = await esperarCorreo(request, correo, `Citas de evaluación confirmadas · Admisión ${CAMPANA}`);
    expect(confirmacion).toContain("[Pautas previas de la evaluación académica");
    expect(confirmacion).toContain("[Pautas previas de la entrevista a los padres");
    expect(confirmacion).toContain("8:00 a. m.");
  });

  test("HU0009-2.0 con más de 24 h de anticipación la familia reprograma la evaluación académica desde el enlace del correo: se libera el turno anterior, se reserva el nuevo y llegan la confirmación actualizada a la familia y el aviso al evaluador responsable", async ({ request }) => {
    test.setTimeout(240_000);
    expect(familia, "depende del agendamiento de HU0009-1.0").not.toBeNull();
    const { page, correo, idExpediente, codigo } = familia!;
    const anterior = turnos.evaluacion_academica!;
    const nuevo = turnos.academica_nueva!;

    // El enlace de reprogramación del correo lleva a P08 con la sesión del portal (decisión R1).
    await page.goto(`${FRONTEND}/portal/evaluaciones`);
    const seccion = page.getByTestId("evaluacion-evaluacion_academica");
    await seccion.getByTestId("reprogramar-evaluacion_academica").click();
    await seccion.locator(`[data-fecha="${nuevo.fecha}"]`).click();
    await seccion.getByTestId(`horario-${nuevo.id}`).click();
    await seccion.getByTestId("confirmar-cambio").click();

    await expect(page.getByTestId("confirmacion")).toHaveText("Cita reprogramada. Te enviamos la confirmación actualizada por correo.");
    await expect(seccion.getByTestId("cita")).toContainText("1:00 p. m.");
    expect(consultarAdmision(`SELECT estado FROM cita WHERE id_expediente = ${idExpediente} AND id_horario = ${anterior.id}`)).toBe("reprogramada");
    expect(consultarAdmision(`SELECT estado FROM cita WHERE id_expediente = ${idExpediente} AND id_horario = ${nuevo.id}`)).toBe("reservada");
    expect(consultarAdmision(`SELECT cupos FROM horario_disponible WHERE id_horario = ${anterior.id}`)).toBe("1");
    expect(consultarAdmision(`SELECT cupos FROM horario_disponible WHERE id_horario = ${nuevo.id}`)).toBe("0");
    expect(consultarAdmision(`SELECT count(*) FROM registro_auditoria WHERE id_expediente = ${idExpediente} AND tipo_evento = 'cita_reprogramada'`)).toBe("1");
    await capturar(page, "HU0009-2.0-p08-cita-reprogramada");

    const aFamilia = await esperarCorreo(request, correo, `Cita reprogramada · Admisión ${CAMPANA}`);
    expect(aFamilia).toContain("Evaluación académica: pasó del");
    expect(aFamilia).toContain("1:00 p. m.");
    const alEvaluador = await esperarCorreo(request, EVALUADOR, `Cita reprogramada: Evaluación académica · ${codigo}`);
    expect(alEvaluador).toContain(`Expediente: ${codigo}`);
    expect(alEvaluador).toContain("Ahora:");
    // C11: el aviso al personal no lleva datos de la familia ni del menor.
    expect(alEvaluador).not.toMatch(/María|Quispe/);
  });
});
