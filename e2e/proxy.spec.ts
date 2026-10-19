// C19 (dev): el proxy /api de Vite (frontend/vite.config.ts) reenvía a la API y NO publica /internal/*, que es
// solo para n8n (ADR-04). Prueba de soporte, sin ID de escenario. Las peticiones salen con node:http y la ruta
// tal cual: el cliente de Playwright normaliza «/./» antes de enviar y esa variante no se probaría.
// Para demostrar que un 404 vacío «no llegó a la API», cada ruta se pide también directo a la API: la API siempre
// responde con un error en JSON (401 si la ruta llega a su router interno, 404 si no), nunca con un cuerpo vacío.
// Las variantes de mayúsculas dan 401 porque Express no distingue mayúsculas: por eso el bloqueo debe ignorarlas.
import { request as solicitar } from "node:http";
import { expect, test } from "@playwright/test";

const FRONTEND = new URL(process.env.FRONTEND_PUBLIC_URL!);
const API_PORT = Number(process.env.API_PORT || 3000);

interface Respuesta {
  status: number;
  cuerpo: string;
}

// GET con la ruta exacta, sin normalizar.
function pedir(puerto: number, ruta: string): Promise<Respuesta> {
  return new Promise((ok, falla) => {
    const req = solicitar({ host: "127.0.0.1", port: puerto, path: ruta, method: "GET" }, (res) => {
      let cuerpo = "";
      res.setEncoding("utf8");
      res.on("data", (c) => (cuerpo += c));
      res.on("end", () => ok({ status: res.statusCode ?? 0, cuerpo }));
    });
    req.on("error", falla);
    req.end();
  });
}

const alProxy = (ruta: string) => pedir(Number(FRONTEND.port || 80), ruta);
const aLaApi = (ruta: string) => pedir(API_PORT, ruta);

// Variante → lo que responde la API si se le pide directo (control).
const VARIANTES_INTERNAS: Array<[string, number, string]> = [
  ["/internal/expedientes/1/contacto", 401, "NO_AUTENTICADO"],
  ["//internal/expedientes/1/contacto", 404, "NO_ENCONTRADO"],
  ["/./internal/expedientes/1/contacto", 404, "NO_ENCONTRADO"],
  ["/%69nternal/expedientes/1/contacto", 404, "NO_ENCONTRADO"],
  ["/Internal/expedientes/1/contacto", 401, "NO_AUTENTICADO"],
  ["/INTERNAL/expedientes/1/contacto", 401, "NO_AUTENTICADO"],
  ["/iNtErNaL/expedientes/1/contacto", 401, "NO_AUTENTICADO"],
];

test.describe("C19 (dev) proxy /api de Vite", () => {
  test("C19 (dev) /api/salud llega a la API: 200", async () => {
    const r = await alProxy("/api/salud");
    expect(r.status).toBe(200);
    expect(JSON.parse(r.cuerpo)).toEqual({ estado: "ok" });
  });

  test("C19 (dev) /api/personal sin token llega a la API: 401 NO_AUTENTICADO", async () => {
    const r = await alProxy("/api/personal");
    expect(r.status).toBe(401);
    expect(JSON.parse(r.cuerpo).error.codigo).toBe("NO_AUTENTICADO");
  });

  for (const [variante, statusApi, codigoApi] of VARIANTES_INTERNAS) {
    test(`C19 (dev) /api${variante} responde 404 vacío sin llegar a la API`, async () => {
      // Control: la API, pedida directo, responde siempre con un error en JSON.
      const directo = await aLaApi(variante);
      expect(directo.status).toBe(statusApi);
      expect(JSON.parse(directo.cuerpo).error.codigo).toBe(codigoApi);

      const porProxy = await alProxy(`/api${variante}`);
      expect(porProxy.status).toBe(404);
      expect(porProxy.cuerpo).toBe("");
    });
  }
});
