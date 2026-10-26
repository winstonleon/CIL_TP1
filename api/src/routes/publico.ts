// /publico — rutas PÚBLICAS a propósito (ADR-17): sin verificarToken ni requireRol, porque la familia no tiene cuenta
// hasta HU0004. Igual que /salud, no hay rol que declarar. Protecciones técnicas (no son reglas de negocio):
// - cuerpo de 4 kB como máximo (parser propio de /publico en app.ts → 413);
// - límite por IP en el POST (limitePorIp → 429 con Retry-After);
// - campo trampa: si llega con texto, la respuesta es la misma 201 y no se guarda nada;
// - la misma respuesta en todos los casos, sin identificadores: no revela si un correo ya existe;
// - sin CORS: P01 llama a /api desde el mismo origen (proxy de Vite en dev, NGINX en prod).
import { Router } from "express";
import { z } from "zod";
import { ErrorApi } from "../errores";
import { limitePorIp, type OpcionesLimite } from "../limitePorIp";
import type { DisparadorN8n } from "../orquestacion/n8n";
import { correoValido, LARGO_MAXIMO, normalizarTelefono } from "../services/reglasSolicitud";
import { CANALES_ORIGEN, formularioSolicitud, registrarSolicitud } from "../services/solicitudInformacion";
import { validar } from "../validacion";

// Campo trampa (ADR-17): P01 lo tiene oculto y fuera del orden de tabulación; una persona no lo llena. El nombre no se
// parece a ningún dato que el navegador autocomplete.
export const CAMPO_TRAMPA = "comentario";

const RESPUESTA = { estado: "registrada" } as const;

const texto = (max: number) => z.string().trim().min(1).max(max);

const cuerpoSolicitud = z
  .object({
    nombres: texto(LARGO_MAXIMO.nombres),
    apellidos: texto(LARGO_MAXIMO.apellidos),
    // Reglas de reglasSolicitud.ts, las mismas que aplica el cliente (HU0001-2.0).
    telefono: z.string().transform((valor, ctx) => {
      const e164 = normalizarTelefono(valor);
      if (e164 === null) {
        ctx.addIssue({ code: "custom", message: "formato" });
        return z.NEVER;
      }
      return e164;
    }),
    correo: z.string().trim().toLowerCase().refine(correoValido),
    id_grado: z.number().int().positive().max(2147483647),
    autoriza_whatsapp: z.boolean().default(false),
    acepta_politica: z.literal(true),
    canal_origen: z.enum(CANALES_ORIGEN).default("formulario_web"),
    [CAMPO_TRAMPA]: z.string().optional(), // si llegó con texto, la ruta ya respondió
  })
  .strict();

const esObjeto = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const conTexto = (v: unknown) => v !== undefined && v !== null && String(v).trim() !== "";

export interface OpcionesRutasPublicas {
  campana: string;
  eventos: DisparadorN8n;
  limite: OpcionesLimite;
}

export function rutasPublicas({ campana, eventos, limite }: OpcionesRutasPublicas): Router {
  const rutas = Router();

  // PÚBLICA a propósito (ADR-17), sin límite por IP: solo lee.
  // GET /publico/solicitud-informacion → { campana, politica: { version, texto }, grados: [{ id_grado, nivel, nombre_grado }] }
  rutas.get("/solicitud-informacion", async (_req, res) => {
    res.json(await formularioSolicitud(campana));
  });

  // PÚBLICA a propósito (ADR-17), con límite por IP.
  // POST /publico/solicitud-informacion → 201 { estado: "registrada" } (HU0001-1.0) · 422 sin consentimiento
  // (HU0001-3.0) · 400 con datos faltantes o con formato inválido (HU0001-2.0)
  rutas.post("/solicitud-informacion", limitePorIp(limite), async (req, res) => {
    const cuerpo: unknown = req.body;
    if (!esObjeto(cuerpo)) throw new ErrorApi(400, "VALIDACION", "Datos inválidos: cuerpo");
    if (conTexto(cuerpo[CAMPO_TRAMPA])) {
      console.warn("Solicitud de información descartada (campo trampa)");
      res.status(201).json(RESPUESTA);
      return;
    }
    // R1 y HU0001-3.0: primera validación, antes que los demás campos. Sin consentimiento no se guarda nada.
    if (cuerpo.acepta_politica !== true) {
      throw new ErrorApi(422, "CONSENTIMIENTO_REQUERIDO", "El consentimiento es obligatorio para continuar.");
    }
    const datos = validar(cuerpoSolicitud, cuerpo);
    const idExpediente = await registrarSolicitud(campana, datos);
    res.status(201).json(RESPUESTA);
    // ADR-16: después del COMMIT y de responder; disparar() nunca rechaza y la familia no espera a n8n.
    void eventos.disparar("captacion", { id_expediente: idExpediente });
  });

  return rutas;
}
