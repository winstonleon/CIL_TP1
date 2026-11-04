// /familia — portal de la familia (pantallas P05 y P05b, HU0005). El router se monta en app.ts detrás de verificarToken
// y requireRol("familia"). Los ids de expediente salen solo de la URL y del token, y la familia solo accede al suyo:
// requireExpedienteDeFamilia responde 404 a uno ajeno (ADR-20). El cuerpo no admite campos de más (.strict()).
import { Router } from "express";
import { z } from "zod";
import { requireExpedienteDeFamilia } from "../auth/expedienteDeFamilia";
import type { Almacenamiento } from "../almacenamiento";
import { registrarAccesoDenegado } from "../auth/requireRol";
import { ErrorApi } from "../errores";
import { esPregunta, LARGO_MAXIMO_RESPUESTA } from "../services/cuestionarioExpectativas";
import { leerDerecho, registrarDerecho } from "../services/derechoAdmision";
import {
  abrirArchivo,
  cargarDocumento,
  confirmarDocumentos,
  listarDocumentos,
  resolverDocumento,
  TIPO_CONTENIDO,
} from "../services/documentos";
import { guardarFicha, leerFicha, listaRequisitos, listarExpedientes } from "../services/fichaInscripcion";
import { LARGO_MAXIMO } from "../services/reglasSolicitud";
import { validar } from "../validacion";
import { recibirCarga } from "./multipart";

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

const esquemaConfirmacion = z.object({}).strict();

export function rutasFamilia(almacenamiento: Almacenamiento): Router {
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

  // ---- P06 · documentos (HU0006, ADR-21). Los archivos solo se descargan por aquí, nunca por una URL del almacenamiento.

  // GET /familia/expedientes/:id/documentos → 200 { editable, confirmado_en, requisitos: [{ …requisito, documentos }] }
  // · 404 · 409 FICHA_INCOMPLETA
  rutas.get("/expedientes/:id/documentos", async (req, res) => {
    res.json(await listarDocumentos(req.expedienteFamilia!));
  });

  // POST /familia/expedientes/:id/documentos · multipart: id_requisito, id_apoderado?, reemplaza?, y al final «archivo»
  // → 201 { id_documento, formato, tamano_kb, fecha_carga } (HU0006-1.0)
  // · 400 VALIDACION · 404 · 409 FICHA_INCOMPLETA o DOCUMENTOS_NO_EDITABLES
  // · 413 ARCHIVO_DEMASIADO_GRANDE y 415 FORMATO_NO_ADMITIDO (HU0006-2.0)
  rutas.post("/expedientes/:id/documentos", async (req, res) => {
    const e = req.expedienteFamilia!;
    res.status(201).json(await recibirCarga(req, (campos, archivo) => cargarDocumento(almacenamiento, e, campos, archivo)));
  });

  // POST /familia/expedientes/:id/documentos/confirmacion {} → 200 { confirmado_en } (HU0006-1.0: solicita la verificación)
  // · 404 · 409 FICHA_INCOMPLETA o DOCUMENTOS_NO_EDITABLES
  rutas.post("/expedientes/:id/documentos/confirmacion", async (req, res) => {
    validar(esquemaConfirmacion, req.body ?? {});
    res.json(await confirmarDocumentos(req.expedienteFamilia!));
  });

  // GET /familia/expedientes/:id/documentos/:idDoc/archivo → 200 con el archivo (ya descifrado y verificado)
  // · 404 DOCUMENTO_NO_ENCONTRADO (inexistente o de otra familia; el ajeno se audita) · 500 ARCHIVO_NO_DISPONIBLE
  rutas.get("/expedientes/:id/documentos/:idDoc/archivo", async (req, res) => {
    const e = req.expedienteFamilia!;
    const texto = String(req.params.idDoc);
    const idDoc = /^\d{1,10}$/.test(texto) ? Number(texto) : NaN;
    const documento = Number.isSafeInteger(idDoc) && idDoc > 0 && idDoc <= 2147483647 ? await resolverDocumento(e, idDoc) : { tipo: "inexistente" as const };
    if (documento.tipo === "ajeno") {
      await registrarAccesoDenegado(req, ["familia"], { idExpediente: e.id_expediente, detalle: { motivo: "documento_ajeno" } });
    }
    if (documento.tipo !== "propio") throw new ErrorApi(404, "DOCUMENTO_NO_ENCONTRADO", "El documento no existe");

    const contenido = await abrirArchivo(almacenamiento, idDoc, documento.clave);
    // Defensa contra que el navegador interprete el archivo como página: tipo fijo, sin sniffing, en sandbox y sin caché.
    res.set({
      "Content-Type": TIPO_CONTENIDO[documento.formato],
      "Content-Disposition": `inline; filename="documento-${idDoc}.${documento.formato}"`,
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "sandbox",
      "Cache-Control": "no-store",
    });
    contenido.pipe(res);
  });

  // ---- P07b · derecho de admisión (HU0007)

  // GET /familia/expedientes/:id/derecho-admision → 200 { version, monto, bancos, cuenta_colegio, registrable, pago }
  // (`pago` es la constancia si ya se registró) · 404
  rutas.get("/expedientes/:id/derecho-admision", async (req, res) => {
    res.json(await leerDerecho(req.expedienteFamilia!));
  });

  // POST /familia/expedientes/:id/derecho-admision · multipart: banco, numero_operacion, fecha_pago y al final «archivo»
  // → 201 constancia (HU0007-1.0) · 400 VALIDACION · 404
  // · 409 COMPROBANTE_DUPLICADO (HU0007-2.0), DERECHO_YA_REGISTRADO o DERECHO_NO_REGISTRABLE · 413 · 415
  rutas.post("/expedientes/:id/derecho-admision", async (req, res) => {
    const e = req.expedienteFamilia!;
    res.status(201).json(await recibirCarga(req, (campos, archivo) => registrarDerecho(almacenamiento, e, campos, archivo)));
  });

  return rutas;
}
