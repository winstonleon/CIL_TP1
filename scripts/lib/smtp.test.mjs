// SMTP real (C12): lectura del entorno, campos de la credencial `cil-smtp` de n8n y llegada de los placeholders del realm de
// Keycloak. El realm de producción se importa una sola vez: un placeholder sin variable queda literal y no se corrige solo.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";
import { advertenciasSmtp, datosCredencialSmtp, smtpDesdeEntorno } from "./smtp.mjs";

const RAIZ = resolve(import.meta.dirname, "..", "..");
const leerDe = (entorno) => (nombre) => entorno[nombre];
const MAILPIT = { SMTP_HOST: "mailpit", SMTP_PORT: "1025" };

test("C12 una autenticación sin SMTP_SSL ni SMTP_STARTTLS se advierte; con cifrado, o sin autenticación, no", () => {
  const auth = { ...MAILPIT, SMTP_AUTH: "true", SMTP_USER: "u", SMTP_PASSWORD: "no-debe-aparecer" };
  const sinCifrar = advertenciasSmtp(smtpDesdeEntorno(leerDe(auth)));
  assert.equal(sinCifrar.length, 1);
  assert.match(sinCifrar[0], /SMTP_AUTH es true sin SMTP_SSL ni SMTP_STARTTLS/);
  assert.ok(!sinCifrar[0].includes("no-debe-aparecer"));
  assert.deepEqual(advertenciasSmtp(smtpDesdeEntorno(leerDe({ ...auth, SMTP_STARTTLS: "true" }))), []);
  assert.deepEqual(advertenciasSmtp(smtpDesdeEntorno(leerDe({ ...auth, SMTP_SSL: "true" }))), []);
  assert.deepEqual(advertenciasSmtp(smtpDesdeEntorno(leerDe(MAILPIT))), []);
});

test("C12 sin las variables nuevas rige Mailpit: sin autenticación ni TLS, como antes", () => {
  const c = smtpDesdeEntorno(leerDe(MAILPIT));
  assert.deepEqual(datosCredencialSmtp(c), { user: "", password: "", host: "mailpit", port: 1025, secure: false, disableStartTls: true });
});

test("C12 STARTTLS en el 587 con autenticación: n8n no desactiva STARTTLS y envía usuario y contraseña", () => {
  const c = smtpDesdeEntorno(
    leerDe({ SMTP_HOST: "smtp.proveedor.test", SMTP_PORT: "587", SMTP_AUTH: "true", SMTP_USER: "admision", SMTP_PASSWORD: "clave con espacios", SMTP_STARTTLS: "true" }),
  );
  assert.deepEqual(datosCredencialSmtp(c), {
    user: "admision",
    password: "clave con espacios",
    host: "smtp.proveedor.test",
    port: 587,
    secure: false,
    disableStartTls: false,
  });
});

test("C12 SSL/TLS implícito en el 465 con autenticación: n8n usa secure", () => {
  const c = smtpDesdeEntorno(
    leerDe({ SMTP_HOST: "smtp.proveedor.test", SMTP_PORT: "465", SMTP_AUTH: "TRUE", SMTP_USER: "admision", SMTP_PASSWORD: "x", SMTP_SSL: "true" }),
  );
  assert.deepEqual(datosCredencialSmtp(c), { user: "admision", password: "x", host: "smtp.proveedor.test", port: 465, secure: true, disableStartTls: false });
});

test("C12 sin SMTP_AUTH la credencial no lleva usuario ni contraseña aunque el servidor ofrezca TLS", () => {
  const c = smtpDesdeEntorno(leerDe({ SMTP_HOST: "relay.interno.test", SMTP_PORT: "25", SMTP_STARTTLS: "true" }));
  assert.deepEqual(datosCredencialSmtp(c), { user: "", password: "", host: "relay.interno.test", port: 25, secure: false, disableStartTls: false });
});

