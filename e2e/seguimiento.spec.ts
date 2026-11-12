// HU0018 · seguimiento programado contra el entorno dev: la revisión diaria de seguimiento-recordatorios (n8n) envía el
// recordatorio por inactividad (R20) y caduca el expediente con el plazo vencido (R21), con los avisos a la familia y al buzón
// de admisión, y devuelve la vacante con la identidad de C25.
// - Disparo (D8-A, John, 07/11/2026): el Schedule diario no se puede esperar; la prueba corre el mismo flujo desde su Manual
//   Trigger «Revisión manual» con `n8n execute` dentro del contenedor, con otro puerto del task broker
//   (N8N_CLI_RUNNERS_BROKER_PORT de docker-compose.yml: el puerto por defecto es del n8n que ya corre). La salida cruda no se imprime: lleva asuntos y cuerpos.
// - Datos (C16): los expedientes se preparan escribiendo directo en la base de dev, como HU0005 (aprobado por John,
//   02/11/2026), y el paso del tiempo se simula con transiciones fechadas en el pasado (la bitácora admite INSERT). Cada
//   corrida deja en dev tres apoderados `hu0018-e2e-*@ejemplo.test` con sus expedientes (uno con recordatorio y dos
//   caducados). La revisión también toma los expedientes viejos de otras corridas que ya cumplen las condiciones: en dev
//   llegan a Mailpit recordatorios y caducidades reales.
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { resolve } from "node:path";
import { expect, test, type APIRequestContext } from "@playwright/test";
import { FRONTEND, MAILPIT } from "./ayudantes";

const RAIZ = resolve(import.meta.dirname, "..");
const COMPOSE = ["compose", "-f", "docker-compose.yml", "-f", "docker-compose.dev.yml"];
const CAMPANA = process.env.CAMPANA_ACTIVA!;
const BUZON_ADMISION = process.env.CORREO_ADMISION || "admision@ejemplo.test";
const GRADO_SQL = `g.nombre_grado LIKE '3.%de primaria' AND g.campana_admision = '${CAMPANA}'`;

function docker(args: string[], timeout = 60_000): string {
  return execFileSync("docker", args, { cwd: RAIZ, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout, maxBuffer: 64 * 1024 * 1024 }).trim();
}
const consultarAdmision = (sql: string) => docker([...COMPOSE, "exec", "-T", "postgres", "psql", "-U", "api_admision", "-d", "admision", "-tA", "-F", "|", "-c", sql]);

// La revisión diaria por su Manual Trigger. Solo se devuelve si falló, sin la salida (trae asuntos y cuerpos).
function revisionDiaria(): void {
  const id = docker([...COMPOSE, "exec", "-T", "n8n", "n8n", "list:workflow"])
    .split("\n")
    .find((l) => l.endsWith("|seguimiento-recordatorios"))
    ?.split("|")[0];
  expect(id, "no está el flujo seguimiento-recordatorios en n8n (npm run n8n:importar)").toBeTruthy();
  try {
    // El puerto del task broker de la ejecución por CLI sale de docker-compose.yml (N8N_CLI_RUNNERS_BROKER_PORT).
    docker([...COMPOSE, "exec", "-T", "n8n", "sh", "-c", `N8N_RUNNERS_BROKER_PORT="$N8N_CLI_RUNNERS_BROKER_PORT" n8n execute --id=${id} --rawOutput`], 420_000);
  } catch (e) {
    throw new Error(`n8n execute falló (código ${(e as { status?: number }).status ?? "?"}); la salida no se imprime porque trae datos de los avisos`);
  }
}

async function esperarCorreo(request: APIRequestContext, correo: string, asunto: string): Promise<string> {
  let id = "";
  await expect
    .poll(
      async () => {
        const lista = await (await request.get(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:"${correo}"`)}&limit=200`)).json();
        id = (lista.messages ?? []).find((m: { Subject: string }) => m.Subject === asunto)?.ID ?? "";
        return id;
      },
      { message: `no llegó «${asunto}»`, timeout: 60_000, intervals: [2_000] },
    )
    .not.toBe("");
  return String((await (await request.get(`${MAILPIT}/api/v1/message/${id}`)).json()).Text ?? "").replace(/\r\n/g, "\n");
}

// Un expediente en dev con su apoderado y una transición fechada hace `horas`.
function expediente(estado: string, desde: string, horas: number): { id: number; correo: string; codigo: string } {
  const correo = `hu0018-e2e-${Date.now()}-${randomBytes(2).toString("hex")}@ejemplo.test`;
  const id = consultarAdmision(
    `WITH a AS (INSERT INTO apoderado (nombres, apellidos, telefono, correo)
                VALUES ('María Fernanda', 'Quispe Rojas', '+51987654321', '${correo}') RETURNING id_apoderado)
     INSERT INTO expediente (id_apoderado_titular, id_grado, estado)
     SELECT a.id_apoderado, g.id_grado, '${estado}' FROM a, grado g WHERE ${GRADO_SQL} RETURNING id_expediente`,
  ).split("\n")[0]!;
  expect(id, "no se creó el expediente: ¿existe el grado «3.° de primaria» de la campaña activa (npm run db:seed)?").toMatch(/^\d+$/);
  consultarAdmision(
    `INSERT INTO registro_auditoria (id_expediente, tipo_evento, estado_anterior, estado_nuevo, detalle, fecha_hora)
     VALUES (${id}, 'transicion_estado', '${desde}', '${estado}', '{"campo":"estado"}', now() - make_interval(hours => ${horas}))`,
  );
  return { id: Number(id), correo, codigo: `ADM-${CAMPANA}-${id.padStart(4, "0")}` };
}

