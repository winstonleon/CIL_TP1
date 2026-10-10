import vue from "@vitejs/plugin-vue";
import { defineConfig } from "vitest/config";

// En el contenedor de dev (Windows + Docker Desktop) los eventos de cambio no llegan: se sondea.
const sondeo = process.env.CHOKIDAR_USEPOLLING === "true";

export default defineConfig({
  plugins: [vue()],
  // En el host, las VITE_* salen del .env de la raíz (Vite solo expone al navegador las VITE_*).
  // En el contenedor llegan como variables de entorno desde docker-compose.dev.yml.
  envDir: "..",
  server: {
    port: 5173,
    strictPort: true,
    watch: sondeo ? { usePolling: true, interval: 1000 } : undefined,
  },
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.ts"],
  },
});
