// Suite de contrato del almacenamiento (ADR-12 D1, ADR-19, ADR-21): todo adaptador debe pasarla, también con el
// decorador de cifrado encima. Un adaptador nuevo (gdrive) se agrega llamando a `probarContrato` con su fábrica.
import { randomBytes, randomUUID } from "node:crypto";
import { Readable } from "node:stream";
import { describe, expect, it } from "vitest";
import { ErrorAlmacenamiento, type Almacenamiento } from "../../src/almacenamiento";

export interface EntornoAlmacenamiento {
  almacenamiento: Almacenamiento;
  // Cuántos objetos hay guardados (los parciales no cuentan como objetos válidos pero tampoco deben quedar).
  contarObjetos: () => Promise<number>;
}

const leer = async (flujo: Readable) => {
  const trozos: Buffer[] = [];
  for await (const t of flujo) trozos.push(t as Buffer);
  return Buffer.concat(trozos);
};

export function probarContrato(nombre: string, crear: () => Promise<EntornoAlmacenamiento>) {
  describe(`D1 contrato del almacenamiento: ${nombre}`, () => {
    it("D1 guarda y devuelve el mismo contenido byte a byte, e informa los bytes guardados", async () => {
      const { almacenamiento } = await crear();
      const contenido = randomBytes(300_000);
      const { clave, bytes } = await almacenamiento.guardar(Readable.from([contenido.subarray(0, 100_000), contenido.subarray(100_000)]));
      expect(bytes).toBe(contenido.length);
      expect((await leer(await almacenamiento.abrir(clave))).equals(contenido)).toBe(true);
    });

    it("D1 cada guardado recibe una clave distinta, un UUID aleatorio que no deriva del contenido", async () => {
      const { almacenamiento } = await crear();
      const a = await almacenamiento.guardar(Readable.from([Buffer.from("igual")]));
      const b = await almacenamiento.guardar(Readable.from([Buffer.from("igual")]));
      expect(a.clave).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
      expect(a.clave).not.toBe(b.clave);
    });

    it("D1 respeta la clave que fija quien llama y rechaza una que no es un UUID", async () => {
      const { almacenamiento, contarObjetos } = await crear();
      const clave = randomUUID();
      expect((await almacenamiento.guardar(Readable.from([Buffer.from("x")]), clave)).clave).toBe(clave);
      const antes = await contarObjetos();
      await expect(almacenamiento.guardar(Readable.from([Buffer.from("x")]), "../fuera")).rejects.toThrow();
      expect(await contarObjetos()).toBe(antes);
    });

    it("D1 guardar con una clave que ya existe falla con CLAVE_EXISTENTE, deja intacto el original y no deja parciales", async () => {
      const { almacenamiento, contarObjetos } = await crear();
      const clave = randomUUID();
      await almacenamiento.guardar(Readable.from([Buffer.from("original")]), clave);
      const antes = await contarObjetos();

      await expect(almacenamiento.guardar(Readable.from([Buffer.from("intruso")]), clave)).rejects.toMatchObject({ codigo: "CLAVE_EXISTENTE" });
      expect((await leer(await almacenamiento.abrir(clave))).toString()).toBe("original");
      expect(await contarObjetos()).toBe(antes);
    });

    it("D1 guardar sin clave siempre genera una nueva: nunca pisa un archivo existente", async () => {
      const { almacenamiento } = await crear();
      const { clave } = await almacenamiento.guardar(Readable.from([Buffer.from("primero")]));
      const otra = await almacenamiento.guardar(Readable.from([Buffer.from("segundo")]));
      expect(otra.clave).not.toBe(clave);
      expect((await leer(await almacenamiento.abrir(clave))).toString()).toBe("primero");
    });

    it("D1 guarda y devuelve un contenido vacío", async () => {
      const { almacenamiento } = await crear();
      const { clave, bytes } = await almacenamiento.guardar(Readable.from([]));
      expect(bytes).toBe(0);
      expect((await leer(await almacenamiento.abrir(clave))).length).toBe(0);
    });

    it("D1 una clave mal formada, con rutas o inexistente da NO_EXISTE", async () => {
      const { almacenamiento } = await crear();
      for (const clave of ["../../etc/passwd", "..\\..\\secreto", "no-es-uuid", "", randomUUID()]) {
        await expect(almacenamiento.abrir(clave)).rejects.toMatchObject({ codigo: "NO_EXISTE" });
        await expect(almacenamiento.abrir(clave)).rejects.toBeInstanceOf(ErrorAlmacenamiento);
      }
    });

    it("D1 un stream que falla a mitad de camino no deja ningún objeto", async () => {
      const { almacenamiento, contarObjetos } = await crear();
      const antes = await contarObjetos();
      const roto = new Readable({
        read() {
          this.push(randomBytes(50_000));
          setImmediate(() => this.destroy(new Error("corte")));
        },
      });
      await expect(almacenamiento.guardar(roto)).rejects.toThrow();
      expect(await contarObjetos()).toBe(antes);
    });

    it("D1 eliminar es idempotente y después el archivo no existe", async () => {
      const { almacenamiento } = await crear();
      const { clave } = await almacenamiento.guardar(Readable.from([Buffer.from("borrar")]));
      await almacenamiento.eliminar(clave);
      await expect(almacenamiento.eliminar(clave)).resolves.toBeUndefined();
      await expect(almacenamiento.eliminar("no-es-uuid")).resolves.toBeUndefined();
      await expect(almacenamiento.abrir(clave)).rejects.toMatchObject({ codigo: "NO_EXISTE" });
    });

    it("D1 guardar no lee el contenido entero en memoria (128 MiB en trozos de 1 MiB)", async () => {
      const { almacenamiento } = await crear();
      const MiB = 1024 * 1024;
      let maximo = 0;
      const base = process.memoryUsage().arrayBuffers;
      const origen = Readable.from(
        (async function* () {
          for (let i = 0; i < 128; i++) {
            maximo = Math.max(maximo, process.memoryUsage().arrayBuffers - base);
            yield Buffer.alloc(MiB, i);
          }
        })(),
      );
      const { clave, bytes } = await almacenamiento.guardar(origen);
      expect(bytes).toBe(128 * MiB);
      await almacenamiento.eliminar(clave);
      // Si el adaptador acumulara el contenido, el pico pasaría de 128 MiB.
      expect(maximo).toBeLessThan(48 * MiB);
    }, 60_000);
  });
}
