// Cuota de ingreso en P07 (HU0013 y HU0014; R17): con la vacante otorgada, la familia elige la modalidad y registra el
// comprobante del pago único o de la primera fracción. La carga es la de HU0007 (firma de bytes, 10 MB, cifrado y
// unicidad por banco, ADR-21). La 2.ª fracción y las siguientes no tienen HU (C64).
// Estados de la HU, derivados del Pago: pendiente = «Cuota en conciliación», observado = «Cuota observada» y conforme =
// «Cuota acreditada». El expediente sigue en vacante_asignada hasta la carta (HU0016).
// Un grado con cuota 0 (C25 punto 5, decisión de John): vacante sin pago, porque ck_pago_monto exige monto > 0.
// Subsanación (A1, como HU0024-2.0): el comprobante nuevo va en la misma fila del Pago, que vuelve a `pendiente`.
import type { Readable } from "node:stream";
import { z } from "zod";
import type { Almacenamiento } from "../almacenamiento";
import { enTransaccion, obtenerPool } from "../db/pool";
import { ErrorApi } from "../errores";
import { fijarModalidad, leerCuotaDeExpediente, type CuotaDeExpediente } from "../repositories/adjudicacion";
import { insertarEvento } from "../repositories/auditoria";
import { insertarIntento } from "../repositories/aviso";
import { TIPO_CUOTA_POR_CONCILIAR } from "../repositories/evaluaciones";
import { bloquearFichaDeExpediente, type ExpedienteDeFamilia } from "../repositories/expediente";
import {
  existeComprobante,
  fechaValidacionPago,
  insertarPago,
  leerCuotaIngreso,
  leerDerechoAdmision,
  UNICIDAD_COMPROBANTE,
  UNICIDAD_PAGO_DEL_EXPEDIENTE,
  type FilaPago,
} from "../repositories/pago";
import { bloquearPago, existeComprobanteDeOtroPago, subsanarPago } from "../repositories/validacion";
import { BANCOS, camposComprobante, comprobanteDuplicado, CUENTA_COLEGIO, leerDerecho, nombresInvalidos } from "./derechoAdmision";
import { guardarInspeccionado, quitarArchivo } from "./documentos";
import { montosDeFracciones } from "./montosCuota";
import { registrarSubsanacionPago } from "./subsanacion";

export const VERSION_CUOTA = "borrador-1";
const ESTADO_CUOTA = "vacante_asignada";

const noCorresponde = () => new ErrorApi(409, "MODALIDAD_NO_CORRESPONDE", "La modalidad se elige con la vacante otorgada");
const yaElegida = () => new ErrorApi(409, "MODALIDAD_YA_ELEGIDA", "La modalidad ya no se puede cambiar: registraste un pago de la cuota");
const noAplica = () => new ErrorApi(409, "CUOTA_NO_APLICA", "Este grado no tiene cuota de ingreso");
const noRegistrable = () => new ErrorApi(409, "CUOTA_NO_REGISTRABLE", "El comprobante se registra con la vacante otorgada y la modalidad elegida");
const yaRegistrada = () => new ErrorApi(409, "CUOTA_YA_REGISTRADA", "La cuota de ingreso de este expediente ya tiene un comprobante registrado");
const noSubsanable = () => new ErrorApi(409, "CUOTA_NO_SUBSANABLE", "El comprobante solo se puede reemplazar cuando Tesorería lo observó");
const fraccionesNoPermitidas = (maximo: number) =>
  new ErrorApi(422, "FRACCIONES_NO_PERMITIDAS", `El número máximo de fracciones permitido es ${maximo}`, { maximo });

export const esquemaModalidad = z.discriminatedUnion("modalidad", [
  z.object({ modalidad: z.literal("unico") }).strict(),
  z.object({ modalidad: z.literal("fraccionado"), numero_fracciones: z.number().int().min(2) }).strict(),
]);
export type EntradaModalidad = z.infer<typeof esquemaModalidad>;

const esquemaCuota = z
  .object({
    ...camposComprobante,
    // Lo que declara la familia (supuesto 1 del plan): sin rechazo automático; Tesorería lo compara con lo que corresponde.
    monto: z
      .string()
      .regex(/^\d{1,8}(\.\d{1,2})?$/)
      .refine((v) => Number(v) > 0, "monto"),
  })
  .strict();

