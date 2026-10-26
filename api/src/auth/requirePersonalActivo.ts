// Las rutas del personal exigen, además del rol del token, una fila ACTIVA en personal con ese mismo rol (C22, ADR-02).
// Cierra la ventana de hasta 5 min en que un token ya emitido seguía valiendo tras desactivar la cuenta o cambiarle el
// rol, y el riesgo de un usuario de Keycloak sin fila. Va después de verificarToken y requireRol, con los mismos roles.
// verificarToken no cambia: la exigencia es de las rutas del personal, no de la validación del token.
import type { RequestHandler } from "express";
import { obtenerPool } from "../db/pool";
import { ErrorApi } from "../errores";
import { buscarPersonalPorKeycloak } from "../repositories/personal";
import { registrarAccesoDenegado, type RolRealm } from "./requireRol";

export function requirePersonalActivo(...roles: [RolRealm, ...RolRealm[]]): RequestHandler {
  return async (req, _res, next) => {
    const usuario = req.usuario;
    if (!usuario) {
      throw new ErrorApi(401, "NO_AUTENTICADO", "Falta el token de acceso");
    }
    const cuenta = await buscarPersonalPorKeycloak(obtenerPool(), usuario.sub);
    const rolVigente = cuenta !== null && (roles as string[]).includes(cuenta.rol) && usuario.roles.includes(cuenta.rol);
    if (cuenta?.activo && rolVigente) {
      next();
      return;
    }
    const motivo = cuenta === null ? "sin_fila" : !cuenta.activo ? "personal_inactivo" : "rol_distinto";
    // Mismo 403 que requireRol: la respuesta no dice si la cuenta existe o está desactivada.
    await registrarAccesoDenegado(req, roles, { detalle: { motivo } });
    throw new ErrorApi(403, "ACCESO_DENEGADO", "No tienes permiso para esta acción");
  };
}
