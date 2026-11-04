// Inspección de un archivo mientras se recibe (HU0006-2.0, ADR-21): reconoce el formato por su firma (los primeros bytes),
// no por la extensión ni por el Content-Type, y corta la carga en cuanto pasa de 10 MB. No guarda el archivo entero en
// memoria: solo retiene los primeros 8 bytes hasta poder decidir.
import { Transform } from "node:stream";
import { ErrorApi } from "../errores";

export const MAXIMO_BYTES = 10 * 1024 * 1024;
export const MENSAJE_FORMATO = "Solo se aceptan archivos PDF, JPG o PNG de hasta 10 MB";

export type FormatoArchivo = "pdf" | "jpg" | "png";

const FIRMAS: ReadonlyArray<readonly [FormatoArchivo, Buffer]> = [
  ["pdf", Buffer.from("%PDF-")],
  ["jpg", Buffer.from([0xff, 0xd8, 0xff])],
  ["png", Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])],
];
const BYTES_PARA_DECIDIR = Math.max(...FIRMAS.map(([, f]) => f.length));

export const formatoPorFirma = (inicio: Buffer): FormatoArchivo | null =>
  FIRMAS.find(([, firma]) => inicio.subarray(0, firma.length).equals(firma))?.[0] ?? null;

export const demasiadoGrande = () => new ErrorApi(413, "ARCHIVO_DEMASIADO_GRANDE", MENSAJE_FORMATO);
export const formatoNoAdmitido = () => new ErrorApi(415, "FORMATO_NO_ADMITIDO", MENSAJE_FORMATO);

export interface InspectorArchivo extends Transform {
  readonly formato: FormatoArchivo | null;
  readonly bytes: number;
}

// Pasa el contenido sin cambios; falla con 415 si la firma no es PDF, JPG ni PNG (también un archivo vacío) y con 413 al
// pasar de MAXIMO_BYTES. Se usa entre la petición y el almacenamiento: el error cancela el guardado.
export function crearInspector(maximo = MAXIMO_BYTES): InspectorArchivo {
  let formato: FormatoArchivo | null = null;
  let decidido = false;
  let bytes = 0;
  let retenido = Buffer.alloc(0);

  const decidir = (t: Transform, siguiente: (e?: Error | null) => void): boolean => {
    formato = formatoPorFirma(retenido);
    decidido = true;
    if (!formato) {
      siguiente(formatoNoAdmitido());
      return false;
    }
    t.push(retenido);
    retenido = Buffer.alloc(0);
    return true;
  };

  const inspector = new Transform({
    transform(trozo: Buffer, _codificacion, siguiente) {
      bytes += trozo.length;
      if (bytes > maximo) return siguiente(demasiadoGrande());
      if (decidido) return siguiente(null, trozo);
      retenido = Buffer.concat([retenido, trozo]);
      if (retenido.length < BYTES_PARA_DECIDIR) return siguiente();
      if (decidir(this, siguiente)) siguiente();
    },
    flush(siguiente) {
      // Un archivo más corto que la firma más larga se decide aquí (y uno vacío no tiene firma).
      if (!decidido && !decidir(this, siguiente)) return;
      siguiente();
    },
  }) as InspectorArchivo;
  Object.defineProperties(inspector, {
    formato: { get: () => formato },
    bytes: { get: () => bytes },
  });
  return inspector;
}
