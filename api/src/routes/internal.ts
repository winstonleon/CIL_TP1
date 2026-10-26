// Rutas /internal/* para n8n (ADR-04). Todas exigen el token de servicio (requireTokenServicio),
// que reemplaza a requireRol: el cliente no es una persona con rol de realm.
import { Router } from "express";
import { z } from "zod";
import { requireTokenServicio } from "../auth/requireTokenServicio";
import { ORIGENES_REBOTE, carpetasPendientes, registrarRebote, reservarCarpeta } from "../services/captacion";
import { registrarErrorFlujo } from "../services/erroresFlujo";
import { cerrarNotificacion, obtenerContactoExpediente, registrarNotificacion } from "../services/notificaciones";
import { validar } from "../validacion";

export const rutasInternas = Router();
rutasInternas.use(requireTokenServicio);

const idExpediente = z.coerce.number().int().positive();
const idRuta = z.coerce.number().int().positive().max(2147483647);

const cuerpoNotificacion = z.object({
  id_expediente: z.number().int().positive(),
  canal: z.enum(["correo", "whatsapp"]),
  tipo_evento: z.string().trim().min(1).max(60),
  estado_envio: z.enum(["pendiente", "enviado", "fallido"]),
});

// Un intento reservado se cierra solo con su resultado; `pendiente` no es un resultado (D7: el error técnico la deja así).
const cuerpoCierre = z.object({ estado_envio: z.enum(["enviado", "fallido"]) }).strict();

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

// GET /internal/expedientes/:id/contacto → { id_expediente, correo, autoriza_whatsapp }
rutasInternas.get("/expedientes/:id/contacto", async (req, res) => {
  res.json(await obtenerContactoExpediente(validar(idExpediente, req.params.id)));
});

// POST /internal/notificaciones { id_expediente, canal, tipo_evento, estado_envio } → 201 { id_notificacion }
rutasInternas.post("/notificaciones", async (req, res) => {
  const datos = validar(cuerpoNotificacion, req.body);
  const id = await registrarNotificacion({
    idExpediente: datos.id_expediente,
    canal: datos.canal,
    tipoEvento: datos.tipo_evento,
    estadoEnvio: datos.estado_envio,
  });
  res.status(201).json({ id_notificacion: id });
});

// HU0002 (flujo captacion): POST /internal/expedientes/:id/carpeta-informativa → 201 { id_notificacion, tipo_evento,
// asunto, cuerpo } · 409 CARPETA_YA_REGISTRADA o ESTADO_NO_PERMITE_CARPETA · 404
rutasInternas.post("/expedientes/:id/carpeta-informativa", async (req, res) => {
  res.status(201).json(await reservarCarpeta(validar(idRuta, req.params.id)));
});

// HU0002 (notificacion-multicanal con id_notificacion): PATCH /internal/notificaciones/:id { estado_envio } → 200
// { id_notificacion, estado_envio } · 409 NOTIFICACION_CERRADA · 404
rutasInternas.patch("/notificaciones/:id", async (req, res) => {
  const { estado_envio } = validar(cuerpoCierre, req.body);
  res.json(await cerrarNotificacion(validar(idRuta, req.params.id), estado_envio));
});

// C27 (barrido de captacion): GET /internal/captacion/pendientes → { expedientes: [{ id_expediente }] }
rutasInternas.get("/captacion/pendientes", async (_req, res) => {
  res.json(await carpetasPendientes());
});

// HU0002-2.0: POST /internal/notificaciones/:id/rebote { origen } → 200 { id_notificacion, estado_envio, transicion }
// · 409 NO_ES_CARPETA · 404
rutasInternas.post("/notificaciones/:id/rebote", async (req, res) => {
  const { origen } = validar(cuerpoRebote, req.body);
  res.json(await registrarRebote(validar(idRuta, req.params.id), origen));
});

// C2 (workflow registro-errores): POST /internal/errores-flujo { flujo, nodo, id_ejecucion } → 204
rutasInternas.post("/errores-flujo", (req, res) => {
  registrarErrorFlujo(validar(cuerpoErrorFlujo, req.body));
  res.status(204).end();
});
