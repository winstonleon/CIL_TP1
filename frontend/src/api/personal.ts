// Llamadas de G10 (Usuarios y roles) a /personal. Pasan por el cliente único llamarApi (rules/frontend.md).
import type { PoliticaRestringida, RolPersonal } from "../gestion/menu";
import { llamarApi } from "./cliente";

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

// Error con el formato uniforme de la API: { error: { codigo, mensaje } }.
export class ErrorApi extends Error {
  constructor(
    readonly status: number,
    readonly codigo: string,
    mensaje: string,
  ) {
    super(mensaje);
  }
}

async function respuesta<T>(res: Response): Promise<T> {
  if (res.ok) return (await res.json()) as T;
  let codigo = "ERROR";
  let mensaje = "No se pudo completar la operación. Vuelve a intentarlo.";
  try {
    const cuerpo = (await res.json()) as { error?: { codigo?: string; mensaje?: string } };
    codigo = cuerpo.error?.codigo ?? codigo;
    mensaje = cuerpo.error?.mensaje ?? mensaje;
  } catch {
    // cuerpo no JSON: se usa el mensaje genérico
  }
  throw new ErrorApi(res.status, codigo, mensaje);
}

const json = (metodo: string, cuerpo?: unknown): RequestInit => ({
  method: metodo,
  headers: cuerpo === undefined ? undefined : { "Content-Type": "application/json" },
  body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
});

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
