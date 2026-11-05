// /bandeja — bandeja de expedientes (G02) y validación documental (G03) de Secretaría (HU0008, cierra C51). El router se
// monta en app.ts detrás de verificarToken, requireRol("secretaria") y requirePersonalActivo (C22). R2 por documento
// (C17): G03 nunca recibe los documentos financieros, y abrir o decidir uno responde 403 auditado como acceso_denegado.
import { Router, type Request } from "express";
import { z } from "zod";
import type { Almacenamiento } from "../almacenamiento";
import { registrarAccesoDenegado } from "../auth/requireRol";
import { ErrorApi } from "../errores";
import type { DisparadorN8n } from "../orquestacion/n8n";
import { abrirArchivo } from "../services/documentos";
import { bandeja, confirmarRama, decidirDocumento, detalleRama, resolverDocumentoDeRama } from "../services/validaciones";
import { validar } from "../validacion";
import { enviarArchivo, esquemaVacio, idPersonalDe, idRuta, leerDecision } from "./validacion";

const esquemaBandeja = z
  .object({
    vista: z.enum(["por_revisar", "observados", "todos"]).default("por_revisar"),
    grado: idRuta.optional(),
    q: z.string().trim().max(100).optional(),
    orden: z.enum(["antiguos", "recientes"]).default("antiguos"),
  })
  .strict();

// R2 (HU0021-2.0): un documento financiero no se abre ni se valida desde la bandeja de Secretaría.
async function denegarFinanciero(req: Request, idExpediente: number, idDocumento: number): Promise<never> {
  await registrarAccesoDenegado(req, ["tesoreria"], { idExpediente, detalle: { recurso: "documentacion_financiera", id_documento: idDocumento } });
  throw new ErrorApi(403, "ACCESO_DENEGADO", "No tienes permiso para ver esta información");
}

async function documentoDeSecretaria(req: Request, idExpediente: number, idDocumento: number) {
  const d = await resolverDocumentoDeRama("documental", idExpediente, idDocumento);
  if (d.tipo === "otra_rama") return denegarFinanciero(req, idExpediente, idDocumento);
  if (d.tipo === "inexistente") throw new ErrorApi(404, "DOCUMENTO_NO_ENCONTRADO", "El documento no existe");
  return d;
}

export function rutasBandeja(campana: string, almacenamiento: Almacenamiento, eventos: DisparadorN8n): Router {
  const rutas = Router();

  // GET /bandeja/expedientes?vista=por_revisar|observados|todos&grado=&q=&orden=antiguos|recientes
  // → 200 { conteos: { por_revisar, observados, todos }, expedientes: [{ id_expediente, codigo, postulante, apoderado,
  //   grado, estado_documental, subsanado, ultima_actividad, en_validacion_desde }] }. Solo en_validacion (HU0017-1.0, C51).
  rutas.get("/expedientes", async (req, res) => {
    const f = validar(esquemaBandeja, req.query);
    res.json(await bandeja(campana, { vista: f.vista, idGrado: f.grado, q: f.q || undefined, recientes: f.orden === "recientes" }));
  });

  // GET /bandeja/expedientes/:id → 200 detalle de G03 (sin documentos financieros) y registra atencion_inicio
  // · 404 EXPEDIENTE_NO_ENCONTRADO · 409 VALIDACION_NO_CORRESPONDE
  rutas.get("/expedientes/:id", async (req, res) => {
    res.json(await detalleRama("documental", validar(idRuta, req.params.id), await idPersonalDe(req)));
  });

  // GET /bandeja/expedientes/:id/documentos/:idDoc/archivo → 200 archivo · 403 ACCESO_DENEGADO (financiero) · 404
  rutas.get("/expedientes/:id/documentos/:idDoc/archivo", async (req, res) => {
    const idExpediente = validar(idRuta, req.params.id);
    const idDocumento = validar(idRuta, req.params.idDoc);
    const d = await documentoDeSecretaria(req, idExpediente, idDocumento);
    enviarArchivo(res, d.formato, `documento-${idDocumento}`, await abrirArchivo(almacenamiento, idDocumento, d.clave));
  });

  // POST /bandeja/expedientes/:id/documentos/:idDoc/decision { decision: "conforme" } | { decision: "observado", motivo }
  // → 200 { documento, rama, id_notificacion } (HU0008-1.0 y 2.0) · 400 · 403 (financiero) · 404
  // · 409 DOCUMENTO_YA_REVISADO, VALIDACION_YA_REGISTRADA o VALIDACION_NO_CORRESPONDE
  rutas.post("/expedientes/:id/documentos/:idDoc/decision", async (req, res) => {
    const idExpediente = validar(idRuta, req.params.id);
    const idDocumento = validar(idRuta, req.params.idDoc);
    await documentoDeSecretaria(req, idExpediente, idDocumento);
    const decision = leerDecision(req);
    const r = await decidirDocumento("documental", idExpediente, idDocumento, await idPersonalDe(req), decision);
    res.json(r);
    // ADR-16: después del COMMIT y de responder; disparar() nunca rechaza.
    if (r.id_notificacion !== null) void eventos.disparar("verificacion-completitud", { id_expediente: idExpediente, id_notificacion: r.id_notificacion });
  });

  // POST /bandeja/expedientes/:id/validacion-documental {} («Dar conformidad al expediente»)
  // → 200 { rama: "conforme", agendamiento_habilitado } (HU0008-1.0) · 404
  // · 409 DOCUMENTOS_SIN_REVISAR, VALIDACION_YA_REGISTRADA o VALIDACION_NO_CORRESPONDE
  rutas.post("/expedientes/:id/validacion-documental", async (req, res) => {
    validar(esquemaVacio, req.body ?? {});
    res.json(await confirmarRama("documental", validar(idRuta, req.params.id), await idPersonalDe(req)));
  });

  return rutas;
}
