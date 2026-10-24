// Errores uniformes de la API: { "error": { "codigo": "...", "mensaje": "..." } } (rules/api.md).
import type { ErrorRequestHandler, RequestHandler } from "express";

export class ErrorApi extends Error {
  constructor(
    readonly status: number,
    readonly codigo: string,
    mensaje: string,
    // Datos estructurados opcionales (plan HU0022, P11), p. ej. el mínimo de vacantes por grado. Sin datos personales.
    readonly detalle?: unknown,
  ) {
    super(mensaje);
  }
}

export const noEncontrado: RequestHandler = () => {
  throw new ErrorApi(404, "NO_ENCONTRADO", "Recurso no encontrado");
};

// Errores del parser JSON de Express (body-parser), según su `type`. Antes de HU0001 caían en el 500 genérico.
const ERRORES_DEL_CUERPO = new Map<unknown, ErrorApi>([
  ["entity.too.large", new ErrorApi(413, "CUERPO_DEMASIADO_GRANDE", "El cuerpo de la petición es demasiado grande")],
  ["entity.parse.failed", new ErrorApi(400, "JSON_INVALIDO", "El cuerpo de la petición no es un JSON válido")],
]);

export const manejadorErrores: ErrorRequestHandler = (err, _req, res, _next) => {
  err = ERRORES_DEL_CUERPO.get((err as { type?: unknown } | null)?.type) ?? err;
  if (err instanceof ErrorApi) {
    const detalle = err.detalle === undefined ? {} : { detalle: err.detalle };
    res.status(err.status).json({ error: { codigo: err.codigo, mensaje: err.message, ...detalle } });
    return;
  }
  // Solo el tipo de error: los mensajes de pg o de librerías pueden incluir datos de la petición.
  console.error(`Error no controlado: ${err?.name ?? "desconocido"}`);
  res.status(500).json({ error: { codigo: "ERROR_INTERNO", mensaje: "Error interno del servidor" } });
};
