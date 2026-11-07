// Guardas de los scripts que solo corren en dev. Devuelven el motivo para no correr (o null), para que cada script decida
// cómo termina. Nunca incluyen el valor de una variable en el mensaje.
const HOSTS_LOCALES = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);
const URLS_PUBLICAS = ["KEYCLOAK_PUBLIC_URL", "FRONTEND_PUBLIC_URL"];

function esLocal(url) {
  try {
    return HOSTS_LOCALES.has(new URL(url).hostname);
  } catch {
    return false; // URL ausente o inválida
  }
}

export function motivoNoLocal(entorno = process.env) {
  const nombre = URLS_PUBLICAS.find((n) => !esLocal(entorno[n]));
  return nombre ? `${nombre} no apunta al entorno local` : null;
}

// Para los scripts de la API que corren en el host (seed, demo, limpieza). Llega a Postgres por el puerto publicado y completa
// lo que config.ts exige y solo define docker-compose.yml. STORAGE_LOCAL_DIR lleva el valor del compose: estos scripts no tocan
// archivos, pero sin ella la configuración no carga (C74).
export function prepararEntornoHost(entorno = process.env) {
  entorno.POSTGRES_HOST = "127.0.0.1";
  entorno.POSTGRES_PORT = entorno.POSTGRES_HOST_PORT || "55432";
  entorno.STORAGE_LOCAL_DIR ??= "/var/lib/cil/archivos";
}

// npm run dev:demo escribe fechas pasadas en una bitácora que no se puede limpiar: exige dev y la base de negocio de dev.
export function motivoFueraDeDev(entorno = process.env) {
  if (entorno.NODE_ENV === "production") return "NODE_ENV es production";
  if (entorno.ADMISION_DB !== "admision") return "ADMISION_DB no es la base de dev";
  return motivoNoLocal(entorno);
}
