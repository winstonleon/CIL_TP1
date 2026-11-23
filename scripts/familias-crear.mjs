// npm run familias:crear -- <archivo.json> --responsable "<nombre>" --consentimiento-confirmado: crea cuentas de familia sin pasar por
// P01, P02 y G04. Corre DENTRO del contenedor `api` (acceso a Keycloak y a la base): aquí solo se le pasa el JSON por la entrada
// estándar. Formato: { "familias": [{ "correo", "nombres", "apellidos", "telefono", "id_grado" }] }. Imprime la contraseña temporal
// de cada familia una sola vez; --consentimiento-confirmado atestigua que cada familia aceptó la política de privacidad.
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { entornoDelResponsable, sacarResponsable } from "./lib/responsable.mjs";

const { responsable, resto } = sacarResponsable(process.argv.slice(2));
const confirmado = resto.includes("--consentimiento-confirmado");
const [archivo] = resto.filter((a) => !a.startsWith("--"));
if (!archivo || !responsable || !confirmado) {
  console.error('Uso: npm run familias:crear -- <archivo.json> --responsable "<nombre>" --consentimiento-confirmado');
  process.exit(1);
}

const r = spawnSync(
  "docker",
  ["compose", "exec", "-T", ...entornoDelResponsable(responsable), "-e", "CIL_CONSENTIMIENTO_CONFIRMADO=1", "api", "npm", "run", "--silent", "familias:crear", "--workspace", "api"],
  { input: readFileSync(archivo), stdio: ["pipe", "inherit", "inherit"] },
);
process.exit(r.status ?? 1);
