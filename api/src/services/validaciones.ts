// Validaciones en paralelo del expediente en en_validacion (HU0008, HU0011 y HU0024; R9; plan del bloque 5):
// - documental (Secretaría, G03) y financiera (Tesorería, G05): cada documento vigente de la rama se marca conforme u
//   observado; «Dar conformidad» / «Marcar conforme» pasa la rama de `pendiente` a `conforme` con todos conformes; la
//   primera observación la pasa a `observado` (la familia la subsana, A1);
// - derecho de admisión (Tesorería, G05): el Pago `derecho_admision` pasa a `conforme` u `observado`.
// Cada decisión bloquea el expediente (el mismo bloqueo de la carga de la familia) y, en la misma transacción, evalúa la
// unión: si las tres ramas quedan conformes, el atencion_fin de esa decisión lleva `habilita_agendamiento` (B1). Con el
// bloqueo, solo la última decisión ve las tres conformes: la unión se registra una vez. «Habilitado» es la condición
// derivada (en_validacion con las tres conformes): HU0009 hace en_validacion → en_evaluacion.
// Una decisión sobre un ítem ya decidido (otra persona del mismo rol) responde 409 y no pisa la anterior.
// Tiempo de atención (ADR-05, §4.7): atencion_inicio al abrir el ítem y atencion_fin emparejado al decidir.
// Una observación reserva el primer intento del aviso por notificacion-multicanal (ADR-07); n8n lo envía.
// Conciliación de la cuota de ingreso (HU0015): el mismo camino del comprobante del derecho, por `tipo_pago`. La cuota exige
// `vacante_asignada` y no evalúa la unión; `cuota_acreditada` en su atencion_fin es solo trazabilidad, y la ruta despierta a
// generacion-carta, que decide con los datos (C62).
import type { Readable } from "node:stream";
import type { Almacenamiento } from "../almacenamiento";
import { enTransaccion, obtenerPool, type Consultable } from "../db/pool";
import { ErrorApi } from "../errores";
import { leerCuotaDeExpediente } from "../repositories/adjudicacion";
import { insertarIntento } from "../repositories/aviso";
import { bloquearFichaDeExpediente, leerDatosFamilia } from "../repositories/expediente";
import {
  bloquearDocumentoDeExpediente,
  bloquearIntentosObservacion,
  bloquearPago,
  condicionesLaborales,
  contarNoConformes,
  documentosDeRama,
  leerCabecera,
  leerDocumentoDeExpediente,
  leerPago,
  listarBandeja,
  listarCuotasTesoreria,
  listarObservacionesPendientes,
  listarTesoreria,
  observacionesVigentes,
  primerIntentoUltimaObservacion,
  ramasConformes,
  registrarDecisionDocumento,
  registrarDecisionPago,
  TIPO_OBSERVACION,
  type Cabecera,
  type DocumentoDeRama,
  type PagoValidable,
  type Rama,
  type VistaBandeja,
} from "../repositories/validacion";
import { avisoAgotado, decidir, MAXIMO_PENDIENTES, MINUTOS_REINTENTO } from "./agendamiento";
import { registrarAtencionFin, registrarAtencionInicio } from "./atencion";
import { componerObservaciones } from "./avisosValidacion";
import { montosDeFracciones } from "./montosCuota";
import { formatoPorFirma, type FormatoArchivo } from "./cargaArchivo";
import { abrirArchivo } from "./documentos";
import { transicionarExpediente, type CampoEstado } from "./expedientes/transicionarExpediente";
import { codigoExpediente } from "./fichaInscripcion";
import { itemDePago, itemDeRama } from "./subsanacion";

export type { Rama };
export const ESTADO_VALIDACION = "en_validacion";
export const LARGO_MAXIMO_MOTIVO = 500;
// Estado del expediente en el que Tesorería decide cada pago.
const ESTADO_DEL_PAGO = { derecho_admision: ESTADO_VALIDACION, cuota_ingreso: "vacante_asignada" } as const;

