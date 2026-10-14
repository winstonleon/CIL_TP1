// Autorización por rol de realm (ADR-02). Cada ruta declara el rol requerido.
// Todo acceso denegado se registra en auditoría como acceso_denegado (HU0021-2.0, CLAUDE.md).
import type { Request, RequestHandler } from "express";
import { obtenerPool } from "../db/pool";
import { ErrorApi } from "../errores";
import { insertarEvento } from "../repositories/auditoria";
import { buscarIdPersonalPorKeycloak } from "../repositories/personal";

export type RolRealm = "familia" | "secretaria" | "tesoreria" | "psicologa" | "evaluador_academico" | "directora";

export interface DatosAccesoDenegado {
  idExpediente?: number | null;
  detalle?: Record<string, unknown>;
}

// Registra el intento bloqueado del usuario del token. La usan requireRol y requireAccesoRestringido.
export async function registrarAccesoDenegado(
  req: Request,
  rolesRequeridos: readonly RolRealm[],
  datos: DatosAccesoDenegado = {},
): Promise<void> {
  const usuario = req.usuario!;
  const pool = obtenerPool();
  const idPersonal = await buscarIdPersonalPorKeycloak(pool, usuario.sub);
  await insertarEvento(pool, {
    tipoEvento: "acceso_denegado",
    idPersonal,
    idExpediente: datos.idExpediente ?? null,
    detalle: {
      metodo: req.method,
      ruta: `${req.baseUrl}${req.path}`,
      roles_requeridos: rolesRequeridos,
      ...datos.detalle,
      // Si el actor no es Personal (p. ej. familia), se guarda su id de Keycloak para trazarlo.
      ...(idPersonal === null ? { keycloak_user_id: usuario.sub } : {}),
    },
  });
}

export function requireRol(...roles: [RolRealm, ...RolRealm[]]): RequestHandler {
  return async (req, _res, next) => {
    const usuario = req.usuario;
    if (!usuario) {
      throw new ErrorApi(401, "NO_AUTENTICADO", "Falta el token de acceso");
    }
    if (roles.some((r) => usuario.roles.includes(r))) {
      next();
      return;
    }
    await registrarAccesoDenegado(req, roles);
    throw new ErrorApi(403, "ACCESO_DENEGADO", "No tienes permiso para esta acción");
  };
}
