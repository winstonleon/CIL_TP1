// Resultados de las evaluaciones (G06 y G11) y dictamen de admisión (G06): HU0010 y HU0025, ADR-25.
// - Cada responsable registra el resultado de SUS citas (S3): expediente en_evaluacion, cita reservada y ya iniciada. La
//   cita pasa a asistio y se inserta Resultado_Evaluacion (una por cita). La inasistencia solo existe en la evaluación
//   académica (HU0025-2.0): la cita pasa a no_asistio con resultado «inasistencia» y se avisa a la familia, que la
//   reprograma en P08 (D2-A; services/evaluaciones.ts).
// - El dictamen exige, por cada evaluación del grado (`grado.requiere_*`, más la entrevista; C25 4), la cita vigente en
//   asistio con su resultado (S2, R13). Apto, En observación y No apto pasan el expediente con transicionarExpediente;
//   no_apto es final (D4d). Desde en_observacion, el nuevo dictamen actualiza la misma fila y deja el anterior, con sus
//   columnas de texto YA CIFRADAS, en atencion_fin.detalle.dictamen_anterior (D4a-A).
// - Cada decisión bloquea el expediente y después la cita (el orden de HU0009) y escribe la transición, el atencion_fin
//   (con id_evento_inicio) y el primer intento del aviso en la misma transacción. Los avisos (ADR-07) los envía
//   agendamiento → notificacion-multicanal sin ningún contenido del informe (C11).
import type { Readable } from "node:stream";
import { z } from "zod";
import type { Almacenamiento } from "../almacenamiento";
import { enTransaccion, obtenerPool, type Consultable } from "../db/pool";
import { ErrorApi } from "../errores";
import { insertarIntento } from "../repositories/aviso";
import {
  actualizarDictamen,
  agendaDelResponsable,
  bloquearDictamenGuardado,
  componentesDelExpediente,
  insertarDictamen,
  insertarResultado,
  leerCabeceraDictamen,
  leerCitaDelResponsable,
  leerDictamen,
  leerRequisitosDeObservacion,
  leerResultadoDeCita,
  marcarCita,
  type CitaDeAgenda,
  type DictamenGuardado,
  type TipoDictamen,
} from "../repositories/dictamen";
import { evaluacionesDelGrado, TIPO_DICTAMEN_NO_APTO, TIPO_DICTAMEN_OBSERVACION, TIPO_INASISTENCIA, type TipoEvaluacion } from "../repositories/evaluaciones";
import { bloquearFichaDeExpediente } from "../repositories/expediente";
import { registrarAtencionFin, registrarAtencionInicio } from "./atencion";
import { formatoPorFirma, type FormatoArchivo } from "./cargaArchivo";
import { RESPONSABLE_POR_TIPO } from "./configuracion";
import { abrirArchivo, guardarInspeccionado, quitarArchivo } from "./documentos";
import { transicionarExpediente } from "./expedientes/transicionarExpediente";
import { codigoExpediente } from "./fichaInscripcion";

export type RolEvaluador = "psicologa" | "evaluador_academico";

const ESTADO_EVALUACION = "en_evaluacion";
const ESTADO_OBSERVACION = "en_observacion";
const ESTADOS_FINALES: readonly string[] = ["apto", "no_apto"];
export const LARGO_MAXIMO_TEXTO = 4000; // conclusiones, requisitos y observaciones (validación técnica)
export const LARGO_MAXIMO_RESULTADO = 50; // Resultado_Evaluacion.resultado varchar(50); escala por definir (S4)
export const RESULTADO_INASISTENCIA = "inasistencia";

// Tipos de cita de cada rol (ADR-15, el mapa de G09): la psicóloga, jornada, psicológica y entrevista; el evaluador, la
// académica.
export const TIPOS_DEL_ROL: Record<RolEvaluador, TipoEvaluacion[]> = {
  psicologa: (Object.keys(RESPONSABLE_POR_TIPO) as (keyof typeof RESPONSABLE_POR_TIPO)[]).filter(
    (t): t is TipoEvaluacion => t !== "visita" && RESPONSABLE_POR_TIPO[t] === "psicologa",
  ),
  evaluador_academico: ["evaluacion_academica"],
};