const CAMPO: Record<Rama, CampoEstado> = { documental: "estado_documental", financiera: "estado_financiero" };
const estadoDeRama = (c: Cabecera, rama: Rama) => (rama === "documental" ? c.estado_documental : c.estado_financiero);

const expedienteNoEncontrado = () => new ErrorApi(404, "EXPEDIENTE_NO_ENCONTRADO", "El expediente no existe");
const noCorresponde = () => new ErrorApi(409, "VALIDACION_NO_CORRESPONDE", "El expediente no está en validación");
const documentoNoEncontrado = () => new ErrorApi(404, "DOCUMENTO_NO_ENCONTRADO", "El documento no existe");
const pagoNoEncontrado = () => new ErrorApi(404, "PAGO_NO_ENCONTRADO", "El pago no existe");
const yaRevisado = (estado: string) =>
  new ErrorApi(409, "DOCUMENTO_YA_REVISADO", "Otra persona ya revisó este documento; vuelve a cargar el expediente", { estado_verificacion: estado });
const yaRegistrada = () => new ErrorApi(409, "VALIDACION_YA_REGISTRADA", "Esta validación ya está conforme");
const sinRevisar = (n: number) =>
  new ErrorApi(409, "DOCUMENTOS_SIN_REVISAR", "Marca cada documento como conforme antes de dar la conformidad", { pendientes: n });
const pagoYaValidado = (estado: string) =>
  new ErrorApi(409, "PAGO_YA_VALIDADO", "Otra persona ya validó este comprobante; vuelve a cargarlo", { estado_validacion: estado });

export type Decision = { decision: "conforme" } | { decision: "observado"; motivo: string };

// ---------------------------------------------------------------- lectura

const nombrePostulante = (c: Cabecera) => ({
  nombres: c.postulante_nombres,
  apellidos: [c.postulante_apellido_paterno, c.postulante_apellido_materno].filter(Boolean).join(" ") || null,
});

const ramas = (c: Cabecera) => ({ documental: c.estado_documental, financiera: c.estado_financiero, derecho: c.estado_derecho });

// Motivo vigente solo si el ítem está observado; el de una observación ya subsanada se muestra como «motivo anterior».
const documentoVisible = (d: DocumentoDeRama) => ({
  id_documento: d.id_documento,
  id_requisito: d.id_requisito,
  tipo_documento: d.tipo_documento,
  categoria: d.categoria,
  parentesco: d.parentesco,
  formato: d.formato,
  tamano_kb: d.tamano_kb,
  fecha_carga: d.fecha_carga.toISOString(),
  estado_verificacion: d.estado_verificacion,
  motivo_observacion: d.estado_verificacion === "observado" ? d.motivo_observacion : null,
  motivo_anterior: d.estado_verificacion === "pendiente" ? d.motivo_anterior : null,
});

async function cabeceraEnValidacion(db: Consultable, idExpediente: number): Promise<Cabecera> {
  const c = await leerCabecera(db, idExpediente);
  if (!c) throw expedienteNoEncontrado();
  if (c.estado !== ESTADO_VALIDACION) throw noCorresponde();
  return c;
}

// La rama espera una decisión del personal si está pendiente o tiene algún documento por revisar. Una rama observada sin
// documentos por revisar espera a la familia: abrirla no abre un ítem de atención (ADR-23, §4.7).
const esperaDecision = (estado: string, documentos: DocumentoDeRama[]) =>
  estado === "pendiente" || (estado === "observado" && documentos.some((d) => d.estado_verificacion === "pendiente"));

const condicionHabilitada = (c: Cabecera) =>
  c.estado === ESTADO_VALIDACION && c.estado_documental === "conforme" && c.estado_financiero === "conforme" && c.estado_derecho === "conforme";