test("C12 una combinación inválida se rechaza nombrando la variable y sin revelar la contraseña", () => {
  const SECRETO = "no-debe-aparecer";
  const completo = { ...MAILPIT, SMTP_AUTH: "true", SMTP_USER: "u", SMTP_PASSWORD: SECRETO };
  const casos = [
    [{ ...completo, SMTP_SSL: "true", SMTP_STARTTLS: "true" }, /SMTP_SSL y SMTP_STARTTLS/],
    [{ ...completo, SMTP_USER: "" }, /Falta SMTP_USER/],
    [{ ...completo, SMTP_PASSWORD: "" }, /Falta SMTP_PASSWORD/],
    [{ ...MAILPIT, SMTP_PASSWORD: SECRETO }, /SMTP_USER o SMTP_PASSWORD/],
    [{ ...completo, SMTP_SSL: "si" }, /SMTP_SSL debe ser true o false/],
    [{ ...completo, SMTP_PORT: "0" }, /SMTP_PORT/],
    [{ ...completo, SMTP_PORT: "mailpit" }, /SMTP_PORT/],
    [{ ...completo, SMTP_HOST: "  " }, /Falta la variable SMTP_HOST/],
  ];
  for (const [entorno, esperado] of casos) {
    assert.throws(
      () => smtpDesdeEntorno(leerDe(entorno)),
      (e) => esperado.test(e.message) && !e.message.includes(SECRETO),
      JSON.stringify(Object.keys(entorno)),
    );
  }
});

// Líneas de un servicio de un compose: de «  nombre:» hasta el siguiente nombre al mismo nivel.
function bloqueDeServicio(archivo, servicio) {
  const lineas = readFileSync(resolve(RAIZ, archivo), "utf8").split(/\r?\n/);
  const inicio = lineas.indexOf(`  ${servicio}:`);
  assert.notEqual(inicio, -1, `${archivo} no declara el servicio ${servicio}`);
  const fin = lineas.findIndex((l, i) => i > inicio && /^ {2}[\w-]+:\s*$/.test(l));
  return lineas.slice(inicio, fin === -1 ? undefined : fin).join("\n");
}

test("C12 cada placeholder del realm de Keycloak llega al entorno de su contenedor en docker-compose.yml", () => {
  const realm = readFileSync(resolve(RAIZ, "infra/keycloak/realm-cil-admision.json"), "utf8");
  // Solo variables de entorno (MAYÚSCULAS): ${username} y similares son mensajes del perfil de usuario de Keycloak.
  const variables = [...new Set([...realm.matchAll(/\$\{([A-Z][A-Z0-9_]*)\}/g)].map((m) => m[1]))];
  const smtp = JSON.parse(realm).smtpServer;
  for (const campo of ["auth", "user", "password", "ssl", "starttls"]) {
    assert.match(smtp[campo] ?? "", /^\$\{SMTP_[A-Z]+\}$/, `smtpServer.${campo} debe ser un placeholder SMTP_*`);
  }
  const entorno = bloqueDeServicio("docker-compose.yml", "keycloak");
  for (const nombre of variables) {
    assert.match(entorno, new RegExp(`^\\s+${nombre}:`, "m"), `el realm usa \${${nombre}} y el servicio keycloak no la recibe`);
  }
});

test("C12 el contenedor admin de producción recibe la contraseña del SMTP como secreto de Docker, no como variable", () => {
  const admin = bloqueDeServicio("docker-compose.prod.yml", "admin");
  assert.match(admin, /^\s+SMTP_PASSWORD_FILE: \/run\/secrets\/smtp_password$/m);
  assert.doesNotMatch(admin, /^\s+SMTP_PASSWORD:/m);
  assert.match(admin, /^\s+- smtp_password$/m);
  for (const nombre of ["SMTP_AUTH", "SMTP_USER", "SMTP_SSL", "SMTP_STARTTLS"]) {
    assert.match(admin, new RegExp(`^\\s+${nombre}:`, "m"), `admin no recibe ${nombre}`);
  }
});
