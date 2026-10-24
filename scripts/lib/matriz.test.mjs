// Pruebas de las reglas de la matriz de trazabilidad (plan HU0022, tramo d). Se ejecutan con npm run test:scripts,
// y npm run evidencias:matriz las corre antes de generar la matriz: si fallan, la matriz no se escribe.
// No forman parte de test:api, test:front ni test:e2e, así que la matriz no las cuenta.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ESTADO_C17, erroresDePartes, estadoDe } from "./matriz.mjs";

const prueba = (suite, titulo, resultado = "pasó") => ({ suite, archivo: `${suite.toLowerCase()}/x.test.ts`, titulo, resultado });
const CONFIG = { "HU9999-1.0": { compromiso: "C99", partes: ["almacenamiento", "aplicación"] } };

describe("matriz: errores de marcado de partes", () => {
  it("falla con una parte que el escenario no declara", () => {
    const esc = { id: "HU9999-1.0", pruebas: [prueba("API", "HU9999-1.0 [parte: inventada] algo")] };
    const errores = erroresDePartes(esc, CONFIG);
    assert.equal(errores.length, 1);
    assert.match(errores[0], /no tiene la parte «inventada»/);
  });

  it("falla con una prueba sin [parte:] en un escenario que se verifica por partes", () => {
    const esc = { id: "HU9999-1.0", pruebas: [prueba("API", "HU9999-1.0 algo sin parte")] };
    const errores = erroresDePartes(esc, CONFIG);
    assert.equal(errores.length, 1);
    assert.match(errores[0], /no declara \[parte: …\]/);
  });

  it("falla con [parte:] en un escenario que no tiene partes", () => {
    const esc = { id: "HU9999-2.0", pruebas: [prueba("API", "HU9999-2.0 [parte: almacenamiento] algo")] };
    const errores = erroresDePartes(esc, CONFIG);
    assert.equal(errores.length, 1);
    assert.match(errores[0], /no tiene partes/);
  });

  it("falla con una marca de parte mal escrita, tenga o no partes el escenario", () => {
    for (const [id, titulo] of [
      ["HU9999-2.0", "HU9999-2.0 [Parte: almacenamiento] otra mayúscula"],
      ["HU9999-2.0", "HU9999-2.0 [parte:almacenamiento] sin espacio"],
      ["HU9999-1.0", "HU9999-1.0 [ parte : almacenamiento] con espacios"],
    ]) {
      const errores = erroresDePartes({ id, pruebas: [prueba("API", titulo)] }, CONFIG);
      assert.equal(errores.length, 1, titulo);
      assert.match(errores[0], /mal escrita/);
    }
  });

  it("no informa errores cuando el marcado es correcto", () => {
    const esc = { id: "HU9999-1.0", pruebas: [prueba("API", "HU9999-1.0 [parte: almacenamiento] a"), prueba("E2E", "HU9999-1.0 [parte: aplicación] b")] };
    assert.deepEqual(erroresDePartes(esc, CONFIG), []);
    assert.deepEqual(erroresDePartes({ id: "HU9999-2.0", pruebas: [prueba("API", "HU9999-2.0 algo")] }, CONFIG), []);
  });
});

describe("matriz: estado de un escenario por partes", () => {
  it("una parte solo cuenta con pruebas de API o E2E que pasan; las de frontend no la verifican", () => {
    const soloFrontend = { id: "HU9999-1.0", pruebas: [prueba("Frontend", "HU9999-1.0 [parte: almacenamiento] a")] };
    assert.equal(estadoDe(soloFrontend, CONFIG), "verificado: ninguna parte; pendiente: almacenamiento, aplicación (C99)");

    const conApi = { id: "HU9999-1.0", pruebas: [...soloFrontend.pruebas, prueba("API", "HU9999-1.0 [parte: almacenamiento] b")] };
    assert.equal(estadoDe(conApi, CONFIG), "verificado: almacenamiento; pendiente: aplicación (C99)");
  });

  it("es «cubierto» solo cuando todas las partes están verificadas", () => {
    const esc = { id: "HU9999-1.0", pruebas: [prueba("API", "HU9999-1.0 [parte: almacenamiento] a"), prueba("E2E", "HU9999-1.0 [parte: aplicación] b")] };
    assert.equal(estadoDe(esc, CONFIG), "cubierto");
  });

  it("una prueba fallida deja el escenario «con fallas», aunque sea de frontend", () => {
    const esc = { id: "HU9999-1.0", pruebas: [prueba("API", "HU9999-1.0 [parte: almacenamiento] a"), prueba("Frontend", "HU9999-1.0 [parte: almacenamiento] b", "falló")] };
    assert.equal(estadoDe(esc, CONFIG), "con fallas");
  });
});

describe("matriz: estados que no cambian con las partes", () => {
  it("C17: si todas las pruebas ejecutadas llevan [política, ruta de prueba], el estado es el de C17", () => {
    const esc = { id: "HU9999-2.0", pruebas: [prueba("API", "HU9999-2.0 [política, ruta de prueba] a")] };
    assert.equal(estadoDe(esc, CONFIG), ESTADO_C17);
  });

  it("un escenario sin partes con una prueba que pasa es «cubierto»; sin pruebas, «sin prueba»", () => {
    assert.equal(estadoDe({ id: "HU9999-2.0", pruebas: [prueba("Frontend", "HU9999-2.0 a")] }, CONFIG), "cubierto");
    assert.equal(estadoDe({ id: "HU9999-2.0", pruebas: [] }, CONFIG), "sin prueba");
  });
});