const citaNoEncontrada = () => new ErrorApi(404, "CITA_NO_ENCONTRADA", "La cita no existe");
const expedienteNoEncontrado = () => new ErrorApi(404, "EXPEDIENTE_NO_ENCONTRADO", "El expediente no existe");
const resultadoYaRegistrado = () => new ErrorApi(409, "RESULTADO_YA_REGISTRADO", "El resultado de esta cita ya está registrado");
const citaNoIniciada = () => new ErrorApi(409, "CITA_NO_INICIADA", "El resultado se registra cuando la cita ya empezó");
const evaluacionNoCorresponde = () =>
  new ErrorApi(409, "EVALUACION_NO_CORRESPONDE", "La cita no admite un resultado en el estado actual del expediente");
const dictamenYaEmitido = () => new ErrorApi(409, "DICTAMEN_YA_EMITIDO", "El dictamen de este expediente ya está emitido");
const dictamenNoCorresponde = () =>
  new ErrorApi(409, "DICTAMEN_NO_CORRESPONDE", "El expediente no admite un dictamen en su estado actual");
const resultadosIncompletos = (faltan: TipoEvaluacion[]) =>
  new ErrorApi(409, "RESULTADOS_INCOMPLETOS", "Faltan los resultados de evaluaciones que exige el grado", faltan.map((tipo_cita) => ({ tipo_cita })));
const citasPendientes = (ids: number[]) =>
  new ErrorApi(409, "CITAS_PENDIENTES", "El expediente tiene citas de evaluación sin registrar", ids.map((id_cita) => ({ id_cita })));
const informeNoEncontrado = () => new ErrorApi(404, "INFORME_NO_ENCONTRADO", "El dictamen no tiene informe adjunto");

const itemCita = (idCita: number) => ({ tipo: "cita", id: idCita });
const itemDictamen = (idExpediente: number) => ({ tipo: "dictamen", id: idExpediente });

const postulante = (c: { postulante_nombres: string | null; postulante_apellidos: string | null }) => ({
  nombres: c.postulante_nombres,
  apellidos: c.postulante_apellidos,
});

function vistaAgenda(c: CitaDeAgenda) {
  return {
    id_cita: c.id_cita,
    id_expediente: c.id_expediente,
    codigo: codigoExpediente(c.campana, c.id_expediente),
    postulante: postulante(c),
    grado: c.grado,
    tipo_cita: c.tipo_cita,
    fecha: c.fecha,
    hora_inicio: c.hora_inicio,
    hora_fin: c.hora_fin,
    estado: c.estado,
    resultado_registrado: c.resultado_registrado,
  };
}

// ---------------------------------------------------------------- agenda y cita (G06 y G11)

// GET /psicologia/agenda y /evaluacion-academica/agenda: las citas del día del responsable de la sesión.
export async function agenda(rol: RolEvaluador, idPersonal: number, fecha: string) {
  const citas = await agendaDelResponsable(obtenerPool(), idPersonal, fecha, TIPOS_DEL_ROL[rol]);
  return { fecha, citas: citas.map(vistaAgenda) };
}

// La cita debe ser del responsable de la sesión y de un tipo de su rol: si no, 404 (no revela citas ajenas).
async function citaPropia(db: Consultable, rol: RolEvaluador, idPersonal: number, idCita: number, bloquear = false) {
  const cita = await leerCitaDelResponsable(db, idCita, bloquear);
  if (!cita || cita.id_personal !== idPersonal || !TIPOS_DEL_ROL[rol].includes(cita.tipo_cita)) throw citaNoEncontrada();
  return cita;
}

