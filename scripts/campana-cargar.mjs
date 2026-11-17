// npm run campana:cargar -- <archivo.json> [--simular]: crea los grados y los requisitos de una campaña nueva (C26, punto 1).
// El archivo está en el host y el comando corre DENTRO del contenedor `api`: se le pasa por la entrada estándar. Con --simular
// valida todo y muestra qué crearía, sin escribir nada. La plantilla está en db/campanas/plantilla-2027.json.
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

const argumentos = process.argv.slice(2);
const simular = argumentos.includes("--simular");
const [ruta] = argumentos.filter((a) => a !== "--simular");
if (!ruta) {
  console.error("Uso: npm run campana:cargar -- <archivo.json> [--simular]");
  process.exit(1);
}

let datos;
try {
  datos = readFileSync(ruta);
} catch {
  console.error("No se pudo leer el archivo.");
  process.exit(1);
}

const r = spawnSync(
  "docker",
  ["compose", "exec", "-T", "api", "npm", "run", "--silent", "campana:cargar", "--workspace", "api", ...(simular ? ["--", "--simular"] : [])],
  { input: datos, stdio: ["pipe", "inherit", "inherit"] },
);
process.exit(r.status ?? 1);
