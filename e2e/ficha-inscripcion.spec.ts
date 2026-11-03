// HU0005 · ficha de inscripción y cuestionario contra el entorno dev: la familia inicia sesión, deja un borrador que se
// guarda solo, sale, vuelve, lo completa y ve habilitada la carga de documentos con la lista que corresponde.
// - Datos (C16): el expediente se prepara escribiendo directo en la base de dev (aprobado por John, 02/11/2026), porque la
//   ruta de G04 envía el aviso de credenciales por agendamiento. Cada corrida deja en dev un apoderado, su cuenta de acceso,
//   su expediente, su postulante y su cuestionario `hu0005-e2e-*@ejemplo.test`. Crea 4 requisitos «E2E hu0005 - …» en el
//   grado «3.° de primaria» y un usuario de Keycloak (rol familia); al terminar quita los requisitos y el usuario.
// - Los DNI son ficticios y las capturas los ocultan. Capturas: test-results/HU0005/capturas-e2e/ (ignorada por git).
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { admin, contrasenaE2E, FRONTEND } from "./ayudantes";

const RAIZ = resolve(import.meta.dirname, "..");
const CAPTURAS = resolve(RAIZ, "test-results/HU0005/capturas-e2e");
const COMPOSE = ["compose", "-f", "docker-compose.yml", "-f", "docker-compose.dev.yml"];
const CAMPANA = process.env.CAMPANA_ACTIVA!;
const PREFIJO = "E2E hu0005 - ";

