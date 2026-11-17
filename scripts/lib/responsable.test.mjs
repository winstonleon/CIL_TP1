// Los envoltorios del host de campana:cargar, directora:crear y firma:cargar toman --responsable con este ayudante.
import assert from "node:assert/strict";
import { test } from "node:test";
import { entornoDelResponsable, sacarResponsable } from "./responsable.mjs";

test("C26 (responsable) --responsable se saca de los argumentos, sin espacios de más, y el resto queda en su orden", () => {
  const { responsable, resto } = sacarResponsable(["ana@ejemplo.test", "--responsable", "  Brayan Denis  ", "Ana María", "Pérez Soto"]);
  assert.equal(responsable, "Brayan Denis");
  assert.deepEqual(resto, ["ana@ejemplo.test", "Ana María", "Pérez Soto"]);
});

test("C26 (responsable) sin --responsable no hay responsable y los argumentos no cambian", () => {
  const { responsable, resto } = sacarResponsable(["archivo.json", "--simular"]);
  assert.equal(responsable, undefined);
  assert.deepEqual(resto, ["archivo.json", "--simular"]);
});

test("C26 (responsable) un --responsable sin valor, vacío o seguido de otra opción se trata como ausente y no se come la opción", () => {
  assert.equal(sacarResponsable(["archivo.json", "--responsable"]).responsable, undefined);
  assert.equal(sacarResponsable(["archivo.json", "--responsable", "   "]).responsable, undefined);
  const { responsable, resto } = sacarResponsable(["archivo.json", "--responsable", "--simular"]);
  assert.equal(responsable, undefined);
  assert.deepEqual(resto, ["archivo.json", "--simular"]);
});

test("C26 (responsable) al contenedor llega por el entorno, con el nombre entero en un solo argumento, y sin responsable no se agrega nada", () => {
  assert.deepEqual(entornoDelResponsable("Brayan Denis (técnico)"), ["-e", "CIL_RESPONSABLE=Brayan Denis (técnico)"]);
  assert.deepEqual(entornoDelResponsable(undefined), []);
});
