// Rutas /internal/* para n8n (ADR-04). Todas exigen el token de servicio (requireTokenServicio),
// que reemplaza a requireRol: el cliente no es una persona con rol de realm.
import { Router } from "express";
import { z } from "zod";
import { requireTokenServicio } from "../auth/requireTokenServicio";
import { ErrorApi } from "../errores";
import { obtenerContactoExpediente, registrarNotificacion } from "../services/notificaciones";

export const rutasInternas = Router();
rutasInternas.use(requireTokenServicio);

const idExpediente = z.coerce.number().int().positive();

const cuerpoNotificacion = z.object({
  id_expediente: z.number().int().positive(),
  canal: z.enum(["correo", "whatsapp"]),
  tipo_evento: z.string().trim().min(1).max(60),
  estado_envio: z.enum(["pendiente", "enviado", "fallido"]),
});

function validar<T>(esquema: z.ZodType<T>, valor: unknown): T {
  const r = esquema.safeParse(valor);
  if (!r.success) {
    const campos = [...new Set(r.error.issues.map((i) => i.path.join(".") || "cuerpo"))].join(", ");
    throw new ErrorApi(400, "VALIDACION", `Datos inválidos: ${campos}`);
  }
  return r.data;
}

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
