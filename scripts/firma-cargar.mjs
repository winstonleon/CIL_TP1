// npm run firma:cargar -- <correo> <ruta>: carga la firma escaneada de la Directora (HU0016-1.0, D2-A). La imagen está en el
// host y el volumen `archivos` solo se ve desde el contenedor `api`: se le pasa por la entrada estándar, sin copiarla a una
// carpeta intermedia. Valida el archivo la API (PNG o JPG, hasta 1 MB). No imprime su contenido ni la clave.
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

const [correo, ruta] = process.argv.slice(2);
if (!correo || !ruta) {
  console.error("Uso: npm run firma:cargar -- <correo de la directora> <ruta de la imagen PNG o JPG>");
  process.exit(1);
}

let imagen;
try {
  imagen = readFileSync(ruta);
} catch {
  console.error("No se pudo leer la imagen.");
  process.exit(1);
}

const r = spawnSync("docker", ["compose", "exec", "-T", "api", "npm", "run", "--silent", "firma:cargar", "--workspace", "api", "--", correo], {
  input: imagen,
  stdio: ["pipe", "inherit", "inherit"],
});
process.exit(r.status ?? 1);
