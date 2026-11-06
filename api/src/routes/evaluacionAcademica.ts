// /evaluacion-academica — registro de la evaluación académica (G11, HU0025). El router se monta en app.ts detrás de
// verificarToken, requireRol("evaluador_academico") y requirePersonalActivo (C22). Ninguna respuesta lleva el informe
// psicológico ni la documentación financiera (R2, R3; HU0025-1.0): solo la cita del evaluador y su propio resultado.
import { Router } from "express";
import type { DisparadorN8n } from "../orquestacion/n8n";
import { agenda, detalleCita, esquemaResultado, registrarInasistencia, registrarResultado } from "../services/dictamen";
import { validar } from "../validacion";
import { esquemaAgenda } from "./psicologia";
import { esquemaVacio, idPersonalDe, idRuta } from "./validacion";

export function rutasEvaluacionAcademica(eventos: DisparadorN8n): Router {
  const rutas = Router();

  // GET /evaluacion-academica/agenda?fecha=YYYY-MM-DD → 200 { fecha, citas } (solo las del evaluador de la sesión)
  rutas.get("/agenda", async (req, res) => {
    res.json(await agenda("evaluador_academico", await idPersonalDe(req), validar(esquemaAgenda, req.query).fecha));
  });

  // GET /evaluacion-academica/citas/:id → 200 la cita con su resultado y registra atencion_inicio si espera el resultado
  // · 404
  rutas.get("/citas/:id", async (req, res) => {
    res.json(await detalleCita("evaluador_academico", await idPersonalDe(req), validar(idRuta, req.params.id)));
  });

  // POST /evaluacion-academica/citas/:id/resultado { resultado, observaciones } → 201 { id_cita, id_expediente,
  // estado: "asistio" } (HU0025-1.0) · 400 · 404 · 409 RESULTADO_YA_REGISTRADO, CITA_NO_INICIADA o
  // EVALUACION_NO_CORRESPONDE
  rutas.post("/citas/:id/resultado", async (req, res) => {
    const idCita = validar(idRuta, req.params.id);
    const entrada = validar(esquemaResultado, req.body);
    res.status(201).json(await registrarResultado("evaluador_academico", await idPersonalDe(req), idCita, entrada));
  });

  // POST /evaluacion-academica/citas/:id/inasistencia {} («Marcar “No asistió”») → 200 { id_cita, id_expediente,
  // estado: "no_asistio" } (HU0025-2.0) · 404 · 409 como el resultado
  rutas.post("/citas/:id/inasistencia", async (req, res) => {
    const idCita = validar(idRuta, req.params.id);
    validar(esquemaVacio, req.body ?? {});
    const { id_notificacion, ...cuerpo } = await registrarInasistencia(await idPersonalDe(req), idCita);
    res.json(cuerpo);
    // ADR-16: el aviso a la familia para que reprograme, después del COMMIT y de responder; solo ids (C11).
    if (id_notificacion !== null) void eventos.disparar("agendamiento", { id_expediente: cuerpo.id_expediente, id_notificacion });
  });

  return rutas;
}
