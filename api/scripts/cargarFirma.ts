// Carga la firma escaneada de la Directora (HU0016-1.0, D2-A). Corre DENTRO del contenedor `api`, porque el volumen `archivos`
// solo se ve desde ahí. No tiene ruta HTTP: la firma nunca sale de la API.
// - `npm run firma:cargar -- <correo> <ruta> --responsable "<nombre>"` (raíz del repo): la imagen llega por la entrada estándar y el
//   responsable por CIL_RESPONSABLE (el comando lo exige: su evento no tiene actor). La corre un técnico.
// - `npm run dev:firma-ficticia`: solo dev. Carga la imagen ficticia en la directora de prueba, sin repetirla si ya la tiene.
//   Sin firma no se emite ninguna carta.
// No imprime la clave del archivo ni datos de la imagen.
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { crearAlmacenamientoDesdeConfig, type Almacenamiento } from "../src/almacenamiento";
import { cerrarPool, obtenerPool } from "../src/db/pool";
import { ErrorApi } from "../src/errores";
import { cargarFirma } from "../src/services/cartaVacante";
import { validarResponsable } from "../src/services/responsable";

const DIRECTORA_DE_PRUEBA = "directora.prueba@ejemplo.test";
const IMAGEN_FICTICIA = join(dirname(fileURLToPath(import.meta.url)), "firma-ficticia-dev.png");

async function entradaEstandar(): Promise<Buffer> {
  const partes: Buffer[] = [];
  for await (const parte of process.stdin) partes.push(parte as Buffer);
  return Buffer.concat(partes);
}

async function yaTieneFirma(almacenamiento: Almacenamiento, correo: string): Promise<boolean> {
  const { rows } = await obtenerPool().query<{ firma_url: string | null }>("SELECT firma_url FROM personal WHERE lower(correo) = lower($1)", [correo]);
  const clave = rows[0]?.firma_url;
  if (!clave) return false;
  try {
    (await almacenamiento.abrir(clave)).destroy();
    return true;
  } catch {
    return false; // el volumen se recreó: hay que volver a cargarla
  }
}

async function principal(): Promise<void> {
  const almacenamiento = crearAlmacenamientoDesdeConfig();
  if (process.argv[2] === "--ficticia") {
    if (process.env.NODE_ENV === "production") throw new Error("La firma ficticia es solo para dev");
    if (await yaTieneFirma(almacenamiento, DIRECTORA_DE_PRUEBA)) {
      console.log("La directora de prueba ya tiene firma ficticia.");
      return;
    }
    await cargarFirma(almacenamiento, DIRECTORA_DE_PRUEBA, await readFile(IMAGEN_FICTICIA));
    console.log("Firma ficticia cargada en la directora de prueba.");
    return;
  }
  const correo = process.argv[2];
  if (!correo) throw new Error('Uso: npm run firma:cargar -- <correo> <ruta de la imagen> --responsable "<nombre>"');
  const responsable = validarResponsable(process.env.CIL_RESPONSABLE, true);
  const { id_personal } = await cargarFirma(almacenamiento, correo, await entradaEstandar(), responsable);
  console.log(`Firma cargada en la cuenta ${id_personal}.`);
}

try {
  await principal();
} catch (error) {
  console.error(error instanceof ErrorApi ? `${error.codigo}: ${error.message}` : "No se pudo cargar la firma");
  process.exitCode = 1;
} finally {
  await cerrarPool();
}
