// Datos ficticios de desarrollo para la base admision (se ejecuta desde el host: npm run db:seed).
//   1. Aplica db/seeds/*.sql en orden (grados de la campaña 2027).
//   2. Crea un Personal por cada usuario de prueba de Keycloak con rol de personal
//      (infra/keycloak/usuarios-prueba.json; requiere npm run kc:usuarios-prueba).
//   3. Crea un apoderado ficticio (DNI 00000001, cifrado) con su consentimiento y un expediente en prospecto.
// Es idempotente. No imprime datos personales.
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { RAIZ, adminApi, cargarEntorno, tokenAdmin } from "../../scripts/lib/keycloak.mjs";

cargarEntorno();
// Desde el host se llega a Postgres por el puerto publicado.
process.env.POSTGRES_HOST = "127.0.0.1";
process.env.POSTGRES_PORT = process.env.POSTGRES_HOST_PORT || "55432";

const { cerrarPool, enTransaccion, obtenerPool } = await import("../src/db/pool");
const { columnasDni, hashDni } = await import("../src/crypto/columnas");

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
  for (const u of usuarios.filter((x) => x.rol !== "familia")) {
    await pool.query(
      `INSERT INTO personal (nombres, apellidos, rol, correo, keycloak_user_id)
       VALUES ($1, $2, $3::rol_personal, $4, $5::uuid)
       ON CONFLICT (correo) DO UPDATE SET keycloak_user_id = EXCLUDED.keycloak_user_id`,
      [u.firstName, u.lastName, u.rol, u.username, await idKeycloak(u.username)],
    );
    personal++;
  }
  console.log(`personal de prueba: ${personal} registros`);

  const dniFicticio = "00000001";
  const familia = usuarios.find((x) => x.rol === "familia")!;
  const { rowCount } = await pool.query("SELECT 1 FROM apoderado WHERE dni_hash = $1", [hashDni(dniFicticio)]);
  if (rowCount) {
    console.log("familia ficticia: ya existía");
  } else {
    await enTransaccion(async (c) => {
      const { dni_cifrado, dni_hash } = columnasDni(dniFicticio);
      const { rows: apo } = await c.query<{ id_apoderado: number }>(
        `INSERT INTO apoderado (dni_cifrado, dni_hash, nombres, apellidos, telefono, correo)
         VALUES ($1, $2, $3, $4, '900000000', $5) RETURNING id_apoderado`,
        [dni_cifrado, dni_hash, familia.firstName, familia.lastName, familia.username],
      );
      const idApoderado = apo[0]!.id_apoderado;
      await c.query(
        `INSERT INTO consentimiento (id_apoderado, version_politica, canal_origen, autoriza_whatsapp)
         VALUES ($1, 'ficticia-v0', 'formulario_web', false)`,
        [idApoderado],
      );
      await c.query(
        `INSERT INTO expediente (id_apoderado_titular, id_grado)
         SELECT $1, id_grado FROM grado WHERE nombre_grado = '3 años' AND campana_admision = '2027'`,
        [idApoderado],
      );
    });
    console.log("familia ficticia: creada (apoderado, consentimiento y expediente en prospecto)");
  }
} finally {
  await cerrarPool();
}
