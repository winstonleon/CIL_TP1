// Datos ficticios de desarrollo para la base admision (se ejecuta desde el host: npm run db:seed).
//   1. Aplica db/seeds/*.sql en orden (grados de la campaña 2027).
//   2. Crea un Personal por cada usuario de prueba de Keycloak con rol de personal
//      (infra/keycloak/usuarios-prueba.json; requiere npm run kc:usuarios-prueba).
//   3. Crea un apoderado ficticio (DNI 00000001) con su consentimiento y un expediente en prospecto, con los
//      repositorios de la API: el de apoderados cifra el DNI, como exige rules/api.md (compromiso C3, HU0001).
// Es idempotente. No imprime datos personales. Corre con el usuario de la API (le basta INSERT/UPDATE).
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { prepararEntornoHost } from "../../scripts/lib/entornoLocal.mjs";
import { RAIZ, adminApi, cargarEntorno, tokenAdmin } from "../../scripts/lib/keycloak.mjs";

cargarEntorno();
prepararEntornoHost();

const { cerrarPool, enTransaccion, obtenerPool } = await import("../src/db/pool");
const { existeApoderadoConDni, insertarApoderado } = await import("../src/repositories/apoderado");
const { insertarConsentimiento } = await import("../src/repositories/consentimiento");
const { insertarExpediente } = await import("../src/repositories/expediente");

interface UsuarioPrueba {
  username: string;
  firstName: string;
  lastName: string;
  rol: string;
}

const pool = obtenerPool();
try {
  const dirSeeds = resolve(RAIZ, "db/seeds");
  for (const archivo of readdirSync(dirSeeds).filter((f) => f.endsWith(".sql")).sort()) {
    await pool.query(readFileSync(resolve(dirSeeds, archivo), "utf8"));
    console.log(`seed ${archivo}: aplicado`);
  }

  const usuarios: UsuarioPrueba[] = JSON.parse(readFileSync(resolve(RAIZ, "infra/keycloak/usuarios-prueba.json"), "utf8"));
  const api = adminApi(await tokenAdmin());
  const idKeycloak = async (username: string): Promise<string> => {
    const { datos } = await api("GET", `/users?exact=true&username=${encodeURIComponent(username)}`);
    if (!datos[0]) throw new Error(`Falta el usuario de prueba en Keycloak; ejecuta npm run kc:usuarios-prueba`);
    return datos[0].id as string;
  };

  let personal = 0;
  // Solo las cuentas de usuarios-prueba.json. Si se reimportó el realm, dev:limpiar-personal-huerfano desactivó la fila
  // vieja: el seed le pone el id nuevo y la deja activa y con su rol. Las rutas del personal exigen eso (C22, HU0002).
  for (const u of usuarios.filter((x) => x.rol !== "familia")) {
    await pool.query(
      `INSERT INTO personal (nombres, apellidos, rol, correo, keycloak_user_id)
       VALUES ($1, $2, $3::rol_personal, $4, $5::uuid)
       ON CONFLICT (correo) DO UPDATE SET keycloak_user_id = EXCLUDED.keycloak_user_id, rol = EXCLUDED.rol, activo = true`,
      [u.firstName, u.lastName, u.rol, u.username, await idKeycloak(u.username)],
    );
    personal++;
  }
  console.log(`personal de prueba: ${personal} registros`);

  const dniFicticio = "00000001";
  const familia = usuarios.find((x) => x.rol === "familia")!;
  if (await existeApoderadoConDni(pool, dniFicticio)) {
    console.log("familia ficticia: ya existía");
  } else {
    await enTransaccion(async (c) => {
      const { rows: grado } = await c.query<{ id_grado: number }>(
        "SELECT id_grado FROM grado WHERE nombre_grado = '3 años' AND campana_admision = '2027'",
      );
      if (!grado[0]) throw new Error("Falta el grado «3 años» de 2027: revisa db/seeds/01-grados-2027.sql");
      // Teléfono en E.164 (plan HU0001, P3). Una fila creada antes de HU0001 conserva '900000000': el seed no la cambia.
      const idApoderado = await insertarApoderado(c, {
        dni: dniFicticio,
        nombres: familia.firstName,
        apellidos: familia.lastName,
        telefono: "+51900000000",
        correo: familia.username,
      });
      await insertarConsentimiento(c, { idApoderado, versionPolitica: "ficticia-v0", canalOrigen: "formulario_web", autorizaWhatsapp: false });
      await insertarExpediente(c, { idApoderadoTitular: idApoderado, idGrado: grado[0].id_grado });
    });
    console.log("familia ficticia: creada (apoderado, consentimiento y expediente en prospecto)");
  }
} finally {
  await cerrarPool();
}
