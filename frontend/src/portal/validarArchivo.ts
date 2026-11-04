// Validación previa de un archivo antes de subirlo (HU0006-2.0, HU0007): tamaño y formato por su firma (los primeros
// bytes), no por la extensión ni por el tipo que declara el navegador. Es una comodidad para avisar de inmediato: la API
// vuelve a validarlo y manda (413 y 415).
export const MAXIMO_BYTES = 10 * 1024 * 1024;
export const MENSAJE_ARCHIVO = "Solo se aceptan archivos PDF, JPG o PNG de hasta 10 MB.";

const FIRMAS: ReadonlyArray<readonly number[]> = [
  [0x25, 0x50, 0x44, 0x46, 0x2d], // %PDF-
  [0xff, 0xd8, 0xff], // JPG
  [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], // PNG
];

export const tieneFirmaAdmitida = (inicio: Uint8Array): boolean =>
  FIRMAS.some((firma) => firma.every((byte, i) => inicio[i] === byte));

// FileReader y no Blob.arrayBuffer(): lo admiten todos los navegadores y el entorno de pruebas.
function leerInicio(archivo: Blob, bytes: number): Promise<Uint8Array> {
  return new Promise((resolver, rechazar) => {
    const lector = new FileReader();
    lector.onload = () => resolver(new Uint8Array(lector.result as ArrayBuffer));
    lector.onerror = () => rechazar(lector.error);
    lector.readAsArrayBuffer(archivo.slice(0, bytes));
  });
}

// null si el archivo es admisible; si no, el mensaje de HU0006-2.0 para mostrar junto al campo.
export async function validarArchivo(archivo: File): Promise<string | null> {
  if (archivo.size > MAXIMO_BYTES) return MENSAJE_ARCHIVO;
  try {
    return tieneFirmaAdmitida(await leerInicio(archivo, 8)) ? null : MENSAJE_ARCHIVO;
  } catch {
    return "No se pudo leer el archivo. Vuelve a seleccionarlo.";
  }
}
