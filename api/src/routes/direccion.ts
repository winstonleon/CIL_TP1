// /direccion — adjudicación de vacantes (G07, HU0012). El router se monta en app.ts detrás de verificarToken,
// requireRol("directora") y requirePersonalActivo (C22). Las rutas del dictamen pasan antes por la política de información
// restringida (R3, C58, montada en app.ts): la directora ve el informe psicológico con esta pantalla.
import { Router } from "express";
import type { Almacenamiento } from "../almacenamiento";
import type { DisparadorN8n } from "../orquestacion/n8n";
import { adjudicarVacante, dictamenParaDireccion, informeParaDireccion, panelAdjudicacion } from "../services/adjudicacion";
import { validar } from "../validacion";
import { enviarArchivo, esquemaVacio, idPersonalDe, idRuta } from "./validacion";

export function rutasDireccion(campana: string, almacenamiento: Almacenamiento, eventos: DisparadorN8n): Router {
  const rutas = Router();

  // GET /direccion/adjudicacion → 200 { pendientes: [{ id_expediente, codigo, postulante, grado, dictamen, recibido,
  // sin_vacantes }], inventario: [{ id_grado, nivel, grado, autorizadas, adjudicadas, disponibles, lista_espera }] }
  rutas.get("/adjudicacion", async (_req, res) => {
    res.json(await panelAdjudicacion(campana));
  });

  // GET /direccion/expedientes/:id/dictamen («Ver dictamen») → 200 { …, dictamen, conclusiones, tiene_informe,
  // fecha_emision } y registra atencion_inicio · 404 · 409 ADJUDICACION_NO_CORRESPONDE
  rutas.get("/expedientes/:id/dictamen", async (req, res) => {
    res.json(await dictamenParaDireccion(validar(idRuta, req.params.id), await idPersonalDe(req)));
  });

  // GET /direccion/expedientes/:id/dictamen/informe → 200 archivo (R3, cabeceras de ADR-21) · 404 · 409
  rutas.get("/expedientes/:id/dictamen/informe", async (req, res) => {
    const idExpediente = validar(idRuta, req.params.id);
    const { formato, contenido } = await informeParaDireccion(almacenamiento, idExpediente);
    enviarArchivo(res, formato, `informe-${idExpediente}`, contenido);
  });

  // POST /direccion/expedientes/:id/adjudicacion {} → 200 { resultado: "vacante_asignada" } (HU0012-1.0) o
  // { resultado: "lista_espera", posicion } (HU0012-2.0) · 400 · 404 · 409 ADJUDICACION_NO_CORRESPONDE
  rutas.post("/expedientes/:id/adjudicacion", async (req, res) => {
    const idExpediente = validar(idRuta, req.params.id);
    validar(esquemaVacio, req.body ?? {});
    const { id_notificacion, ...cuerpo } = await adjudicarVacante(idExpediente, await idPersonalDe(req));
    res.json(cuerpo);
    // ADR-16: después del COMMIT y de responder; solo ids (C11). disparar() nunca rechaza.
    void eventos.disparar("agendamiento", { id_expediente: idExpediente, id_notificacion });
  });

  return rutas;
}
