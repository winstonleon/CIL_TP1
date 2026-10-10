import { crearApp } from "./app";
import { obtenerConfig } from "./config";
import { cerrarPool } from "./db/pool";

const { API_PORT } = obtenerConfig();
const servidor = crearApp().listen(API_PORT, () => {
  console.log(`API de admisión escuchando en el puerto ${API_PORT}`);
});

process.on("SIGTERM", () => {
  servidor.close(() => void cerrarPool());
});
