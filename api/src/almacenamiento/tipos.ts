// Interfaz del almacenamiento de archivos (ADR-12 D1, ADR-21). Todo adaptador (local hoy, gdrive después) la cumple y
// pasa la suite de contrato `api/test/almacenamiento/contrato.ts`. La clave que devuelve `guardar` es un UUID aleatorio
// que genera el adaptador: el nombre original del archivo nunca se usa como ruta. La BD guarda solo esa clave.
import type { Readable } from "node:stream";

export interface ResultadoGuardado {
  clave: string;
  bytes: number;
}

export interface Almacenamiento {
  // Guarda el contenido del stream sin leerlo entero en memoria. Si el stream falla, no deja ningún objeto.
  // `clave` (un UUID) la fija quien llama cuando la necesita antes de guardar (el cifrado la usa como dato asociado);
  // sin ella, el adaptador genera una. Siempre la genera el servidor: nunca sale de la petición del cliente. Guardar con
  // una clave que ya existe falla con ErrorAlmacenamiento("CLAVE_EXISTENTE") y deja intacto el archivo original.
  // `bytes` son los del contenido recibido.
  guardar(contenido: Readable, clave?: string): Promise<ResultadoGuardado>;
  // Lee un archivo. Una clave mal formada o inexistente lanza ErrorAlmacenamiento("NO_EXISTE").
  abrir(clave: string): Promise<Readable>;
  // Idempotente: eliminar una clave que no existe no es un error.
  eliminar(clave: string): Promise<void>;
}

export type CodigoErrorAlmacenamiento = "NO_EXISTE" | "CORRUPTO" | "CLAVE_DESCONOCIDA" | "CLAVE_EXISTENTE";

// Los mensajes no llevan claves ni rutas.
export class ErrorAlmacenamiento extends Error {
  constructor(
    readonly codigo: CodigoErrorAlmacenamiento,
    mensaje: string,
  ) {
    super(mensaje);
  }
}
