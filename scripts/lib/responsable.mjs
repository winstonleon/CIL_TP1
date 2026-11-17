// `--responsable "<nombre>"` de los comandos de producción que dejan un evento de la bitácora sin actor (campana:cargar, directora:crear y
// firma:cargar). Se saca de los argumentos y viaja al contenedor por el entorno (CIL_RESPONSABLE): ni por la línea de comandos de npm
// ni por la entrada estándar, que lleva los datos del comando.

// Devuelve el nombre (recortado) y el resto de los argumentos en su orden. Un `--responsable` sin valor, o seguido de otra opción, no
// consume nada: el comando lo trata como ausente.
export function sacarResponsable(argumentos) {
  const resto = [];
  let responsable;
  for (let k = 0; k < argumentos.length; k++) {
    if (argumentos[k] !== "--responsable") {
      resto.push(argumentos[k]);
    } else if (argumentos[k + 1] !== undefined && !argumentos[k + 1].startsWith("--")) {
      responsable = argumentos[++k].trim() || undefined;
    }
  }
  return { responsable, resto };
}

export const entornoDelResponsable = (responsable) => (responsable ? ["-e", `CIL_RESPONSABLE=${responsable}`] : []);
