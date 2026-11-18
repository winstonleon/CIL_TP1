// Utilidades compartidas por los scripts de infraestructura: carga del .env y Admin API de Keycloak.
// Nunca imprimen valores de variables ni tokens.
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

export const RAIZ = resolve(import.meta.dirname, "..", "..");

export function cargarEntorno() {
  // En el contenedor `admin` de producción (ADR-08) las variables llegan del compose y no hay .env que cargar.
  if (process.env.CIL_ENTORNO_DEL_CONTENEDOR === "1") return;
  const ruta = resolve(RAIZ, ".env");
  if (!existsSync(ruta)) throw new Error("No existe .env en la raíz del repo (copia .env.example)");
  process.loadEnvFile(ruta);
}

// Valor de una variable. Un secreto también puede llegar como secreto de Docker (C5): NOMBRE_FILE indica el archivo
// que lo contiene y NOMBRE queda sin definir, para que el valor no viaje en el entorno del contenedor. Si están las
// dos, manda NOMBRE. Si el archivo no existe, no hay valor: Docker no crea el secreto cuando su variable está vacía
// en .env. El mensaje de error nunca incluye el valor ni la ruta.
export function leerVariable(nombre) {
  const valor = process.env[nombre];
  if (valor) return valor;
  const archivo = process.env[`${nombre}_FILE`];
  if (!archivo) return valor;
  try {
    return readFileSync(archivo, "utf8").replace(/\r?\n$/, "");
  } catch (e) {
    if (e.code === "ENOENT") return undefined;
    throw new Error(`No se pudo leer el archivo que indica ${nombre}_FILE`);
  }
}

export function requerida(nombre) {
  const valor = leerVariable(nombre);
  if (!valor || valor.startsWith("cambiar")) {
    throw new Error(`Falta la variable ${nombre} en .env (ejecuta node scripts/generar-secretos.js)`);
  }
  return valor;
}

export function urlKeycloak() {
  return requerida("KEYCLOAK_PUBLIC_URL").replace(/\/$/, "");
}

// El mensaje de error incluye el estado HTTP y error/error_description de Keycloak, o la causa
// de red (p. ej. ECONNREFUSED). Nunca credenciales ni tokens.
export async function tokenAdmin() {
  let res;
  try {
    res = await fetch(`${urlKeycloak()}/realms/master/protocol/openid-connect/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "password",
        client_id: "admin-cli",
        username: requerida("KEYCLOAK_ADMIN"),
        password: requerida("KEYCLOAK_ADMIN_PASSWORD"),
      }),
    });
  } catch (e) {
    throw new Error(`Keycloak no responde en ${urlKeycloak()} (${e.cause?.code ?? e.message})`);
  }
  if (!res.ok) {
    let detalle = "";
    try {
      const cuerpo = await res.json();
      detalle = [cuerpo.error, cuerpo.error_description].filter(Boolean).join(": ");
    } catch {
      // cuerpo no JSON (p. ej. 502 del proxy): basta el estado HTTP
    }
    throw new Error(`No se obtuvo token de administración de Keycloak (HTTP ${res.status}${detalle ? `, ${detalle}` : ""})`);
  }
  return (await res.json()).access_token;
}

// Cliente mínimo de la Admin API del realm del proyecto.
export function adminApi(token) {
  const realm = requerida("KEYCLOAK_REALM");
  const base = `${urlKeycloak()}/admin/realms/${realm}`;
  return async function llamar(metodo, ruta, cuerpo) {
    const res = await fetch(`${base}${ruta}`, {
      method: metodo,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(cuerpo ? { "Content-Type": "application/json" } : {}),
      },
      body: cuerpo ? JSON.stringify(cuerpo) : undefined,
    });
    if (!res.ok) throw new Error(`Admin API ${metodo} ${ruta}: HTTP ${res.status}`);
    const texto = await res.text();
    return { res, datos: texto ? JSON.parse(texto) : null };
  };
}
