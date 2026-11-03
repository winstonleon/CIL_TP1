// Reglas de la matriz de trazabilidad (scripts/matriz-trazabilidad.mjs), sin E/S, para poder probarlas con node --test.
// Una prueba es { suite: "API" | "Frontend" | "E2E", archivo, titulo, resultado: "pasó" | "falló" | "omitida" | … }.
// Un escenario es { id, pruebas: [...] }.

// HU0021-2.0 (compromiso C17): el mecanismo se probó con rutas que existen solo en la prueba.
export const MARCA_C17 = "[política, ruta de prueba]";
export const ESTADO_C17 = "mecanismo probado; verificación en ruta real pendiente (C17)";

// Escenarios cuya verificación se completa en otras HU o etapas (plan HU0022, compromiso C25; plan HU0002, C30 y C34; plan HU0005, C43).
// Cada prueba de estos escenarios declara la parte que cubre con «[parte: X]». Una parte queda verificada solo con
// pruebas de API o E2E que pasan: las de frontend usan la API simulada y se listan, pero no verifican nada. El
// escenario es «cubierto» cuando todas sus partes están verificadas.
export const ESCENARIOS_POR_PARTES = {
  "HU0022-1.0": { compromiso: "C25", partes: ["almacenamiento", "completitud", "agendamiento", "adjudicación"] },
  "HU0022-2.0": { compromiso: "C25", partes: ["regla", "adjudicación real"] },
  // WhatsApp Cloud API todavía no existe (C30): se verifica que no se envía sin autorización o con el canal apagado.
  "HU0002-1.0": { compromiso: "C30", partes: ["correo", "sin WhatsApp", "WhatsApp autorizado"] },
  // D1 cubre solo el rechazo síncrono del servidor SMTP; el rebote asíncrono del proveedor queda antes del VPS (C34).
  "HU0002-2.0": { compromiso: "C34", partes: ["rechazo síncrono", "rebote asíncrono del proveedor"] },
  // Un segundo apoderado a medias no se guarda en el servidor y se pierde al recargar (C43): la parte «conservado» no tiene
  // prueba a propósito y sigue pendiente hasta que el compromiso se cumpla.
  "HU0005-2.0": { compromiso: "C43", partes: ["borrador", "segundo apoderado parcial", "segundo apoderado conservado"] },
};
export const SUITES_QUE_VERIFICAN = ["API", "E2E"];

const PARTE = /\[parte: ([^\]]+)\]/;
// Cualquier intento de marca (otras mayúsculas o espacios): si no es exactamente «[parte: X]», es un error.
const PARTE_APROXIMADA = /\[\s*parte\s*:/i;
export const parteDe = (titulo) => titulo.match(PARTE)?.[1]?.trim() ?? null;

const paso = (p) => p.resultado.startsWith("pasó");

// Errores de marcado de partes de un escenario (textos para el informe). La matriz termina con error si hay alguno.
export function erroresDePartes(esc, config = ESCENARIOS_POR_PARTES) {
  const conPartes = config[esc.id];
  const errores = [];
  for (const p of esc.pruebas) {
    const parte = parteDe(p.titulo);
    const donde = `«${p.titulo}» (${p.archivo})`;
    if (!parte && PARTE_APROXIMADA.test(p.titulo)) errores.push(`${esc.id}: la marca de parte está mal escrita (se espera «[parte: X]»): ${donde}`);
    else if (!conPartes && parte) errores.push(`${esc.id} no tiene partes, pero la prueba declara [parte: ${parte}]: ${donde}`);
    else if (conPartes && !parte) errores.push(`${esc.id} se verifica por partes y la prueba no declara [parte: …]: ${donde}`);
    else if (conPartes && !conPartes.partes.includes(parte)) {
      errores.push(`${esc.id} no tiene la parte «${parte}» (partes: ${conPartes.partes.join(", ")}): ${donde}`);
    }
  }
  return errores;
}

// Partes verificadas y pendientes de un escenario por partes.
export function partesDe(esc, config = ESCENARIOS_POR_PARTES) {
  const { partes, compromiso } = config[esc.id];
  const verificadas = partes.filter((parte) =>
    esc.pruebas.some((p) => parteDe(p.titulo) === parte && SUITES_QUE_VERIFICAN.includes(p.suite) && paso(p)),
  );
  return { verificadas, pendientes: partes.filter((x) => !verificadas.includes(x)), compromiso };
}

export function estadoDe(esc, config = ESCENARIOS_POR_PARTES) {
  if (!esc.pruebas.length) return "sin prueba";
  if (esc.pruebas.some((p) => p.resultado === "falló")) return "con fallas";
  const ejecutadas = esc.pruebas.filter(paso);
  if (!ejecutadas.length) return "no ejecutado";
  if (config[esc.id]) {
    const { verificadas, pendientes, compromiso } = partesDe(esc, config);
    if (!pendientes.length) return "cubierto";
    return `verificado: ${verificadas.join(", ") || "ninguna parte"}; pendiente: ${pendientes.join(", ")} (${compromiso})`;
  }
  if (ejecutadas.every((p) => p.titulo.includes(MARCA_C17))) return ESTADO_C17;
  return "cubierto";
}
