// Valida el Bearer token de Keycloak (ADR-02): firma contra el JWKS del realm, emisor,
// audiencia y expiración. Los roles salen de realm_access.roles. No se usa keycloak-connect.
import type { RequestHandler } from "express";
import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose";
import { obtenerConfig } from "../config";
import { ErrorApi } from "../errores";

export interface UsuarioToken {
  sub: string;
  roles: string[];
}

declare module "express-serve-static-core" {
  interface Request {
    usuario?: UsuarioToken;
  }
}

export interface OpcionesToken {
  jwks: JWTVerifyGetKey;
  emisor: string;
  audiencia: string;
}

// El JWKS se pide por la red interna; el emisor es la URL pública (KC_HOSTNAME).
export function opcionesTokenDesdeConfig(): OpcionesToken {
  const c = obtenerConfig();
  const base = (url: string) => url.replace(/\/$/, "");
  return {
    jwks: createRemoteJWKSet(new URL(`${base(c.KEYCLOAK_INTERNAL_URL)}/realms/${c.KEYCLOAK_REALM}/protocol/openid-connect/certs`)),
    emisor: `${base(c.KEYCLOAK_PUBLIC_URL)}/realms/${c.KEYCLOAK_REALM}`,
    audiencia: c.KEYCLOAK_API_CLIENT_ID,
  };
}

export function crearVerificarToken(opciones: OpcionesToken): RequestHandler {
  return async (req, _res, next) => {
    const cabecera = req.headers.authorization;
    if (!cabecera?.startsWith("Bearer ")) {
      throw new ErrorApi(401, "NO_AUTENTICADO", "Falta el token de acceso");
    }
    let usuario: UsuarioToken;
    try {
      const { payload } = await jwtVerify(cabecera.slice("Bearer ".length), opciones.jwks, {
        issuer: opciones.emisor,
        audience: opciones.audiencia,
        algorithms: ["RS256"],
      });
      if (!payload.sub) throw new Error("token sin sub");
      const roles = (payload.realm_access as { roles?: unknown } | undefined)?.roles;
      usuario = {
        sub: payload.sub,
        roles: Array.isArray(roles) ? roles.filter((r): r is string => typeof r === "string") : [],
      };
    } catch {
      throw new ErrorApi(401, "TOKEN_INVALIDO", "Token de acceso inválido o expirado");
    }
    req.usuario = usuario;
    next();
  };
}
