// npm run firma:cargar -- <correo> <ruta> --responsable "<nombre>": carga la firma escaneada de la Directora (HU0016-1.0, D2-A). La imagen
// está en el host y el volumen `archivos` solo se ve desde el contenedor `api`: se le pasa por la entrada estándar, sin copiarla a una
// carpeta intermedia. Valida el archivo la API (PNG o JPG, hasta 1 MB). No imprime su contenido ni la clave. Su evento de la
// bitácora no tiene actor: --responsable (obligatorio) deja en su `detalle` el nombre de quien corre el comando.
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { entornoDelResponsable, sacarResponsable } from "./lib/responsable.mjs";

const { responsable, resto } = sacarResponsable(process.argv.slice(2));
const [correo, ruta] = resto;
if (!correo || !ruta || !responsable) {
  console.error('Uso: npm run firma:cargar -- <correo de la directora> <ruta de la imagen PNG o JPG> --responsable "<nombre>"');
  process.exit(1);
}

let imagen;
try {
  imagen = readFileSync(ruta);
} catch {
  console.error("No se pudo leer la imagen.");
  process.exit(1);
}

const r = spawnSync("docker", ["compose", "exec", "-T", ...entornoDelResponsable(responsable), "api", "npm", "run", "--silent", "firma:cargar", "--workspace", "api", "--", correo], {
  input: imagen,
  stdio: ["pipe", "inherit", "inherit"],
});
process.exit(r.status ?? 1);