const esperaResultado = (c: { estado: string; estado_expediente: string }) => c.estado === "reservada" && c.estado_expediente === ESTADO_EVALUACION;

// GET …/citas/:id: el formulario de la cita. Abrirla registra atencion_inicio si espera el resultado (ADR-05). En G11 no
// devuelve nada del informe psicológico ni de la documentación financiera (R2, R3; HU0025-1.0): solo la cita y su propio
// resultado.
export async function detalleCita(rol: RolEvaluador, idPersonal: number, idCita: number) {
  const db = obtenerPool();
  const cita = await citaPropia(db, rol, idPersonal, idCita);
  if (esperaResultado(cita)) await registrarAtencionInicio(db, { idPersonal, idExpediente: cita.id_expediente, item: itemCita(idCita) });
  const r = await leerResultadoDeCita(db, idCita);
  return {
    ...vistaAgenda(cita),
    iniciada: cita.iniciada,
    registrable: esperaResultado(cita),
    resultado: r ? { resultado: r.resultado, observaciones: r.observaciones } : null,
  };
}

const textoObligatorio = z.string().trim().min(1).max(LARGO_MAXIMO_TEXTO);
export const esquemaResultado = z
  .object({ resultado: z.string().trim().min(1).max(LARGO_MAXIMO_RESULTADO), observaciones: textoObligatorio })
  .strict()
  .refine((r) => r.resultado.toLowerCase() !== RESULTADO_INASISTENCIA, {
    message: "La inasistencia se registra con «No asistió»",
    path: ["resultado"],
  });
export type EntradaResultado = z.infer<typeof esquemaResultado>;

type Decision = { estado: "asistio" | "no_asistio"; resultado: string; observaciones: string | null; aviso: string | null; decision: string };

async function decidirCita(rol: RolEvaluador, idPersonal: number, idCita: number, d: Decision) {
  const leida = await citaPropia(obtenerPool(), rol, idPersonal, idCita);
  return enTransaccion(async (c) => {
    // Orden de bloqueo: expediente y cita (HU0009). Se vuelve a leer la cita ya bloqueada.
    const bloqueo = await bloquearFichaDeExpediente(c, leida.id_expediente);
    if (!bloqueo) throw citaNoEncontrada();
    const cita = await citaPropia(c, rol, idPersonal, idCita, true);
    if (await leerResultadoDeCita(c, idCita)) throw resultadoYaRegistrado();
    if (bloqueo.estado !== ESTADO_EVALUACION || cita.estado !== "reservada") throw evaluacionNoCorresponde();
    if (!cita.iniciada) throw citaNoIniciada();

    await marcarCita(c, idCita, d.estado);
    const idResultado = await insertarResultado(c, { idCita, idPersonal, tipo: cita.tipo_cita, resultado: d.resultado, observaciones: d.observaciones });
    const idNotificacion = d.aviso ? await insertarIntento(c, { idExpediente: cita.id_expediente, tipoEvento: d.aviso, estadoEnvio: "pendiente" }) : null;
    await registrarAtencionFin(c, {
      idPersonal,
      idExpediente: cita.id_expediente,
      item: itemCita(idCita),
      decision: d.decision,
      extra: { id_resultado: idResultado, ...(idNotificacion !== null ? { id_notificacion: idNotificacion } : {}) },
    });
    return { id_cita: idCita, id_expediente: cita.id_expediente, estado: d.estado, id_notificacion: idNotificacion };
  });
}

// POST …/citas/:id/resultado (HU0025-1.0 en G11; S1 en G06): la cita pasa a asistio y el resultado queda a disposición
// de la psicóloga para el dictamen.
export async function registrarResultado(rol: RolEvaluador, idPersonal: number, idCita: number, e: EntradaResultado) {
  const { id_notificacion: _sinAviso, ...r } = await decidirCita(rol, idPersonal, idCita, {
    estado: "asistio",
    resultado: e.resultado,
    observaciones: e.observaciones,
    aviso: null,
    decision: "resultado",
  });
  return r;
}

