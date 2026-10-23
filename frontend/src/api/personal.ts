// Llamadas de G10 (Usuarios y roles) a /personal. Pasan por el cliente único llamarApi (rules/frontend.md).
import type { PoliticaRestringida, RolPersonal } from "../gestion/menu";
import { llamarApi } from "./cliente";
import { json, respuesta } from "./respuesta";

export interface CuentaPersonal {
  id_personal: number;
  nombres: string;
  apellidos: string;
  correo: string;
  rol: RolPersonal;
  activo: boolean;
}

export interface DatosCuenta {
  nombres: string;
  apellidos: string;
  correo: string;
  rol: RolPersonal;
}

export type CambiosCuenta = Partial<Pick<DatosCuenta, "nombres" | "apellidos" | "rol">>;

// Respuesta de la reactivación (HU0021-5.0): enlace_enviado indica si Keycloak reenvió el enlace para definir la
// contraseña (la cuenta nunca había definido una).
export interface CuentaReactivada extends CuentaPersonal {
  enlace_enviado: boolean;
}

// Error con el formato uniforme de la API (api/respuesta.ts). Se reexporta para G10.
export { ErrorApi } from "./respuesta";

export async function listarCuentas(): Promise<CuentaPersonal[]> {
  return respuesta(await llamarApi("gestion", "/personal"));
}

export async function obtenerPolitica(): Promise<PoliticaRestringida> {
  return respuesta(await llamarApi("gestion", "/personal/permisos"));
}

export async function crearCuenta(datos: DatosCuenta): Promise<CuentaPersonal> {
  return respuesta(await llamarApi("gestion", "/personal", json("POST", datos)));
}

export async function modificarCuenta(id: number, cambios: CambiosCuenta): Promise<CuentaPersonal> {
  return respuesta(await llamarApi("gestion", `/personal/${id}`, json("PATCH", cambios)));
}

export async function desactivarCuenta(id: number): Promise<CuentaPersonal> {
  return respuesta(await llamarApi("gestion", `/personal/${id}/desactivacion`, json("POST")));
}

export async function reactivarCuenta(id: number): Promise<CuentaReactivada> {
  return respuesta(await llamarApi("gestion", `/personal/${id}/reactivacion`, json("POST")));
}
