// Crea la cuenta inicial de la Directora en producción (C18). Corre DENTRO del contenedor `api`, que tiene el acceso a Keycloak y a
// la base: `npm run directora:crear -- <correo> "<nombres>" "<apellidos>"` (raíz del repo) le pasa los datos por la entrada estándar.
// Keycloak envía a ese correo el enlace para definir la contraseña (72 h). No imprime el correo, contraseñas ni tokens.
import { cerrarPool } from "../src/db/pool";
import { ErrorApi } from "../src/errores";
import { crearKeycloakAdminDesdeConfig } from "../src/identidad/keycloakAdmin";
import { crearDirectoraInicial } from "../src/services/directoraInicial";

async function entradaEstandar(): Promise<string> {
  const partes: Buffer[] = [];
  for await (const parte of process.stdin) partes.push(parte as Buffer);
  return Buffer.concat(partes).toString("utf8");
}

try {
  let datos: unknown;
  try {
    datos = JSON.parse(await entradaEstandar());
  } catch {
    throw new ErrorApi(400, "VALIDACION", "Faltan el correo, los nombres y los apellidos de la directora");
  }
  const fila = await crearDirectoraInicial(crearKeycloakAdminDesdeConfig(), datos);
  console.log(`Cuenta de la directora creada (id_personal ${fila.id_personal}). Keycloak le envió el enlace para definir su contraseña; vence en 72 h.`);
  console.log("Falta su firma: npm run firma:cargar -- <correo> <imagen PNG o JPG>.");
} catch (error) {
  console.error(error instanceof ErrorApi ? `${error.codigo}: ${error.message}` : "No se pudo crear la cuenta de la directora");
  process.exitCode = 1;
} finally {
  await cerrarPool();
}
