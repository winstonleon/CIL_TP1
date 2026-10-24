// Reglas de formato del formulario P01 (HU0001-2.0). Son las MISMAS que aplica la API en
// api/src/services/reglasSolicitud.ts: la prueba «HU0001-2.0 el cliente y el servidor aplican las mismas reglas»
// (api/test/solicitudInformacion.test.ts) compara los dos módulos con una tabla de casos. Si cambias una regla aquí,
// cámbiala también allá. Módulo puro (sin DOM ni Vue), para que esa prueba pueda importarlo.

export const LARGO_MAXIMO = { nombres: 100, apellidos: 100, correo: 150, telefono: 25 } as const;

// Expresión de correo de zod 4.6.5 (z.regexes.email), copiada tal cual de la API.
export const CORREO = /^(?:[A-Za-z0-9_'+\-]+\.)*[A-Za-z0-9_'+\-]*[A-Za-z0-9_+-]@(?:[A-Za-z0-9][A-Za-z0-9\-]*\.)+[A-Za-z]{2,}$/;

export function correoValido(correo: string): boolean {
  const valor = correo.trim();
  return valor.length <= LARGO_MAXIMO.correo && CORREO.test(valor);
}

// Teléfono (plan HU0001, P3 y S8). Se quitan espacios, guiones y paréntesis, y vale:
// - un celular peruano: 9 y 8 dígitos, con +51 o 51 delante o sin ellos → «+51987654321»;
// - un número E.164 de otro país: + y de 8 a 15 dígitos, sin empezar en 0 → se guarda tal cual («+34612345678»).
// Con +51 solo valen los celulares (S8). Sin +, solo vale el formato peruano. Devuelve null si no es válido.
export function normalizarTelefono(telefono: string): string | null {
  if (telefono.length > LARGO_MAXIMO.telefono) return null;
  const limpio = telefono.replace(/[\s()-]/g, "");
  const celular = /^(?:\+?51)?(9\d{8})$/.exec(limpio);
  if (celular) return `+51${celular[1]}`;
  if (limpio.startsWith("+51")) return null;
  return /^\+[1-9]\d{7,14}$/.test(limpio) ? limpio : null;
}
