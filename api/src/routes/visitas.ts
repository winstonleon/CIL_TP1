// /visitas — visitas guiadas para Secretaría (pantalla G04, HU0004). El router se monta en app.ts detrás de
// verificarToken, requireRol("secretaria") y requirePersonalActivo (C22). G04 no registra atencion_inicio (§4.7).
import { Router } from "express";
import { z } from "zod";
import type { IdentidadAdmin } from "../identidad/keycloakAdmin";
import type { DisparadorN8n } from "../orquestacion/n8n";
// C73: la misma validación de fecha que G08 y P07b; una fecha imposible («2026-13-01») responde 400, no 500.
import { fechaValida } from "../services/derechoAdmision";
import { registrarAsistencia, RESULTADOS_ASISTENCIA, visitasDeLaSemana } from "../services/visitas";
import { validar } from "../validacion";

const consultaSemana = z.object({ fecha: z.string().refine(fechaValida).optional() }).strict();
const idCita = z.coerce.number().int().positive().max(2147483647);
const cuerpoAsistencia = z.object({ resultado: z.enum(RESULTADOS_ASISTENCIA) }).strict();

export function rutasVisitas(campana: string, identidad: IdentidadAdmin, eventos: DisparadorN8n): Router {
  const rutas = Router();

  // GET /visitas?fecha=AAAA-MM-DD → { desde, hasta, visitas: [...], sin_registrar: [...] }. Sin `fecha`, la semana de
  // hoy; el parámetro sirve a las pruebas y a los enlaces directos (S14).
  rutas.get("/", async (req, res) => {
    const { fecha } = validar(consultaSemana, req.query);
    res.json(await visitasDeLaSemana(campana, fecha));
  });

  // POST /visitas/:idCita/asistencia { resultado: "asistio_interesado" | "no_asistio" } → 200 { id_cita, estado_cita,
  // estado_expediente } (HU0004-1.0 y 2.0) · 409 VISITA_YA_REGISTRADA, ESTADO_DESACTUALIZADO o CORREO_CON_CUENTA (C28)
  // · 404 · 502 IDENTIDAD_NO_DISPONIBLE
  rutas.post("/:idCita/asistencia", async (req, res) => {
    const id = validar(idCita, req.params.idCita);
    const { resultado } = validar(cuerpoAsistencia, req.body);
    res.json(await registrarAsistencia(identidad, req.usuario!.sub, id, resultado));
    // ADR-16: después del COMMIT y de responder; agendamiento envía las credenciales o la invitación a reprogramar.
    void eventos.disparar("agendamiento", { id_cita: id });
  });

  return rutas;
}
