// Alta manual de cuentas de familia en producción. Corre DENTRO del contenedor `api`, que tiene el acceso a Keycloak y a la base:
// `npm run familias:crear -- <archivo.json> --responsable "<nombre>" --consentimiento-confirmado` (raíz del repo) le pasa el JSON por la
// entrada estándar y el responsable por CIL_RESPONSABLE. Imprime la contraseña temporal de cada familia UNA sola vez: no queda en la BD.
import { obtenerConfig } from "../src/config";
import { cerrarPool } from "../src/db/pool";
import { ErrorApi } from "../src/errores";
import { crearKeycloakAdminDesdeConfig } from "../src/identidad/keycloakAdmin";
import { crearFamiliasIniciales } from "../src/services/familiasIniciales";

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
    throw new ErrorApi(400, "VALIDACION", "El archivo no es un JSON válido");
  }
  const resultados = await crearFamiliasIniciales(
    crearKeycloakAdminDesdeConfig(),
    obtenerConfig().CAMPANA_ACTIVA,
    datos,
    process.env.CIL_RESPONSABLE,
    process.env.CIL_CONSENTIMIENTO_CONFIRMADO === "1",
  );
  for (const r of resultados) {
    console.log(r.error ? `ERROR  ${r.correo}  ${r.error}` : `OK     ${r.correo}  expediente ${r.id_expediente}  contraseña temporal: ${r.contrasena_temporal}`);
  }
  console.log("Cada familia debe cambiar la contraseña en su primer ingreso. No se enviaron correos ni se guardó ninguna contraseña.");
  if (resultados.some((r) => r.error)) process.exitCode = 1;
} catch (error) {
  console.error(error instanceof ErrorApi ? `${error.codigo}: ${error.message}` : "No se pudieron crear las cuentas");
  process.exitCode = 1;
} finally {
  await cerrarPool();
}
