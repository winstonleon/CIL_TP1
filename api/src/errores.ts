// Errores uniformes de la API: { "error": { "codigo": "...", "mensaje": "..." } } (rules/api.md).
import type { ErrorRequestHandler, RequestHandler } from "express";

export class ErrorApi extends Error {
  constructor(
    readonly status: number,
    readonly codigo: string,
    mensaje: string,
  ) {
    super(mensaje);
  }
}

export const noEncontrado: RequestHandler = () => {
  throw new ErrorApi(404, "NO_ENCONTRADO", "Recurso no encontrado");
};

export const manejadorErrores: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof ErrorApi) {
    res.status(err.status).json({ error: { codigo: err.codigo, mensaje: err.message } });
    return;
  }
  // Solo el tipo de error: los mensajes de pg o de librerías pueden incluir datos de la petición.
  console.error(`Error no controlado: ${err?.name ?? "desconocido"}`);
  res.status(500).json({ error: { codigo: "ERROR_INTERNO", mensaje: "Error interno del servidor" } });
};
