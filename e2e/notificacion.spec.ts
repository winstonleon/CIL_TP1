// S0-C7 y S0-C8: flujo notificacion-multicanal de punta a punta (webhook de n8n → API interna → Mailpit → BD).
// Requiere el entorno dev levantado, `npm run db:seed` (familia ficticia), `npm run n8n:credenciales` y
// `npm run n8n:importar`. Los secretos salen de .env (playwright.config.ts) y nunca se imprimen.
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { expect, test, type APIRequestContext } from "@playwright/test";

const RAIZ = resolve(import.meta.dirname, "..");
const COMPOSE = ["compose", "-f", "docker-compose.yml", "-f", "docker-compose.dev.yml"];
const WEBHOOK = `http://127.0.0.1:${process.env.N8N_HOST_PORT || 5679}/webhook/notificacion-multicanal`;
const MAILPIT = `http://127.0.0.1:${process.env.MAILPIT_UI_PORT || 8025}`;
const API = `http://127.0.0.1:${process.env.API_PORT || 3000}`;
const CORREO_FAMILIA = "familia.prueba@ejemplo.test";
const SECRETO = process.env.N8N_WEBHOOK_SECRET!;

function docker(args: string[]): string {
  return execFileSync("docker", [...COMPOSE, ...args], { cwd: RAIZ, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 1 << 28 });
}

// Consulta a una base del Postgres de dev desde dentro del contenedor (socket local).
function consultar(usuario: string, base: string, sql: string): string {
  return docker(["exec", "-T", "postgres", "psql", "-U", usuario, "-d", base, "-tA", "-F", "\t", "-c", sql]).trim();
}
const consultarAdmision = (sql: string) => consultar("api_admision", "admision", sql);

function idExpedienteFicticio(): number {
  const id = consultarAdmision(
    `SELECT e.id_expediente FROM expediente e JOIN apoderado a ON a.id_apoderado = e.id_apoderado_titular
      WHERE a.correo = '${CORREO_FAMILIA}' ORDER BY 1 LIMIT 1`,
  );
  if (!id) throw new Error("No existe la familia ficticia: ejecuta npm run db:seed");
  return Number(id);
}

const filasDeEvento = (tipoEvento: string) =>
  Number(consultarAdmision(`SELECT count(*) FROM notificacion WHERE tipo_evento = '${tipoEvento}'`));

function notificar(request: APIRequestContext, cuerpo: unknown, cabeceras: Record<string, string> = { "X-Webhook-Secret": SECRETO }) {
  return request.post(WEBHOOK, { headers: cabeceras, data: cuerpo, failOnStatusCode: false });
}

