import vue from "@vitejs/plugin-vue";
import type { IncomingMessage } from "node:http";
import { defineConfig } from "vitest/config";

// En el contenedor de dev (Windows + Docker Desktop) los eventos de cambio no llegan: se sondea.
const sondeo = process.env.CHOKIDAR_USEPOLLING === "true";

// Proxy de dev hacia la API por la red interna (en prod lo hace NGINX, compromiso C19). VITE_API_URL=/api.
const api = process.env.API_INTERNAL_URL;

// /internal/* es solo para n8n (ADR-04): el proxy no lo publica. Se normaliza la ruta (puntos, barras
// repetidas y codificación) antes de comparar.
function esRutaInterna(req: IncomingMessage): boolean {
  try {
    const ruta = decodeURIComponent(new URL(req.url ?? "/", "http://local").pathname).replace(/\/{2,}/g, "/");
    return /^\/api\/internal(\/|$)/i.test(ruta);
  } catch {
    return true; // ruta mal codificada: no se reenvía
  }
}

export default defineConfig({
  plugins: [vue()],
  // En el host, las VITE_* salen del .env de la raíz (Vite solo expone al navegador las VITE_*).
  // En el contenedor llegan como variables de entorno desde docker-compose.dev.yml.
  envDir: "..",
  server: {
    port: 5173,
    strictPort: true,
    watch: sondeo ? { usePolling: true, interval: 1000 } : undefined,
    proxy: api
      ? {
          "/api": {
            target: api,
            changeOrigin: true,
            rewrite: (ruta) => ruta.replace(/^\/api/, ""),
            // false → Vite responde 404 sin reenviar.
            bypass: (req) => (esRutaInterna(req) ? false : undefined),
          },
        }
      : undefined,
  },
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.ts"],
  },
});
