// Configuración del SMTP (C12): una sola lectura del entorno para la credencial `cil-smtp` de n8n (npm run n8n:credenciales)
// y para el realm de Keycloak, que recibe las mismas variables como placeholders al importarse (infra/keycloak/README.md).
// Sin las variables nuevas rige Mailpit (dev): sin autenticación ni TLS. Los errores nombran la variable, nunca su valor.
import { leerVariable } from "./keycloak.mjs";

function texto(leer, nombre) {
  return (leer(nombre) ?? "").trim();
}

function booleano(leer, nombre) {
  const valor = texto(leer, nombre).toLowerCase();
  if (valor === "") return false;
  if (valor !== "true" && valor !== "false") throw new Error(`${nombre} debe ser true o false`);
  return valor === "true";
}

export function smtpDesdeEntorno(leer = leerVariable) {
  const host = texto(leer, "SMTP_HOST");
  if (!host) throw new Error("Falta la variable SMTP_HOST en .env");
  const puerto = Number(texto(leer, "SMTP_PORT"));
  if (!Number.isInteger(puerto) || puerto < 1 || puerto > 65535) throw new Error("SMTP_PORT debe ser un puerto entre 1 y 65535");

  const auth = booleano(leer, "SMTP_AUTH");
  const ssl = booleano(leer, "SMTP_SSL");
  const starttls = booleano(leer, "SMTP_STARTTLS");
  const user = texto(leer, "SMTP_USER");
  // La contraseña va tal cual, sin recortar: una clave de aplicación puede llevar espacios.
  const password = leer("SMTP_PASSWORD") ?? "";

  if (ssl && starttls) throw new Error("SMTP_SSL y SMTP_STARTTLS no pueden ser true a la vez");
  if (auth && !user) throw new Error("Falta SMTP_USER: SMTP_AUTH es true");
  if (auth && !password) throw new Error("Falta SMTP_PASSWORD: SMTP_AUTH es true");
  if (!auth && (user || password)) throw new Error("SMTP_USER o SMTP_PASSWORD están definidos pero SMTP_AUTH no es true");

  return { host, puerto, auth, user, password, ssl, starttls };
}

// Campos de la credencial SMTP de n8n. Con SSL/TLS el cifrado es implícito (puerto 465); con STARTTLS, el servidor lo
// negocia en el 587; sin ninguno (Mailpit) se desactiva STARTTLS.
export function datosCredencialSmtp(c) {
  return {
    user: c.auth ? c.user : "",
    password: c.auth ? c.password : "",
    host: c.host,
    port: c.puerto,
    secure: c.ssl,
    disableStartTls: !c.ssl && !c.starttls,
  };
}

// No son errores (Mailpit con autenticación, en un ensayo, no lleva TLS), pero en producción una contraseña sin cifrar es un descuido.
export function advertenciasSmtp(c) {
  return c.auth && !c.ssl && !c.starttls ? ["SMTP_AUTH es true sin SMTP_SSL ni SMTP_STARTTLS: el usuario y la contraseña viajarían sin cifrar"] : [];
}
