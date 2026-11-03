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
  // Secreto del cliente confidencial api-admision: su service account crea y gestiona usuarios (HU0021).
  KEYCLOAK_API_CLIENT_SECRET: z.string().min(1),
  // Destino del enlace para definir la contraseña del personal (execute actions email).
  FRONTEND_PUBLIC_URL: z.url(),
  DATA_ENCRYPTION_KEY: clave32,
  DATA_HMAC_KEY: clave32,
  // Token de servicio con que n8n llama a /internal/* (ADR-04).
  INTERNAL_API_TOKEN: z.string().min(32),
  // Campaña activa (HU0022, C23): G09 solo configura los grados y horarios de esta campaña (grado.campana_admision).
  CAMPANA_ACTIVA: z.string().regex(/^[0-9A-Za-z-]{1,10}$/),
  // Eventos de la API hacia n8n (ADR-16, HU0001): webhooks internos con el mismo secreto que la credencial
  // cil-webhook-secret de n8n (al rotarlo hay que recrear api, C11).
  N8N_WEBHOOK_INTERNAL_URL: z.url(),
  N8N_WEBHOOK_SECRET: z.string().min(32),
  // Enlace para agendar la visita guiada (HU0002, ADR-18): cifra el id del expediente en el enlace de P02.
  ENLACE_VISITA_KEY: clave32,
  // URL pública de la carpeta informativa (ADR-18). Vacía hasta que el colegio la entregue (C33).
  CARPETA_INFORMATIVA_URL: z.preprocess((v) => (v === "" ? undefined : v), z.url().optional()),
  // Visita guiada (HU0003, ADR-19): horas de anticipación del recordatorio (D4, provisional hasta C37).
  RECORDATORIO_VISITA_HORAS: z.coerce.number().int().min(1).max(168),
  // Dirección del colegio para «Lugar» de P02 y de los correos de la visita (ADR-19). Vacía hasta que el colegio la
  // entregue (C39): se muestra «[Dirección del colegio]».
  DIRECCION_COLEGIO: z.preprocess((v) => (v === "" ? undefined : v), z.string().trim().min(1).max(200).optional()),
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
