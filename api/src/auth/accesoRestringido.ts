// Política de información restringida por rol (HU0021-2.0, ADR-02 [MODELO R2/R3]).
// Las rutas reales que exponen estos recursos la montan en sus HU (HU0008, HU0010, HU0011, HU0025;
// compromiso C17). Si el rol no está permitido: 403 sin ejecutar el handler (no se muestra contenido)
// y acceso_denegado en registro_auditoria con el recurso y, si la ruta lo indica, el expediente.
import type { Request, RequestHandler } from "express";
import { obtenerPool } from "../db/pool";
import { ErrorApi } from "../errores";
import { existeExpediente } from "../repositories/expediente";
import { registrarAccesoDenegado, type RolRealm } from "./requireRol";

export const RECURSOS_RESTRINGIDOS = {
  // R2: documentación financiera de los padres, solo Tesorería.
  documentacion_financiera: ["tesoreria"],
  // R3: informe psicológico, Psicología y Dirección (G10 actualizado).
  informe_psicologico: ["psicologa", "directora"],
} as const satisfies Record<string, readonly RolRealm[]>;

export type RecursoRestringido = keyof typeof RECURSOS_RESTRINGIDOS;

export interface OpcionesAccesoRestringido {
  // Devuelve el id del expediente consultado (p. ej. req.params.id). La política no supone la forma de la ruta.
  obtenerIdExpediente?: (req: Request) => unknown;
}

// Solo se registra el expediente si el valor es un id válido y existe (FK de registro_auditoria).
async function expedienteConsultado(valor: unknown): Promise<number | null> {
  const id = typeof valor === "number" ? valor : typeof valor === "string" && /^\d+$/.test(valor) ? Number(valor) : NaN;
  if (!Number.isSafeInteger(id) || id <= 0) return null;
  return (await existeExpediente(obtenerPool(), id)) ? id : null;
}

export function requireAccesoRestringido(recurso: RecursoRestringido, opciones: OpcionesAccesoRestringido = {}): RequestHandler {
  const permitidos: readonly RolRealm[] = RECURSOS_RESTRINGIDOS[recurso];
  return async (req, _res, next) => {
    const usuario = req.usuario;
    if (!usuario) {
      throw new ErrorApi(401, "NO_AUTENTICADO", "Falta el token de acceso");
    }
    if (permitidos.some((r) => usuario.roles.includes(r))) {
      next();
      return;
    }
    await registrarAccesoDenegado(req, permitidos, {
      idExpediente: await expedienteConsultado(opciones.obtenerIdExpediente?.(req)),
      detalle: { recurso },
    });
    throw new ErrorApi(403, "ACCESO_DENEGADO", "No tienes permiso para ver esta información");
  };
}
