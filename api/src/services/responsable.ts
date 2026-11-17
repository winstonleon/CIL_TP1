// Quien corre un comando de producción que deja un evento de la bitácora sin actor (campana:cargar, directora:crear y firma:cargar): su
// nombre queda en el `detalle` del evento, que no tiene id_personal (modelo de datos §4.7). El comando real lo exige; con --simular, o
// al llamar al servicio desde el código, solo se valida si viene.
import { ErrorApi } from "../errores";

const MINIMO = 3;
const MAXIMO = 100;

export function validarResponsable(valor: string | undefined, obligatorio: boolean): string | undefined {
  const responsable = valor?.trim();
  if (!responsable) {
    if (obligatorio) throw new ErrorApi(400, "RESPONSABLE_REQUERIDO", 'Indica quién corre el comando: --responsable "<nombre>"');
    return undefined;
  }
  if (responsable.length < MINIMO || responsable.length > MAXIMO || /[\u0000-\u001f\u007f]/.test(responsable)) {
    throw new ErrorApi(400, "RESPONSABLE_INVALIDO", `El responsable debe tener de ${MINIMO} a ${MAXIMO} caracteres, sin saltos de línea`);
  }
  return responsable;
}
