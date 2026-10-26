// Token del enlace para agendar la visita guiada (HU0002-1.0, ADR-18). P02 es pública (la familia no tiene cuenta hasta
// HU0004): el enlace identifica al expediente sin mostrar su id ni permitir derivar el de otra familia.
// AES-256-GCM del id (4 bytes) con ENLACE_VISITA_KEY y una AAD propia; GCM autentica el contenido, así que un token
// alterado no identifica a nadie. Formato: v1.<base64url(iv ‖ cifrado ‖ etiqueta)>; el prefijo permite rotar la clave.
// No vence ni se revoca uno por uno: HU0003 decide qué estados lo aceptan y si vence (C31).
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { obtenerConfig } from "../config";

const VERSION = "v1";
const ALGORITMO = "aes-256-gcm";
const LARGO_IV = 12;
const LARGO_ID = 4;
const LARGO_TAG = 16;
const AAD = Buffer.from("enlace-visita", "utf8");
const ID_MAXIMO = 2147483647; // serial de Postgres

const clavePorDefecto = () => obtenerConfig().ENLACE_VISITA_KEY;

export function crearTokenVisita(idExpediente: number, claveBase64: string = clavePorDefecto()): string {
  if (!Number.isSafeInteger(idExpediente) || idExpediente <= 0 || idExpediente > ID_MAXIMO) {
    throw new Error("Id de expediente inválido para el enlace de la visita");
  }
  const id = Buffer.alloc(LARGO_ID);
  id.writeUInt32BE(idExpediente);
  const iv = randomBytes(LARGO_IV);
  const cifrador = createCipheriv(ALGORITMO, Buffer.from(claveBase64, "base64"), iv, { authTagLength: LARGO_TAG });
  cifrador.setAAD(AAD);
  const cifrado = Buffer.concat([cifrador.update(id), cifrador.final()]);
  return `${VERSION}.${Buffer.concat([iv, cifrado, cifrador.getAuthTag()]).toString("base64url")}`;
}

// El id del expediente, o null si el token tiene otro formato, está alterado o es de otra clave.
export function leerTokenVisita(token: string, claveBase64: string = clavePorDefecto()): number | null {
  const partes = token.split(".");
  if (partes.length !== 2 || partes[0] !== VERSION || !/^[A-Za-z0-9_-]+$/.test(partes[1]!)) return null;
  const bytes = Buffer.from(partes[1]!, "base64url");
  if (bytes.length !== LARGO_IV + LARGO_ID + LARGO_TAG) return null;
  try {
    const descifrador = createDecipheriv(ALGORITMO, Buffer.from(claveBase64, "base64"), bytes.subarray(0, LARGO_IV), {
      authTagLength: LARGO_TAG,
    });
    descifrador.setAAD(AAD);
    descifrador.setAuthTag(bytes.subarray(LARGO_IV + LARGO_ID));
    const id = Buffer.concat([descifrador.update(bytes.subarray(LARGO_IV, LARGO_IV + LARGO_ID)), descifrador.final()]).readUInt32BE();
    return id > 0 && id <= ID_MAXIMO ? id : null;
  } catch {
    return null; // la etiqueta no coincide: token alterado o de otra clave
  }
}
