// /familia — portal de la familia (pantallas P05 y P05b, HU0005). El router se monta en app.ts detrás de verificarToken
// y requireRol("familia"). Los ids de expediente salen solo de la URL y del token, y la familia solo accede al suyo:
// requireExpedienteDeFamilia responde 404 a uno ajeno (ADR-20). El cuerpo no admite campos de más (.strict()).
import { Router } from "express";
import { z } from "zod";
import { requireExpedienteDeFamilia } from "../auth/expedienteDeFamilia";
import type { Almacenamiento } from "../almacenamiento";
import type { DisparadorN8n } from "../orquestacion/n8n";
import { registrarAccesoDenegado } from "../auth/requireRol";
import { ErrorApi } from "../errores";
import { esPregunta, LARGO_MAXIMO_RESPUESTA } from "../services/cuestionarioExpectativas";
import { leerDerecho, registrarDerecho, subsanarDerecho } from "../services/derechoAdmision";
import {
  abrirArchivo,
  cargarDocumento,
  confirmarDocumentos,
  listarDocumentos,
  resolverDocumento,
  TIPO_CONTENIDO,
} from "../services/documentos";
import { TIPOS_EVALUACION, type TipoEvaluacion } from "../repositories/evaluaciones";
import { confirmarCitas, leerEvaluaciones, reprogramarCita, resolverCita } from "../services/evaluaciones";
import { abrirCarta } from "../services/cartaVacante";
import { elegirModalidad, esquemaModalidad, leerCuota, registrarCuota, subsanarCuota } from "../services/cuotaIngreso";
import { guardarFicha, leerFicha, listaRequisitos, listarExpedientes } from "../services/fichaInscripcion";
import { leerPanel } from "../services/panelSeguimiento";
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

// P08 (HU0009): un turno por evaluación; los tipos y los horarios los valida el servicio contra el grado.
const idHorario = z.number().int().positive().max(2147483647);
const esquemaCitas = z
  .object({
    horarios: z
      .array(z.object({ tipo_cita: z.enum(TIPOS_EVALUACION as [TipoEvaluacion, ...TipoEvaluacion[]]), id_horario: idHorario }).strict())
      .min(1)
      .max(TIPOS_EVALUACION.length),
  })
  .strict();
const esquemaReprogramacion = z.object({ id_horario: idHorario }).strict();

