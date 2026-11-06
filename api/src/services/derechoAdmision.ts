// Derecho de admisión (P07b, HU0007): la familia registra el comprobante de su depósito o transferencia. El monto es la
// constante de R16 (C26 punto 2) y el pago queda pendiente de Tesorería; la constancia se muestra en pantalla.
// Los textos que debe entregar el colegio (bancos y cuenta) van entre corchetes en `borrador-1` (ADR-19, C48).
// Subsanación (A1, bloque 5; HU0024-2.0): con el comprobante observado y el expediente en en_validacion, la familia
// registra el comprobante nuevo en la misma fila del Pago, que vuelve a `pendiente`; el anterior no se borra.
import type { Readable } from "node:stream";
import { z } from "zod";
import type { Almacenamiento } from "../almacenamiento";
import { enTransaccion, obtenerPool } from "../db/pool";
import { ErrorApi } from "../errores";
import { bloquearFichaDeExpediente, type ExpedienteDeFamilia } from "../repositories/expediente";
import {
  existeComprobante,
  insertarPago,
  leerDerechoAdmision,
  UNICIDAD_COMPROBANTE,
  UNICIDAD_PAGO_DEL_EXPEDIENTE,
  type FilaPago,
} from "../repositories/pago";
import { leerPostulante } from "../repositories/postulante";
import { bloquearPago, existeComprobanteDeOtroPago, subsanarPago } from "../repositories/validacion";
import { ESTADO_SUBSANACION, registrarSubsanacionPago } from "./subsanacion";
import { DERECHO_ADMISION } from "./configuracion";
import { guardarInspeccionado, quitarArchivo } from "./documentos";
import { codigoExpediente } from "./fichaInscripcion";

export const VERSION_DERECHO_ADMISION = "borrador-1";
// Lista cerrada de bancos de P07b (P1 a: la unicidad es por banco, así que «BCP» y «bcp» no pueden ser dos valores).
export const BANCOS = ["[Banco 1]", "[Banco 2]", "[Banco 3]"] as const;
export const CUENTA_COLEGIO = "[Banco y N.º de cuenta del colegio]";
const ESTADO_REGISTRABLE = "en_postulacion";

const fechaValida = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v) && new Date(`${v}T00:00:00Z`).toISOString().startsWith(v);
// La fecha de hoy en Lima (TZ del colegio): un abono no puede ser de una fecha futura.
const hoyEnLima = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Lima" }).format(new Date());

// Campos del comprobante, los mismos para el derecho de admisión y la cuota de ingreso (HU0014).
export const camposComprobante = {
  banco: z.enum(BANCOS),
  // Solo se le quitan los espacios de los extremos: normalizar más (ceros a la izquierda) sería una regla de negocio.
  numero_operacion: z.string().trim().min(1).max(40).regex(/^[^\u0000-\u001f\u007f]+$/),
  fecha_pago: z.string().refine(fechaValida).refine((v) => v <= hoyEnLima(), "futura"),
};

const esquemaDerecho = z.object(camposComprobante).strict();

export const nombresInvalidos = (issues: { path: PropertyKey[] }[]) => [...new Set(issues.map((i) => i.path.join(".") || "cuerpo"))].join(", ");

const noRegistrable = () => new ErrorApi(409, "DERECHO_NO_REGISTRABLE", "El derecho de admisión no se puede registrar en el estado actual del expediente");
const yaRegistrado = () => new ErrorApi(409, "DERECHO_YA_REGISTRADO", "El derecho de admisión de este expediente ya tiene un comprobante registrado");
const noSubsanable = () =>
  new ErrorApi(409, "DERECHO_NO_SUBSANABLE", "El comprobante solo se puede reemplazar cuando Tesorería lo observó");
export const comprobanteDuplicado = () =>
  new ErrorApi(409, "COMPROBANTE_DUPLICADO", "Este comprobante ya fue registrado. Revisa el N.° de operación.", { campo: "numero_operacion" });

async function constancia(e: ExpedienteDeFamilia, p: FilaPago, registradoEn: Date | null) {
  const postulante = e.id_postulante ? await leerPostulante(obtenerPool(), e.id_postulante) : null;
  const nombre = [postulante?.nombres, postulante?.apellido_paterno, postulante?.apellido_materno].filter(Boolean).join(" ");
  const codigo = codigoExpediente(e.campana_admision, e.id_expediente);
  return {
    // Modelo de datos §7: el código de la constancia se deriva, no tiene columna.
    codigo: `CONST-${codigo}-${p.id_pago}`,
    expediente: codigo,
    postulante: nombre || null,
    concepto: "Derecho de admisión",
    monto: Number(p.monto),
    banco: p.banco,
    numero_operacion: p.numero_operacion,
    fecha_pago: p.fecha_pago,
    // `Pago` no guarda la fecha de registro (C49): solo se conoce en la respuesta del registro.
    registrado_en: registradoEn?.toISOString() ?? null,
    estado: p.estado_validacion,
  };
}

