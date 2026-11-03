// La familia solo ve y modifica su propio expediente (modelo de datos §4.6, HU0005). Va después de requireRol("familia"),
// en las rutas con `:id` de expediente. Un expediente ajeno responde 404, con el mismo cuerpo que uno inexistente, porque
// un 403 confirmaría que el id existe y los ids son secuenciales. Si existe y es ajeno, se audita `acceso_denegado`.
import type { RequestHandler } from "express";
import { obtenerPool } from "../db/pool";
import { ErrorApi } from "../errores";
import { existeExpediente, leerExpedienteDeFamilia, type ExpedienteDeFamilia } from "../repositories/expediente";
import { UUID } from "../uuid";
import { registrarAccesoDenegado } from "./requireRol";

declare module "express-serve-static-core" {
  interface Request {
    expedienteFamilia?: ExpedienteDeFamilia;
  }
}

const noEncontrado = () => new ErrorApi(404, "EXPEDIENTE_NO_ENCONTRADO", "El expediente no existe");

export const requireExpedienteDeFamilia: RequestHandler = async (req, _res, next) => {
  const usuario = req.usuario;
  if (!usuario) {
    throw new ErrorApi(401, "NO_AUTENTICADO", "Falta el token de acceso");
  }
  const texto = String(req.params.id);
  const id = /^\d{1,10}$/.test(texto) ? Number(texto) : NaN;
  if (!Number.isSafeInteger(id) || id <= 0 || id > 2147483647) throw noEncontrado();

  const pool = obtenerPool();
  const propio = UUID.test(usuario.sub) ? await leerExpedienteDeFamilia(pool, usuario.sub, id) : null;
  if (!propio) {
    if (await existeExpediente(pool, id)) {
      await registrarAccesoDenegado(req, ["familia"], { idExpediente: id, detalle: { motivo: "expediente_ajeno" } });
    }
    throw noEncontrado();
  }
  req.expedienteFamilia = propio;
  next();
};
