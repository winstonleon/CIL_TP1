// Carga de documentos de la familia (P06, HU0006). Los archivos van al almacenamiento (ADR-12 D1, ADR-21) y nunca pasan
// por n8n; la BD guarda la clave en `documento.url_archivo`. La carga, el reemplazo y la confirmación se admiten en
// `en_postulacion` con la ficha completa y no cambian el estado: «Confirmar documentos» solo deja el evento
// `documentos_confirmados` (P3 A) que toma HU0017 para verificar la completitud.
// En `en_validacion` solo se admite la subsanación (A1, bloque 5): reemplazar un documento vigente observado.
import { pipeline, type Readable } from "node:stream";
import { z } from "zod";
import { ErrorAlmacenamiento, type Almacenamiento } from "../almacenamiento";
import { obtenerConfig } from "../config";
import { enTransaccion, obtenerPool } from "../db/pool";
import { ErrorApi } from "../errores";
import { fechaUltimoEvento, insertarEvento } from "../repositories/auditoria";
import {
  bloquearDocumentoVigente,
  contarVigentesDeRequisito,
  insertarDocumento,
  leerDocumento,
  listarDocumentosVigentes,
  marcarNoVigente,
} from "../repositories/documento";
import { bloquearFichaDeExpediente, type ExpedienteDeFamilia } from "../repositories/expediente";
import { leerPostulante } from "../repositories/postulante";
import { hayCambiosDesde, ultimaVerificacion } from "../repositories/completitud";
import { requisitosExigidos } from "../repositories/requisito";
import { leerDocumentoDeExpediente, motivosAnteriores } from "../repositories/validacion";
import { crearInspector, type FormatoArchivo } from "./cargaArchivo";
import { verificacionVigente } from "./completitud";
import { ESTADO_SUBSANACION, registrarSubsanacionDocumento } from "./subsanacion";

const ESTADO_EDITABLE = "en_postulacion";

const entero = z.preprocess(
  (v) => (v === "" ? undefined : v),
  z.coerce.number().int().positive().max(2147483647),
);
const esquemaCarga = z
  .object({ id_requisito: entero, id_apoderado: entero.optional(), reemplaza: entero.optional() })
  .strict();

export const TIPO_CONTENIDO: Record<FormatoArchivo, string> = {
  pdf: "application/pdf",
  jpg: "image/jpeg",
  png: "image/png",
};

// Guarda el archivo mientras lo inspecciona (firma y 10 MB): si el inspector falla, el guardado se cancela y no queda
// ningún objeto. Compartido con HU0007 (comprobante del derecho de admisión).
export async function guardarInspeccionado(almacenamiento: Almacenamiento, archivo: Readable) {
  const inspector = crearInspector();
  pipeline(archivo, inspector, () => undefined);
  const { clave } = await almacenamiento.guardar(inspector);
  return { clave, bytes: inspector.bytes, formato: inspector.formato! };
}

export const quitarArchivo = (almacenamiento: Almacenamiento, clave: string) => almacenamiento.eliminar(clave).catch(() => undefined);

async function exigirFichaCompleta(e: ExpedienteDeFamilia) {
  const postulante = e.id_postulante ? await leerPostulante(obtenerPool(), e.id_postulante) : null;
  if (!postulante?.ficha_completa) {
    throw new ErrorApi(409, "FICHA_INCOMPLETA", "Completa la ficha para cargar los documentos");
  }
}

const topeAlcanzado = (tope: number) =>
  new ErrorApi(409, "LIMITE_DOCUMENTOS_REQUISITO", `Ya cargaste el máximo de ${tope} archivos para este documento. Reemplaza alguno en lugar de agregar más.`, { maximo: tope });

const noEditable = () => new ErrorApi(409, "DOCUMENTOS_NO_EDITABLES", "Los documentos no se pueden modificar en el estado actual del expediente");

const noObservado = () =>
  new ErrorApi(409, "DOCUMENTO_NO_OBSERVADO", "Solo puedes reemplazar los documentos observados mientras se valida tu expediente");

async function exigirEditable(e: ExpedienteDeFamilia) {
  await exigirFichaCompleta(e);
  if (e.estado !== ESTADO_EDITABLE) throw noEditable();
}

