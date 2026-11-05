// Rutas /internal/* para n8n (ADR-04). Todas exigen el token de servicio (requireTokenServicio),
// que reemplaza a requireRol: el cliente no es una persona con rol de realm. Reciben Keycloak (identidad) porque el aviso
// de credenciales fija la contraseña temporal de la familia (HU0004-1.0, D3).
import { Router } from "express";
import { z } from "zod";
import { requireTokenServicio } from "../auth/requireTokenServicio";
import type { IdentidadAdmin } from "../identidad/keycloakAdmin";
import { avisosPendientes, cerrarAviso, reservarAviso } from "../services/agendamiento";
import { ORIGENES_REBOTE, carpetasPendientes, registrarRebote, reservarCarpeta } from "../services/captacion";
import { verificacionesPendientes, verificarCompletitud } from "../services/completitud";
import { registrarErrorFlujo } from "../services/erroresFlujo";
import { obtenerContactoExpediente, registrarNotificacion } from "../services/notificaciones";
import { recordatoriosPendientes, reservarRecordatorio } from "../services/recordatorios";
import { observacionesPendientes, reservarAvisoObservacion } from "../services/validaciones";
import { validar } from "../validacion";

const idExpediente = z.coerce.number().int().positive();
const idRuta = z.coerce.number().int().positive().max(2147483647);

const cuerpoNotificacion = z.object({
  id_expediente: z.number().int().positive(),
  canal: z.enum(["correo", "whatsapp"]),
  tipo_evento: z.string().trim().min(1).max(60),
  estado_envio: z.enum(["pendiente", "enviado", "fallido"]),
});

// Un intento reservado se cierra solo con su resultado; `pendiente` no es un resultado (D7: un 502, un 500 o un error
// técnico la dejan así).
const cuerpoCierre = z.object({ estado_envio: z.enum(["enviado", "fallido"]) }).strict();

// El webhook de la observación trae el primer intento; el barrido no manda cuerpo (plan del bloque 5).
const cuerpoAvisoObservacion = z.object({ id_notificacion: idRuta.optional() }).strict();

const cuerpoRebote = z.object({ origen: z.enum(ORIGENES_REBOTE) }).strict();

// Solo identificadores, sin mensaje (C2): nombres de flujo y de nodo de una línea, para que el log no se pueda partir.
const textoDeUnaLinea = (max: number) => z.string().min(1).max(max).regex(/^[^\p{Cc}]+$/u);
const cuerpoErrorFlujo = z
  .object({
    flujo: textoDeUnaLinea(60),
    nodo: textoDeUnaLinea(100),
    id_ejecucion: z.string().regex(/^[0-9A-Za-z-]{1,40}$/),
  })
  .strict();

