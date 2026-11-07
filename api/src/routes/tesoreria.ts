// /tesoreria — validaciones de Tesorería (G05): documentación financiera (HU0011), comprobante del derecho de admisión
// (HU0024) y conciliación de la cuota de ingreso (HU0015). El router se monta en app.ts detrás de verificarToken, requireRol("tesoreria") y requirePersonalActivo (C22).
// Las rutas de la documentación financiera montan además la política de información restringida (R2, C17).
import { Router } from "express";
import { z } from "zod";
import type { Almacenamiento } from "../almacenamiento";
import { requireAccesoRestringido } from "../auth/accesoRestringido";
import { ErrorApi } from "../errores";
import type { DisparadorN8n } from "../orquestacion/n8n";
import { abrirArchivo } from "../services/documentos";
import {
  abrirComprobante,
  confirmarRama,
  decidirDocumento,
  decidirPago,
  detallePago,
  detalleRama,
  resolverDocumentoDeRama,
  validacionesTesoreria,
} from "../services/validaciones";
import { validar } from "../validacion";
import { enviarArchivo, esquemaVacio, idPersonalDe, idRuta, leerDecision } from "./validacion";

const esquemaLista = z.object({ vista: z.enum(["todo", "derecho", "financiera", "cuota"]).default("todo") }).strict();

export function rutasTesoreria(campana: string, almacenamiento: Almacenamiento, eventos: DisparadorN8n): Router {
  const rutas = Router();
  const financiera = requireAccesoRestringido("documentacion_financiera", { obtenerIdExpediente: (req) => req.params.id });
  const avisar = (idExpediente: number, idNotificacion: number | null) => {
    // ADR-16: después del COMMIT y de responder; disparar() nunca rechaza.
    if (idNotificacion !== null) void eventos.disparar("verificacion-completitud", { id_expediente: idExpediente, id_notificacion: idNotificacion });
  };

  // GET /tesoreria/validaciones?vista=todo|derecho|financiera|cuota → 200 { conteos: { todo, derecho, financiera, cuota }, items: [{
  //   concepto, id_expediente, id_pago, codigo, postulante, grado, monto, estado, subsanado, recibido }] }
  rutas.get("/validaciones", async (req, res) => {
    res.json(await validacionesTesoreria(campana, validar(esquemaLista, req.query).vista));
  });

  // GET /tesoreria/expedientes/:id/documentacion-financiera → 200 { …, condiciones_laborales, documentos } y registra
  // atencion_inicio · 404 · 409 VALIDACION_NO_CORRESPONDE
  rutas.get("/expedientes/:id/documentacion-financiera", financiera, async (req, res) => {
    res.json(await detalleRama("financiera", validar(idRuta, req.params.id), await idPersonalDe(req)));
  });

  // GET /tesoreria/expedientes/:id/documentos/:idDoc/archivo → 200 archivo (solo financieros) · 404
  rutas.get("/expedientes/:id/documentos/:idDoc/archivo", financiera, async (req, res) => {
    const idExpediente = validar(idRuta, req.params.id);
    const idDocumento = validar(idRuta, req.params.idDoc);
    const d = await resolverDocumentoDeRama("financiera", idExpediente, idDocumento);
    if (d.tipo !== "de_rama") throw new ErrorApi(404, "DOCUMENTO_NO_ENCONTRADO", "El documento no existe");
    enviarArchivo(res, d.formato, `documento-${idDocumento}`, await abrirArchivo(almacenamiento, idDocumento, d.clave));
  });

  // POST /tesoreria/expedientes/:id/documentos/:idDoc/decision { decision, motivo? } → 200 (HU0011-1.0 y 2.0)
  // · 400 · 404 · 409 DOCUMENTO_YA_REVISADO, VALIDACION_YA_REGISTRADA o VALIDACION_NO_CORRESPONDE
  rutas.post("/expedientes/:id/documentos/:idDoc/decision", financiera, async (req, res) => {
    const idExpediente = validar(idRuta, req.params.id);
    const idDocumento = validar(idRuta, req.params.idDoc);
    const r = await decidirDocumento("financiera", idExpediente, idDocumento, await idPersonalDe(req), leerDecision(req));
    res.json(r);
    avisar(idExpediente, r.id_notificacion);
  });

  // POST /tesoreria/expedientes/:id/validacion-financiera {} («Marcar conforme») → 200 { rama, agendamiento_habilitado }
  // · 404 · 409 DOCUMENTOS_SIN_REVISAR, VALIDACION_YA_REGISTRADA o VALIDACION_NO_CORRESPONDE
  rutas.post("/expedientes/:id/validacion-financiera", financiera, async (req, res) => {
    validar(esquemaVacio, req.body ?? {});
    res.json(await confirmarRama("financiera", validar(idRuta, req.params.id), await idPersonalDe(req)));
  });

  // GET /tesoreria/pagos/:idPago → 200 detalle del comprobante (del derecho o de la cuota, con monto_corresponde) y registra
  // atencion_inicio · 404 · 409
  rutas.get("/pagos/:idPago", async (req, res) => {
    res.json(await detallePago(validar(idRuta, req.params.idPago), await idPersonalDe(req)));
  });

  // GET /tesoreria/pagos/:idPago/comprobante → 200 archivo · 404
  rutas.get("/pagos/:idPago/comprobante", async (req, res) => {
    const idPago = validar(idRuta, req.params.idPago);
    const { formato, contenido } = await abrirComprobante(almacenamiento, idPago);
    enviarArchivo(res, formato, `comprobante-${idPago}`, contenido);
  });

  // POST /tesoreria/pagos/:idPago/decision { decision: "conforme" } | { decision: "observado", motivo } («Observar
  // comprobante») → 200 { id_pago, id_expediente, estado_validacion, id_notificacion, agendamiento_habilitado }
  // (HU0024-1.0 y 2.0; HU0015-1.0 y 2.0 en la cuota) · 400 · 404 · 409 PAGO_YA_VALIDADO o VALIDACION_NO_CORRESPONDE
  rutas.post("/pagos/:idPago/decision", async (req, res) => {
    const { cuota_acreditada, ...r } = await decidirPago(validar(idRuta, req.params.idPago), await idPersonalDe(req), leerDecision(req));
    res.json(r);
    avisar(r.id_expediente, r.id_notificacion);
    // HU0016-1.0 (ADR-16): solo despierta al flujo; la API decide con los datos (C62). Solo ids (C11).
    if (cuota_acreditada) void eventos.disparar("generacion-carta", { id_expediente: r.id_expediente });
  });

  return rutas;
}