const pagoVisible = async (p: FilaPago, estadoExpediente: string) => ({
  id_pago: p.id_pago,
  numero_fraccion: p.numero_fraccion,
  banco: p.banco,
  numero_operacion: p.numero_operacion,
  monto: Number(p.monto),
  fecha_pago: p.fecha_pago,
  estado: p.estado_validacion,
  subsanable: estadoExpediente === ESTADO_CUOTA && p.estado_validacion === "observado",
  motivo_observacion: p.estado_validacion === "observado" ? p.motivo_observacion : null,
  // El motivo se conserva hasta la nueva decisión (nota de Pago): en `pendiente` es el de la observación subsanada.
  motivo_anterior: p.estado_validacion === "pendiente" ? p.motivo_observacion : null,
  fecha_validacion: p.estado_validacion === "conforme" ? ((await fechaValidacionPago(obtenerPool(), p.id_pago))?.toISOString() ?? null) : null,
});

const montosElegidos = (c: CuotaDeExpediente) => (c.modalidad ? montosDeFracciones(Number(c.monto), c.numero_fracciones!) : []);

// GET /familia/expedientes/:id/cuota-ingreso: todo lo que muestra P07, también la tarjeta del derecho de admisión.
export async function leerCuota(e: ExpedienteDeFamilia) {
  const db = obtenerPool();
  const c = (await leerCuotaDeExpediente(db, e.id_expediente))!;
  const pago = await leerCuotaIngreso(db, e.id_expediente);
  const derecho = (await leerDerecho(e)).pago;
  const filaDerecho = derecho ? await leerDerechoAdmision(db, e.id_expediente) : null;
  const monto = Number(c.monto);
  const aplica = monto > 0;
  const disponible = e.estado === ESTADO_CUOTA;
  return {
    version: VERSION_CUOTA,
    disponible,
    aplica,
    nivel: c.nivel,
    grado: c.nombre_grado,
    monto,
    max_fracciones: c.max_fracciones,
    modalidad: c.modalidad,
    numero_fracciones: c.numero_fracciones,
    montos: montosElegidos(c),
    bancos: BANCOS,
    cuenta_colegio: CUENTA_COLEGIO,
    modalidad_editable: disponible && aplica && !pago,
    registrable: disponible && aplica && c.modalidad !== null && !pago,
    pago: pago ? await pagoVisible(pago, e.estado) : null,
    derecho: derecho
      ? { ...derecho, fecha_validacion: derecho.estado === "conforme" ? ((await fechaValidacionPago(db, filaDerecho!.id_pago))?.toISOString() ?? null) : null }
      : null,
  };
}

// POST …/cuota-ingreso/modalidad. Se puede cambiar mientras no haya un pago de cuota registrado (ajuste 2 de John): con el
// expediente bloqueado, para no cruzarse con el registro del comprobante.
export async function elegirModalidad(e: ExpedienteDeFamilia, entrada: EntradaModalidad) {
  await enTransaccion(async (tx) => {
    const bloqueo = await bloquearFichaDeExpediente(tx, e.id_expediente);
    if (bloqueo?.estado !== ESTADO_CUOTA) throw noCorresponde();
    const c = (await leerCuotaDeExpediente(tx, e.id_expediente))!;
    if (Number(c.monto) === 0) throw noAplica();
    if (await leerCuotaIngreso(tx, e.id_expediente)) throw yaElegida();
    if (entrada.modalidad === "fraccionado" && entrada.numero_fracciones > c.max_fracciones) throw fraccionesNoPermitidas(c.max_fracciones);
    await fijarModalidad(tx, e.id_expediente, entrada.modalidad, entrada.modalidad === "fraccionado" ? entrada.numero_fracciones : 1);
  });
  return leerCuota(e);
}

function leerEntrada(campos: Record<string, string>) {
  const entrada = z.safeParse(esquemaCuota, campos);
  if (!entrada.success) throw new ErrorApi(400, "VALIDACION", `Datos inválidos: ${nombresInvalidos(entrada.error.issues)}`);
  return entrada.data;
}

function verificarRegistrable(estado: string | undefined, c: CuotaDeExpediente) {
  if (estado !== ESTADO_CUOTA) throw noRegistrable();
  if (Number(c.monto) === 0) throw noAplica();
  if (c.modalidad === null) throw noRegistrable();
}

