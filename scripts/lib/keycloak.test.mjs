// Lectura del entorno de los scripts de infraestructura (scripts/lib/keycloak.mjs): secretos por archivo (C5) y el
// contenedor `admin` de producción, que no tiene .env (ADR-08).
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, test } from "node:test";
import { cargarEntorno, leerVariable, requerida } from "./keycloak.mjs";

const NOMBRES = ["CIL_PRUEBA_SECRETO", "CIL_PRUEBA_SECRETO_FILE", "CIL_ENTORNO_DEL_CONTENEDOR"];
let dir;
let cargarOriginal;

beforeEach(() => {
  for (const n of NOMBRES) delete process.env[n];
  dir = mkdtempSync(join(tmpdir(), "cil-secreto-"));
  cargarOriginal = process.loadEnvFile;
});

afterEach(() => {
  for (const n of NOMBRES) delete process.env[n];
  rmSync(dir, { recursive: true, force: true });
  process.loadEnvFile = cargarOriginal;
});

function archivoCon(contenido) {
  const ruta = join(dir, "secreto");
  writeFileSync(ruta, contenido);
  return ruta;
}

test("C5 un secreto se lee de su variable o, si no está, del archivo que indica NOMBRE_FILE", () => {
  assert.equal(leerVariable("CIL_PRUEBA_SECRETO"), undefined);

  // El salto de línea final de un archivo escrito a mano no forma parte del secreto; los espacios interiores sí.
  process.env.CIL_PRUEBA_SECRETO_FILE = archivoCon("valor de archivo\n");
  assert.equal(leerVariable("CIL_PRUEBA_SECRETO"), "valor de archivo");
  assert.equal(requerida("CIL_PRUEBA_SECRETO"), "valor de archivo");

  process.env.CIL_PRUEBA_SECRETO = "valor de variable";
  assert.equal(leerVariable("CIL_PRUEBA_SECRETO"), "valor de variable");
});

test("C5 sin archivo no hay valor: Docker no crea el secreto si su variable está vacía en .env", () => {
  process.env.CIL_PRUEBA_SECRETO_FILE = join(dir, "no-existe");
  assert.equal(leerVariable("CIL_PRUEBA_SECRETO"), undefined);
  assert.throws(() => requerida("CIL_PRUEBA_SECRETO"), /^Error: Falta la variable CIL_PRUEBA_SECRETO/);
});

test("C5 si el archivo no se puede leer o trae un valor sin generar, el error no revela el valor ni la ruta", () => {
  // Una carpeta en lugar de un archivo: existe, pero no se puede leer como secreto.
  process.env.CIL_PRUEBA_SECRETO_FILE = dir;
  assert.throws(
    () => requerida("CIL_PRUEBA_SECRETO"),
    (e) => e.message === "No se pudo leer el archivo que indica CIL_PRUEBA_SECRETO_FILE" && !e.message.includes(dir),
  );

  process.env.CIL_PRUEBA_SECRETO_FILE = archivoCon("cambiar-esto");
  assert.throws(
    () => requerida("CIL_PRUEBA_SECRETO"),
    (e) => e.message.startsWith("Falta la variable CIL_PRUEBA_SECRETO") && !e.message.includes("cambiar-esto"),
  );

  process.env.CIL_PRUEBA_SECRETO_FILE = archivoCon("");
  assert.throws(() => requerida("CIL_PRUEBA_SECRETO"), /^Error: Falta la variable CIL_PRUEBA_SECRETO/);
});

test("ADR-08 en el contenedor admin las variables llegan del compose: no se busca ni se carga un .env", () => {
  let cargas = 0;
  process.loadEnvFile = () => {
    cargas += 1;
  };

  process.env.CIL_ENTORNO_DEL_CONTENEDOR = "1";
  cargarEntorno();
  assert.equal(cargas, 0);

  // Fuera del contenedor sigue igual: carga el .env de la raíz o, si no existe, lo dice.
  delete process.env.CIL_ENTORNO_DEL_CONTENEDOR;
  try {
    cargarEntorno();
    assert.equal(cargas, 1);
  } catch (e) {
    assert.equal(e.message, "No existe .env en la raíz del repo (copia .env.example)");
    assert.equal(cargas, 0);
  }
});