// Detalle de una rama de documentos (G03 documental, G05 financiera). Abrirlo registra atencion_inicio si la rama todavía
// espera una decisión. G03 nunca recibe los documentos financieros (R2): cada rama lee solo sus categorías.
export async function detalleRama(rama: Rama, idExpediente: number, idPersonal: number) {
  const db = obtenerPool();
  const c = await cabeceraEnValidacion(db, idExpediente);
  const documentos = await documentosDeRama(db, idExpediente, rama);
  if (esperaDecision(estadoDeRama(c, rama), documentos)) {
    await registrarAtencionInicio(db, { idPersonal, idExpediente, item: itemDeRama(rama, idExpediente) });
  }
  return {
    id_expediente: idExpediente,
    codigo: codigoExpediente(c.campana_admision, idExpediente),
    grado: c.nombre_grado,
    postulante: nombrePostulante(c),
    apoderado: { nombres: c.apoderado_nombres, apellidos: c.apoderado_apellidos, ...(rama === "documental" ? { telefono: c.apoderado_telefono } : {}) },
    ramas: ramas(c),
    agendamiento_habilitado: condicionHabilitada(c),
    ...(rama === "financiera" ? { condiciones_laborales: await condicionesLaborales(db, idExpediente) } : {}),
    documentos: documentos.map(documentoVisible),
  };
}

export type DocumentoResueltoPersonal = { tipo: "de_rama"; formato: FormatoArchivo; clave: string } | { tipo: "otra_rama" } | { tipo: "inexistente" };

// ¿El documento es de este expediente y de esta rama? La ruta de Secretaría audita como acceso_denegado el intento sobre
// un documento financiero (R2, HU0021-2.0); la de Tesorería responde 404 a uno no financiero.
export async function resolverDocumentoDeRama(rama: Rama, idExpediente: number, idDocumento: number): Promise<DocumentoResueltoPersonal> {
  const d = await leerDocumentoDeExpediente(obtenerPool(), idDocumento, idExpediente);
  if (!d?.vigente) return { tipo: "inexistente" };
  const esFinanciero = d.categoria === "financiero";
  if (esFinanciero !== (rama === "financiera")) return { tipo: "otra_rama" };
  return { tipo: "de_rama", formato: d.formato as FormatoArchivo, clave: d.url_archivo };
}

// ---------------------------------------------------------------- decisiones de documentos

type ResultadoDecision = {
  documento: { id_documento: number; estado_verificacion: string };
  rama: string;
  id_notificacion: number | null;
};

// Marca un documento como conforme u observado («Solicitar subsanación»). La observación pasa la rama a `observado` (si
// estaba `pendiente`), cierra la atención del ítem y reserva el primer intento del aviso, todo en la misma transacción.
export async function decidirDocumento(rama: Rama, idExpediente: number, idDocumento: number, idPersonal: number, d: Decision): Promise<ResultadoDecision> {
  return enTransaccion(async (c) => {
    const bloqueo = await bloquearFichaDeExpediente(c, idExpediente);
    if (!bloqueo) throw expedienteNoEncontrado();
    if (bloqueo.estado !== ESTADO_VALIDACION) throw noCorresponde();
    const doc = await bloquearDocumentoDeExpediente(c, idDocumento, idExpediente);
    if (!doc || !doc.vigente || (doc.categoria === "financiero") !== (rama === "financiera")) throw documentoNoEncontrado();
    const cab = (await leerCabecera(c, idExpediente))!;
    const estadoRama = estadoDeRama(cab, rama);
    if (estadoRama === "conforme") throw yaRegistrada();
    if (doc.estado_verificacion !== "pendiente") throw yaRevisado(doc.estado_verificacion);

    const motivo = d.decision === "observado" ? d.motivo : null;
    await registrarDecisionDocumento(c, { idDocumento, estado: d.decision, motivo, idPersonal });
    if (d.decision === "conforme") {
      return { documento: { id_documento: idDocumento, estado_verificacion: "conforme" }, rama: estadoRama, id_notificacion: null };
    }
    if (estadoRama === "pendiente") {
      await transicionarExpediente(c, {
        idExpediente,
        campo: CAMPO[rama],
        esperado: "pendiente",
        nuevo: "observado",
        idPersonal,
        detalle: { id_documento: idDocumento },
      });
    }
    const idNotificacion = await insertarIntento(c, { idExpediente, tipoEvento: TIPO_OBSERVACION, estadoEnvio: "pendiente" });
    await registrarAtencionFin(c, {
      idPersonal,
      idExpediente,
      item: itemDeRama(rama, idExpediente),
      decision: "observado",
      extra: { id_documento: idDocumento, id_notificacion: idNotificacion },
    });
    return { documento: { id_documento: idDocumento, estado_verificacion: "observado" }, rama: "observado", id_notificacion: idNotificacion };
  });
}

