// Solo para dev (npm run dev:limpiar-personal-huerfano). Después de reimportar el realm de Keycloak, las cuentas del
// personal creadas en dev (API, G10 o E2E) quedan en `personal` sin usuario en Keycloak. Este script las marca
// activo = false y registra cada baja como gestion_usuario (actor: el sistema, origen limpieza_dev).
// No borra filas: registro_auditoria las referencia. Solo toca correos @ejemplo.test (datos ficticios).
// Aborta si las URLs del entorno no son locales. Imprime solo cuántas filas cambió.
import { cargarEntorno, requerida, tokenAdmin, urlKeycloak } from "../../scripts/lib/keycloak.mjs";

cargarEntorno();

const HOSTS_LOCALES = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);
for (const nombre of ["KEYCLOAK_PUBLIC_URL", "FRONTEND_PUBLIC_URL"]) {
  let host = "";
  try {
    host = new URL(requerida(nombre)).hostname;
  } catch {
    // URL inválida: se aborta abajo
  }
  if (!HOSTS_LOCALES.has(host)) {
    console.error(`Abortado: ${nombre} no apunta al entorno local. Este script es solo para dev.`);
    process.exit(1);
  }
}

// Desde el host se llega a Postgres por el puerto publicado (como en seed.ts).
process.env.POSTGRES_HOST = "127.0.0.1";
process.env.POSTGRES_PORT = process.env.POSTGRES_HOST_PORT || "55432";

const { cerrarPool, enTransaccion, obtenerPool } = await import("../src/db/pool");
const { insertarEvento } = await import("../src/repositories/auditoria");
const { marcarInactivo } = await import("../src/repositories/personal");

const ADMIN_REALM = `${urlKeycloak()}/admin/realms/${encodeURIComponent(requerida("KEYCLOAK_REALM"))}`;

// Antes de interpretar un 404 como «usuario inexistente», el realm debe existir: si no, Keycloak también
// responde 404 («Realm not found») y se desactivarían todas las cuentas, incluidas las de prueba.
async function exigirRealm(token: string): Promise<void> {
  const res = await fetch(ADMIN_REALM, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) {
    console.error(`Abortado: el realm no responde (HTTP ${res.status}). Importa el realm antes de limpiar; no se cambió nada.`);
    process.exit(1);
  }
}

// true si el usuario existe en Keycloak, false si no (404). Cualquier otra respuesta aborta sin cambiar nada.
async function existeEnKeycloak(token: string, id: string): Promise<boolean> {
  const res = await fetch(`${ADMIN_REALM}/users/${encodeURIComponent(id)}`, { headers: { Authorization: `Bearer ${token}` } });
  if (res.status === 404) return false;
  if (!res.ok) throw new Error(`Keycloak respondió HTTP ${res.status} al consultar un usuario; no se cambió nada`);
  return true;
}

try {
  const { rows } = await obtenerPool().query<{ id_personal: number; keycloak_user_id: string }>(
    `SELECT id_personal, keycloak_user_id::text AS keycloak_user_id
       FROM personal
      WHERE activo AND correo LIKE '%@ejemplo.test'
      ORDER BY id_personal`,
  );
  const token = await tokenAdmin();
  await exigirRealm(token);
  const huerfanas: number[] = [];
  for (const fila of rows) {
    if (!(await existeEnKeycloak(token, fila.keycloak_user_id))) huerfanas.push(fila.id_personal);
  }

  await enTransaccion(async (c) => {
    for (const id of huerfanas) {
      await marcarInactivo(c, id);
      await insertarEvento(c, {
        tipoEvento: "gestion_usuario",
        idPersonal: null,
        detalle: { accion: "desactivacion", id_personal_afectado: id, origen: "limpieza_dev" },
      });
    }
  });
  console.log(`${huerfanas.length} filas marcadas como inactivas`);
} finally {
  await cerrarPool();
}
