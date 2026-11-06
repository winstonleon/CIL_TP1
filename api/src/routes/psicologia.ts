// /psicologia — agenda de Psicología y dictamen de admisión (G06; HU0010 y S1 de ADR-25). El router se monta en app.ts
// detrás de verificarToken, la política del informe psicológico (R3: cualquier otro rol recibe 403 auditado como
// acceso_denegado con `detalle.recurso`, HU0021-2.0 y C17), requireRol("psicologa") y requirePersonalActivo (C22).
import { Router } from "express";
import { z } from "zod";
import type { Almacenamiento } from "../almacenamiento";
import type { DisparadorN8n } from "../orquestacion/n8n";
import {
  abrirInforme,
  agenda,
  detalleCita,
  detalleDictamen,
  emitirDictamen,
  esquemaResultado,
  LARGO_MAXIMO_TEXTO,
  registrarResultado,
} from "../services/dictamen";
import { validar } from "../validacion";
import { recibirCargaConArchivoOpcional } from "./multipart";
import { enviarArchivo, idPersonalDe, idRuta } from "./validacion";

// Fecha del día de la agenda (YYYY-MM-DD, una fecha real).
export const esquemaAgenda = z
  .object({ fecha: z.iso.date() })
  .strict();

const esquemaAperturaDictamen = z.object({ abrir: z.literal("1").optional() }).strict();

// Un campo de texto del dictamen ocupa hasta 4 bytes por carácter (UTF-8).
const LIMITE_CAMPO_DICTAMEN = LARGO_MAXIMO_TEXTO * 4;

export function rutasPsicologia(almacenamiento: Almacenamiento, eventos: DisparadorN8n): Router {
  const rutas = Router();

  // GET /psicologia/agenda?fecha=YYYY-MM-DD → 200 { fecha, citas: [{ id_cita, id_expediente, codigo, postulante, grado,
  //   tipo_cita, fecha, hora_inicio, hora_fin, estado, resultado_registrado }] } (solo las citas de la psicóloga de la sesión)
  rutas.get("/agenda", async (req, res) => {
    res.json(await agenda("psicologa", await idPersonalDe(req), validar(esquemaAgenda, req.query).fecha));
  });

  // GET /psicologia/citas/:id → 200 la cita con su resultado y registra atencion_inicio si espera el resultado · 404
  rutas.get("/citas/:id", async (req, res) => {
    res.json(await detalleCita("psicologa", await idPersonalDe(req), validar(idRuta, req.params.id)));
  });

  // POST /psicologia/citas/:id/resultado { resultado, observaciones } → 201 { id_cita, id_expediente, estado: "asistio" }
  // · 400 · 404 · 409 RESULTADO_YA_REGISTRADO, CITA_NO_INICIADA o EVALUACION_NO_CORRESPONDE
  rutas.post("/citas/:id/resultado", async (req, res) => {
    const idCita = validar(idRuta, req.params.id);
    const entrada = validar(esquemaResultado, req.body);
    res.status(201).json(await registrarResultado("psicologa", await idPersonalDe(req), idCita, entrada));
  });

  // GET /psicologia/expedientes/:id/dictamen[?abrir=1] → 200 { …, exigidas, faltan, componentes, habilitado, opciones,
  // dictamen }. `abrir=1` (el panel del dictamen se abre) registra atencion_inicio si espera el dictamen; sin él es una
  // lectura · 400 · 404 · 409 DICTAMEN_NO_CORRESPONDE
  rutas.get("/expedientes/:id/dictamen", async (req, res) => {
    const { abrir } = validar(esquemaAperturaDictamen, req.query);
    res.json(await detalleDictamen(await idPersonalDe(req), validar(idRuta, req.params.id), abrir === "1"));
  });

  // POST /psicologia/expedientes/:id/dictamen · multipart: dictamen, conclusiones, requisitos_complementarios (solo con
  // en_observacion) y, opcional, «archivo» al final → 201 { id_expediente, estado, dictamen, tiene_informe }
  // (HU0010-1.0, 2.0 y 3.0) · 400 · 404 · 409 RESULTADOS_INCOMPLETOS, CITAS_PENDIENTES, DICTAMEN_YA_EMITIDO,
  // DICTAMEN_NO_CORRESPONDE o ESTADO_DESACTUALIZADO · 413 · 415
  rutas.post("/expedientes/:id/dictamen", async (req, res) => {
    const idExpediente = validar(idRuta, req.params.id);
    const idPersonal = await idPersonalDe(req);
    const { id_notificacion, ...cuerpo } = await recibirCargaConArchivoOpcional(
      req,
      (campos, archivo) => emitirDictamen(almacenamiento, idPersonal, idExpediente, campos, archivo),
      { limiteCampo: LIMITE_CAMPO_DICTAMEN },
    );
    res.status(201).json(cuerpo);
    // ADR-16: después del COMMIT y de responder; solo ids (C11). disparar() nunca rechaza.
    if (id_notificacion !== null) void eventos.disparar("agendamiento", { id_expediente: idExpediente, id_notificacion });
  });

  // GET /psicologia/expedientes/:id/dictamen/informe → 200 archivo (R3, cabeceras de ADR-21) · 404 INFORME_NO_ENCONTRADO
  rutas.get("/expedientes/:id/dictamen/informe", async (req, res) => {
    const idExpediente = validar(idRuta, req.params.id);
    const { formato, contenido } = await abrirInforme(almacenamiento, idExpediente);
    enviarArchivo(res, formato, `informe-${idExpediente}`, contenido);
  });

  return rutas;
}