// «Dar conformidad al expediente» (G03) o «Marcar conforme» (G05): con todos los documentos vigentes de la rama conformes,
// la rama pasa de `pendiente` a `conforme` con la fecha y el usuario (transicion_estado, HU0011-1.0). Evalúa la unión.
export async function confirmarRama(rama: Rama, idExpediente: number, idPersonal: number) {
  return enTransaccion(async (c) => {
    const bloqueo = await bloquearFichaDeExpediente(c, idExpediente);
    if (!bloqueo) throw expedienteNoEncontrado();
    if (bloqueo.estado !== ESTADO_VALIDACION) throw noCorresponde();
    const cab = (await leerCabecera(c, idExpediente))!;
    if (estadoDeRama(cab, rama) === "conforme") throw yaRegistrada();
    const pendientes = await contarNoConformes(c, idExpediente, rama);
    if (pendientes > 0) throw sinRevisar(pendientes);

    await transicionarExpediente(c, { idExpediente, campo: CAMPO[rama], esperado: "pendiente", nuevo: "conforme", idPersonal });
    const habilita = await ramasConformes(c, idExpediente);
    await registrarAtencionFin(c, {
      idPersonal,
      idExpediente,
      item: itemDeRama(rama, idExpediente),
      decision: "conforme",
      extra: habilita ? { habilita_agendamiento: true } : {},
    });
    return { rama: "conforme", agendamiento_habilitado: habilita };
  });
}

// ---------------------------------------------------------------- derecho de admisión (HU0024)

async function pagoExistente(idPago: number) {
  const pago = await leerPago(obtenerPool(), idPago);
  if (!pago) throw pagoNoEncontrado();
  return pago;
}

async function cabeceraDelPago(db: Consultable, pago: PagoValidable): Promise<Cabecera> {
  const c = await leerCabecera(db, pago.id_expediente);
  if (!c) throw expedienteNoEncontrado();
  if (c.estado !== ESTADO_DEL_PAGO[pago.tipo_pago]) throw noCorresponde();
  return c;
}

// Lo que G05 compara con el abono (HU0015-2.0): el monto del pago único o de la fracción, con la configuración vigente.
async function datosDeCuota(db: Consultable, pago: PagoValidable) {
  const q = (await leerCuotaDeExpediente(db, pago.id_expediente))!;
  const montos = montosDeFracciones(Number(q.monto), q.numero_fracciones ?? 1);
  return { modalidad: q.modalidad, numero_fracciones: q.numero_fracciones, monto_corresponde: montos[pago.numero_fraccion - 1] ?? null };
}

