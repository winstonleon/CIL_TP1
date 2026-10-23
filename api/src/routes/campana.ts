// /campana-activa — la campaña que muestran todas las pantallas G (C23). La lee cualquier rol del personal:
// el router se monta en app.ts detrás de verificarToken y requireRol con los 5 roles.
import { Router } from "express";

export function rutaCampanaActiva(campana: string): Router {
  const rutas = Router();
  // GET /campana-activa → { campana: "2027" }
  rutas.get("/", (_req, res) => {
    res.json({ campana });
  });
  return rutas;
}
