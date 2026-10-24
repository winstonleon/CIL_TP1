// Eventos de la API hacia n8n (ADR-16, HU0001): POST al webhook interno del flujo con X-Webhook-Secret (ADR-04).
// Es la única puerta de la API hacia n8n, como identidad/keycloakAdmin lo es hacia Keycloak.
// - El cuerpo lleva solo identificadores: n8n pide los datos por /internal/*, así sus ejecuciones guardan menos datos
//   personales (C10, C11).
// - Se llama después del COMMIT y de responder al cliente, y nunca rechaza: un fallo de n8n no detiene el trámite.
// - Un 4xx no se reintenta (es definitivo). Ante red, timeout o 5xx, hasta 3 intentos. No hay outbox: un evento no
//   entregado se deduce de los datos y su recuperación la decide el plan del flujo receptor (captacion: C27).
// - El log lleva solo los identificadores, el número de intentos y la causa: nunca el secreto, el cuerpo ni la URL.
import { obtenerConfig } from "../config";

// Flujos que la API dispara (ADR-06). La lista crece con cada HU que agregue un evento.
export type FlujoN8n = "captacion";

// Solo identificadores numéricos, p. ej. { id_expediente: 123 }: el tipo impide enviar datos personales.
export type CuerpoEvento = Readonly<Record<string, number>>;

export interface DisparadorN8n {
  disparar(flujo: FlujoN8n, cuerpo: CuerpoEvento): Promise<void>;
}

export interface OpcionesDisparador {
  urlBase: string; // N8N_WEBHOOK_INTERNAL_URL, p. ej. http://n8n:5678/webhook
  secreto: string; // N8N_WEBHOOK_SECRET
  timeoutMs?: number; // por intento
  esperasMs?: readonly number[]; // entre intentos: [1000, 3000] son 3 intentos
}

const esperar = (ms: number) => new Promise<void>((resolver) => setTimeout(resolver, ms));

// Causa de un fallo de red sin el mensaje del error, que podría incluir la URL o datos de la petición.
function causaDe(e: unknown): string {
  const error = e as { name?: unknown; cause?: { code?: unknown } } | null;
  if (error?.name === "TimeoutError") return "sin respuesta a tiempo";
  if (typeof error?.cause?.code === "string") return error.cause.code;
  return typeof error?.name === "string" ? error.name : "error de red";
}

export function crearDisparadorN8n({ urlBase, secreto, timeoutMs = 5000, esperasMs = [1000, 3000] }: OpcionesDisparador): DisparadorN8n {
  const base = urlBase.replace(/\/+$/, "");
  return {
    async disparar(flujo, cuerpo) {
      let intentos = 0;
      let causa = "";
      for (;;) {
        intentos += 1;
        let reintentable: boolean;
        try {
          const respuesta = await fetch(`${base}/${flujo}`, {
            method: "POST",
            headers: { "Content-Type": "application/json", "X-Webhook-Secret": secreto },
            body: JSON.stringify(cuerpo),
            signal: AbortSignal.timeout(timeoutMs),
          });
          await respuesta.body?.cancel().catch(() => undefined);
          if (respuesta.ok) return;
          causa = `HTTP ${respuesta.status}`;
          reintentable = respuesta.status >= 500;
        } catch (e) {
          causa = causaDe(e);
          reintentable = true;
        }
        if (!reintentable || intentos > esperasMs.length) break;
        await esperar(esperasMs[intentos - 1]!);
      }
      const ids = Object.entries(cuerpo).map(([campo, valor]) => `${campo}=${valor}`).join(", ");
      console.warn(`Evento ${flujo} no entregado a n8n (${ids}, ${intentos} ${intentos === 1 ? "intento" : "intentos"}, ${causa})`);
    },
  };
}

export function crearDisparadorN8nDesdeConfig(): DisparadorN8n {
  const c = obtenerConfig();
  return crearDisparadorN8n({ urlBase: c.N8N_WEBHOOK_INTERNAL_URL, secreto: c.N8N_WEBHOOK_SECRET });
}