// POST …/cuota-ingreso (HU0014-1.0): el pago único o la primera fracción. El aviso a Tesorería se reserva en la misma
// transacción y `cuota_registrada` es su fuente y la fecha «Recibido» de G05 (Pago no guarda la suya, C49).
export async function registrarCuota(almacenamiento: Almacenamiento, e: ExpedienteDeFamilia, campos: Record<string, string>, archivo: Readable) {
  const { banco, numero_operacion: numeroOperacion, fecha_pago: fechaPago, monto } = leerEntrada(campos);
  const db = obtenerPool();
  // Antes de recibir el archivo: lo que ya se sabe rechazado no sube nada (la restricción de la BD cubre la carrera).
  verificarRegistrable(e.estado, (await leerCuotaDeExpediente(db, e.id_expediente))!);
  if (await leerCuotaIngreso(db, e.id_expediente)) throw yaRegistrada();
  if (await existeComprobante(db, banco, numeroOperacion)) throw comprobanteDuplicado();

  const guardado = await guardarInspeccionado(almacenamiento, archivo);
  let idNotificacion: number;
  try {
    idNotificacion = await enTransaccion(async (tx) => {
      const bloqueo = await bloquearFichaDeExpediente(tx, e.id_expediente);
      verificarRegistrable(bloqueo?.estado, (await leerCuotaDeExpediente(tx, e.id_expediente))!);
      const pago = await insertarPago(tx, {
        idExpediente: e.id_expediente,
        tipoPago: "cuota_ingreso",
        monto: Number(monto),
        banco,
        numeroOperacion,
        fechaPago,
        clave: guardado.clave,
      });
      const id = await insertarIntento(tx, { idExpediente: e.id_expediente, tipoEvento: TIPO_CUOTA_POR_CONCILIAR, estadoEnvio: "pendiente" });
      await insertarEvento(tx, { tipoEvento: "cuota_registrada", idExpediente: e.id_expediente, detalle: { id_pago: pago.id_pago, id_notificacion: id } });
      return id;
    });
  } catch (error) {
    await quitarArchivo(almacenamiento, guardado.clave);
    const pg = error as { code?: string; constraint?: string };
    if (pg.code === "23505" && pg.constraint === UNICIDAD_COMPROBANTE) throw comprobanteDuplicado();
    if (pg.code === "23505" && pg.constraint === UNICIDAD_PAGO_DEL_EXPEDIENTE) throw yaRegistrada();
    throw error;
  }
  return { id_notificacion: idNotificacion, cuota: await leerCuota(e) };
}

// PUT …/cuota-ingreso (HU0015-2.0): el comprobante nuevo de una cuota observada, en la misma fila. Los datos anteriores
// quedan en subsanacion_registrada y su archivo no se borra. No avisa otra vez a Tesorería (supuesto 7): reaparece en G05.
export async function subsanarCuota(almacenamiento: Almacenamiento, e: ExpedienteDeFamilia, campos: Record<string, string>, archivo: Readable) {
  const { banco, numero_operacion: numeroOperacion, fecha_pago: fechaPago, monto } = leerEntrada(campos);
  const db = obtenerPool();
  const previo = await leerCuotaIngreso(db, e.id_expediente);
  if (e.estado !== ESTADO_CUOTA || previo?.estado_validacion !== "observado") throw noSubsanable();
  if (await existeComprobanteDeOtroPago(db, banco, numeroOperacion, previo.id_pago)) throw comprobanteDuplicado();

  const guardado = await guardarInspeccionado(almacenamiento, archivo);
  try {
    await enTransaccion(async (tx) => {
      // Orden de bloqueo: expediente y después pago (el mismo de la decisión de Tesorería).
      const bloqueo = await bloquearFichaDeExpediente(tx, e.id_expediente);
      const pago = await bloquearPago(tx, previo.id_pago);
      if (bloqueo?.estado !== ESTADO_CUOTA || pago?.estado_validacion !== "observado") throw noSubsanable();
      await subsanarPago(tx, { idPago: pago.id_pago, banco, numeroOperacion, fechaPago, clave: guardado.clave, monto: Number(monto) });
      await registrarSubsanacionPago(tx, {
        idExpediente: e.id_expediente,
        idPago: pago.id_pago,
        anterior: { banco: pago.banco, numero_operacion: pago.numero_operacion, clave: pago.comprobante_url, motivo: pago.motivo_observacion, monto: Number(pago.monto) },
      });
    });
  } catch (error) {
    // Solo se quita el archivo NUEVO: el comprobante anterior se conserva, como en el derecho de admisión.
    await quitarArchivo(almacenamiento, guardado.clave);
    const pg = error as { code?: string; constraint?: string };
    if (pg.code === "23505" && pg.constraint === UNICIDAD_COMPROBANTE) throw comprobanteDuplicado();
    throw error;
  }
  return leerCuota(e);
}