function consultarAdmision(sql: string): string {
  return execFileSync("docker", [...COMPOSE, "exec", "-T", "postgres", "psql", "-U", "api_admision", "-d", "admision", "-tA", "-F", "\t", "-c", sql], {
    cwd: RAIZ,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

const dniE2E = () => String(10_000_000 + Math.floor(Math.random() * 80_000_000));
const GRADO_SQL = `g.nombre_grado LIKE '3.%de primaria' AND g.campana_admision = '${CAMPANA}'`;

let correo: string;
let contrasena: string;
let idKeycloak: string;
let idExpediente: number;
let dniPostulante: string;
let dniMadre: string;

async function capturar(page: Page, nombre: string, ocultar: string[] = []) {
  mkdirSync(CAPTURAS, { recursive: true });
  await page.screenshot({ path: resolve(CAPTURAS, `${nombre}.png`), fullPage: true, mask: ocultar.map((s) => page.locator(s)) });
}

async function entrar(page: Page) {
  await page.goto(`${FRONTEND}/portal/ficha`);
  await page.locator("#username").fill(correo);
  await page.locator("#password").fill(contrasena);
  await page.locator("#kc-login").click();
  await expect(page).toHaveURL(`${FRONTEND}/portal/ficha`);
  await expect(page.getByRole("heading", { name: "Ficha de inscripción y cuestionario" })).toBeVisible();
}

const continuar = (page: Page) => page.getByRole("button", { name: "Guardar y continuar" });
const filaDelExpediente = () =>
  consultarAdmision(
    `SELECT concat_ws('|', e.estado, p.nombres, p.dni_cifrado IS NOT NULL, strpos(p.dni_cifrado, '${dniPostulante}') = 0, p.ficha_completa, c.es_borrador)
       FROM expediente e
       LEFT JOIN postulante p ON p.id_postulante = e.id_postulante
       LEFT JOIN cuestionario_expectativas c ON c.id_expediente = e.id_expediente
      WHERE e.id_expediente = ${idExpediente}`,
  );

test.describe.serial("HU0005 P05 y P05b en el entorno dev", () => {
  test.beforeAll(async () => {
    correo = `hu0005-e2e-${Date.now()}-${randomBytes(2).toString("hex")}@ejemplo.test`;
    contrasena = contrasenaE2E();
    dniPostulante = dniE2E();
    dniMadre = dniE2E();

    // Usuario de la familia en Keycloak, con el rol familia y una contraseña definitiva (el primer ingreso es de D3).
    const api = await admin();
    const { res } = await api("POST", "/users", { username: correo, email: correo, firstName: "María Fernanda", lastName: "Quispe Rojas", enabled: true, emailVerified: true });
    idKeycloak = res.headers.get("location")!.split("/").pop()!;
    await api("PUT", `/users/${idKeycloak}/reset-password`, { type: "password", value: contrasena, temporary: false });
    const { datos: rol } = await api("GET", "/roles/familia");
    await api("POST", `/users/${idKeycloak}/role-mappings/realm`, [{ id: rol.id, name: rol.name }]);

    // Requisitos del grado (un resto de una corrida fallida se limpia antes) y el expediente en portal_habilitado.
    consultarAdmision(`DELETE FROM requisito_documental WHERE tipo_documento LIKE '${PREFIJO}%'`);
    consultarAdmision(
      `INSERT INTO requisito_documental (id_grado, tipo_documento, categoria, condicion_aplicacion, por_apoderado)
       SELECT g.id_grado, v.tipo, v.categoria::categoria_requisito, v.condicion::condicion_aplicacion, v.por_apoderado
         FROM grado g,
              (VALUES ('${PREFIJO}Partida de nacimiento', 'postulante_y_padres', 'todos', false),
                      ('${PREFIJO}Certificado de estudios', 'colegio_procedencia', 'solo_colegio_peruano', false),
                      ('${PREFIJO}Boletas de pago', 'financiero', 'si_dependiente', true),
                      ('${PREFIJO}Recibos por honorarios', 'financiero', 'si_independiente', true)) AS v(tipo, categoria, condicion, por_apoderado)
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
  });

  test.afterAll(async () => {
    consultarAdmision(`DELETE FROM requisito_documental WHERE tipo_documento LIKE '${PREFIJO}%'`);
    if (idKeycloak) await (await admin())("DELETE", `/users/${idKeycloak}`);
  });

  test("HU0005-2.0 [parte: borrador] la familia deja un borrador que se guarda solo, sale, vuelve y lo encuentra sin pérdida", async ({ browser }) => {
    test.setTimeout(120_000);
    const contexto = await browser.newContext();
    const page = await contexto.newPage();
    try {
      await entrar(page);
      await expect(page.getByTestId("expediente-codigo")).toContainText(`ADM-${CAMPANA}-`);
      await expect(page.getByTestId("menu-documentos")).toBeDisabled();

      // Sin pulsar nada: el borrador se guarda 2 s después del último cambio.
      await page.locator("#p05n").fill("Sofia Valentina");
      await page.locator("#p05ap").fill("Quispe");
      await page.locator("#p05d").fill(dniPostulante);
      await page.locator('input[name="p05proc"]').first().check(); // «Sí»: estudió en otro colegio del Perú
      await expect(page.getByTestId("estado-guardado")).toContainText("Borrador guardado", { timeout: 10_000 });
      await capturar(page, "p05-borrador-guardado", ["#p05d"]);
    } finally {
      await contexto.close(); // la familia abandona el formulario
    }

    // Cifrado (ADR-03) y transición al primer guardado: el DNI no está en claro y el expediente pasó a en_postulacion.
    await expect.poll(filaDelExpediente).toBe("en_postulacion|Sofia Valentina|t|t|f|t");
    expect(consultarAdmision(`SELECT count(*) FROM registro_auditoria WHERE id_expediente = ${idExpediente} AND tipo_evento = 'transicion_estado' AND estado_anterior = 'portal_habilitado' AND estado_nuevo = 'en_postulacion'`)).toBe("1");

    const vuelta = await browser.newContext();
    const pagina = await vuelta.newPage();
    try {
      await entrar(pagina);
      await expect(pagina.locator("#p05n")).toHaveValue("Sofia Valentina");
      await expect(pagina.locator("#p05ap")).toHaveValue("Quispe");
      await expect(pagina.locator("#p05d")).toHaveValue(dniPostulante); // la familia dueña lee su DNI
      await expect(pagina.locator('input[name="p05proc"]').first()).toBeChecked();
      await expect(pagina.locator('input[name="p05cond"]').first()).not.toBeChecked(); // sin responder: ninguna opción marcada
      await expect(pagina.locator('input[name="p05cond"]').nth(1)).not.toBeChecked();
      await expect(pagina.getByTestId("estado-guardado")).toContainText("Borrador guardado hace");
    } finally {
      await vuelta.close();
    }
  });

  test("HU0005-1.0 la familia completa la ficha y ve habilitada la carga de documentos con la lista que corresponde", async ({ browser }) => {
    test.setTimeout(120_000);
    const contexto = await browser.newContext();
    const page = await contexto.newPage();
    try {
      await entrar(page);

      // Paso 1 · P05
      await page.locator("#p05am").fill("Rojas");
      await page.locator("#p05f").fill("2018-03-14");
      await page.locator('input[name="p05cond"]').nth(1).check(); // «No»: sin condición especial
      await continuar(page).click();
      // Paso 2 · P05b: la madre es la titular; sus nombres, teléfono y correo vienen de P01.
      await expect(page.getByRole("tab", { selected: true })).toContainText("Datos de los padres");
      await expect(page.locator("#p05bt-cor")).toHaveValue(correo);
      await expect(page.locator("#p05bt-cor")).toBeDisabled();
      await page.locator("#p05bt-par").selectOption("madre");
      await page.locator("#p05bt-dni").fill(dniMadre);
      await page.locator('input[name="p05btcl"]').first().check(); // dependiente
      await continuar(page).click();
      // Paso 3 · colegio de procedencia
      await page.locator("#p05c").fill("Colegio Ficticio de Lima");
      await continuar(page).click();
      // Paso 4 · cuestionario
      for (const id of ["p1", "p2", "p3"]) await page.locator(`#p05q-${id}`).fill(`Respuesta ficticia ${id}`);
      await capturar(page, "p05-cuestionario", ["#p05d"]);
      await continuar(page).click();

      // HU0005-1.0: la ficha queda completa y se habilita la carga de documentos con la lista del grado y lo declarado.
      await expect(page.getByTestId("paso-documentos")).toBeVisible({ timeout: 15_000 });
      await expect(page.getByRole("heading", { name: "Paso siguiente: Documentos" })).toBeVisible();
      const lista = page.getByTestId("lista-documentos");
      await expect(lista).toContainText(`${PREFIJO}Partida de nacimiento`);
      await expect(lista).toContainText(`${PREFIJO}Certificado de estudios`); // declaró colegio peruano
      await expect(lista).toContainText(`${PREFIJO}Boletas de pago — María Fernanda Quispe Rojas`); // madre dependiente
      await expect(lista).not.toContainText(`${PREFIJO}Recibos por honorarios`); // nadie es independiente
      await expect(page.getByTestId("menu-documentos")).toBeEnabled();
      await capturar(page, "p05-documentos-habilitados", ["#p05d"]);
    } finally {
      await contexto.close();
    }

    await expect.poll(filaDelExpediente).toBe("en_postulacion|Sofia Valentina|t|t|t|f");
    expect(consultarAdmision(`SELECT count(*) FROM registro_auditoria WHERE id_expediente = ${idExpediente} AND tipo_evento = 'transicion_estado'`)).toBe("1");
    expect(consultarAdmision(`SELECT count(*) FROM postulante_apoderado pa JOIN expediente e ON e.id_postulante = pa.id_postulante WHERE e.id_expediente = ${idExpediente}`)).toBe("1");
  });
});
