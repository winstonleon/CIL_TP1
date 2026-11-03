// D3 (HU0004-1.0, A7): la contraseña temporal de la familia. Sin BD ni red.
import { describe, expect, it } from "vitest";
import { CLASES_CONTRASENA, generarContrasenaTemporal, LARGO_CONTRASENA_TEMPORAL } from "../src/crypto/contrasenaTemporal";

describe("D3 contraseña temporal de la familia", () => {
  it("D3 la contraseña generada cumple el largo y las cuatro clases, no usa 0 O 1 l I y no se repite", () => {
    const generadas = Array.from({ length: 500 }, generarContrasenaTemporal);
    for (const c of generadas) {
      expect(c).toHaveLength(LARGO_CONTRASENA_TEMPORAL);
      for (const clase of CLASES_CONTRASENA) expect([...c].some((x) => clase.includes(x)), c).toBe(true);
      expect(c).not.toMatch(/[0O1lI]/);
      expect([...c].every((x) => CLASES_CONTRASENA.join("").includes(x))).toBe(true);
    }
    expect(new Set(generadas).size).toBe(generadas.length);
    expect(LARGO_CONTRASENA_TEMPORAL).toBe(16);
  });
});
