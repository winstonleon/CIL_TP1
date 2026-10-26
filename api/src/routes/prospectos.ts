// /prospectos — prospectos para Secretaría (pantalla G04, HU0002-2.0). El router se monta en app.ts detrás de
// verificarToken, requireRol("secretaria") y requirePersonalActivo (C22). G04 no registra atencion_inicio: solo lista
// prospectos y no abre ningún ítem (§4.7).
import { Router } from "express";
import { prospectosContactoNoEntregado } from "../services/prospectos";

export function rutasProspectos(campana: string): Router {
  const rutas = Router();
  // GET /prospectos/contacto-no-entregado → { prospectos: [{ id_expediente, nombres, apellidos, grado: { nivel,
  // nombre_grado }, correo, telefono, fecha_rebote }] }
  rutas.get("/contacto-no-entregado", async (_req, res) => {
    res.json(await prospectosContactoNoEntregado(campana));
  });
  return rutas;
}
