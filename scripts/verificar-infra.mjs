// Pruebas de la Etapa A del Sprint 0 (S0-A1..S0-A7) contra el entorno dev levantado con
// docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d
// Requiere haber ejecutado antes: npm run kc:usuarios-prueba
// No imprime valores de variables, contraseñas ni tokens.
import { execFileSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import net from "node:net";
import { resolve } from "node:path";
import { RAIZ, adminApi, cargarEntorno, requerida, tokenAdmin, urlKeycloak } from "./lib/keycloak.mjs";

cargarEntorno();
const COMPOSE = ["compose", "-f", "docker-compose.yml", "-f", "docker-compose.dev.yml"];
const REALM = requerida("KEYCLOAK_REALM");
const FRONTEND = requerida("FRONTEND_PUBLIC_URL").replace(/\/$/, "");
const CONTRASENA_PRUEBA = requerida("KEYCLOAK_TEST_USER_PASSWORD");
const puerto = (nombre, defecto) => Number(process.env[nombre] || defecto);
const usuariosPrueba = JSON.parse(readFileSync(resolve(RAIZ, "infra/keycloak/usuarios-prueba.json"), "utf8"));
const usuarioDeRol = (rol) => usuariosPrueba.find((u) => u.rol === rol).username;

function docker(args, opciones = {}) {
  return execFileSync("docker", [...COMPOSE, ...args], {
    cwd: RAIZ,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    ...opciones,
  });
}

function afirmar(condicion, mensaje) {
  if (!condicion) throw new Error(mensaje);
}

const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

const resultados = [];
async function prueba(id, nombre, fn) {
  try {
    await fn();
    resultados.push({ id, ok: true });
    console.log(`✔ ${id} ${nombre}`);
  } catch (e) {
    resultados.push({ id, ok: false });
    console.log(`✘ ${id} ${nombre}\n    ${e.message}`);
  }
}

// --- PostgreSQL: conexión por la IP de red del contenedor (regla scram de pg_hba, no la de loopback) ---
function conectar(usuario, contrasena, base) {
  try {
    docker(["exec", "-T", "-e", "PGPASSWORD", "postgres", "psql", "-h", "postgres", "-U", usuario, "-d", base, "-tAc", "select 1"], {
      env: { ...process.env, PGPASSWORD: contrasena },
    });
    return { ok: true, error: "" };
  } catch (e) {
    return { ok: false, error: String(e.stderr || e.message) };
  }
}

function puertoAbierto(port) {
  return new Promise((ok) => {
    const s = net.connect({ host: "127.0.0.1", port }, () => {
      s.end();
      ok(true);
    });
    s.on("error", () => ok(false));
    s.setTimeout(3000, () => {
      s.destroy();
      ok(false);
    });
  });
}

// --- Keycloak: login real por el formulario con Authorization Code + PKCE ---
function guardarCookies(res, jar) {
  for (const c of res.headers.getSetCookie()) {
    const [par] = c.split(";");
    const i = par.indexOf("=");
    jar.set(par.slice(0, i), par.slice(i + 1));
  }
}

async function iniciarSesion(clientId, usuario, contrasena) {
  const realmUrl = `${urlKeycloak()}/realms/${REALM}`;
  const redirectUri = `${FRONTEND}/callback`;
  const verificador = randomBytes(32).toString("base64url");
  const desafio = createHash("sha256").update(verificador).digest("base64url");
  const jar = new Map();

  const pagina = await fetch(
    `${realmUrl}/protocol/openid-connect/auth?` +
      new URLSearchParams({
        client_id: clientId,
        redirect_uri: redirectUri,
        response_type: "code",
        scope: "openid",
        state: randomBytes(8).toString("hex"),
        code_challenge: desafio,
        code_challenge_method: "S256",
      }),
    { redirect: "manual" },
  );
  guardarCookies(pagina, jar);
  afirmar(pagina.status === 200, `página de login de ${clientId}: HTTP ${pagina.status}`);
  const html = await pagina.text();
  const m = html.match(/<form[^>]*id="kc-form-login"[^>]*action="([^"]+)"/) || html.match(/action="([^"]*login-actions\/authenticate[^"]*)"/);
  afirmar(m, "no se encontró el formulario de login de Keycloak");

  const envio = await fetch(m[1].replaceAll("&amp;", "&"), {
    method: "POST",
    redirect: "manual",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Cookie: [...jar].map(([k, v]) => `${k}=${v}`).join("; "),
    },
    body: new URLSearchParams({ username: usuario, password: contrasena, credentialId: "" }),
  });
  const destino = envio.headers.get("location") ?? "";
  if (envio.status !== 302 || !destino.startsWith(redirectUri)) return { ok: false, status: envio.status };

  const codigo = new URL(destino).searchParams.get("code");
  const token = await fetch(`${realmUrl}/protocol/openid-connect/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      client_id: clientId,
      code: codigo,
      redirect_uri: redirectUri,
      code_verifier: verificador,
    }),
  });
  afirmar(token.ok, `canje del código por token: HTTP ${token.status}`);
  const { access_token } = await token.json();
  return { ok: true, claims: JSON.parse(Buffer.from(access_token.split(".")[1], "base64url").toString("utf8")) };
}

function verificarClaims(claims, rol) {
  const aud = [].concat(claims.aud ?? []);
  afirmar(claims.iss === `${urlKeycloak()}/realms/${REALM}`, "el emisor (iss) no es KEYCLOAK_PUBLIC_URL/realms/<realm>");
  afirmar(aud.includes("api-admision"), "aud no incluye api-admision");
  afirmar(claims.realm_access?.roles?.includes(rol), `realm_access.roles no incluye ${rol}`);
}

// ======================================================================================

await prueba("S0-A1", "los 4 servicios de dev están healthy", async () => {
  const salida = docker(["ps", "--format", "json"]).trim();
  const servicios = salida.startsWith("[") ? JSON.parse(salida) : salida.split(/\r?\n/).filter(Boolean).map((l) => JSON.parse(l));
  for (const nombre of ["postgres", "keycloak", "n8n", "mailpit"]) {
    const c = servicios.find((s) => s.Service === nombre);
    afirmar(c, `${nombre} no está levantado`);
    afirmar(c.Health === "healthy", `${nombre}: ${c.State}/${c.Health || "sin healthcheck"}`);
  }
});

await prueba("S0-A2", "cada usuario entra solo a su base; n8n y keycloak no entran a admision", async () => {
  const adm = [requerida("ADMISION_DB_USER"), requerida("ADMISION_DB_PASSWORD")];
  const n8n = [requerida("N8N_DB_USER"), requerida("N8N_DB_PASSWORD")];
  const kc = [requerida("KEYCLOAK_DB_USER"), requerida("KEYCLOAK_DB_PASSWORD")];
  const dbAdm = requerida("ADMISION_DB");
  const permitidas = [
    [adm, dbAdm],
    [adm, `${dbAdm}_test`],
    [n8n, requerida("N8N_DB")],
    [kc, requerida("KEYCLOAK_DB")],
  ];
  const denegadas = [
    [n8n, dbAdm],
    [n8n, `${dbAdm}_test`],
    [kc, dbAdm],
    [kc, `${dbAdm}_test`],
    [adm, requerida("N8N_DB")],
    [adm, requerida("KEYCLOAK_DB")],
  ];
  for (const [[u, p], db] of permitidas) {
    const r = conectar(u, p, db);
    afirmar(r.ok, `${u} no pudo conectarse a ${db}: ${r.error.split("\n")[0]}`);
  }
  for (const [[u, p], db] of denegadas) {
    const r = conectar(u, p, db);
    afirmar(!r.ok, `${u} SÍ pudo conectarse a ${db}`);
    afirmar(/permission denied/i.test(r.error), `${u} → ${db} falló, pero no por permisos: ${r.error.split("\n")[0]}`);
  }
  afirmar(await puertoAbierto(puerto("POSTGRES_HOST_PORT", 55432)), "Postgres no responde en 127.0.0.1:POSTGRES_HOST_PORT");
});

const api = adminApi(await tokenAdmin().catch(() => "sin-token"));

await prueba("S0-A3", "el realm tiene los 6 roles, los 3 clientes y la fuerza bruta de 5 intentos", async () => {
  const { datos: realm } = await api("GET", "");
  afirmar(realm.bruteForceProtected === true, "bruteForceProtected no está activo");
  afirmar(realm.failureFactor === 5, `failureFactor = ${realm.failureFactor}, se esperaba 5`);
  afirmar(realm.permanentLockout === false, "el bloqueo debe ser temporal (permanentLockout = false)");

  const { datos: roles } = await api("GET", "/roles");
  for (const r of ["familia", "secretaria", "tesoreria", "psicologa", "evaluador_academico", "directora"]) {
    afirmar(roles.some((x) => x.name === r), `falta el rol ${r}`);
  }

  const cliente = async (clientId) => (await api("GET", `/clients?clientId=${clientId}`)).datos[0];
  for (const id of ["portal-familias", "gestion-interna"]) {
    const c = await cliente(id);
    afirmar(c, `falta el cliente ${id}`);
    afirmar(c.publicClient && c.standardFlowEnabled && !c.directAccessGrantsEnabled, `${id} debe ser público, con Authorization Code y sin direct grant`);
    afirmar(c.attributes?.["pkce.code.challenge.method"] === "S256", `${id} no exige PKCE S256`);
    afirmar(
      c.protocolMappers?.some((m) => m.protocolMapper === "oidc-audience-mapper" && m.config["included.client.audience"] === "api-admision"),
      `${id} no tiene el audience mapper hacia api-admision`,
    );
  }

  const apiCliente = await cliente("api-admision");
  afirmar(apiCliente && !apiCliente.publicClient && apiCliente.serviceAccountsEnabled, "api-admision debe ser confidencial con service account");
  const { datos: sa } = await api("GET", `/clients/${apiCliente.id}/service-account-user`);
  const gestion = await cliente("realm-management");
  const { datos: rolesSa } = await api("GET", `/users/${sa.id}/role-mappings/clients/${gestion.id}`);
  for (const r of ["manage-users", "view-users"]) {
    afirmar(rolesSa.some((x) => x.name === r), `la service account de api-admision no tiene ${r}`);
  }
});

await prueba("S0-A4", "un usuario de prueba inicia sesión (PKCE) y su token trae rol, aud e iss", async () => {
  const familia = await iniciarSesion("portal-familias", usuarioDeRol("familia"), CONTRASENA_PRUEBA);
  afirmar(familia.ok, `login de familia en portal-familias falló (HTTP ${familia.status}); ¿ejecutaste npm run kc:usuarios-prueba?`);
  verificarClaims(familia.claims, "familia");

  const secretaria = await iniciarSesion("gestion-interna", usuarioDeRol("secretaria"), CONTRASENA_PRUEBA);
  afirmar(secretaria.ok, `login de secretaria en gestion-interna falló (HTTP ${secretaria.status})`);
  verificarClaims(secretaria.claims, "secretaria");
});

await prueba("S0-A5", "tras 5 intentos fallidos consecutivos la cuenta se bloquea temporalmente", async () => {
  const usuario = usuarioDeRol("evaluador_academico");
  const { datos: encontrados } = await api("GET", `/users?exact=true&username=${encodeURIComponent(usuario)}`);
  afirmar(encontrados[0], `no existe ${usuario}`);
  const ruta = `/attack-detection/brute-force/users/${encontrados[0].id}`;
  await api("DELETE", ruta);
  // Intentos separados más de quickLoginCheckMilliSeconds (1 s) para medir solo failureFactor.
  const fallar = async (n) => {
    for (let i = 0; i < n; i++) {
      await esperar(1200);
      const r = await iniciarSesion("gestion-interna", usuario, "contrasena-incorrecta");
      afirmar(!r.ok, "una contraseña incorrecta fue aceptada");
    }
    await esperar(1200);
  };
  try {
    await fallar(4);
    afirmar((await iniciarSesion("gestion-interna", usuario, CONTRASENA_PRUEBA)).ok, "con 4 fallos la cuenta ya estaba bloqueada");

    await fallar(5);
    afirmar(!(await iniciarSesion("gestion-interna", usuario, CONTRASENA_PRUEBA)).ok, "tras 5 fallos la contraseña correcta todavía entra");
    const { datos: estado } = await api("GET", ruta);
    afirmar(estado.disabled === true, "Keycloak no reporta la cuenta como bloqueada");
  } finally {
    await api("DELETE", ruta);
  }
  await esperar(1200);
  afirmar((await iniciarSesion("gestion-interna", usuario, CONTRASENA_PRUEBA)).ok, "tras desbloquear por Admin API no se pudo entrar");
});

await prueba("S0-A6", "Mailpit y n8n responden en sus puertos de host", async () => {
  const mail = await fetch(`http://127.0.0.1:${puerto("MAILPIT_UI_PORT", 8025)}/api/v1/info`);
  afirmar(mail.ok, `Mailpit: HTTP ${mail.status}`);
  const n8n = await fetch(`http://127.0.0.1:${puerto("N8N_HOST_PORT", 5679)}/healthz`);
  afirmar(n8n.ok, `n8n: HTTP ${n8n.status}`);
});

