// Verificación del despliegue de producción (ADR-08; C5, C11, C14, C19 y C46) contra un entorno levantado con
//   docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d
// Se corre en el servidor, desde la raíz del repo: lee .env y consulta a Docker. No imprime valores de variables,
// contraseñas ni tokens. Las rutas se piden tal cual, sin normalizar, con node:http y node:https.
// Uso: npm run prod:verificar -- [opciones]
//   --certificado-autofirmado  ensayo con un certificado propio: no valida la cadena TLS.
//   --sin-docker               omite lo que consulta a Docker (para correrlo desde otra máquina).
//   --limite-por-ip            comprueba además que X-Forwarded-For no esquiva el límite por IP. Deja la IP desde la
//                              que se corre sin poder enviar P01 ni reservar en P02 durante 10 minutos.
// Con PROD_VERIFICAR_USUARIO y PROD_VERIFICAR_CONTRASENA en el entorno (y, si no es una familia,
// PROD_VERIFICAR_CLIENTE=gestion-interna), comprueba también el ingreso de esa cuenta.
import { execFileSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import http from "node:http";
import https from "node:https";
import tls from "node:tls";
import { RAIZ, cargarEntorno, requerida, urlKeycloak } from "./lib/keycloak.mjs";

const opciones = new Set(process.argv.slice(2));
const AUTOFIRMADO = opciones.has("--certificado-autofirmado");
const SIN_DOCKER = opciones.has("--sin-docker");
const LIMITE_POR_IP = opciones.has("--limite-por-ip");
// fetch (el ingreso con PKCE) no tiene otra forma de aceptar un certificado propio.
if (AUTOFIRMADO) process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

cargarEntorno();
const COMPOSE = ["compose", "-f", "docker-compose.yml", "-f", "docker-compose.prod.yml"];
const SITIO = new URL(requerida("FRONTEND_PUBLIC_URL"));
const KEYCLOAK = new URL(urlKeycloak());
const REALM = requerida("KEYCLOAK_REALM");
const PUERTO_HTTPS = Number(SITIO.port || 443);
const PUERTO_HTTP = Number(process.env.NGINX_HTTP_PORT || 80);
const SERVICIOS = ["postgres", "keycloak", "n8n", "api", "nginx"];

function docker(args, opcionesExec = {}) {
  return execFileSync("docker", [...COMPOSE, ...args], {
    cwd: RAIZ,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    maxBuffer: 1 << 26,
    ...opcionesExec,
  });
}

function afirmar(condicion, mensaje) {
  if (!condicion) throw new Error(mensaje);
}

// Petición con la ruta exacta. `esperarContinuar` envía el cuerpo solo si el servidor lo acepta (Expect: 100-continue):
// así un cuerpo demasiado grande recibe su 413 sin llegar a transmitirse.
function pedir(ruta, { metodo = "GET", cabeceras = {}, cuerpo, plano = false, esperarContinuar = false } = {}) {
  return new Promise((ok, falla) => {
    const todas = { ...cabeceras };
    if (cuerpo) todas["Content-Length"] = String(cuerpo.length);
    if (esperarContinuar) todas.Expect = "100-continue";
    const req = (plano ? http : https).request(
      {
        host: SITIO.hostname,
        port: plano ? PUERTO_HTTP : PUERTO_HTTPS,
        path: ruta,
        method: metodo,
        headers: todas,
        rejectUnauthorized: !AUTOFIRMADO,
      },
      (res) => {
        const partes = [];
        res.on("data", (p) => partes.push(p));
        res.on("end", () => ok({ status: res.statusCode ?? 0, cabeceras: res.headers, cuerpo: Buffer.concat(partes).toString("utf8") }));
      },
    );
    req.on("error", (e) => falla(new Error(`${metodo} ${ruta.slice(0, 60)}: ${e.code ?? e.message}`)));
    req.setTimeout(120_000, () => req.destroy(new Error("sin respuesta en 120 s")));
    if (cuerpo && esperarContinuar) req.on("continue", () => req.end(cuerpo));
    else req.end(cuerpo);
  });
}

// La API responde siempre con un error en JSON ({ error: { codigo } }); NGINX, con su propia página.
function codigoApi(respuesta) {
  try {
    return JSON.parse(respuesta.cuerpo).error?.codigo ?? null;
  } catch {
    return null;
  }
}

const resultados = [];
async function prueba(id, nombre, fn, motivoOmitida) {
  if (motivoOmitida) {
    resultados.push({ ok: null });
    console.log(`– ${id} ${nombre}\n    no ejecutada: ${motivoOmitida}`);
    return;
  }
  try {
    const nota = await fn();
    resultados.push({ ok: true });
    console.log(`✔ ${id} ${nombre}${nota ? `\n    ${nota}` : ""}`);
  } catch (e) {
    resultados.push({ ok: false });
    console.log(`✘ ${id} ${nombre}\n    ${e.message}`);
  }
}

const sinDocker = SIN_DOCKER ? "se pasó --sin-docker" : null;

// ======================================================================================

await prueba(
  "ADR-08",
  "los cinco servicios están healthy y solo NGINX publica puertos",
  async () => {
    const salida = docker(["ps", "--format", "json"]).trim();
    const contenedores = salida.startsWith("[") ? JSON.parse(salida) : salida.split(/\r?\n/).filter(Boolean).map((l) => JSON.parse(l));
    for (const nombre of SERVICIOS) {
      const c = contenedores.find((s) => s.Service === nombre);
      afirmar(c, `${nombre} no está levantado`);
      afirmar(c.Health === "healthy", `${nombre}: ${c.State}/${c.Health || "sin healthcheck"}`);
    }
    const publicados = (c) => (c.Publishers ?? []).filter((p) => p.PublishedPort > 0);
    for (const c of contenedores) {
      if (c.Service === "nginx") continue;
      afirmar(!publicados(c).length, `${c.Service} publica el puerto ${publicados(c)[0]?.PublishedPort}`);
    }
    const deNginx = new Set(publicados(contenedores.find((s) => s.Service === "nginx")).map((p) => p.TargetPort));
    afirmar(deNginx.has(80) && deNginx.has(443), "NGINX no publica el 80 y el 443 del contenedor");
  },
  sinDocker,
);

await prueba("ADR-08", "HTTP redirige a la URL pública por HTTPS y conserva la ruta", async () => {
  const r = await pedir("/portal/panel?x=1", { plano: true });
  afirmar(r.status === 301, `respondió ${r.status}, se esperaba 301`);
  afirmar(r.cabeceras.location === `${SITIO.origin}/portal/panel?x=1`, "la cabecera Location no es FRONTEND_PUBLIC_URL más la ruta");
});

await prueba(
  "ADR-08",
  "el certificado TLS es válido para el dominio y no vence en los próximos 15 días",
  () =>
    new Promise((ok, falla) => {
      const s = tls.connect({ host: SITIO.hostname, port: PUERTO_HTTPS, servername: SITIO.hostname }, () => {
        const dias = Math.floor((new Date(s.getPeerCertificate().valid_to).getTime() - Date.now()) / 86_400_000);
        s.end();
        if (dias < 15) falla(new Error(`vence en ${dias} días: revisa la renovación (certbot)`));
        else ok(`vence en ${dias} días`);
      });
      s.on("error", (e) => falla(new Error(`el certificado no se pudo validar (${e.code ?? e.message})`)));
    }),
  AUTOFIRMADO ? "se pasó --certificado-autofirmado" : null,
);

await prueba("ADR-08", "el frontend responde, las rutas del router devuelven index.html y un asset inexistente da 404", async () => {
  for (const ruta of ["/", "/solicitud-informacion", "/portal/panel", "/gestion/bandeja/7", "/callback/portal?code=x&state=y"]) {
    const r = await pedir(ruta);
    afirmar(r.status === 200 && r.cuerpo.includes('id="app"'), `${ruta.split("?")[0]} no devolvió index.html (HTTP ${r.status})`);
  }
  const inicio = await pedir("/");
  const script = inicio.cuerpo.match(/\/assets\/[^"]+\.js/)?.[0];
  afirmar(script, "index.html no referencia ningún script de /assets");
  const asset = await pedir(script, { cabeceras: { "Accept-Encoding": "gzip" } });
  afirmar(asset.status === 200, `${script}: HTTP ${asset.status}`);
  afirmar(/immutable/.test(asset.cabeceras["cache-control"] ?? ""), "los archivos de /assets no llevan Cache-Control immutable");
  afirmar((await pedir("/assets/no-existe.js")).status === 404, "un asset inexistente no dio 404");
});

await prueba("C19", "index.html no se guarda en caché y pide al navegador que no envíe Referer", async () => {
  const r = await pedir("/visita-guiada?t=prueba");
  afirmar(r.cabeceras["cache-control"] === "no-cache", "falta Cache-Control: no-cache");
  afirmar(r.cabeceras["referrer-policy"] === "no-referrer", "falta Referrer-Policy: no-referrer");
});

await prueba("C19", "/api/salud y /api/personal (sin token) llegan a la API", async () => {
  const salud = await pedir("/api/salud");
  afirmar(salud.status === 200 && JSON.parse(salud.cuerpo).estado === "ok", `/api/salud: HTTP ${salud.status}`);
  const personal = await pedir("/api/personal");
  afirmar(personal.status === 401 && codigoApi(personal) === "NO_AUTENTICADO", `/api/personal: HTTP ${personal.status}`);
});

await prueba("C19", "/api/internal y sus variantes no llegan a la API", async () => {
  // Las mismas variantes que e2e/proxy.spec.ts comprueba contra el proxy de dev, y algunas más.
  const bloqueadas = [
    "/api/internal",
    "/api/internal/",
    "/api/internal/expedientes/1/contacto",
    "/api//internal/expedientes/1/contacto",
    "/api/./internal/expedientes/1/contacto",
    "/api/%69nternal/expedientes/1/contacto",
    "/api/Internal/expedientes/1/contacto",
    "/api/INTERNAL/expedientes/1/contacto",
    "/api/iNtErNaL/expedientes/1/contacto",
    "/api/publico/../internal/expedientes/1/contacto",
    "/api/publico/%2e%2e/internal/expedientes/1/contacto",
    "/api%2Finternal%2Fexpedientes/1/contacto",
    "/api/internal%2Fexpedientes/1/contacto",
    "/api/internal?x=1",
  ];
  for (const ruta of bloqueadas) {
    const r = await pedir(ruta);
    afirmar(r.status === 404 && codigoApi(r) === null, `${ruta} llegó a la API o no dio 404 (HTTP ${r.status}, ${codigoApi(r) ?? "sin código"})`);
  }
  // Doble codificación: NGINX no la reconoce como /internal y la reenvía, pero la API tampoco: no es su router interno.
  const doble = await pedir("/api/%2569nternal/expedientes/1/contacto");
  afirmar(codigoApi(doble) !== "NO_AUTENTICADO" && doble.status !== 200, `la doble codificación alcanzó el router interno (HTTP ${doble.status})`);
});

await prueba("C11", "los webhooks de n8n no se publican", async () => {
  for (const ruta of ["/webhook/captacion", "/webhook-test/captacion", "/webhook-waiting/1", "/Webhook/agendamiento", "/webhook"]) {
    const r = await pedir(ruta, { metodo: "POST", cabeceras: { "Content-Type": "application/json" }, cuerpo: Buffer.from("{}") });
    afirmar(r.status === 404, `${ruta}: HTTP ${r.status}, se esperaba 404`);
    afirmar(!/n8n|workflow/i.test(r.cuerpo), `${ruta}: la respuesta parece de n8n`);
  }
});

await prueba("C46", "/api acepta un cuerpo de 10,5 MB y NGINX corta uno de 12 MB con 413", async () => {
  const cabeceras = { "Content-Type": "application/octet-stream" };
  const cabe = await pedir("/api/familia/expedientes/1/documentos", {
    metodo: "POST",
    cabeceras,
    cuerpo: Buffer.alloc(10.5 * 1024 * 1024, 0x61),
    esperarContinuar: true,
  });
  afirmar(cabe.status === 401 && codigoApi(cabe) === "NO_AUTENTICADO", `10,5 MB no llegaron a la API (HTTP ${cabe.status})`);
  const noCabe = await pedir("/api/familia/expedientes/1/documentos", {
    metodo: "POST",
    cabeceras,
    cuerpo: Buffer.alloc(12 * 1024 * 1024, 0x61),
    esperarContinuar: true,
  });
  afirmar(noCabe.status === 413 && codigoApi(noCabe) === null, `12 MB: HTTP ${noCabe.status}, se esperaba 413 de NGINX`);
  // Fuera de /api rige el tope por defecto de NGINX (1 MB).
  const fuera = await pedir("/", { metodo: "POST", cabeceras, cuerpo: Buffer.alloc(2 * 1024 * 1024, 0x61), esperarContinuar: true });
  afirmar(fuera.status === 413, `2 MB fuera de /api: HTTP ${fuera.status}, se esperaba 413`);
});

await prueba("ADR-08", "Keycloak responde bajo /auth con el emisor público", async () => {
  afirmar(KEYCLOAK.origin === SITIO.origin && KEYCLOAK.pathname.replace(/\/$/, "") === "/auth", "KEYCLOAK_PUBLIC_URL debe ser FRONTEND_PUBLIC_URL más /auth");
  const r = await pedir(`/auth/realms/${REALM}/.well-known/openid-configuration`);
  afirmar(r.status === 200, `HTTP ${r.status}${r.status === 503 ? " (Keycloak sigue arrancando: reintenta en un minuto)" : ""}`);
  const config = JSON.parse(r.cuerpo);
  const emisor = `${urlKeycloak()}/realms/${REALM}`;
  afirmar(config.issuer === emisor, "el emisor (issuer) no es KEYCLOAK_PUBLIC_URL/realms/<realm>");
  for (const campo of ["authorization_endpoint", "token_endpoint", "jwks_uri", "end_session_endpoint"]) {
    afirmar(config[campo]?.startsWith(`${emisor}/`), `${campo} no está bajo la URL pública`);
  }
  const login = await pedir(`/auth/realms/${REALM}/protocol/openid-connect/auth?client_id=portal-familias&response_type=code&scope=openid&redirect_uri=${encodeURIComponent(`${SITIO.origin}/callback/portal`)}&code_challenge=${"a".repeat(43)}&code_challenge_method=S256`);
  afirmar(login.status === 200 && login.cuerpo.includes("kc-form-login"), `la página de ingreso no cargó (HTTP ${login.status})`);
  const css = login.cuerpo.match(/\/auth\/resources\/[^"']+\.css/)?.[0];
  afirmar(css, "la página de ingreso no referencia sus estilos bajo /auth/resources");
  afirmar((await pedir(css)).status === 200, "los recursos del tema no cargan por /auth/resources");
});

await prueba("ADR-08", "la consola de administración, la Admin API, la salud y las métricas de Keycloak no se publican", async () => {
  const rutas = [
    "/auth/",
    "/auth/admin/",
    "/auth/admin/master/console/",
    `/auth/admin/realms/${REALM}/users`,
    "/auth/health",
    "/auth/health/ready",
    "/auth/metrics",
    "/auth/realms/../admin/master/console/",
    "/auth/realms/..%2Fadmin/master/console/",
    "/auth/realms/%2e%2e/admin/master/console/",
    "/auth/realms/..;/admin/master/console/",
    "/auth/Admin/master/console/",
  ];
  for (const ruta of rutas) {
    const r = await pedir(ruta);
    afirmar(r.status === 404 && !/keycloak/i.test(r.cuerpo), `${ruta}: HTTP ${r.status}, se esperaba el 404 de NGINX`);
  }
});

await prueba(
  "C19",
  "el registro de acceso de NGINX no guarda la consulta ni el Referer",
  async () => {
    const enConsulta = `marca-${randomBytes(6).toString("hex")}`;
    const enReferer = `marca-${randomBytes(6).toString("hex")}`;
    const ruta = `/visita-guiada/${randomBytes(4).toString("hex")}`;
    await pedir(`${ruta}?t=${enConsulta}`, { cabeceras: { Referer: `${SITIO.origin}/visita-guiada?t=${enReferer}` } });
    await new Promise((r) => setTimeout(r, 1500));
    const registro = docker(["logs", "--since", "2m", "nginx"], { stdio: ["ignore", "pipe", "ignore"] });
    afirmar(registro.includes(`GET ${ruta} `), "la petición no aparece en el registro de acceso");
    afirmar(!registro.includes(enConsulta), "la consulta quedó en el registro de acceso");
    afirmar(!registro.includes(enReferer), "el Referer quedó en el registro de acceso");
  },
  sinDocker,
);

await prueba(
  "C5",
  "n8n recibe la contraseña de su base y su clave de cifrado como archivos, no como variables",
  async () => {
    const variables = docker(["exec", "-T", "n8n", "env"])
      .split(/\r?\n/)
      .filter((l) => l.includes("="))
      .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]);
    const nombres = new Set(variables.map(([n]) => n));
    for (const n of ["DB_POSTGRESDB_PASSWORD", "N8N_ENCRYPTION_KEY"]) {
      afirmar(!nombres.has(n), `n8n recibe ${n} como variable`);
      afirmar(nombres.has(`${n}_FILE`), `n8n no recibe ${n}_FILE`);
    }
    const secretos = ["N8N_DB_PASSWORD", "N8N_ENCRYPTION_KEY"].map((n) => [n, requerida(n)]);
    const porValor = secretos.filter(([, s]) => variables.some(([, v]) => v === s)).map(([n]) => n);
    afirmar(!porValor.length, `el entorno de n8n contiene el valor de: ${porValor.join(", ")}`);
    // n8n guarda en su volumen la clave con la que arrancó: debe ser la del secreto, no una generada por él.
    const guardada = JSON.parse(docker(["exec", "-T", "n8n", "cat", "/home/node/.n8n/config"])).encryptionKey;
    afirmar(guardada === requerida("N8N_ENCRYPTION_KEY"), "n8n no está usando la clave de cifrado de .env");
  },
  sinDocker,
);

await prueba(
  "C14",
  "la base de pruebas no existe en producción",
  async () => {
    const nombre = `${requerida("ADMISION_DB").replace(/_test$/, "")}_test`;
    afirmar(/^[a-z0-9_]+$/.test(nombre), "ADMISION_DB tiene caracteres inesperados");
    const sql = `select count(*) from pg_database where datname = '${nombre}'`;
    const cuenta = docker(["exec", "-T", "postgres", "sh", "-c", `psql -U "$POSTGRES_USER" -d postgres -tAc "${sql}"`]).trim();
    afirmar(cuenta === "0", `existe la base ${nombre}`);
  },
  sinDocker,
);

await prueba(
  "C19",
  "la IP del cliente la fija NGINX: X-Forwarded-For no esquiva el límite por IP de las rutas públicas",
  async () => {
    // Seis envíos inválidos (no guardan nada), cada uno con otra IP falsa. Si NGINX reenviara esa cabecera, cada uno
    // tendría su propio contador y ninguno llegaría al límite de 5 cada 10 minutos (ADR-17).
    const estados = [];
    for (let i = 1; i <= 6; i++) {
      const r = await pedir("/api/publico/solicitud-informacion", {
        metodo: "POST",
        cabeceras: { "Content-Type": "application/json", "X-Forwarded-For": `203.0.113.${i}` },
        cuerpo: Buffer.from("{}"),
      });
      estados.push(r.status);
    }
    afirmar(estados.includes(429), `seis envíos con IP falsas distintas no llegaron al límite (${estados.join(", ")})`);
    return `estados: ${estados.join(", ")}`;
  },
  LIMITE_POR_IP ? null : "deja esta IP limitada 10 minutos: pásale --limite-por-ip",
);

const usuario = process.env.PROD_VERIFICAR_USUARIO;
const contrasena = process.env.PROD_VERIFICAR_CONTRASENA;
await prueba(
  "ADR-08",
  "una cuenta inicia sesión por /auth (PKCE) y la API acepta su token",
  async () => {
    const cliente = process.env.PROD_VERIFICAR_CLIENTE || "portal-familias";
    const realmUrl = `${urlKeycloak()}/realms/${REALM}`;
    const redirectUri = `${SITIO.origin}/callback/${cliente === "portal-familias" ? "portal" : "gestion"}`;
    const verificador = randomBytes(32).toString("base64url");
    const galletas = new Map();
    const guardar = (res) => {
      for (const c of res.headers.getSetCookie()) {
        const [par] = c.split(";");
        galletas.set(par.slice(0, par.indexOf("=")), par.slice(par.indexOf("=") + 1));
      }
    };
    const pagina = await fetch(
      `${realmUrl}/protocol/openid-connect/auth?` +
        new URLSearchParams({
          client_id: cliente,
          redirect_uri: redirectUri,
          response_type: "code",
          scope: "openid",
          state: randomBytes(8).toString("hex"),
          code_challenge: createHash("sha256").update(verificador).digest("base64url"),
          code_challenge_method: "S256",
        }),
      { redirect: "manual" },
    );
    guardar(pagina);
    afirmar(pagina.status === 200, `página de ingreso de ${cliente}: HTTP ${pagina.status}`);
    const accion = (await pagina.text()).match(/<form[^>]*id="kc-form-login"[^>]*action="([^"]+)"/)?.[1];
    afirmar(accion, "no se encontró el formulario de ingreso de Keycloak");
    afirmar(accion.startsWith(`${realmUrl}/`), "el formulario de ingreso no apunta a la URL pública");
    const envio = await fetch(accion.replaceAll("&amp;", "&"), {
      method: "POST",
      redirect: "manual",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Cookie: [...galletas].map(([k, v]) => `${k}=${v}`).join("; ") },
      body: new URLSearchParams({ username: usuario, password: contrasena, credentialId: "" }),
    });
    const destino = envio.headers.get("location") ?? "";
    afirmar(envio.status === 302 && destino.startsWith(redirectUri), `Keycloak no aceptó la cuenta (HTTP ${envio.status})`);
    const canje = await fetch(`${realmUrl}/protocol/openid-connect/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        client_id: cliente,
        code: new URL(destino).searchParams.get("code"),
        redirect_uri: redirectUri,
        code_verifier: verificador,
      }),
    });
    afirmar(canje.ok, `canje del código por el token: HTTP ${canje.status}`);
    const { access_token: token } = await canje.json();
    const datos = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8"));
    afirmar(datos.iss === realmUrl, "el emisor del token no es KEYCLOAK_PUBLIC_URL/realms/<realm>");
    const esFamilia = datos.realm_access?.roles?.includes("familia");
    const r = await pedir(esFamilia ? "/api/familia/expedientes" : "/api/campana-activa", { cabeceras: { Authorization: `Bearer ${token}` } });
    // 401 es «token rechazado». Un 403 también prueba que la API lo validó (cuenta del personal sin fila activa).
    afirmar(r.status !== 401 && [200, 403].includes(r.status), `la API no aceptó el token (HTTP ${r.status}, ${codigoApi(r) ?? "sin código"})`);
    return `la API respondió ${r.status}`;
  },
  usuario && contrasena ? null : "faltan PROD_VERIFICAR_USUARIO y PROD_VERIFICAR_CONTRASENA en el entorno",
);

const fallidas = resultados.filter((r) => r.ok === false).length;
const omitidas = resultados.filter((r) => r.ok === null).length;
const noEjecutadas = omitidas === 1 ? "1 no ejecutada" : `${omitidas} no ejecutadas`;
console.log(`\n${resultados.filter((r) => r.ok).length}/${resultados.length - omitidas} comprobaciones en verde${omitidas ? `; ${noEjecutadas}` : ""}`);
process.exit(fallidas ? 1 : 0);
