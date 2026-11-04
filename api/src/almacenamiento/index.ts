// Punto único para obtener el almacenamiento configurado (ADR-12 D1, ADR-21). Los archivos siempre se cifran (ADR-03).
import { obtenerConfig } from "../config";
import { cifrar } from "./cifrado";
import { crearAlmacenamientoLocal } from "./local";
import type { Almacenamiento } from "./tipos";

export type { Almacenamiento } from "./tipos";
export { ErrorAlmacenamiento } from "./tipos";

export function crearAlmacenamientoDesdeConfig(): Almacenamiento {
  const c = obtenerConfig();
  // Un adaptador nuevo (gdrive) se suma al enum STORAGE_DRIVER de config.ts y a este switch; lo cifra el mismo decorador.
  const interno = c.STORAGE_DRIVER === "local" ? crearAlmacenamientoLocal(c.STORAGE_LOCAL_DIR) : undefined;
  if (!interno) throw new Error("STORAGE_DRIVER no tiene adaptador");
  return cifrar(interno, {
    vigente: Buffer.from(c.ARCHIVOS_ENCRYPTION_KEY, "base64"),
    anterior: c.ARCHIVOS_ENCRYPTION_KEY_ANTERIOR ? Buffer.from(c.ARCHIVOS_ENCRYPTION_KEY_ANTERIOR, "base64") : undefined,
  });
}