// Detalle del comprobante (G05). Abrirlo registra atencion_inicio solo si espera la decisión de Tesorería (`pendiente`):
// un comprobante observado espera a la familia.
export async function detallePago(idPago: number, idPersonal: number) {
  const pago = await pagoExistente(idPago);
  const db = obtenerPool();
  const c = await cabeceraDelPago(db, pago);
  if (pago.estado_validacion === "pendiente") {
    await registrarAtencionInicio(db, { idPersonal, idExpediente: pago.id_expediente, item: itemDePago(idPago) });
  }
  return {
    id_pago: idPago,
    id_expediente: pago.id_expediente,
    codigo: codigoExpediente(c.campana_admision, pago.id_expediente),
    grado: c.nombre_grado,
    postulante: nombrePostulante(c),
    concepto: pago.tipo_pago,
    numero_fraccion: pago.numero_fraccion,
    ...(pago.tipo_pago === "cuota_ingreso" ? await datosDeCuota(db, pago) : {}),
    banco: pago.banco,
    numero_operacion: pago.numero_operacion,
    monto: Number(pago.monto),
    fecha_pago: pago.fecha_pago,
    estado_validacion: pago.estado_validacion,
    motivo_observacion: pago.estado_validacion === "observado" ? pago.motivo_observacion : null,
    // El motivo se conserva hasta la nueva decisión (nota de Pago): en `pendiente` es el de la observación ya subsanada.
    motivo_anterior: pago.estado_validacion === "pendiente" ? pago.motivo_observacion : null,
    ramas: ramas(c),
    agendamiento_habilitado: condicionHabilitada(c),
  };
}

// «Marcar conforme» u «Observar comprobante» (HU0024), o «Conciliar y aprobar pago» y «Rechazar comprobante» (HU0015): misma
// transacción que la unión (solo del derecho) y el aviso.
export async function decidirPago(idPago: number, idPersonal: number, d: Decision) {
  const previo = await pagoExistente(idPago);
  const idExpediente = previo.id_expediente;
  return enTransaccion(async (c) => {
    // Orden de bloqueo: expediente y después pago (el mismo de la subsanación de la familia).
    const bloqueo = await bloquearFichaDeExpediente(c, idExpediente);
    if (bloqueo?.estado !== ESTADO_DEL_PAGO[previo.tipo_pago]) throw noCorresponde();
    const pago = (await bloquearPago(c, idPago))!;
    if (pago.estado_validacion !== "pendiente") throw pagoYaValidado(pago.estado_validacion);

    const motivo = d.decision === "observado" ? d.motivo : null;
    await registrarDecisionPago(c, { idPago, estado: d.decision, motivo, idPersonal });
    let extra: Record<string, unknown> = { id_pago: idPago };
    let idNotificacion: number | null = null;
    let habilita = false;
    let cuotaAcreditada = false;
    if (d.decision === "observado") {
      idNotificacion = await insertarIntento(c, { idExpediente, tipoEvento: TIPO_OBSERVACION, estadoEnvio: "pendiente" });
      extra = { ...extra, id_notificacion: idNotificacion };
    } else if (pago.tipo_pago === "derecho_admision") {
      habilita = await ramasConformes(c, idExpediente);
      if (habilita) extra = { ...extra, habilita_agendamiento: true };
    } else if (pago.numero_fraccion === 1) {
      cuotaAcreditada = true;
      extra = { ...extra, cuota_acreditada: true };
    }
    await registrarAtencionFin(c, { idPersonal, idExpediente, item: itemDePago(idPago), decision: d.decision, extra });
    return {
      id_pago: idPago,
      id_expediente: idExpediente,
      estado_validacion: d.decision,
      id_notificacion: idNotificacion,
      agendamiento_habilitado: habilita,
      cuota_acreditada: cuotaAcreditada,
    };
  });
}