export function rutasInternas(identidad: IdentidadAdmin): Router {
  const rutas = Router();
  rutas.use(requireTokenServicio);

  // GET /internal/expedientes/:id/contacto → { id_expediente, correo, autoriza_whatsapp }
  rutas.get("/expedientes/:id/contacto", async (req, res) => {
    res.json(await obtenerContactoExpediente(validar(idExpediente, req.params.id)));
  });

  // POST /internal/notificaciones { id_expediente, canal, tipo_evento, estado_envio } → 201 { id_notificacion }
  rutas.post("/notificaciones", async (req, res) => {
    const datos = validar(cuerpoNotificacion, req.body);
    const id = await registrarNotificacion({
      idExpediente: datos.id_expediente,
      canal: datos.canal,
      tipoEvento: datos.tipo_evento,
      estadoEnvio: datos.estado_envio,
    });
    res.status(201).json({ id_notificacion: id });
  });

  // HU0002 (flujo captacion): POST /internal/expedientes/:id/carpeta-informativa → 201 { id_expediente, id_notificacion,
  // tipo_evento, asunto, cuerpo } · 409 CARPETA_YA_REGISTRADA o ESTADO_NO_PERMITE_CARPETA · 404
  rutas.post("/expedientes/:id/carpeta-informativa", async (req, res) => {
    res.status(201).json(await reservarCarpeta(validar(idRuta, req.params.id)));
  });

  // HU0002 (notificacion-multicanal con id_notificacion): PATCH /internal/notificaciones/:id { estado_envio } → 200
  // { id_notificacion, estado_envio } · 409 NOTIFICACION_CERRADA · 404. Un aviso de credenciales cerrado `fallido`
  // invalida la contraseña temporal (M3, HU0004).
  rutas.patch("/notificaciones/:id", async (req, res) => {
    const { estado_envio } = validar(cuerpoCierre, req.body);
    res.json(await cerrarAviso(identidad, validar(idRuta, req.params.id), estado_envio));
  });

  // C27 (barrido de captacion): GET /internal/captacion/pendientes → { expedientes: [{ id_expediente }] }
  rutas.get("/captacion/pendientes", async (_req, res) => {
    res.json(await carpetasPendientes());
  });

  // HU0002-2.0: POST /internal/notificaciones/:id/rebote { origen } → 200 { id_notificacion, estado_envio, transicion }
  // · 409 NO_ES_CARPETA · 404
  rutas.post("/notificaciones/:id/rebote", async (req, res) => {
    const { origen } = validar(cuerpoRebote, req.body);
    res.json(await registrarRebote(validar(idRuta, req.params.id), origen));
  });

  // HU0003 y HU0004 (flujo agendamiento): POST /internal/citas/:id/aviso → 201 { id_expediente, id_cita, id_notificacion,
  // tipo_evento, asunto, cuerpo } · 409 AVISO_YA_REGISTRADO, AVISO_AGOTADO o AVISO_NO_CORRESPONDE · 404 · 502 (Keycloak)
  rutas.post("/citas/:id/aviso", async (req, res) => {
    res.status(201).json(await reservarAviso(identidad, validar(idRuta, req.params.id)));
  });

  // Barrido de agendamiento (ADR-16): GET /internal/agendamiento/pendientes → { citas: [{ id_cita }] }
  rutas.get("/agendamiento/pendientes", async (_req, res) => {
    res.json(await avisosPendientes());
  });

  // HU0003-1.0 (flujo seguimiento-recordatorios, D4): POST /internal/citas/:id/recordatorio → 201 { …, tipo_evento:
  // "recordatorio_visita", asunto, cuerpo } · 409 RECORDATORIO_YA_REGISTRADO, AVISO_AGOTADO o FUERA_DE_VENTANA · 404
  rutas.post("/citas/:id/recordatorio", async (req, res) => {
    res.status(201).json(await reservarRecordatorio(validar(idRuta, req.params.id)));
  });

  // GET /internal/recordatorios/pendientes → { citas: [{ id_cita }] }
  rutas.get("/recordatorios/pendientes", async (_req, res) => {
    res.json(await recordatoriosPendientes());
  });

  // HU0017 (flujo verificacion-completitud, ADR-22): POST /internal/expedientes/:id/verificacion-completitud
  // → 200 { id_expediente, resultado: "completo" } (HU0017-1.0)
  // → 201 { id_expediente, resultado: "incompleto", id_notificacion, tipo_evento, asunto, cuerpo } (HU0017-2.0)
  // · 409 VERIFICACION_NO_CORRESPONDE, AVISO_YA_REGISTRADO o AVISO_AGOTADO · 404
  rutas.post("/expedientes/:id/verificacion-completitud", async (req, res) => {
    const r = await verificarCompletitud(validar(idRuta, req.params.id));
    res.status(r.resultado === "completo" ? 200 : 201).json(r);
  });

  // Barrido de recepcion-registro (ADR-16): GET /internal/completitud/pendientes → { expedientes: [{ id_expediente }] }
  rutas.get("/completitud/pendientes", async (_req, res) => {
    res.json(await verificacionesPendientes());
  });

  // HU0008-2.0, HU0011-2.0 y HU0024-2.0 (flujo verificacion-completitud, rama validación): POST
  // /internal/expedientes/:id/aviso-observacion { id_notificacion? } → 201 { id_expediente, id_notificacion, tipo_evento:
  // "subsanacion_solicitada", asunto, cuerpo } · 409 AVISO_NO_CORRESPONDE, AVISO_YA_REGISTRADO o AVISO_AGOTADO · 404
  rutas.post("/expedientes/:id/aviso-observacion", async (req, res) => {
    const { id_notificacion } = validar(cuerpoAvisoObservacion, req.body ?? {});
    res.status(201).json(await reservarAvisoObservacion(validar(idRuta, req.params.id), id_notificacion));
  });

  // Barrido de la rama validación (ADR-16): GET /internal/observaciones/pendientes → { expedientes: [{ id_expediente }] }
  rutas.get("/observaciones/pendientes", async (_req, res) => {
    res.json(await observacionesPendientes());
  });

  // C2 (workflow registro-errores): POST /internal/errores-flujo { flujo, nodo, id_ejecucion } → 204
  rutas.post("/errores-flujo", (req, res) => {
    registrarErrorFlujo(validar(cuerpoErrorFlujo, req.body));
    res.status(204).end();
  });

  return rutas;
}
