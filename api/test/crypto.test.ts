import { describe, expect, it } from "vitest";
import { cifrar, columnasDni, descifrar, hashDni, normalizarDni } from "../src/crypto/columnas";

const B64 = "[A-Za-z0-9+/]+={0,2}";

describe("S0-B1 cifrado de columnas (AES-256-GCM)", () => {
  it("S0-B1 cifra y descifra el DNI (ida y vuelta)", () => {
    expect(descifrar(cifrar("00000001"))).toBe("00000001");
  });

  it("S0-B1 el valor cifrado tiene el formato v1:iv:authTag:ciphertext con IV de 12 bytes y tag de 16", () => {
    const valor = cifrar("00000001");
    expect(valor).toMatch(new RegExp(`^v1:${B64}:${B64}:${B64}$`));
    const [, iv, tag] = valor.split(":");
    expect(Buffer.from(iv!, "base64")).toHaveLength(12);
    expect(Buffer.from(tag!, "base64")).toHaveLength(16);
    expect(valor).not.toContain("00000001");
  });

  it("S0-B1 dos cifrados del mismo DNI son distintos (IV aleatorio)", () => {
    expect(cifrar("00000001")).not.toBe(cifrar("00000001"));
  });

  it("S0-B1 un authTag alterado hace fallar el descifrado", () => {
    const [v, iv, tag, ct] = cifrar("00000001").split(":");
    const tagAlterado = Buffer.from(tag!, "base64");
    tagAlterado[0] = tagAlterado[0]! ^ 0xff;
    expect(() => descifrar([v, iv, tagAlterado.toString("base64"), ct].join(":"))).toThrow();
  });

  it("S0-B1 un ciphertext alterado hace fallar el descifrado", () => {
    const [v, iv, tag, ct] = cifrar("00000001").split(":");
    const ctAlterado = Buffer.from(ct!, "base64");
    ctAlterado[0] = ctAlterado[0]! ^ 0xff;
    expect(() => descifrar([v, iv, tag, ctAlterado.toString("base64")].join(":"))).toThrow();
  });

  it("S0-B1 rechaza una versión de formato desconocida", () => {
    const valor = cifrar("00000001").replace(/^v1:/, "v9:");
    expect(() => descifrar(valor)).toThrow("Formato de columna cifrada no reconocido");
  });
});

describe("S0-B2 hash y normalización del DNI", () => {
  it("S0-B2 hashDni es determinista y tiene 64 caracteres hexadecimales", () => {
    expect(hashDni("00000001")).toBe(hashDni("00000001"));
    expect(hashDni("00000001")).toMatch(/^[0-9a-f]{64}$/);
  });

  it("S0-B2 ' 0000-0001 ' y '00000001' producen el mismo hash (trim, sin espacios ni guiones)", () => {
    expect(hashDni(" 0000-0001 ")).toBe(hashDni("00000001"));
    expect(hashDni("0000 0001")).toBe(hashDni("00000001"));
  });

  it("S0-B2 '00000001' y '1' producen hashes distintos (el DNI se conserva como texto)", () => {
    expect(hashDni("1")).not.toBe(hashDni("00000001"));
  });

  it("S0-B2 normalizarDni conserva los ceros iniciales y devuelve texto", () => {
    const n = normalizarDni(" 0000-0001 ");
    expect(n).toBe("00000001");
    expect(typeof n).toBe("string");
  });

  it("S0-B2 normaliza a mayúsculas un carné de extranjería", () => {
    expect(normalizarDni("ce-00ab12")).toBe("CE00AB12");
    expect(hashDni("ce-00ab12")).toBe(hashDni("CE00AB12"));
  });

  it("S0-B2 rechaza un DNI vacío tras normalizar", () => {
    expect(() => hashDni("  - ")).toThrow();
  });

  it("S0-B2 columnasDni cifra el DNI normalizado y calcula su hash", () => {
    const { dni_cifrado, dni_hash } = columnasDni(" 0000-0001 ");
    expect(descifrar(dni_cifrado)).toBe("00000001");
    expect(dni_hash).toBe(hashDni("00000001"));
  });
});
