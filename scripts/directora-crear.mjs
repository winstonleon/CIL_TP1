// npm run directora:crear -- <correo> <nombres> <apellidos>: crea la cuenta inicial de la Directora (C18, ADR-02). Corre DENTRO del
// contenedor `api`, que tiene el acceso a Keycloak y a la base: aquí solo se le pasan los datos por la entrada estándar, así
// ningún nombre con espacios o tildes pasa por la línea de comandos del contenedor. Keycloak envía a ese correo el enlace para
// definir la contraseña (vence en 72 h): el SMTP tiene que estar configurado (C12).
import { spawnSync } from "node:child_process";

const [correo, nombres, apellidos] = process.argv.slice(2);
if (!correo || !nombres || !apellidos) {
  console.error('Uso: npm run directora:crear -- <correo> "<nombres>" "<apellidos>"');
  process.exit(1);
}

const r = spawnSync("docker", ["compose", "exec", "-T", "api", "npm", "run", "--silent", "directora:crear", "--workspace", "api"], {
  input: Buffer.from(JSON.stringify({ correo, nombres, apellidos }), "utf8"),
  stdio: ["pipe", "inherit", "inherit"],
});
process.exit(r.status ?? 1);