await prueba("S0-A7", "n8n no recibe secretos ajenos y ningún servicio usa env_file", async () => {
  const prohibidas = [
    "DATA_ENCRYPTION_KEY",
    "DATA_HMAC_KEY",
    "KEYCLOAK_API_CLIENT_SECRET",
    "KEYCLOAK_ADMIN_PASSWORD",
    "POSTGRES_SUPERPASSWORD",
    "ADMISION_DB_PASSWORD",
    "KEYCLOAK_DB_PASSWORD",
  ];
  const variables = docker(["exec", "-T", "n8n", "env"])
    .split(/\r?\n/)
    .filter((l) => l.includes("="))
    .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]);
  const porNombre = prohibidas.filter((p) => variables.some(([n]) => n === p));
  afirmar(!porNombre.length, `n8n recibe variables prohibidas: ${porNombre.join(", ")}`);
  // Además, ningún valor del contenedor coincide con un secreto prohibido, aunque tenga otro nombre.
  const porValor = prohibidas.filter((p) => variables.some(([, v]) => v === requerida(p)));
  afirmar(!porValor.length, `n8n contiene el valor de: ${porValor.join(", ")}`);

  const config = JSON.parse(docker(["config", "--format", "json"]));
  const conEnvFile = Object.entries(config.services).filter(([, s]) => s.env_file).map(([n]) => n);
  afirmar(!conEnvFile.length, `servicios con env_file: ${conEnvFile.join(", ")}`);
});

const fallidas = resultados.filter((r) => !r.ok);
console.log(`\n${resultados.length - fallidas.length}/${resultados.length} pruebas en verde`);
process.exit(fallidas.length ? 1 : 0);
