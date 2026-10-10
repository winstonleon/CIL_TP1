// GET /salud — ruta PÚBLICA a propósito (sin requireRol): la usan el healthcheck de Docker y el monitoreo.
// No devuelve datos de negocio.
import { Router } from "express";
import { obtenerPool } from "../db/pool";
import { verificarConexion } from "../repositories/salud";

export const rutaSalud = Router();

rutaSalud.get("/salud", async (_req, res) => {
  try {
    await verificarConexion(obtenerPool());
    res.json({ estado: "ok" });
  } catch {
    res.status(503).json({ error: { codigo: "BD_NO_DISPONIBLE", mensaje: "La base de datos no responde" } });
  }
});