// La carga: libre en en_postulacion; en en_validacion, solo el reemplazo de un documento observado (antes de recibir el
// archivo, y otra vez bajo el bloqueo).
async function exigirCargable(e: ExpedienteDeFamilia, reemplaza: number | undefined) {
  await exigirFichaCompleta(e);
  if (e.estado === ESTADO_EDITABLE) return;
  if (e.estado !== ESTADO_SUBSANACION || reemplaza === undefined) throw noEditable();
  const anterior = await leerDocumentoDeExpediente(obtenerPool(), reemplaza, e.id_expediente);
  if (anterior?.vigente && anterior.estado_verificacion !== "observado") throw noObservado();
}

// GET /documentos: los requisitos de R7 con sus archivos vigentes (el historial reemplazado no se muestra).
export async function listarDocumentos(e: ExpedienteDeFamilia) {
  await exigirFichaCompleta(e);
  const db = obtenerPool();
  const [requisitos, documentos, confirmado, verificacion, anteriores] = await Promise.all([
    requisitosExigidos(db, e.id_expediente),
    listarDocumentosVigentes(db, e.id_expediente),
    fechaUltimoEvento(db, e.id_expediente, "documentos_confirmados"),
    verificacionVigente(db, e.id_expediente),
    motivosAnteriores(db, e.id_expediente),
  ]);
  return {
    editable: e.estado === ESTADO_EDITABLE,
    subsanacion: e.estado === ESTADO_SUBSANACION, // A1: solo se reemplazan los observados
    confirmado_en: confirmado?.toISOString() ?? null,
    verificacion, // HU0017 (ajuste 3): resultado de la verificación de la última confirmación, o null
    requisitos: requisitos.map((r) => ({
      ...r,
      documentos: documentos
        .filter((d) => d.id_requisito === r.id_requisito && d.id_apoderado === r.id_apoderado)
        .map((d) => ({
          id_documento: d.id_documento,
          formato: d.formato,
          tamano_kb: d.tamano_kb,
          fecha_carga: d.fecha_carga.toISOString(),
          estado_verificacion: d.estado_verificacion,
          // El motivo vigente solo si está observado; el de una observación ya subsanada es el «motivo anterior».
          motivo_observacion: d.estado_verificacion === "observado" ? d.motivo_observacion : null,
          motivo_anterior: d.estado_verificacion === "pendiente" ? (anteriores.get(d.id_documento) ?? null) : null,
        })),
    })),
  };
}

export async function cargarDocumento(
  almacenamiento: Almacenamiento,
  e: ExpedienteDeFamilia,
  campos: Record<string, string>,
  archivo: Readable,
) {
  const entrada = z.safeParse(esquemaCarga, campos);
  if (!entrada.success) {
    const nombres = [...new Set(entrada.error.issues.map((i) => i.path.join(".") || "cuerpo"))].join(", ");
    throw new ErrorApi(400, "VALIDACION", `Datos inválidos: ${nombres}`);
  }
  const { id_requisito: idRequisito, id_apoderado: idApoderado = null, reemplaza } = entrada.data;
  await exigirCargable(e, reemplaza);

  // El requisito debe ser de la lista de R7 de este expediente y, si es por apoderado, de uno de sus apoderados.
  const exigidos = await requisitosExigidos(obtenerPool(), e.id_expediente);
  const exigido = exigidos.find((r) => r.id_requisito === idRequisito && r.id_apoderado === idApoderado);
  if (!exigido) {
    throw new ErrorApi(400, "VALIDACION", "Datos inválidos: id_requisito, id_apoderado");
  }

  // Tope técnico (ADR-19): se comprueba antes de recibir el archivo y otra vez bajo el bloqueo. Reemplazar no suma.
  const tope = obtenerConfig().MAX_DOCUMENTOS_POR_REQUISITO;
  if (reemplaza === undefined && (await contarVigentesDeRequisito(obtenerPool(), e.id_expediente, idRequisito, idApoderado)) >= tope) {
    throw topeAlcanzado(tope);
  }

  const guardado = await guardarInspeccionado(almacenamiento, archivo);
  try {
    return await enTransaccion(async (db) => {
      const bloqueo = await bloquearFichaDeExpediente(db, e.id_expediente);
      const subsanacion = bloqueo?.estado === ESTADO_SUBSANACION && reemplaza !== undefined;
      if (bloqueo?.estado !== ESTADO_EDITABLE && !subsanacion) throw noEditable();
      if (reemplaza !== undefined) {
        const anterior = await bloquearDocumentoVigente(db, reemplaza, e.id_expediente);
        if (!anterior || anterior.id_requisito !== idRequisito || anterior.id_apoderado !== idApoderado) {
          throw new ErrorApi(400, "VALIDACION", "Datos inválidos: reemplaza");
        }
        if (subsanacion && anterior.estado_verificacion !== "observado") throw noObservado();
        await marcarNoVigente(db, anterior.id_documento);
      } else if ((await contarVigentesDeRequisito(db, e.id_expediente, idRequisito, idApoderado)) >= tope) {
        throw topeAlcanzado(tope);
      }
      const d = await insertarDocumento(db, {
        idExpediente: e.id_expediente,
        idRequisito,
        idApoderado,
        clave: guardado.clave,
        formato: guardado.formato,
        tamanoKb: Math.max(1, Math.ceil(guardado.bytes / 1024)),
      });
      if (subsanacion) {
        await registrarSubsanacionDocumento(db, {
          idExpediente: e.id_expediente,
          categoria: exigido.categoria,
          idDocumentoNuevo: d.id_documento,
          idDocumentoAnterior: reemplaza!,
        });
      }
      return {
        id_documento: d.id_documento,
        formato: d.formato,
        tamano_kb: d.tamano_kb,
        fecha_carga: d.fecha_carga.toISOString(),
      };
    });
  } catch (error) {
    await quitarArchivo(almacenamiento, guardado.clave);
    throw error;
  }
}

