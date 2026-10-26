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

// ---------------------------------------------------------------- solo del cliente (pantalla P01)

// Mensajes de los campos (plan HU0001, S1; G10 para «obligatorio» y el correo). El mockup no muestra errores.
export const MENSAJES = {
  obligatorio: "Este campo es obligatorio.",
  telefono: "Ingresa un celular válido: 9 dígitos que empiecen con 9, o el número internacional con +código de país.",
  correo: "Ingresa un correo válido.",
  grado: "Selecciona el nivel y grado de interés.",
  consentimiento: "El consentimiento es obligatorio para continuar.", // texto de HU0001-3.0
} as const;

export type CampoSolicitud = "nombres" | "apellidos" | "telefono" | "correo" | "id_grado" | "acepta_politica";
export type ErroresSolicitud = Partial<Record<CampoSolicitud, string>>;

export interface DatosFormulario {
  nombres: string;
  apellidos: string;
  telefono: string;
  correo: string;
  id_grado: number | null;
  acepta_politica: boolean;
}

// HU0001-2.0 y 3.0: un campo vacío muestra el mensaje de obligatorio antes que el de formato.
export function validarSolicitud(f: DatosFormulario): ErroresSolicitud {
  const e: ErroresSolicitud = {};
  if (!f.nombres.trim()) e.nombres = MENSAJES.obligatorio;
  if (!f.apellidos.trim()) e.apellidos = MENSAJES.obligatorio;
  if (!f.telefono.trim()) e.telefono = MENSAJES.obligatorio;
  else if (normalizarTelefono(f.telefono) === null) e.telefono = MENSAJES.telefono;
  if (!f.correo.trim()) e.correo = MENSAJES.obligatorio;
  else if (!correoValido(f.correo)) e.correo = MENSAJES.correo;
  if (f.id_grado === null) e.id_grado = MENSAJES.grado;
  if (!f.acepta_politica) e.acepta_politica = MENSAJES.consentimiento;
  return e;
}

// Etiquetas del enum nivel_educativo del DBML (ADR-10: si cambian sus valores, cambia este mapa).
export const ETIQUETA_NIVEL: Readonly<Record<string, string>> = { inicial: "Inicial", primaria: "Primaria", secundaria: "Secundaria" };

// Opción del select: «Nivel · nombre del grado» con el nombre tal como está guardado (plan HU0001).
export const etiquetaGrado = (g: { nivel: string; nombre_grado: string }) => `${ETIQUETA_NIVEL[g.nivel] ?? g.nivel} · ${g.nombre_grado}`;

// Canal de origen (plan HU0001, S2 y M2): los enlaces del colegio llevan ?origen=facebook o ?origen=instagram, y se
// compara sin distinguir mayúsculas (Facebook o INSTAGRAM también cuentan). Cualquier otro valor, o ninguno, es
// formulario_web.
export type CanalOrigen = "facebook" | "instagram" | "formulario_web";

export function canalDeOrigen(origen: unknown): CanalOrigen {
  const valor = Array.isArray(origen) ? origen[0] : origen;
  const canal = typeof valor === "string" ? valor.toLowerCase() : "";
  return canal === "facebook" || canal === "instagram" ? canal : "formulario_web";
}