const unico = () => `e2e_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

test.describe("S0-C7 flujo notificacion-multicanal", () => {
  test("S0-C7 sin el secreto del webhook (o con uno incorrecto) n8n responde 403 y no registra nada", async ({ request }) => {
    const tipo = unico();
    const cuerpo = { id_expediente: idExpedienteFicticio(), tipo_evento: tipo, asunto: `S0-C7 ${tipo}`, cuerpo: "Mensaje ficticio." };
    for (const cabeceras of [{}, { "X-Webhook-Secret": "incorrecto" }]) {
      const res = await notificar(request, cuerpo, cabeceras);
      expect(res.status()).toBe(403);
    }
    expect(filasDeEvento(tipo)).toBe(0);
  });

  test("S0-C7 una notificación válida envía el correo a Mailpit, la registra como enviada y no crea fila de WhatsApp", async ({ request }) => {
    const idExpediente = idExpedienteFicticio();
    const tipo = unico();
    const asunto = `S0-C7 ${tipo}`;

    const res = await notificar(request, { id_expediente: idExpediente, tipo_evento: tipo, asunto, cuerpo: "Mensaje ficticio de la prueba E2E." });
    expect(res.status()).toBe(200);
    const respuesta = await res.json();
    expect(respuesta).toEqual({
      id_expediente: idExpediente,
      correo: { estado_envio: "enviado", id_notificacion: expect.any(Number) },
      whatsapp: "no_aplica",
    });

    // El correo llegó a Mailpit, al apoderado titular y con el remitente de SMTP_FROM.
    const busqueda = await (await request.get(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`subject:"${asunto}"`)}`)).json();
    expect(busqueda.messages).toHaveLength(1);
    const mensaje = busqueda.messages[0];
    expect(mensaje.Subject).toBe(asunto);
    expect(mensaje.To.map((d: { Address: string }) => d.Address)).toEqual([CORREO_FAMILIA]);
    const remitente = process.env.SMTP_FROM!.match(/<([^>]+)>/)?.[1] ?? process.env.SMTP_FROM!;
    expect(mensaje.From.Address).toBe(remitente);

    // Quedó registrada en la BD como correo enviado, y no hay ninguna fila de WhatsApp (R22).
    const fila = consultarAdmision(
      `SELECT id_expediente, canal, tipo_evento, estado_envio FROM notificacion WHERE id_notificacion = ${respuesta.correo.id_notificacion}`,
    );
    expect(fila).toBe([idExpediente, "correo", tipo, "enviado"].join("\t"));
    expect(filasDeEvento(tipo)).toBe(1);
    expect(Number(consultarAdmision(`SELECT count(*) FROM notificacion WHERE tipo_evento = '${tipo}' AND canal = 'whatsapp'`))).toBe(0);
  });

  test("S0-C7 una entrada inválida responde 400 VALIDACION", async ({ request }) => {
    const res = await notificar(request, { id_expediente: "x" });
    expect(res.status()).toBe(400);
    expect((await res.json()).error.codigo).toBe("VALIDACION");
  });

  test("S0-C7 un expediente inexistente responde 502 CONTACTO_NO_DISPONIBLE y no registra notificación", async ({ request }) => {
    const tipo = unico();
    const res = await notificar(request, { id_expediente: 999999, tipo_evento: tipo, asunto: `S0-C7 ${tipo}`, cuerpo: "Mensaje ficticio." });
    expect(res.status()).toBe(502);
    expect((await res.json()).error.codigo).toBe("CONTACTO_NO_DISPONIBLE");
    expect(filasDeEvento(tipo)).toBe(0);
  });
});

test.describe("S0-C8 el token de la API interna no queda en n8n", () => {
  test("S0-C8 tras fallas de «Obtener contacto» (expediente inexistente y API detenida) el token no aparece en las ejecuciones guardadas", async ({ request }) => {
    test.setTimeout(180_000);
    const desde = new Date().toISOString();
    const cuerpo = (id: number) => ({ id_expediente: id, tipo_evento: unico(), asunto: "S0-C8", cuerpo: "Mensaje ficticio." });

    // Falla 1: la API responde 404 (expediente inexistente).
    expect((await notificar(request, cuerpo(999999))).status()).toBe(502);

    // Falla 2: la API no responde (contenedor detenido).
    docker(["stop", "api"]);
    try {
      expect((await notificar(request, cuerpo(idExpedienteFicticio()))).status()).toBe(502);
    } finally {
      docker(["start", "api"]);
      await expect
        .poll(async () => (await request.get(`${API}/salud`, { failOnStatusCode: false }).catch(() => null))?.status(), { timeout: 60_000 })
        .toBe(200);
    }

    // Hay ejecuciones con error desde el inicio de la prueba: la búsqueda cubre las fallas.
    const errores = Number(consultar("n8n", "n8n", `SELECT count(*) FROM execution_entity WHERE status = 'error' AND "startedAt" >= '${desde}'`));
    expect(errores).toBeGreaterThanOrEqual(2);

    // Búsqueda por valor: solo se informa si aparece, nunca se imprime.
    const token = process.env.INTERNAL_API_TOKEN!;
    const ejecuciones = consultar("n8n", "n8n", `SELECT d."workflowData"::text || d.data FROM execution_data d`);
    expect(ejecuciones.includes(token), "INTERNAL_API_TOKEN aparece en los datos de ejecución de n8n").toBe(false);
    const volcado = docker(["exec", "-T", "postgres", "pg_dump", "-U", "n8n", "-d", "n8n", "--data-only"]);
    expect(volcado.includes(token), "INTERNAL_API_TOKEN aparece en texto plano en la base n8n").toBe(false);
  });
});
