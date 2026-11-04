// Cifrado de los archivos en reposo (ADR-03, ADR-21): decorador sobre cualquier adaptador. AES-256-GCM, un solo bloque
// GCM por archivo. Formato: "CILF" + id de la clave (4 bytes del SHA-256 de la clave) + IV (12) + cifrado + etiqueta (16).
// El dato asociado (AAD) es la cabecera más la clave de almacenamiento: un archivo movido a otra clave no se descifra.
// La carga cifra en stream. La descarga lee el cifrado entero (10 MB como máximo), lo descifra y verifica la etiqueta
// ANTES de devolver el primer byte: nunca sale contenido sin verificar.
import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from "node:crypto";
import { Readable, Transform, pipeline } from "node:stream";
import { ErrorAlmacenamiento, type Almacenamiento, type ResultadoGuardado } from "./tipos";

const MAGIA = Buffer.from("CILF");
const LARGO_ID = 4;
const LARGO_IV = 12;
const LARGO_CABECERA = MAGIA.length + LARGO_ID + LARGO_IV;
const LARGO_ETIQUETA = 16;
// Tope de lo que la descarga acepta leer a memoria: los 10 MB de HU0006-2.0 más la cabecera y la etiqueta, con holgura.
const MAXIMO_CIFRADO = 11 * 1024 * 1024;

export interface ClavesArchivos {
  vigente: Buffer;
  // Solo durante una rotación (C47): para leer lo que aún no se re-cifró.
  anterior?: Buffer;
}

const idDe = (clave: Buffer) => createHash("sha256").update(clave).digest().subarray(0, LARGO_ID);

export function cifrar(interno: Almacenamiento, claves: ClavesArchivos): Almacenamiento {
  const idVigente = idDe(claves.vigente);
  const porId = new Map<string, Buffer>([[idVigente.toString("hex"), claves.vigente]]);
  if (claves.anterior) porId.set(idDe(claves.anterior).toString("hex"), claves.anterior);

  return {
    async guardar(contenido: Readable, claveDada?: string): Promise<ResultadoGuardado> {
      const clave = claveDada ?? randomUUID();
      const iv = randomBytes(LARGO_IV);
      const cabecera = Buffer.concat([MAGIA, idVigente, iv]);
      const cifrador = createCipheriv("aes-256-gcm", claves.vigente, iv);
      cifrador.setAAD(Buffer.concat([cabecera, Buffer.from(clave)]));

      let bytes = 0;
      let cabeceraEnviada = false;
      const alCifrar = new Transform({
        transform(trozo: Buffer, _codificacion, siguiente) {
          if (!cabeceraEnviada) {
            this.push(cabecera);
            cabeceraEnviada = true;
          }
          bytes += trozo.length;
          siguiente(null, cifrador.update(trozo));
        },
        flush(siguiente) {
          if (!cabeceraEnviada) this.push(cabecera);
          this.push(cifrador.final());
          this.push(cifrador.getAuthTag());
          siguiente();
        },
      });
      // Si el contenido falla, pipeline destruye `alCifrar` y el adaptador interno no deja ningún objeto.
      pipeline(contenido, alCifrar, () => undefined);
      const guardado = await interno.guardar(alCifrar, clave);
      return { clave: guardado.clave, bytes };
    },

    async abrir(clave: string): Promise<Readable> {
      const origen = await interno.abrir(clave);
      const trozos: Buffer[] = [];
      let total = 0;
      for await (const trozo of origen) {
        total += (trozo as Buffer).length;
        if (total > MAXIMO_CIFRADO) {
          origen.destroy();
          throw new ErrorAlmacenamiento("CORRUPTO", "El archivo almacenado no es válido");
        }
        trozos.push(trozo as Buffer);
      }
      const todo = Buffer.concat(trozos);
      if (todo.length < LARGO_CABECERA + LARGO_ETIQUETA || !todo.subarray(0, MAGIA.length).equals(MAGIA)) {
        throw new ErrorAlmacenamiento("CORRUPTO", "El archivo almacenado no es válido");
      }
      const cabecera = todo.subarray(0, LARGO_CABECERA);
      const claveCifrado = porId.get(cabecera.subarray(MAGIA.length, MAGIA.length + LARGO_ID).toString("hex"));
      if (!claveCifrado) throw new ErrorAlmacenamiento("CLAVE_DESCONOCIDA", "El archivo se cifró con una clave que no está configurada");

      const iv = cabecera.subarray(MAGIA.length + LARGO_ID);
      const descifrador = createDecipheriv("aes-256-gcm", claveCifrado, iv);
      descifrador.setAAD(Buffer.concat([cabecera, Buffer.from(clave)]));
      descifrador.setAuthTag(todo.subarray(todo.length - LARGO_ETIQUETA));
      try {
        const claro = Buffer.concat([descifrador.update(todo.subarray(LARGO_CABECERA, todo.length - LARGO_ETIQUETA)), descifrador.final()]);
        return Readable.from([claro], { objectMode: false });
      } catch {
        // La etiqueta no coincide: contenido alterado, o archivo de otra clave de almacenamiento (AAD).
        throw new ErrorAlmacenamiento("CORRUPTO", "El archivo almacenado no es válido");
      }
    },

    eliminar: (clave: string) => interno.eliminar(clave),
  };
}
