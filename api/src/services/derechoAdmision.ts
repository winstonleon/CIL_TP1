// Derecho de admisión (P07b, HU0007): la familia registra el comprobante de su depósito o transferencia. El monto es la
// constante de R16 (C26 punto 2) y el pago queda pendiente de Tesorería; la constancia se muestra en pantalla.
// Los textos que debe entregar el colegio (bancos y cuenta) van entre corchetes en `borrador-1` (ADR-19, C48).
import type { Readable } from "node:stream";
import { z } from "zod";
import type { Almacenamiento } from "../almacenamiento";
import { enTransaccion, obtenerPool } from "../db/pool";
import { ErrorApi } from "../errores";
import { bloquearFichaDeExpediente, type ExpedienteDeFamilia } from "../repositories/expediente";
import {
  existeComprobante,
  insertarDerechoAdmision,
  leerDerechoAdmision,
  UNICIDAD_COMPROBANTE,
  UNICIDAD_PAGO_DEL_EXPEDIENTE,
  type FilaPago,
} from "../repositories/pago";
import { leerPostulante } from "../repositories/postulante";
import { DERECHO_ADMISION } from "./configuracion";
import { guardarInspeccionado, quitarArchivo } from "./documentos";
import { codigoExpediente } from "./fichaInscripcion";

export const VERSION_DERECHO_ADMISION = "borrador-1";
// Lista cerrada de bancos de P07b (P1 a: la unicidad es por banco, así que «BCP» y «bcp» no pueden ser dos valores).
export const BANCOS = ["[Banco 1]", "[Banco 2]", "[Banco 3]"] as const;
const CUENTA_COLEGIO = "[Banco y N.º de cuenta del colegio]";
const ESTADO_REGISTRABLE = "en_postulacion";

const fechaValida = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v) && new Date(`${v}T00:00:00Z`).toISOString().startsWith(v);
// La fecha de hoy en Lima (TZ del colegio): un abono no puede ser de una fecha futura.
const hoyEnLima = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Lima" }).format(new Date());

const esquemaDerecho = z
  .object({
    banco: z.enum(BANCOS),
    // Solo se le quitan los espacios de los extremos: normalizar más (ceros a la izquierda) sería una regla de negocio.
    numero_operacion: z.string().trim().min(1).max(40).regex(/^[^\u0000-\u001f\u007f]+$/),
    fecha_pago: z.string().refine(fechaValida).refine((v) => v <= hoyEnLima(), "futura"),
  })
  .strict();

const noRegistrable = () => new ErrorApi(409, "DERECHO_NO_REGISTRABLE", "El derecho de admisión no se puede registrar en el estado actual del expediente");
const yaRegistrado = () => new ErrorApi(409, "DERECHO_YA_REGISTRADO", "El derecho de admisión de este expediente ya tiene un comprobante registrado");
const duplicado = () =>
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
    pago: pago ? await constancia(e, pago, null) : null,
  };
}

export async function registrarDerecho(
  almacenamiento: Almacenamiento,
  e: ExpedienteDeFamilia,
  campos: Record<string, string>,
  archivo: Readable,
) {
  const entrada = z.safeParse(esquemaDerecho, campos);
  if (!entrada.success) {
    const nombres = [...new Set(entrada.error.issues.map((i) => i.path.join(".") || "cuerpo"))].join(", ");
    throw new ErrorApi(400, "VALIDACION", `Datos inválidos: ${nombres}`);
  }
  const { banco, numero_operacion: numeroOperacion, fecha_pago: fechaPago } = entrada.data;
  if (e.estado !== ESTADO_REGISTRABLE) throw noRegistrable();

  // Antes de recibir el archivo: un duplicado se rechaza sin subir nada (la restricción de la BD cubre la carrera).
  const db = obtenerPool();
  if (await leerDerechoAdmision(db, e.id_expediente)) throw yaRegistrado();
  if (await existeComprobante(db, banco, numeroOperacion)) throw duplicado();

  const guardado = await guardarInspeccionado(almacenamiento, archivo);
  let pago: Awaited<ReturnType<typeof insertarDerechoAdmision>>;
  try {
    pago = await enTransaccion(async (tx) => {
      const bloqueo = await bloquearFichaDeExpediente(tx, e.id_expediente);
      if (bloqueo?.estado !== ESTADO_REGISTRABLE) throw noRegistrable();
      return insertarDerechoAdmision(tx, {
        idExpediente: e.id_expediente,
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
    if (pg.code === "23505" && pg.constraint === UNICIDAD_COMPROBANTE) throw duplicado();
    if (pg.code === "23505" && pg.constraint === UNICIDAD_PAGO_DEL_EXPEDIENTE) throw yaRegistrado();
    throw error;
  }
  // Ya confirmado: un fallo al armar la constancia no debe borrar el archivo del pago registrado.
  return constancia(e, pago, pago.registrado_en);
}