export function rutasFamilia(almacenamiento: Almacenamiento, eventos: DisparadorN8n, campana: string): Router {
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

  // GET /familia/expedientes/:id/documentos → 200 { editable, confirmado_en, verificacion, requisitos: [{ …requisito, documentos }] }
  // · 404 · 409 FICHA_INCOMPLETA
  rutas.get("/expedientes/:id/documentos", async (req, res) => {
    res.json(await listarDocumentos(req.expedienteFamilia!));
  });

  // POST /familia/expedientes/:id/documentos · multipart: id_requisito, id_apoderado?, reemplaza?, y al final «archivo»
  // → 201 { id_documento, formato, tamano_kb, fecha_carga } (HU0006-1.0; en en_validacion, solo el reemplazo de un
  // documento observado: HU0008-2.0 y HU0011-2.0, A1)
  // · 400 VALIDACION · 404 · 409 FICHA_INCOMPLETA, DOCUMENTOS_NO_EDITABLES o DOCUMENTO_NO_OBSERVADO
  // · 413 ARCHIVO_DEMASIADO_GRANDE y 415 FORMATO_NO_ADMITIDO (HU0006-2.0)
  rutas.post("/expedientes/:id/documentos", async (req, res) => {
    const e = req.expedienteFamilia!;
    res.status(201).json(await recibirCarga(req, (campos, archivo) => cargarDocumento(almacenamiento, e, campos, archivo)));
  });

  // POST /familia/expedientes/:id/documentos/confirmacion {} → 200 { confirmado_en } (HU0006-1.0: solicita la verificación)
  // · 404 · 409 FICHA_INCOMPLETA, DOCUMENTOS_NO_EDITABLES o SIN_CAMBIOS (HU0017-2.0, ADR-22)
  rutas.post("/expedientes/:id/documentos/confirmacion", async (req, res) => {
    validar(esquemaConfirmacion, req.body ?? {});
    const e = req.expedienteFamilia!;
    res.json(await confirmarDocumentos(e));
    // ADR-16 (HU0017): después del COMMIT y de responder; disparar() nunca rechaza y la familia no espera a n8n.
    void eventos.disparar("recepcion-registro", { id_expediente: e.id_expediente });
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

  // PUT /familia/expedientes/:id/derecho-admision · multipart: banco, numero_operacion, fecha_pago y al final «archivo»
  // → 200 como el GET, con el pago de vuelta en `pendiente` (HU0024-2.0, subsanación A1) · 400 VALIDACION · 404
  // · 409 DERECHO_NO_SUBSANABLE o COMPROBANTE_DUPLICADO · 413 · 415
  rutas.put("/expedientes/:id/derecho-admision", async (req, res) => {
    const e = req.expedienteFamilia!;
    res.json(await recibirCarga(req, (campos, archivo) => subsanarDerecho(almacenamiento, e, campos, archivo)));
  });

  // ---- P07 · cuota de ingreso (HU0013, HU0014 y HU0015-2.0)

  // GET /familia/expedientes/:id/cuota-ingreso → 200 { disponible, aplica, nivel, grado, monto, max_fracciones, modalidad,
  // numero_fracciones, montos, bancos, cuenta_colegio, modalidad_editable, registrable, pago, derecho } · 404
  rutas.get("/expedientes/:id/cuota-ingreso", async (req, res) => {
    res.json(await leerCuota(req.expedienteFamilia!));
  });

  // POST /familia/expedientes/:id/cuota-ingreso/modalidad { modalidad: "unico" } | { modalidad: "fraccionado",
  // numero_fracciones } → 200 como el GET (HU0013-1.0) · 400 · 404 · 409 MODALIDAD_NO_CORRESPONDE, MODALIDAD_YA_ELEGIDA o
  // CUOTA_NO_APLICA · 422 FRACCIONES_NO_PERMITIDAS con detalle { maximo } (HU0013-2.0)
  rutas.post("/expedientes/:id/cuota-ingreso/modalidad", async (req, res) => {
    res.json(await elegirModalidad(req.expedienteFamilia!, validar(esquemaModalidad, req.body)));
  });

  // POST /familia/expedientes/:id/cuota-ingreso · multipart: banco, numero_operacion, fecha_pago, monto y al final «archivo»
  // → 201 como el GET, con la cuota en conciliación (HU0014-1.0) · 400 VALIDACION · 404 · 409 COMPROBANTE_DUPLICADO,
  // CUOTA_YA_REGISTRADA, CUOTA_NO_REGISTRABLE o CUOTA_NO_APLICA · 413 · 415 (HU0014-2.0)
  rutas.post("/expedientes/:id/cuota-ingreso", async (req, res) => {
    const e = req.expedienteFamilia!;
    const { id_notificacion, cuota } = await recibirCarga(req, (campos, archivo) => registrarCuota(almacenamiento, e, campos, archivo));
    res.status(201).json(cuota);
    // ADR-16: después del COMMIT y de responder; solo ids (C11). disparar() nunca rechaza.
    void eventos.disparar("agendamiento", { id_expediente: e.id_expediente, id_notificacion });
  });

  // PUT /familia/expedientes/:id/cuota-ingreso · multipart: como el POST → 200 como el GET, con la cuota de vuelta en
  // conciliación (HU0015-2.0, subsanación A1) · 400 VALIDACION · 404 · 409 CUOTA_NO_SUBSANABLE o COMPROBANTE_DUPLICADO · 413 · 415
  rutas.put("/expedientes/:id/cuota-ingreso", async (req, res) => {
    const e = req.expedienteFamilia!;
    res.json(await recibirCarga(req, (campos, archivo) => subsanarCuota(almacenamiento, e, campos, archivo)));
  });

  // ---- P04 · panel de seguimiento (HU0020) y Carta de Vacante (HU0016)

  // GET /familia/expedientes/:id/panel → 200 { etapas: [{ clave, titulo, estado }], validaciones: { documental, financiera,
  // derecho }, acciones: [{ tipo, titulo, motivo?, destino? }], historial: [{ fecha, texto }], carta: { disponible,
  // fecha_emision } } · 404. Solo lee: el historial es una lista blanca, nunca `detalle` (ADR-29).
  rutas.get("/expedientes/:id/panel", async (req, res) => {
    res.json(await leerPanel(req.expedienteFamilia!));
  });

  // La única salida del PDF hacia la familia, con sesión y solo de su expediente (D1-A).

  // GET /familia/expedientes/:id/carta → 200 PDF (ya descifrado y verificado) · 404 CARTA_NO_ENCONTRADA · 500 ARCHIVO_NO_DISPONIBLE
  rutas.get("/expedientes/:id/carta", async (req, res) => {
    const e = req.expedienteFamilia!;
    const { codigo, contenido } = await abrirCarta(almacenamiento, e.id_expediente, e.campana_admision);
    res.set({
      "Content-Type": TIPO_CONTENIDO.pdf,
      "Content-Disposition": `attachment; filename="carta-vacante-${codigo}.pdf"`,
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "sandbox",
      "Cache-Control": "no-store",
    });
    res.send(contenido);
  });

  // ---- P08 · evaluaciones (HU0009)

  // GET /familia/expedientes/:id/evaluaciones → 200 { modo: "bloqueado" | "agendar" | "agendadas", grado,
  // min_horas_reprogramacion, evaluaciones: [{ tipo_cita, cita, horarios: [{ id_horario, fecha, hora_inicio, hora_fin,
  // disponible }] }] } · 404
  rutas.get("/expedientes/:id/evaluaciones", async (req, res) => {
    res.json(await leerEvaluaciones(req.expedienteFamilia!, campana));
  });

  // POST /familia/expedientes/:id/evaluaciones { horarios: [{ tipo_cita, id_horario }] } («Confirmar citas»)
  // → 201 { estado: "en_evaluacion", citas } (HU0009-1.0) · 400 · 404 · 409 AGENDAMIENTO_NO_HABILITADO,
  // EVALUACIONES_YA_AGENDADAS, HORARIO_SIN_CUPO o HORARIO_NO_DISPONIBLE (con detalle [{ id_horario }])
  // · 422 EVALUACIONES_NO_CORRESPONDEN u ORDEN_DE_CITAS
  rutas.post("/expedientes/:id/evaluaciones", async (req, res) => {
    const { horarios } = validar(esquemaCitas, req.body);
    const e = req.expedienteFamilia!;
    const { id_notificacion, ...cuerpo } = await confirmarCitas(e, horarios, campana);
    res.status(201).json(cuerpo);
    // ADR-16: después del COMMIT y de responder; disparar() nunca rechaza y la familia no espera a n8n.
    void eventos.disparar("agendamiento", { id_expediente: e.id_expediente, id_notificacion });
  });

  // POST /familia/expedientes/:id/citas/:idCita/reprogramacion { id_horario } → 200 { cita } (HU0009-2.0) · 400
  // · 404 CITA_NO_ENCONTRADA (inexistente o de otra familia; la ajena se audita) · 409 CITA_NO_REPROGRAMABLE,
  // HORARIO_SIN_CUPO o HORARIO_NO_DISPONIBLE · 422 PLAZO_REPROGRAMACION_VENCIDO u ORDEN_DE_CITAS
  rutas.post("/expedientes/:id/citas/:idCita/reprogramacion", async (req, res) => {
    const e = req.expedienteFamilia!;
    const texto = String(req.params.idCita);
    const idCita = /^\d{1,10}$/.test(texto) ? Number(texto) : NaN;
    const valido = Number.isSafeInteger(idCita) && idCita > 0 && idCita <= 2147483647;
    const tipo = valido ? await resolverCita(e, idCita) : "inexistente";
    if (tipo === "ajena") {
      await registrarAccesoDenegado(req, ["familia"], { idExpediente: e.id_expediente, detalle: { motivo: "cita_ajena" } });
    }
    if (tipo !== "propia") throw new ErrorApi(404, "CITA_NO_ENCONTRADA", "La cita no existe");
    const { id_horario } = validar(esquemaReprogramacion, req.body);
    const { avisos, ...cuerpo } = await reprogramarCita(e, idCita, id_horario, campana);
    res.json(cuerpo);
    for (const id_notificacion of avisos) void eventos.disparar("agendamiento", { id_expediente: e.id_expediente, id_notificacion });
  });

  return rutas;
}