// El comprobante descifrado y verificado. `Pago` no guarda el formato: se reconoce por la firma, como en la carga.
export async function abrirComprobante(almacenamiento: Almacenamiento, idPago: number): Promise<{ formato: FormatoArchivo; contenido: Buffer }> {
  const pago = await pagoExistente(idPago);
  await cabeceraDelPago(obtenerPool(), pago);
  const flujo: Readable = await abrirArchivo(almacenamiento, idPago, pago.comprobante_url);
  const partes: Buffer[] = [];
  for await (const parte of flujo) partes.push(parte as Buffer);
  const contenido = Buffer.concat(partes);
  const formato = formatoPorFirma(contenido.subarray(0, 16));
  if (!formato) {
    console.error(`Comprobante con formato no reconocido: pago ${idPago}`);
    throw new ErrorApi(500, "ARCHIVO_NO_DISPONIBLE", "No se pudo leer el archivo");
  }
  return { formato, contenido };
}

// ---------------------------------------------------------------- listas

export async function bandeja(campana: string, f: { vista: VistaBandeja; idGrado?: number; q?: string; recientes: boolean }) {
  const { filas, conteos } = await listarBandeja(obtenerPool(), { campana, ...f });
  return {
    conteos,
    expedientes: filas.map((b) => ({
      id_expediente: b.id_expediente,
      codigo: b.codigo,
      postulante: { nombres: b.postulante_nombres, apellidos: b.postulante_apellidos },
      apoderado: { nombres: b.apoderado_nombres, apellidos: b.apoderado_apellidos },
      grado: { id_grado: b.id_grado, nombre_grado: b.nombre_grado },
      estado_documental: b.estado_documental,
      subsanado: b.subsanado,
      motivos_anteriores: b.motivos_anteriores,
      ultima_actividad: b.ultima_actividad?.toISOString() ?? null,
      en_validacion_desde: b.en_validacion_desde?.toISOString() ?? null,
    })),
  };
}

export type VistaTesoreria = "todo" | "derecho" | "financiera" | "cuota";

export async function validacionesTesoreria(campana: string, vista: VistaTesoreria) {
  const db = obtenerPool();
  const [validaciones, cuotas] = await Promise.all([listarTesoreria(db, campana), listarCuotasTesoreria(db, campana)]);
  // Orden estable: los más antiguos primero, y sin fecha al final, como cada lista por separado.
  const instante = (d: Date | null) => d?.getTime() ?? Number.POSITIVE_INFINITY;
  const items = [...validaciones, ...cuotas].sort((a, b) => (instante(a.recibido) === instante(b.recibido) ? 0 : instante(a.recibido) - instante(b.recibido)));
  const de = (concepto: string) => items.filter((i) => i.concepto === concepto);
  const pendientes = (lista: typeof items) => lista.filter((i) => i.estado === "pendiente").length;
  const visibles =
    vista === "derecho" ? de("derecho_admision") : vista === "financiera" ? de("documentacion_financiera") : vista === "cuota" ? de("cuota_ingreso") : items;
  return {
    conteos: {
      todo: pendientes(items),
      derecho: pendientes(de("derecho_admision")),
      financiera: pendientes(de("documentacion_financiera")),
      cuota: pendientes(de("cuota_ingreso")),
    },
    items: visibles.map((i) => ({
      concepto: i.concepto,
      id_expediente: i.id_expediente,
      id_pago: i.id_pago,
      codigo: i.codigo,
      postulante: { nombres: i.postulante_nombres, apellidos: i.postulante_apellidos },
      grado: i.nombre_grado,
      monto: i.monto === null ? null : Number(i.monto),
      estado: i.estado,
      subsanado: i.subsanado,
      motivos_anteriores: i.motivos_anteriores,
      recibido: i.recibido?.toISOString() ?? null,
      ...(i.concepto === "cuota_ingreso" ? { numero_fraccion: i.numero_fraccion, modalidad: i.modalidad, numero_fracciones: i.numero_fracciones } : {}),
    })),
  };
}

// ---------------------------------------------------------------- aviso de observaciones (n8n, ADR-07)

export interface AvisoObservacion {
  id_expediente: number;
  id_notificacion: number;
  tipo_evento: string;
  asunto: string;
  cuerpo: string;
}