// POST /evaluacion-academica/citas/:id/inasistencia (HU0025-2.0): libera la cita (no_asistio) y reserva el primer intento
// del aviso a la familia para que la reprograme.
export async function registrarInasistencia(idPersonal: number, idCita: number) {
  return decidirCita("evaluador_academico", idPersonal, idCita, {
    estado: "no_asistio",
    resultado: RESULTADO_INASISTENCIA,
    observaciones: null,
    aviso: TIPO_INASISTENCIA,
    decision: "inasistencia",
  });
}

// ---------------------------------------------------------------- dictamen (G06)

interface Condicion {
  exigidas: TipoEvaluacion[];
  faltan: TipoEvaluacion[];
  pendientes: number[]; // citas vigentes todavía reservadas
}

// S2 y C25 (4): cada evaluación del grado tiene su cita vigente en asistio con resultado.
async function condicionDelDictamen(db: Consultable, idExpediente: number, componentes: Awaited<ReturnType<typeof componentesDelExpediente>>): Promise<Condicion> {
  const exigidas = await evaluacionesDelGrado(db, idExpediente);
  const faltan = exigidas.filter((t) => {
    const c = componentes.find((x) => x.tipo_cita === t);
    return !c || c.estado !== "asistio" || c.resultado === null;
  });
  return { exigidas, faltan, pendientes: componentes.filter((c) => c.estado === "reservada").map((c) => c.id_cita) };
}

// GET /psicologia/expedientes/:id/dictamen: los componentes de la evaluación (con el resultado académico, HU0025-1.0) y el
// dictamen. Solo `abrir` (la psicóloga abre el panel del dictamen en G06) registra atencion_inicio, si espera la decisión:
// en evaluación con todos los resultados, o en observación (ADR-05, ADR-25). Una recarga no abre un ítem: el cycle time de
// HU0019 se mide desde la apertura real del panel.
export async function detalleDictamen(idPersonal: number, idExpediente: number, abrir = false) {
  const db = obtenerPool();
  const cabecera = await leerCabeceraExpediente(idExpediente);
  if (![ESTADO_EVALUACION, ESTADO_OBSERVACION, ...ESTADOS_FINALES].includes(cabecera.estado)) throw dictamenNoCorresponde();
  const componentes = await componentesDelExpediente(db, idExpediente);
  const condicion = await condicionDelDictamen(db, idExpediente, componentes);
  const dictamen = await leerDictamen(db, idExpediente);
  const habilitado =
    (cabecera.estado === ESTADO_EVALUACION && condicion.faltan.length === 0) || cabecera.estado === ESTADO_OBSERVACION;
  if (abrir && habilitado) await registrarAtencionInicio(db, { idPersonal, idExpediente, item: itemDictamen(idExpediente) });
  return {
    id_expediente: idExpediente,
    codigo: codigoExpediente(cabecera.campana, idExpediente),
    postulante: postulante(cabecera),
    grado: cabecera.grado,
    edad: cabecera.edad,
    estado: cabecera.estado,
    exigidas: condicion.exigidas,
    faltan: condicion.faltan,
    componentes: componentes.map((c) => ({
      id_cita: c.id_cita,
      tipo_cita: c.tipo_cita,
      estado: c.estado,
      fecha: c.fecha,
      hora_inicio: c.hora_inicio,
      resultado: c.resultado,
      observaciones: c.observaciones,
    })),
    habilitado,
    // En observación solo se admite el nuevo dictamen Apto o No apto (D4a-A).
    opciones: cabecera.estado === ESTADO_OBSERVACION ? ["apto", "no_apto"] : cabecera.estado === ESTADO_EVALUACION ? ["apto", "en_observacion", "no_apto"] : [],
    dictamen: dictamen
      ? {
          dictamen: dictamen.dictamen,
          conclusiones: dictamen.conclusiones,
          requisitos_complementarios: dictamen.requisitos_complementarios,
          tiene_informe: dictamen.informe_url !== null,
          fecha_emision: dictamen.fecha_emision.toISOString(),
        }
      : null,
  };
}

