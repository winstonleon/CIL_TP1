// /familia — portal de la familia (pantallas P05 y P05b, HU0005). El router se monta en app.ts detrás de verificarToken
// y requireRol("familia"). Los ids de expediente salen solo de la URL y del token, y la familia solo accede al suyo:
// requireExpedienteDeFamilia responde 404 a uno ajeno (ADR-20). El cuerpo no admite campos de más (.strict()).
import { Router } from "express";
import { z } from "zod";
import { requireExpedienteDeFamilia } from "../auth/expedienteDeFamilia";
import { esPregunta, LARGO_MAXIMO_RESPUESTA } from "../services/cuestionarioExpectativas";
import { guardarFicha, leerFicha, listaRequisitos, listarExpedientes } from "../services/fichaInscripcion";
import { LARGO_MAXIMO } from "../services/reglasSolicitud";
import { validar } from "../validacion";

const texto = (max: number) => z.string().max(max).nullish();
const logico = z.boolean().nullish();

const esquemaFicha = z
  .object({
    modo: z.enum(["borrador", "completa"]),
    postulante: z
      .object({
        nombres: texto(LARGO_MAXIMO.nombres),
        apellido_paterno: texto(LARGO_MAXIMO.apellidos),
        apellido_materno: texto(LARGO_MAXIMO.apellidos),
        dni: texto(20),
        fecha_nacimiento: texto(10),
        estudio_en_colegio_peruano: logico,
        colegio_procedencia: texto(150),
        tiene_condicion_especial: logico,
      })
      .strict(),
    titular: z.object({ parentesco: texto(30), dni: texto(20), condicion_laboral: texto(20) }).strict(),
    segundo_apoderado: z
      .object({
        parentesco: texto(30),
        nombres: texto(LARGO_MAXIMO.nombres),
        apellidos: texto(LARGO_MAXIMO.apellidos),
        dni: texto(20),
        telefono: texto(LARGO_MAXIMO.telefono),
        correo: texto(LARGO_MAXIMO.correo),
        condicion_laboral: texto(20),
      })
      .strict()
      .nullish(),
    respuestas: z
      .record(z.string(), z.string().max(LARGO_MAXIMO_RESPUESTA))
      .refine((r) => Object.keys(r).every(esPregunta))
      .default({}),
  })
  .strict();

export function rutasFamilia(): Router {
  const rutas = Router();

  // GET /familia/expedientes → 200 [{ id_expediente, codigo, estado, grado, postulante, ficha_completa }]: solo los del
  // titular con esa cuenta de Keycloak.
  rutas.get("/expedientes", async (req, res) => {
    res.json(await listarExpedientes(req.usuario!.sub));
  });

  // Desde aquí, todas las rutas con :id exigen que el expediente sea de la familia del token (404 si no).
  rutas.use("/expedientes/:id", requireExpedienteDeFamilia);

  // GET /familia/expedientes/:id/ficha → 200 con la ficha, el cuestionario y su fecha de guardado (HU0005-2.0: retomar).
  rutas.get("/expedientes/:id/ficha", async (req, res) => {
    res.json(await leerFicha(req.expedienteFamilia!));
  });

  // PUT /familia/expedientes/:id/ficha { modo: "borrador" | "completa", postulante, titular, segundo_apoderado, respuestas }
  // → 200 borrador { ficha_completa: false, guardado_en, pendientes } (HU0005-2.0)
  // → 200 completa { ficha_completa: true, guardado_en, requisitos } (HU0005-1.0)
  // · 400 VALIDACION (con detalle) · 404 · 409 DNI_YA_REGISTRADO, FICHA_NO_EDITABLE o FICHA_YA_COMPLETA
  rutas.put("/expedientes/:id/ficha", async (req, res) => {
    const { modo, ...entrada } = validar(esquemaFicha, req.body);
    res.json(await guardarFicha(req.expedienteFamilia!, modo, entrada));
  });

  // GET /familia/expedientes/:id/requisitos → 200 { requisitos: [...] } (R7) · 409 FICHA_INCOMPLETA. Contrato de HU0006.
  rutas.get("/expedientes/:id/requisitos", async (req, res) => {
    res.json(await listaRequisitos(req.expedienteFamilia!));
  });

  return rutas;
}
