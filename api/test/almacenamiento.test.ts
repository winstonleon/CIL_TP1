// D1 (ADR-12, ADR-19, ADR-21): adaptador local con la suite de contrato, y el cifrado de los archivos en reposo (ADR-03)
// con su formato, el dato asociado (AAD), la verificación antes de entregar y la rotación de la clave. Sin servicios externos.
import { createHash, randomBytes } from "node:crypto";
import { mkdtemp, readdir, readFile, rename, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { describe, expect, it } from "vitest";
import { cifrar } from "../src/almacenamiento/cifrado";
import { crearAlmacenamientoLocal } from "../src/almacenamiento/local";
import { variablesInvalidas } from "../src/config";
import { probarContrato, type EntornoAlmacenamiento } from "./almacenamiento/contrato";

const nuevoDirectorio = () => mkdtemp(join(tmpdir(), "cil-prueba-almacenamiento-"));
const contarArchivos = (dir: string) => async () => (await readdir(dir)).length;
const leer = async (flujo: Readable) => {
  const trozos: Buffer[] = [];
  for await (const t of flujo) trozos.push(t as Buffer);
  return Buffer.concat(trozos);
};

const claveA = randomBytes(32);
const claveB = randomBytes(32);

probarContrato("local", async (): Promise<EntornoAlmacenamiento> => {
  const dir = await nuevoDirectorio();
  return { almacenamiento: crearAlmacenamientoLocal(dir), contarObjetos: contarArchivos(dir) };
});

probarContrato("local cifrado (AES-256-GCM)", async (): Promise<EntornoAlmacenamiento> => {
  const dir = await nuevoDirectorio();
  return { almacenamiento: cifrar(crearAlmacenamientoLocal(dir), { vigente: claveA }), contarObjetos: contarArchivos(dir) };
});

async function cifrado(anterior?: Buffer, vigente = claveA) {
  const dir = await nuevoDirectorio();
  const local = crearAlmacenamientoLocal(dir);
  return { dir, local, almacenamiento: cifrar(local, { vigente, anterior }) };
}

describe("ADR-03 los archivos se cifran en reposo (formato CILF, AES-256-GCM)", () => {
  it("ADR-03 los bytes guardados llevan la cabecera CILF y no contienen el texto plano", async () => {
    const { almacenamiento, local } = await cifrado();
    const secreto = Buffer.from("DNI 00000001 - informe de terapia ficticio");
    const { clave } = await almacenamiento.guardar(Readable.from([secreto]));

    const crudo = await leer(await local.abrir(clave));
    expect(crudo.subarray(0, 4).toString()).toBe("CILF");
    // cabecera (4 + 4 + 12) + contenido + etiqueta (16)
    expect(crudo).toHaveLength(20 + secreto.length + 16);
    expect(crudo.includes(secreto)).toBe(false);
    expect(crudo.includes(Buffer.from("00000001"))).toBe(false);
  });

  it("ADR-03 dos guardados del mismo contenido dan bytes distintos (IV aleatorio)", async () => {
    const { almacenamiento, local } = await cifrado();
    const a = await almacenamiento.guardar(Readable.from([Buffer.from("igual")]));
    const b = await almacenamiento.guardar(Readable.from([Buffer.from("igual")]));
    expect((await leer(await local.abrir(a.clave))).equals(await leer(await local.abrir(b.clave)))).toBe(false);
  });

  it("ADR-03 dos archivos intercambiados en disco dan error al leerse (la clave de almacenamiento es parte del AAD)", async () => {
    const { almacenamiento, dir } = await cifrado();
    const a = await almacenamiento.guardar(Readable.from([Buffer.from("contenido de A")]));
    const b = await almacenamiento.guardar(Readable.from([Buffer.from("contenido de B")]));
    await rename(join(dir, a.clave), join(dir, "intermedio"));
    await rename(join(dir, b.clave), join(dir, a.clave));
    await rename(join(dir, "intermedio"), join(dir, b.clave));

    await expect(almacenamiento.abrir(a.clave)).rejects.toMatchObject({ codigo: "CORRUPTO" });
    await expect(almacenamiento.abrir(b.clave)).rejects.toMatchObject({ codigo: "CORRUPTO" });
  });

  it("ADR-03 un byte alterado (contenido, etiqueta o IV) no entrega ningún byte del contenido", async () => {
    const { almacenamiento, dir } = await cifrado();
    const { clave } = await almacenamiento.guardar(Readable.from([randomBytes(5000)]));
    const original = await readFile(join(dir, clave));
    // El contenido, la etiqueta (último byte) y el IV (byte 10 de la cabecera).
    for (const posicion of [100, original.length - 1, 10]) {
      const alterado = Buffer.from(original);
      alterado[posicion] = alterado[posicion]! ^ 0x01;
      await writeFile(join(dir, clave), alterado);
      // `abrir` falla antes de devolver el stream: no hay forma de leer contenido sin verificar.
      await expect(almacenamiento.abrir(clave)).rejects.toMatchObject({ codigo: "CORRUPTO" });
    }
  });

  it("ADR-03 un archivo truncado o sin la cabecera CILF es CORRUPTO", async () => {
    const { almacenamiento, dir } = await cifrado();
    const { clave } = await almacenamiento.guardar(Readable.from([randomBytes(1000)]));
    const original = await readFile(join(dir, clave));

    await writeFile(join(dir, clave), original.subarray(0, original.length - 5));
    await expect(almacenamiento.abrir(clave)).rejects.toMatchObject({ codigo: "CORRUPTO" });
    await writeFile(join(dir, clave), Buffer.concat([Buffer.from("XXXX"), original.subarray(4)]));
    await expect(almacenamiento.abrir(clave)).rejects.toMatchObject({ codigo: "CORRUPTO" });
    await writeFile(join(dir, clave), Buffer.alloc(5));
    await expect(almacenamiento.abrir(clave)).rejects.toMatchObject({ codigo: "CORRUPTO" });
  });

  it("ADR-03 un archivo cifrado con una clave que ya no está configurada da CLAVE_DESCONOCIDA", async () => {
    const { almacenamiento, dir } = await cifrado();
    const { clave } = await almacenamiento.guardar(Readable.from([Buffer.from("contenido")]));
    const otra = cifrar(crearAlmacenamientoLocal(dir), { vigente: claveB });
    await expect(otra.abrir(clave)).rejects.toMatchObject({ codigo: "CLAVE_DESCONOCIDA" });
  });

  it("ADR-03 rotación: con la clave anterior configurada se lee lo viejo, y lo nuevo se escribe con la vigente (C47)", async () => {
    const viejo = await cifrado();
    const { clave: claveVieja } = await viejo.almacenamiento.guardar(Readable.from([Buffer.from("escrito con A")]));

    const rotado = cifrar(viejo.local, { vigente: claveB, anterior: claveA });
    expect((await leer(await rotado.abrir(claveVieja))).toString()).toBe("escrito con A");

    const { clave: claveNueva } = await rotado.guardar(Readable.from([Buffer.from("escrito con B")]));
    const crudo = await readFile(join(viejo.dir, claveNueva));
    const idB = createHash("sha256").update(claveB).digest().subarray(0, 4);
    expect(crudo.subarray(4, 8).equals(idB)).toBe(true);
    expect((await leer(await rotado.abrir(claveNueva))).toString()).toBe("escrito con B");
  });
});

describe("D1 configuración del almacenamiento", () => {
  const base = {
    POSTGRES_HOST: "h", POSTGRES_PORT: "5432", ADMISION_DB: "d", ADMISION_DB_USER: "u", ADMISION_DB_PASSWORD: "p",
    KEYCLOAK_PUBLIC_URL: "http://k", KEYCLOAK_INTERNAL_URL: "http://k", KEYCLOAK_REALM: "r", KEYCLOAK_API_CLIENT_ID: "c",
    KEYCLOAK_API_CLIENT_SECRET: "s", FRONTEND_PUBLIC_URL: "http://f",
    DATA_ENCRYPTION_KEY: randomBytes(32).toString("base64"), DATA_HMAC_KEY: randomBytes(32).toString("base64"),
    INTERNAL_API_TOKEN: randomBytes(32).toString("hex"), CAMPANA_ACTIVA: "2027", N8N_WEBHOOK_INTERNAL_URL: "http://n",
    N8N_WEBHOOK_SECRET: randomBytes(32).toString("hex"), ENLACE_VISITA_KEY: randomBytes(32).toString("base64"),
    RECORDATORIO_VISITA_HORAS: "24", STORAGE_DRIVER: "local", STORAGE_LOCAL_DIR: "/tmp/x",
    ARCHIVOS_ENCRYPTION_KEY: randomBytes(32).toString("base64"),
    CORREO_ADMISION: "admision@ejemplo.test",
    CORREO_TESORERIA: "tesoreria@ejemplo.test",
  } as NodeJS.ProcessEnv;

  it("D1 una configuración completa es válida y la clave anterior es opcional", () => {
    expect(variablesInvalidas(base)).toEqual([]);
    expect(variablesInvalidas({ ...base, ARCHIVOS_ENCRYPTION_KEY_ANTERIOR: "" })).toEqual([]);
  });

  it("HU0006-1.0 (tope técnico) MAX_DOCUMENTOS_POR_REQUISITO vale 20 por defecto, admite de 1 a 100 y nombra la variable si es inválida", () => {
    expect(variablesInvalidas({ ...base, MAX_DOCUMENTOS_POR_REQUISITO: "20" })).toEqual([]);
    expect(variablesInvalidas({ ...base, MAX_DOCUMENTOS_POR_REQUISITO: "1" })).toEqual([]);
    expect(variablesInvalidas({ ...base, MAX_DOCUMENTOS_POR_REQUISITO: "100" })).toEqual([]);
    for (const malo of ["0", "101", "-3", "veinte", "2.5"]) {
      expect(variablesInvalidas({ ...base, MAX_DOCUMENTOS_POR_REQUISITO: malo })).toEqual(["MAX_DOCUMENTOS_POR_REQUISITO"]);
    }
  });

  it("D1 un STORAGE_DRIVER desconocido o una clave que no es de 32 bytes nombran la variable, nunca su valor", () => {
    expect(variablesInvalidas({ ...base, STORAGE_DRIVER: "gdrive" })).toEqual(["STORAGE_DRIVER"]);
    expect(variablesInvalidas({ ...base, STORAGE_DRIVER: undefined })).toEqual(["STORAGE_DRIVER"]);
    expect(variablesInvalidas({ ...base, ARCHIVOS_ENCRYPTION_KEY: "corta" })).toEqual(["ARCHIVOS_ENCRYPTION_KEY"]);
    expect(variablesInvalidas({ ...base, ARCHIVOS_ENCRYPTION_KEY_ANTERIOR: "corta" })).toEqual(["ARCHIVOS_ENCRYPTION_KEY_ANTERIOR"]);
    expect(variablesInvalidas({ ...base, STORAGE_LOCAL_DIR: "" })).toEqual(["STORAGE_LOCAL_DIR"]);
  });
});
