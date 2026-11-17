// npm run campana:cargar -- <archivo.json> [--simular] [--responsable "<nombre>"]: crea los grados y los requisitos de una campaña nueva
// (C26, punto 1). El archivo está en el host y el comando corre DENTRO del contenedor `api`: se le pasa por la entrada estándar. Con
// --simular valida todo y muestra qué crearía, sin escribir nada. La carga real exige --responsable: los eventos que deja no tienen
// actor, y el nombre de quien corre el comando queda en su `detalle`. Va por el entorno del contenedor (CIL_RESPONSABLE), no por la
// línea de comandos de npm. La plantilla está en db/campanas/plantilla-2027.json.
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { entornoDelResponsable, sacarResponsable } from "./lib/responsable.mjs";

const { responsable, resto } = sacarResponsable(process.argv.slice(2));
const simular = resto.includes("--simular");
const [ruta] = resto.filter((a) => a !== "--simular");
if (!ruta || (!simular && !responsable)) {
  console.error('Uso: npm run campana:cargar -- <archivo.json> [--simular] [--responsable "<nombre>"]  (la carga real exige --responsable)');
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
  ["compose", "exec", "-T", ...entornoDelResponsable(responsable), "api", "npm", "run", "--silent", "campana:cargar", "--workspace", "api", ...(simular ? ["--", "--simular"] : [])],
  { input: datos, stdio: ["pipe", "inherit", "inherit"] },
);
process.exit(r.status ?? 1);
