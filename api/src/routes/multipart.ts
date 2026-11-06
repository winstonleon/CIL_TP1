// Recepción de cargas multipart/form-data con busboy (ADR-21): los campos de texto llegan antes del archivo y el archivo
// se entrega como stream a `procesar` mientras se recibe, sin pasar por la memoria ni por el disco de la API.
// Un archivo, hasta 10 MB. Ante cualquier error se deja de procesar y se descarta el resto del cuerpo (con tope).
import busboy from "busboy";
import type { Request } from "express";
import type { Readable } from "node:stream";
import { ErrorApi } from "../errores";
import { demasiadoGrande, MAXIMO_BYTES } from "../services/cargaArchivo";

// Los campos de texto y los encabezados de las partes caben en esta holgura sobre el tamaño máximo del archivo.
const HOLGURA_CUERPO = 64 * 1024;
// Lo máximo que se lee y descarta tras un error antes de cortar la conexión.
const TOPE_DESCARTE = 3 * MAXIMO_BYTES;
const LIMITE_CAMPO = 1024; // bytes de un campo de texto

export interface OpcionesCarga {
  // Bytes de un campo de texto (p. ej. las conclusiones del dictamen, HU0010). Debe caber en HOLGURA_CUERPO.
  limiteCampo?: number;
}

const invalido = (mensaje: string) => new ErrorApi(400, "VALIDACION", mensaje);

function descartar(req: Request): void {
  let leidos = 0;
  req.on("data", (trozo: Buffer) => {
    leidos += trozo.length;
    if (leidos > TOPE_DESCARTE) req.destroy();
  });
  req.on("error", () => undefined);
  req.resume();
}

export function recibirCarga<T>(
  req: Request,
  procesar: (campos: Record<string, string>, archivo: Readable) => Promise<T>,
): Promise<T> {
  // Sin archivo opcional, `recibir` nunca llama a `procesar` con null: falta el archivo es un 400.
  return recibir(req, (campos, archivo) => procesar(campos, archivo!), false, {});
}

// Igual, con el archivo opcional (el informe del dictamen, HU0010-1.0): sin la parte «archivo», `procesar` recibe null
// al terminar el cuerpo.
export function recibirCargaConArchivoOpcional<T>(
  req: Request,
  procesar: (campos: Record<string, string>, archivo: Readable | null) => Promise<T>,
  opciones: OpcionesCarga = {},
): Promise<T> {
  return recibir(req, procesar, true, opciones);
}

function recibir<T>(
  req: Request,
  procesar: (campos: Record<string, string>, archivo: Readable | null) => Promise<T>,
  archivoOpcional: boolean,
  opciones: OpcionesCarga,
): Promise<T> {
  const limiteCampo = Math.min(opciones.limiteCampo ?? LIMITE_CAMPO, HOLGURA_CUERPO / 2);
  return new Promise<T>((resolver, rechazar) => {
    let terminado = false;
    let analizador: ReturnType<typeof busboy> | undefined;
    const fallar = (e: unknown) => {
      if (terminado) return;
      terminado = true;
      if (analizador) req.unpipe(analizador);
      descartar(req);
      rechazar(e);
    };

    const largo = Number(req.headers["content-length"]);
    if (Number.isFinite(largo) && largo > MAXIMO_BYTES + HOLGURA_CUERPO) return fallar(demasiadoGrande());

    try {
      analizador = busboy({
        headers: req.headers,
        // fileSize + 1: el inspector ve el byte de más y responde 413 (busboy solo trunca como respaldo).
        limits: { fieldSize: limiteCampo, fields: 8, files: 1, parts: 10, fileSize: MAXIMO_BYTES + 1 },
      });
    } catch {
      return fallar(invalido("Se esperaba un formulario multipart/form-data"));
    }

    const campos: Record<string, string> = {};
    let archivoIniciado = false;
    let resultado: Promise<T> | undefined;

    analizador.on("field", (nombre, valor, info) => {
      if (archivoIniciado) return fallar(invalido("Los campos van antes del archivo"));
      if (info.nameTruncated || info.valueTruncated) return fallar(invalido("Un campo es demasiado largo"));
      campos[nombre] = valor;
    });
    analizador.on("file", (nombre, archivo) => {
      if (nombre !== "archivo" || archivoIniciado) {
        archivo.resume();
        return fallar(invalido("Se esperaba un solo archivo en el campo «archivo»"));
      }
      archivoIniciado = true;
      resultado = procesar({ ...campos }, archivo);
      resultado.catch((e) => {
        archivo.resume();
        fallar(e);
      });
    });
    analizador.on("filesLimit", () => fallar(invalido("Se esperaba un solo archivo")));
    analizador.on("fieldsLimit", () => fallar(invalido("Hay campos de más")));
    analizador.on("partsLimit", () => fallar(invalido("Hay partes de más")));
    analizador.on("error", fallar);
    analizador.on("close", () => {
      if (!resultado && archivoOpcional) resultado = procesar({ ...campos }, null);
      if (!resultado) return fallar(invalido("Falta el archivo"));
      resultado.then((valor) => {
        if (terminado) return;
        terminado = true;
        resolver(valor);
      }, fallar);
    });

    req.pipe(analizador);
  });
}
