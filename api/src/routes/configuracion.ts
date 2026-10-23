// /configuracion — configuración de la campaña activa (HU0022, pantalla G09). Solo Secretaría (§4.6 y matriz de G10):
// el router se monta en app.ts detrás de verificarToken y requireRol("secretaria").
import { Router } from "express";
import { z } from "zod";
import {
  CATEGORIAS_REQUISITO,
  CONDICIONES_APLICACION,
  TIPOS_CITA,
  crearHorario,
  crearRequisito,
  guardarGrados,
  horarios,
  modificarRequisito,
  obtenerConfiguracion,
  quitarHorario,
  quitarRequisito,
  requisitosDeGrado,
  responsables,
} from "../services/configuracion";
import { validar } from "../validacion";

const idRuta = z.coerce.number().int().positive().max(2147483647);
const id = z.number().int().positive().max(2147483647);

// numeric(10,2) y ≥ 0: la cuota puede ser 0 a propósito (plan HU0022, P10: colegios sin cuota de ingreso).
const dinero = z
  .number()
  .min(0)
  .max(99999999.99)
  .refine((v) => Math.abs(v * 100 - Math.round(v * 100)) < 1e-6, { message: "dos decimales como máximo" })
  .transform((v) => v.toFixed(2));

const cambioGrado = z
  .object({
    id_grado: id,
    vacantes_autorizadas: z.number().int().min(0).max(2147483647).optional(),
    requiere_jornada_observacion: z.boolean().optional(),
    requiere_evaluacion_psicologica: z.boolean().optional(),
    requiere_evaluacion_academica: z.boolean().optional(),
    monto_cuota_ingreso: dinero.optional(),
    max_fracciones: z.number().int().min(1).max(32767).optional(),
  })
  .strict();

const cuerpoGrados = z
  .object({ grados: z.array(cambioGrado).min(1).max(100) })
  .strict()
  .refine((c) => new Set(c.grados.map((g) => g.id_grado)).size === c.grados.length, { message: "grado repetido", path: ["grados"] });

const camposRequisito = {
  tipo_documento: z.string().trim().min(1).max(80),
  categoria: z.enum(CATEGORIAS_REQUISITO),
  condicion_aplicacion: z.enum(CONDICIONES_APLICACION),
  obligatorio: z.boolean(),
  por_apoderado: z.boolean(),
};

// Valores por defecto del DBML: condición «todos», obligatorio y no por apoderado.
const cuerpoRequisito = z
  .object({
    ...camposRequisito,
    condicion_aplicacion: camposRequisito.condicion_aplicacion.default("todos"),
    obligatorio: camposRequisito.obligatorio.default(true),
    por_apoderado: camposRequisito.por_apoderado.default(false),
  })
  .strict();

// Sin id_grado: un requisito no cambia de grado (plan HU0022, P4). Un campo desconocido es un 400.
const cambioRequisito = z
  .object(camposRequisito)
  .partial()
  .strict()
  .refine((c) => Object.values(c).some((v) => v !== undefined), { message: "sin cambios" });

const hora = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);

const cuerpoHorario = z
  .object({
    id_personal: id,
    tipo_cita: z.enum(TIPOS_CITA),
    fecha: z.iso.date(),
    hora_inicio: hora,
    hora_fin: hora,
    cupos: z.number().int().min(0).max(32767).default(1),
  })
  .strict()
  .refine((h) => h.hora_fin > h.hora_inicio, { message: "hora_fin debe ser posterior a hora_inicio", path: ["hora_fin"] });

const filtroHorarios = z.object({ tipo_cita: z.enum(TIPOS_CITA).optional() });

export function rutasConfiguracion(campana: string): Router {
  const rutas = Router();

  // GET /configuracion → { campana, derecho_admision, grados: [...] } (HU0022-1.0)
  rutas.get("/", async (_req, res) => {
    res.json(await obtenerConfiguracion(campana));
  });

  // PATCH /configuracion/grados { grados: [...] } → 200 (HU0022-1.0) · 422 si quedan menos vacantes que las adjudicadas (HU0022-2.0)
  rutas.patch("/grados", async (req, res) => {
    const { grados } = validar(cuerpoGrados, req.body);
    res.json(await guardarGrados(req.usuario!.sub, campana, grados));
  });

  rutas.get("/grados/:id/requisitos", async (req, res) => {
    res.json(await requisitosDeGrado(campana, validar(idRuta, req.params.id)));
  });

  rutas.post("/grados/:id/requisitos", async (req, res) => {
    const idGrado = validar(idRuta, req.params.id);
    res.status(201).json(await crearRequisito(req.usuario!.sub, campana, idGrado, validar(cuerpoRequisito, req.body)));
  });

  rutas.patch("/requisitos/:id", async (req, res) => {
    const idRequisito = validar(idRuta, req.params.id);
    res.json(await modificarRequisito(req.usuario!.sub, campana, idRequisito, validar(cambioRequisito, req.body)));
  });

  rutas.delete("/requisitos/:id", async (req, res) => {
    await quitarRequisito(req.usuario!.sub, campana, validar(idRuta, req.params.id));
    res.status(204).end();
  });

  // GET /configuracion/responsables → cuentas activas que pueden tener horarios (directora, psicóloga, evaluador académico)
  rutas.get("/responsables", async (_req, res) => {
    res.json(await responsables());
  });

  rutas.get("/horarios", async (req, res) => {
    const { tipo_cita } = validar(filtroHorarios, req.query);
    res.json(await horarios(campana, tipo_cita));
  });

  rutas.post("/horarios", async (req, res) => {
    res.status(201).json(await crearHorario(req.usuario!.sub, campana, validar(cuerpoHorario, req.body)));
  });

  rutas.delete("/horarios/:id", async (req, res) => {
    await quitarHorario(req.usuario!.sub, campana, validar(idRuta, req.params.id));
    res.status(204).end();
  });

  return rutas;
}