const sinCambios = () =>
  new ErrorApi(409, "SIN_CAMBIOS", "No hay cambios desde la última verificación: carga los documentos que faltan antes de confirmar");

// «Confirmar documentos» (HU0006-1.0): solicita la verificación de completitud, que hace HU0017 en n8n y la API (la ruta
// avisa a recepcion-registro después de responder). No cambia el estado. Después de una verificación incompleta, solo se
// acepta si algo cambió (ajuste 2 de ADR-22): un documento, el pago del derecho o la configuración de G09.
export async function confirmarDocumentos(e: ExpedienteDeFamilia): Promise<{ confirmado_en: string }> {
  await exigirEditable(e);
  return enTransaccion(async (db) => {
    const bloqueo = await bloquearFichaDeExpediente(db, e.id_expediente);
    if (bloqueo?.estado !== ESTADO_EDITABLE) throw noEditable();
    const verificacion = await ultimaVerificacion(db, e.id_expediente);
    if (verificacion?.resultado === "incompleto" && !(await hayCambiosDesde(db, e.id_expediente, verificacion))) throw sinCambios();
    const vigentes = await listarDocumentosVigentes(db, e.id_expediente);
    await insertarEvento(db, {
      tipoEvento: "documentos_confirmados",
      idExpediente: e.id_expediente,
      detalle: { documentos_vigentes: vigentes.length },
    });
    return { confirmado_en: (await fechaUltimoEvento(db, e.id_expediente, "documentos_confirmados"))!.toISOString() };
  });
}

export type DocumentoResuelto =
  | { tipo: "propio"; formato: FormatoArchivo; clave: string }
  | { tipo: "ajeno" }
  | { tipo: "inexistente" };

// Distingue un documento propio de uno ajeno y de uno inexistente: la ruta responde 404 a los dos últimos y audita el
// ajeno (ADR-20), para que los ids secuenciales no permitan enumerar documentos.
export async function resolverDocumento(e: ExpedienteDeFamilia, idDocumento: number): Promise<DocumentoResuelto> {
  const d = await leerDocumento(obtenerPool(), idDocumento);
  if (!d) return { tipo: "inexistente" };
  if (d.id_expediente !== e.id_expediente) return { tipo: "ajeno" };
  return { tipo: "propio", formato: d.formato as FormatoArchivo, clave: d.url_archivo };
}

// Abre el archivo ya descifrado y verificado (el decorador de cifrado verifica la etiqueta antes de devolver el stream).
// Un fallo es del servidor, no de la familia: 500 con el id del documento en el log y sin rutas ni claves.
export async function abrirArchivo(almacenamiento: Almacenamiento, idDocumento: number, clave: string): Promise<Readable> {
  try {
    return await almacenamiento.abrir(clave);
  } catch (error) {
    const causa = error instanceof ErrorAlmacenamiento ? error.codigo : "ERROR";
    console.error(`Archivo no disponible: documento ${idDocumento} (${causa})`);
    throw new ErrorApi(500, "ARCHIVO_NO_DISPONIBLE", "No se pudo leer el archivo");
  }
}