async function leerCabeceraExpediente(idExpediente: number) {
  const c = await leerCabeceraDictamen(obtenerPool(), idExpediente);
  if (!c) throw expedienteNoEncontrado();
  return c;
}

export const esquemaDictamen = z
  .object({
    dictamen: z.enum(["apto", "en_observacion", "no_apto"]),
    conclusiones: textoObligatorio,
    requisitos_complementarios: textoObligatorio.optional(),
  })
  .strict()
  .refine((d) => (d.dictamen === "en_observacion") === (d.requisitos_complementarios !== undefined), {
    message: "Los requisitos complementarios van solo, y siempre, con el dictamen En observación",
    path: ["requisitos_complementarios"],
  });

const AVISO_DEL_DICTAMEN: Record<TipoDictamen, string | null> = {
  apto: null, // D3-A: sin aviso; la Dirección lo ve en G07 (HU0012)
  en_observacion: TIPO_DICTAMEN_OBSERVACION,
  no_apto: TIPO_DICTAMEN_NO_APTO,
};

// Estado del expediente y dictamen pedido: ¿se admite? (en_evaluacion → cualquiera; en_observacion → apto o no_apto).
function verificarEstadoDelDictamen(estado: string, dictamen: TipoDictamen) {
  if (ESTADOS_FINALES.includes(estado)) throw dictamenYaEmitido();
  if (estado === ESTADO_OBSERVACION && dictamen === "en_observacion") throw dictamenYaEmitido();
  if (estado !== ESTADO_EVALUACION && estado !== ESTADO_OBSERVACION) throw dictamenNoCorresponde();
}

// Copia del dictamen reemplazado para la auditoría: columnas de texto tal como están guardadas (cifradas, ADR-03).
const copiaParaAuditoria = (d: DictamenGuardado) => ({
  dictamen: d.dictamen,
  conclusiones: d.conclusiones,
  requisitos_complementarios: d.requisitos_complementarios,
  informe_url: d.informe_url,
  fecha_emision: d.fecha_emision.toISOString(),
});

