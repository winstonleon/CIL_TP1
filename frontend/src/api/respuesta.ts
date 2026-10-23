// Respuestas de la API con su formato uniforme de error: { error: { codigo, mensaje, detalle? } } (rules/api.md).

// detalle: datos estructurados opcionales del error, p. ej. el mínimo de vacantes por grado (plan HU0022, P11).
export class ErrorApi extends Error {
  constructor(
    readonly status: number,
    readonly codigo: string,
    mensaje: string,
    readonly detalle?: unknown,
  ) {
    super(mensaje);
  }
}

export async function respuesta<T>(res: Response): Promise<T> {
  if (res.ok) return (res.status === 204 ? undefined : await res.json()) as T;
  let codigo = "ERROR";
  let mensaje = "No se pudo completar la operación. Vuelve a intentarlo.";
  let detalle: unknown;
  try {
    const cuerpo = (await res.json()) as { error?: { codigo?: string; mensaje?: string; detalle?: unknown } };
    codigo = cuerpo.error?.codigo ?? codigo;
    mensaje = cuerpo.error?.mensaje ?? mensaje;
    detalle = cuerpo.error?.detalle;
  } catch {
    // cuerpo no JSON: se usa el mensaje genérico
  }
  throw new ErrorApi(res.status, codigo, mensaje, detalle);
}

export const json = (metodo: string, cuerpo?: unknown): RequestInit => ({
  method: metodo,
  headers: cuerpo === undefined ? undefined : { "Content-Type": "application/json" },
  body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
});

export function mensajeDe(e: unknown): string {
  return e instanceof ErrorApi ? e.message : "No se pudo conectar con el servidor. Vuelve a intentarlo.";
}