const estado = (id: number) => consultarAdmision(`SELECT estado FROM expediente WHERE id_expediente = ${id}`);
const avisos = (id: number) =>
  consultarAdmision(`SELECT tipo_evento || ' ' || estado_envio FROM notificacion WHERE id_expediente = ${id} ORDER BY id_notificacion`).split("\n").filter(Boolean);
// C25 (2): adjudicadas (autorizadas − disponibles) y expedientes del grado con vacante o carta.
const identidad = () =>
  consultarAdmision(
    `SELECT g.vacantes_autorizadas - g.vacantes_disponibles, (SELECT count(*) FROM expediente e WHERE e.id_grado = g.id_grado AND e.estado IN ('vacante_asignada', 'carta_emitida'))
       FROM grado g WHERE ${GRADO_SQL}`,
  )
    .split("|")
    .map(Number);

test.describe.serial("HU0018 seguimiento programado en el entorno dev", () => {
  let inactivo: ReturnType<typeof expediente>;
  let vencido: ReturnType<typeof expediente>;
  let conVacante: ReturnType<typeof expediente>;
  let antes: number[];

  test.beforeAll(() => {
    test.setTimeout(480_000);
    inactivo = expediente("portal_habilitado", "visita_agendada", 49);
    vencido = expediente("portal_habilitado", "visita_agendada", 16 * 24);
    // La vacante se toma del grado como lo haría la adjudicación (R14), para que la identidad de C25 siga valiendo.
    antes = identidad();
    conVacante = expediente("vacante_asignada", "apto", 8 * 24);
    consultarAdmision(`UPDATE grado g SET vacantes_disponibles = vacantes_disponibles - 1 WHERE ${GRADO_SQL}`);
    revisionDiaria();
  });

  test("HU0018-1.0 [parte: correo] la revisión diaria envía a la familia con 48 h sin interacción el recordatorio con la acción pendiente, la fecha límite y el enlace a su expediente, y lo registra", async ({ request }) => {
    test.setTimeout(120_000);
    const texto = await esperarCorreo(request, inactivo.correo, `Tienes una acción pendiente · Admisión ${CAMPANA}`);
    const lineas = texto.split("\n");
    expect(lineas[0]).toBe("Hola, María Fernanda:");
    expect(lineas).toContain("Acción pendiente: completar la ficha de inscripción, cargar tus documentos y registrar el derecho de admisión.");
    expect(lineas.some((l) => /^Fecha límite: \d{2}\/\d{2}\/\d{4}\. Si vence sin completarla, tu postulación caducará\.$/.test(l))).toBe(true);
    expect(lineas).toContain(`Tu expediente: ${FRONTEND}/portal/panel`);
    await expect.poll(() => avisos(inactivo.id)).toEqual(["recordatorio_48h enviado"]);
    expect(estado(inactivo.id)).toBe("portal_habilitado");
  });

  test("HU0018-2.0 al vencer el plazo de la etapa la revisión diaria pasa el expediente a caducado y notifica a los padres y al personal de admisión", async ({ request }) => {
    test.setTimeout(120_000);
    expect(estado(vencido.id)).toBe("caducado");
    const familia = await esperarCorreo(request, vencido.correo, `Postulación caducada · Admisión ${CAMPANA}`);
    expect(familia).toContain("Tu postulación caducó y se liberaron el cupo o la vacante que tenía reservados.");
    const admision = await esperarCorreo(request, BUZON_ADMISION, `Expediente caducado ${vencido.codigo} · Admisión ${CAMPANA}`);
    expect(admision).toContain(`El expediente ${vencido.codigo} caducó por vencimiento del plazo.`);
    expect(admision).not.toContain("María Fernanda");
    await expect.poll(() => avisos(vencido.id)).toEqual(["expediente_caducado enviado", "expediente_caducado_admision enviado"]);
    expect(consultarAdmision(`SELECT estado_anterior || '>' || estado_nuevo || ' ' || (id_personal IS NULL) FROM registro_auditoria WHERE id_expediente = ${vencido.id} ORDER BY id_evento DESC LIMIT 1`)).toBe(
      "portal_habilitado>caducado true",
    );
  });

  test("HU0018-2.0 (vacante, C25) la caducidad en la cuota devuelve la vacante y la identidad de las adjudicadas se mantiene", async () => {
    expect(estado(conVacante.id)).toBe("caducado");
    expect(identidad()).toEqual(antes);
    const [adjudicadas, expedientes] = identidad();
    expect(adjudicadas).toBe(expedientes);
  });

  test("HU0018-1.0 [parte: correo] (idempotencia) una segunda revisión el mismo día no repite el recordatorio ni la caducidad", async () => {
    test.setTimeout(480_000);
    revisionDiaria();
    expect(avisos(inactivo.id)).toEqual(["recordatorio_48h enviado"]);
    expect(avisos(vencido.id)).toEqual(["expediente_caducado enviado", "expediente_caducado_admision enviado"]);
    expect(identidad()).toEqual(antes);
  });
});
