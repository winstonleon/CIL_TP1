// Crea o actualiza en el n8n del proyecto las tres credenciales que usan los flujos, con los valores de .env
// (ADR-06; GUIA-INSTALACION.md §3). Elimina el copiado manual y sincroniza los secretos que viven en dos
// lugares: se vuelve a correr cada vez que cambian en .env.
//   - Cada credencial se busca por NOMBRE EXACTO. Si no existe, se crea (POST); si existe una, se comprueba
//     su tipo y se actualiza con PATCH, que conserva el ID y no rompe los flujos importados. Si hay más de
//     una con el mismo nombre, o el tipo no coincide, falla.
//   - Nunca imprime valores: solo «creada» o «actualizada» y el ID.
// Usa N8N_CIL_API_URL y N8N_CIL_API_KEY (variables de Windows, las mismas del MCP).
// Uso: npm run n8n:credenciales
import { cargarEntorno, requerida } from "./lib/keycloak.mjs";

cargarEntorno();
const URL_N8N = process.env.N8N_CIL_API_URL?.replace(/\/$/, "");
const CLAVE = process.env.N8N_CIL_API_KEY;
if (!URL_N8N || !CLAVE) {
  console.error("Faltan N8N_CIL_API_URL o N8N_CIL_API_KEY en el entorno (ver GUIA-INSTALACION.md §3).");
  process.exit(2);
}

const secretoWebhook = requerida("N8N_WEBHOOK_SECRET");
const tokenApi = requerida("INTERNAL_API_TOKEN");
const SECRETOS = [secretoWebhook, tokenApi];
const tapar = (texto) => SECRETOS.reduce((t, s) => t.split(s).join("***"), texto);

// La credencial de la API interna solo puede enviarse al host de la API (Allowed HTTP Request Domains).
const hostApi = new URL(requerida("API_INTERNAL_URL")).hostname;

const DESEADAS = [
  {
    name: "cil-smtp",
    type: "smtp",
    data: {
      user: "",
      password: "",
      host: requerida("SMTP_HOST"),
      port: Number(requerida("SMTP_PORT")),
      secure: false,
      disableStartTls: true, // Mailpit (dev) no ofrece TLS
    },
  },
  {
    name: "cil-webhook-secret",
    type: "httpHeaderAuth",
    data: { name: "X-Webhook-Secret", value: secretoWebhook },
  },
  {
    name: "cil-api-interna",
    type: "httpHeaderAuth",
    data: {
      name: "Authorization",
      value: `Bearer ${tokenApi}`,
      allowedHttpRequestDomains: "domains",
      allowedDomains: hostApi,
    },
  },
];

async function api(metodo, ruta, cuerpo) {
  const res = await fetch(`${URL_N8N}/api/v1${ruta}`, {
    method: metodo,
    headers: { "X-N8N-API-KEY": CLAVE, accept: "application/json", ...(cuerpo ? { "Content-Type": "application/json" } : {}) },
    body: cuerpo ? JSON.stringify(cuerpo) : undefined,
  });
  const texto = await res.text();
  if (!res.ok) throw new Error(`n8n ${metodo} ${ruta}: HTTP ${res.status} ${tapar(texto).slice(0, 300)}`);
  return texto ? JSON.parse(texto) : null;
}

async function listarCredenciales() {
  const todas = [];
  let cursor;
  do {
    const pagina = await api("GET", `/credentials?limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`);
    todas.push(...pagina.data);
    cursor = pagina.nextCursor;
  } while (cursor);
  return todas;
}

const existentes = await listarCredenciales();
let creadas = 0;
let fallos = 0;

for (const d of DESEADAS) {
  try {
    const mismas = existentes.filter((c) => c.name === d.name);
    if (mismas.length > 1) throw new Error(`hay ${mismas.length} credenciales llamadas «${d.name}»: es ambiguo, deja solo una.`);
    if (mismas.length === 1) {
      if (mismas[0].type !== d.type) throw new Error(`existe con tipo ${mismas[0].type}, pero se esperaba ${d.type}.`);
      await api("PATCH", `/credentials/${mismas[0].id}`, { data: d.data });
      console.log(`${d.name}: actualizada (id ${mismas[0].id})`);
    } else {
      const nueva = await api("POST", "/credentials", { name: d.name, type: d.type, data: d.data });
      creadas++;
      console.log(`${d.name}: creada (id ${nueva.id})`);
    }
  } catch (e) {
    fallos++;
    console.error(`✘ ${d.name}: ${tapar(e.message)}`);
  }
}

if (creadas) {
  console.log("Se crearon credenciales nuevas (IDs nuevos): corre `npm run n8n:importar` para que los flujos las usen.");
}
process.exit(fallos ? 1 : 0);