// POST /psicologia/expedientes/:id/dictamen · multipart: dictamen, conclusiones, requisitos_complementarios y, opcional,
// «archivo» (el informe, guardado cifrado como los documentos, ADR-21).
export async function emitirDictamen(
  almacenamiento: Almacenamiento,
  idPersonal: number,
  idExpediente: number,
  campos: Record<string, string>,
  archivo: Readable | null,
) {
  const entrada = z.safeParse(esquemaDictamen, campos);
  if (!entrada.success) {
    archivo?.resume();
    const nombres = [...new Set(entrada.error.issues.map((i) => i.path.join(".") || "cuerpo"))].join(", ");
    throw new ErrorApi(400, "VALIDACION", `Datos inválidos: ${nombres}`);
  }
  const d = entrada.data;
  // Antes de recibir el archivo: un dictamen que no corresponde no sube nada (se vuelve a verificar con el bloqueo).
  const previo = await leerCabeceraExpediente(idExpediente).catch((e: unknown) => {
    archivo?.resume();
    throw e;
  });
  try {
    verificarEstadoDelDictamen(previo.estado, d.dictamen);
  } catch (e) {
    archivo?.resume();
    throw e;
  }

  const guardado = archivo ? await guardarInspeccionado(almacenamiento, archivo) : null;
  try {
    return await enTransaccion(async (c) => {
      const bloqueo = await bloquearFichaDeExpediente(c, idExpediente);
      if (!bloqueo) throw expedienteNoEncontrado();
      verificarEstadoDelDictamen(bloqueo.estado, d.dictamen);
      const componentes = await componentesDelExpediente(c, idExpediente);
      const condicion = await condicionDelDictamen(c, idExpediente, componentes);
      if (condicion.faltan.length) throw resultadosIncompletos(condicion.faltan);
      if (d.dictamen === "no_apto" && condicion.pendientes.length) throw citasPendientes(condicion.pendientes);

      const anterior = await bloquearDictamenGuardado(c, idExpediente);
      const datos = {
        idExpediente,
        idPersonal,
        dictamen: d.dictamen,
        conclusiones: d.conclusiones,
        requisitosComplementarios: d.requisitos_complementarios ?? null,
        informeUrl: guardado?.clave ?? null,
      };
      const idDictamen = anterior ? await actualizarDictamen(c, datos) : await insertarDictamen(c, datos);
      const aviso = AVISO_DEL_DICTAMEN[d.dictamen];
      const idNotificacion = aviso ? await insertarIntento(c, { idExpediente, tipoEvento: aviso, estadoEnvio: "pendiente" }) : null;
      await transicionarExpediente(c, {
        idExpediente,
        campo: "estado",
        esperado: bloqueo.estado,
        nuevo: d.dictamen,
        idPersonal,
        detalle: { id_dictamen: idDictamen, ...(idNotificacion !== null ? { id_notificacion: idNotificacion } : {}) },
      });
      await registrarAtencionFin(c, {
        idPersonal,
        idExpediente,
        item: itemDictamen(idExpediente),
        decision: d.dictamen,
        extra: { id_dictamen: idDictamen, ...(anterior ? { dictamen_anterior: copiaParaAuditoria(anterior) } : {}) },
      });
      return { id_expediente: idExpediente, estado: d.dictamen, dictamen: d.dictamen, tiene_informe: guardado !== null || anterior?.informe_url != null, id_notificacion: idNotificacion };
    });
  } catch (error) {
    if (guardado) await quitarArchivo(almacenamiento, guardado.clave);
    throw error;
  }
}

// GET /psicologia/expedientes/:id/dictamen/informe: el informe descifrado y verificado en memoria (ADR-03); el formato
// sale de su firma, como el comprobante del derecho (Dictamen_Admision no guarda el formato).
export async function abrirInforme(almacenamiento: Almacenamiento, idExpediente: number): Promise<{ formato: FormatoArchivo; contenido: Buffer }> {
  const dictamen = await leerDictamen(obtenerPool(), idExpediente);
  if (!dictamen?.informe_url) throw informeNoEncontrado();
  const flujo = await abrirArchivo(almacenamiento, dictamen.id_dictamen, dictamen.informe_url);
  const partes: Buffer[] = [];
  for await (const parte of flujo) partes.push(parte as Buffer);
  const contenido = Buffer.concat(partes);
  const formato = formatoPorFirma(contenido.subarray(0, 16));
  if (!formato) {
    console.error(`Informe con formato no reconocido: dictamen ${dictamen.id_dictamen}`);
    throw new ErrorApi(500, "ARCHIVO_NO_DISPONIBLE", "No se pudo leer el archivo");
  }
  return { formato, contenido };
}

// ---------------------------------------------------------------- Secretaría (G03)

// GET /bandeja/expedientes/:id/requisitos-complementarios (R13, D4b-B): solo los requisitos del dictamen En observación,
// sin las conclusiones ni el informe (R3). Es una lectura: no abre un ítem de atención.
export async function requisitosComplementarios(idExpediente: number) {
  const r = await leerRequisitosDeObservacion(obtenerPool(), idExpediente);
  if (!r) throw new ErrorApi(404, "REQUISITOS_NO_ENCONTRADOS", "El expediente no tiene un dictamen en observación");
  return {
    id_expediente: r.id_expediente,
    codigo: codigoExpediente(r.campana, r.id_expediente),
    postulante: postulante(r),
    grado: r.grado,
    requisitos_complementarios: r.requisitos_complementarios,
    fecha_emision: r.fecha_emision.toISOString(),
  };
}