export async function leerDerecho(e: ExpedienteDeFamilia) {
  const pago = await leerDerechoAdmision(obtenerPool(), e.id_expediente);
  return {
    version: VERSION_DERECHO_ADMISION,
    monto: DERECHO_ADMISION,
    bancos: BANCOS,
    cuenta_colegio: CUENTA_COLEGIO,
    registrable: e.estado === ESTADO_REGISTRABLE && !pago,
    pago: pago
      ? {
          ...(await constancia(e, pago, null)),
          subsanable: e.estado === ESTADO_SUBSANACION && pago.estado_validacion === "observado",
          motivo_observacion: pago.estado_validacion === "observado" ? pago.motivo_observacion : null,
          // El motivo se conserva hasta la nueva decisión (nota de Pago): en `pendiente` es el de la observación subsanada.
          motivo_anterior: pago.estado_validacion === "pendiente" ? pago.motivo_observacion : null,
        }
      : null,
  };
}

export async function registrarDerecho(
  almacenamiento: Almacenamiento,
  e: ExpedienteDeFamilia,
  campos: Record<string, string>,
  archivo: Readable,
) {
  const entrada = z.safeParse(esquemaDerecho, campos);
  if (!entrada.success) throw new ErrorApi(400, "VALIDACION", `Datos inválidos: ${nombresInvalidos(entrada.error.issues)}`);
  const { banco, numero_operacion: numeroOperacion, fecha_pago: fechaPago } = entrada.data;
  if (e.estado !== ESTADO_REGISTRABLE) throw noRegistrable();

  // Antes de recibir el archivo: un duplicado se rechaza sin subir nada (la restricción de la BD cubre la carrera).
  const db = obtenerPool();
  if (await leerDerechoAdmision(db, e.id_expediente)) throw yaRegistrado();
  if (await existeComprobante(db, banco, numeroOperacion)) throw comprobanteDuplicado();

  const guardado = await guardarInspeccionado(almacenamiento, archivo);
  let pago: Awaited<ReturnType<typeof insertarPago>>;
  try {
    pago = await enTransaccion(async (tx) => {
      const bloqueo = await bloquearFichaDeExpediente(tx, e.id_expediente);
      if (bloqueo?.estado !== ESTADO_REGISTRABLE) throw noRegistrable();
      return insertarPago(tx, {
        idExpediente: e.id_expediente,
        tipoPago: "derecho_admision",
        monto: DERECHO_ADMISION,
        banco,
        numeroOperacion,
        fechaPago,
        clave: guardado.clave,
      });
    });
  } catch (error) {
    await quitarArchivo(almacenamiento, guardado.clave);
    const pg = error as { code?: string; constraint?: string };
    if (pg.code === "23505" && pg.constraint === UNICIDAD_COMPROBANTE) throw comprobanteDuplicado();
    if (pg.code === "23505" && pg.constraint === UNICIDAD_PAGO_DEL_EXPEDIENTE) throw yaRegistrado();
    throw error;
  }
  // Ya confirmado: un fallo al armar la constancia no debe borrar el archivo del pago registrado.
  return constancia(e, pago, pago.registrado_en);
}

const esObservado = (p: FilaPago | null): p is FilaPago => p?.estado_validacion === "observado";

// PUT /derecho-admision: el comprobante nuevo del derecho observado (A1). Misma validación que el registro; R19 sin contar
// el propio pago. El banco, el número de operación y la clave anteriores quedan en subsanacion_registrada.
export async function subsanarDerecho(
  almacenamiento: Almacenamiento,
  e: ExpedienteDeFamilia,
  campos: Record<string, string>,
  archivo: Readable,
) {
  const entrada = z.safeParse(esquemaDerecho, campos);
  if (!entrada.success) throw new ErrorApi(400, "VALIDACION", `Datos inválidos: ${nombresInvalidos(entrada.error.issues)}`);
  const { banco, numero_operacion: numeroOperacion, fecha_pago: fechaPago } = entrada.data;
  const db = obtenerPool();
  const previo = await leerDerechoAdmision(db, e.id_expediente);
  if (e.estado !== ESTADO_SUBSANACION || !esObservado(previo)) throw noSubsanable();
  if (await existeComprobanteDeOtroPago(db, banco, numeroOperacion, previo.id_pago)) throw comprobanteDuplicado();

  const guardado = await guardarInspeccionado(almacenamiento, archivo);
  try {
    await enTransaccion(async (tx) => {
      // Orden de bloqueo: expediente y después pago (el mismo de la decisión de Tesorería).
      const bloqueo = await bloquearFichaDeExpediente(tx, e.id_expediente);
      const pago = await bloquearPago(tx, previo.id_pago);
      if (bloqueo?.estado !== ESTADO_SUBSANACION || pago?.estado_validacion !== "observado") throw noSubsanable();
      await subsanarPago(tx, { idPago: pago.id_pago, banco, numeroOperacion, fechaPago, clave: guardado.clave });
      await registrarSubsanacionPago(tx, {
        idExpediente: e.id_expediente,
        idPago: pago.id_pago,
        anterior: { banco: pago.banco, numero_operacion: pago.numero_operacion, clave: pago.comprobante_url, motivo: pago.motivo_observacion },
      });
    });
  } catch (error) {
    // Solo se quita el archivo NUEVO: el comprobante anterior se conserva (ajuste 1 de John).
    await quitarArchivo(almacenamiento, guardado.clave);
    const pg = error as { code?: string; constraint?: string };
    if (pg.code === "23505" && pg.constraint === UNICIDAD_COMPROBANTE) throw comprobanteDuplicado();
    throw error;
  }
  return leerDerecho({ ...e, estado: ESTADO_SUBSANACION });
}
