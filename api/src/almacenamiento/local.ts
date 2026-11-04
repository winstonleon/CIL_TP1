// Adaptador de almacenamiento local (D1, ADR-12): un archivo por clave en STORAGE_LOCAL_DIR.
// Escribe en `<uuid>.parcial` y lo enlaza a su clave al terminar, así una caída a mitad de escritura no deja un archivo
// que parezca completo y guardar con una clave existente falla en vez de sobrescribir. La clave se valida como UUID antes
// de tocar el disco (sin path traversal).
import { randomUUID } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { link, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { Transform, type Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { UUID } from "../uuid";
import { ErrorAlmacenamiento, type Almacenamiento, type ResultadoGuardado } from "./tipos";

export function crearAlmacenamientoLocal(directorio: string): Almacenamiento {
  const rutaDe = (clave: string) => join(directorio, clave);

  return {
    async guardar(contenido: Readable, claveDada?: string): Promise<ResultadoGuardado> {
      if (claveDada !== undefined && !UUID.test(claveDada)) throw new TypeError("La clave debe ser un UUID");
      await mkdir(directorio, { recursive: true });
      const clave = claveDada ?? randomUUID();
      const parcial = `${rutaDe(clave)}.parcial`;
      let bytes = 0;
      const contador = new Transform({
        transform(trozo: Buffer, _codificacion, siguiente) {
          bytes += trozo.length;
          siguiente(null, trozo);
        },
      });
      try {
        await pipeline(contenido, contador, createWriteStream(parcial, { flags: "wx", mode: 0o600 }));
        // `link` falla si la clave ya existe (`rename` la sobrescribiría): guardar nunca pisa un archivo.
        await link(parcial, rutaDe(clave));
      } catch (e) {
        await rm(parcial, { force: true });
        if ((e as NodeJS.ErrnoException).code === "EEXIST") throw new ErrorAlmacenamiento("CLAVE_EXISTENTE", "Ya existe un archivo con esa clave");
        throw e;
      }
      await rm(parcial, { force: true });
      return { clave, bytes };
    },

    async abrir(clave: string): Promise<Readable> {
      if (!UUID.test(clave)) throw new ErrorAlmacenamiento("NO_EXISTE", "El archivo no existe");
      const lectura = createReadStream(rutaDe(clave));
      // Espera a que el archivo abra: si no existe, falla aquí y no al consumir el stream.
      await new Promise<void>((resolver, rechazar) => {
        lectura.once("open", () => resolver());
        lectura.once("error", (e: NodeJS.ErrnoException) =>
          rechazar(e.code === "ENOENT" ? new ErrorAlmacenamiento("NO_EXISTE", "El archivo no existe") : e),
        );
      });
      return lectura;
    },

    async eliminar(clave: string): Promise<void> {
      if (!UUID.test(clave)) return;
      await rm(rutaDe(clave), { force: true });
    },
  };
}
