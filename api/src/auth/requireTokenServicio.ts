// Protege las rutas /internal/*, que solo usa n8n (ADR-04): exige el token de servicio
// INTERNAL_API_TOKEN como Bearer. NGINX no publica estas rutas en producción.
import { createHash, timingSafeEqual } from "node:crypto";
import type { RequestHandler } from "express";
import { obtenerConfig } from "../config";
import { ErrorApi } from "../errores";

// Se comparan los SHA-256 para que la comparación sea de tiempo constante sin importar el largo.
const huella = (valor: string) => createHash("sha256").update(valor, "utf8").digest();

export const requireTokenServicio: RequestHandler = (req, _res, next) => {
  const cabecera = req.headers.authorization;
  if (!cabecera?.startsWith("Bearer ")) {
    throw new ErrorApi(401, "NO_AUTENTICADO", "Falta el token de servicio");
  }
  const recibido = huella(cabecera.slice("Bearer ".length));
  const esperado = huella(obtenerConfig().INTERNAL_API_TOKEN);
  if (!timingSafeEqual(recibido, esperado)) {
    throw new ErrorApi(401, "TOKEN_INVALIDO", "Token de servicio inválido");
  }
  next();
};