const noCorrespondeAviso = () => new ErrorApi(409, "AVISO_NO_CORRESPONDE", "El expediente no tiene un aviso de observaciones pendiente");
const avisoYaRegistrado = () => new ErrorApi(409, "AVISO_YA_REGISTRADO", "El aviso de observaciones ya está registrado o en curso");

type ResultadoAviso = { aviso: AvisoObservacion } | { conflicto: ErrorApi };

// POST /internal/expedientes/:id/aviso-observacion. Solo se envía el aviso de la ÚLTIMA observación, con todas las
// observaciones vigentes (una observación nueva reemplaza el aviso pendiente de la anterior):
// - con `idNotificacion` (webhook de la API): el primer intento, que la observación ya reservó, si sigue siendo el último y
//   no venció; si no, 409 y lo toma el barrido;
// - sin él (barrido): ADR-07, retoma con una fila nueva o cierra con la fila `fallido` del tope.
// Los conflictos se lanzan después del COMMIT: la fila de cierre del tope debe quedar guardada.
export async function reservarAvisoObservacion(idExpediente: number, idNotificacion?: number): Promise<AvisoObservacion> {
  const r = await enTransaccion<ResultadoAviso>(async (c) => {
    const bloqueo = await bloquearFichaDeExpediente(c, idExpediente);
    if (!bloqueo) throw expedienteNoEncontrado();
    const desde = await primerIntentoUltimaObservacion(c, idExpediente);
    const vigentes = await observacionesVigentes(c, idExpediente);
    const estadoAdmitido = bloqueo.estado === ESTADO_VALIDACION || bloqueo.estado === ESTADO_DEL_PAGO.cuota_ingreso;
    if (!estadoAdmitido || desde === null || (vigentes.documentos.length === 0 && vigentes.derecho === null && vigentes.cuota === null)) {
      return { conflicto: noCorrespondeAviso() };
    }
    const intentos = await bloquearIntentosObservacion(c, { idExpediente, desde, minutosReintento: MINUTOS_REINTENTO });
    let id: number;
    if (idNotificacion !== undefined) {
      const ultimo = intentos.at(-1);
      if (!intentos.some((i) => i.id_notificacion === idNotificacion)) return { conflicto: noCorrespondeAviso() };
      if (intentos.some((i) => i.estado_envio !== "pendiente") || ultimo?.id_notificacion !== idNotificacion || ultimo.vencido) {
        return { conflicto: avisoYaRegistrado() };
      }
      id = idNotificacion;
    } else {
      const decision = decidir(intentos);
      if (decision.accion === "cerrado" || decision.accion === "en_curso") return { conflicto: avisoYaRegistrado() };
      if (decision.accion === "agotar") {
        await insertarIntento(c, { idExpediente, tipoEvento: TIPO_OBSERVACION, estadoEnvio: "fallido" });
        return { conflicto: avisoAgotado() };
      }
      id = await insertarIntento(c, { idExpediente, tipoEvento: TIPO_OBSERVACION, estadoEnvio: "pendiente" });
    }
    const familia = (await leerDatosFamilia(c, idExpediente))!;
    const mensaje = componerObservaciones({ nombres: familia.nombres, campana: familia.campana_admision, ...vigentes });
    return { aviso: { id_expediente: idExpediente, id_notificacion: id, tipo_evento: TIPO_OBSERVACION, ...mensaje } };
  });
  if ("conflicto" in r) throw r.conflicto;
  return r.aviso;
}

// GET /internal/observaciones/pendientes: solo ids de expediente.
export async function observacionesPendientes(): Promise<{ expedientes: { id_expediente: number }[] }> {
  const ids = await listarObservacionesPendientes(obtenerPool(), { minutosReintento: MINUTOS_REINTENTO, limite: MAXIMO_PENDIENTES });
  return { expedientes: ids.map((id_expediente) => ({ id_expediente })) };
}
