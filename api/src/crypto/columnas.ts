// Cifrado de columnas sensibles (ADR-03): AES-256-GCM con IV aleatorio de 12 bytes.
// Formato almacenado: v1:iv:authTag:ciphertext (cada parte en base64), para poder rotar la clave.
// La unicidad del DNI se controla con dni_hash = HMAC-SHA256(DNI normalizado, DATA_HMAC_KEY).
// Solo los repositorios usan este módulo (rules/api.md).
import { createCipheriv, createDecipheriv, createHmac, randomBytes } from "node:crypto";
import { obtenerConfig } from "../config";

const VERSION = "v1";
const ALGORITMO = "aes-256-gcm";
const LARGO_IV = 12;
const LARGO_TAG = 16;

function claveCifrado(): Buffer {
  return Buffer.from(obtenerConfig().DATA_ENCRYPTION_KEY, "base64");
}

function claveHmac(): Buffer {
  return Buffer.from(obtenerConfig().DATA_HMAC_KEY, "base64");
}

export function cifrar(texto: string): string {
  const iv = randomBytes(LARGO_IV);
  const cifrador = createCipheriv(ALGORITMO, claveCifrado(), iv, { authTagLength: LARGO_TAG });
  const cifrado = Buffer.concat([cifrador.update(texto, "utf8"), cifrador.final()]);
  return [VERSION, iv.toString("base64"), cifrador.getAuthTag().toString("base64"), cifrado.toString("base64")].join(":");
}

export function descifrar(valor: string): string {
  const partes = valor.split(":");
  if (partes.length !== 4 || partes[0] !== VERSION) {
    throw new Error("Formato de columna cifrada no reconocido");
  }
  const [, iv, tag, cifrado] = partes as [string, string, string, string];
  const descifrador = createDecipheriv(ALGORITMO, claveCifrado(), Buffer.from(iv, "base64"), { authTagLength: LARGO_TAG });
  descifrador.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([descifrador.update(Buffer.from(cifrado, "base64")), descifrador.final()]).toString("utf8");
}

// DNI o CE normalizado: sin espacios ni guiones y en mayúsculas. Se conserva como texto
// (nunca se convierte a número) para no perder los ceros iniciales.
export function normalizarDni(dni: string): string {
  const normalizado = dni.trim().toUpperCase().replace(/[\s-]/g, "");
  if (!normalizado) throw new Error("El DNI está vacío");
  return normalizado;
}

export function hashDni(dni: string): string {
  return createHmac("sha256", claveHmac()).update(normalizarDni(dni), "utf8").digest("hex");
}

// Valores listos para las columnas dni_cifrado y dni_hash.
export function columnasDni(dni: string): { dni_cifrado: string; dni_hash: string } {
  return { dni_cifrado: cifrar(normalizarDni(dni)), dni_hash: hashDni(dni) };
}
