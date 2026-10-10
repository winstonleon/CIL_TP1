// Configuración de la API desde variables de entorno (ADR-08: nada fijo para el entorno local).
// Si falta o es inválida una variable, el error nombra la variable, nunca su valor.
import { z } from "zod";

const clave32 = z
  .string()
  .refine((v) => Buffer.from(v, "base64").length === 32, { message: "debe ser de 32 bytes en base64" });

const esquema = z.object({
  API_PORT: z.coerce.number().int().positive().default(3000),
  POSTGRES_HOST: z.string().min(1),
  POSTGRES_PORT: z.coerce.number().int().positive(),
  ADMISION_DB: z.string().min(1),
  ADMISION_DB_USER: z.string().min(1),
  ADMISION_DB_PASSWORD: z.string().min(1),
  KEYCLOAK_PUBLIC_URL: z.url(),
  KEYCLOAK_INTERNAL_URL: z.url(),
  KEYCLOAK_REALM: z.string().min(1),
  KEYCLOAK_API_CLIENT_ID: z.string().min(1),
  DATA_ENCRYPTION_KEY: clave32,
  DATA_HMAC_KEY: clave32,
});

export type Config = z.infer<typeof esquema>;

let cache: Config | undefined;

export function obtenerConfig(): Config {
  if (!cache) {
    const r = esquema.safeParse(process.env);
    if (!r.success) {
      const variables = [...new Set(r.error.issues.map((i) => i.path.join(".")))].join(", ");
      throw new Error(`Configuración inválida o incompleta: ${variables}`);
    }
    cache = r.data;
  }
  return cache;
}
