// npm run directora:crear -- <correo> <nombres> <apellidos> --responsable "<nombre>": crea la cuenta inicial de la Directora (C18, ADR-02).
// Corre DENTRO del contenedor `api`, que tiene el acceso a Keycloak y a la base: aquí solo se le pasan los datos por la entrada
// estándar, así ningún nombre con espacios o tildes pasa por la línea de comandos del contenedor. Keycloak envía a ese correo el enlace
// para definir la contraseña (vence en 72 h): el SMTP tiene que estar configurado (C12). Su evento de la bitácora no tiene actor:
// --responsable (obligatorio) deja en su `detalle` el nombre de quien corre el comando.
import { spawnSync } from "node:child_process";
import { entornoDelResponsable, sacarResponsable } from "./lib/responsable.mjs";

const { responsable, resto } = sacarResponsable(process.argv.slice(2));
const [correo, nombres, apellidos] = resto;
if (!correo || !nombres || !apellidos || !responsable) {
  console.error('Uso: npm run directora:crear -- <correo> "<nombres>" "<apellidos>" --responsable "<nombre>"');
  process.exit(1);
}

const r = spawnSync("docker", ["compose", "exec", "-T", ...entornoDelResponsable(responsable), "api", "npm", "run", "--silent", "directora:crear", "--workspace", "api"], {
  input: Buffer.from(JSON.stringify({ correo, nombres, apellidos }), "utf8"),
  stdio: ["pipe", "inherit", "inherit"],
});
process.exit(r.status ?? 1);
