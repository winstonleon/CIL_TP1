// pago: comprobantes que registra la familia (no hay pasarela de pagos, ADR-11). HU0007: derecho de admisión; HU0014: cuota
// de ingreso (pago único o primera fracción).
// `comprobante_url` guarda la clave del almacenamiento (ADR-21). Los nombres de las restricciones los usa el servicio
// para distinguir un comprobante duplicado (R19, por banco) de un derecho ya registrado en este expediente.
import type { Consultable } from "../db/pool";

export const UNICIDAD_COMPROBANTE = "uq_pago_banco_numero_operacion";
export const UNICIDAD_PAGO_DEL_EXPEDIENTE = "uq_pago_expediente_tipo_fraccion";

export interface FilaPago {
  id_pago: number;
  id_expediente: number;
  tipo_pago: string;
  numero_fraccion: number;
  numero_operacion: string;
  banco: string;
  monto: string; // numeric llega como texto
  fecha_pago: string; // AAAA-MM-DD
  comprobante_url: string;
  estado_validacion: string;
  motivo_observacion: string | null;
}

const COLUMNAS = `id_pago, id_expediente, tipo_pago::text AS tipo_pago, numero_fraccion, numero_operacion, banco, monto::text AS monto,
  to_char(fecha_pago, 'YYYY-MM-DD') AS fecha_pago, comprobante_url, estado_validacion::text AS estado_validacion, motivo_observacion`;

// R16: el derecho de admisión es un solo pago (numero_fraccion = 1).
export async function leerDerechoAdmision(db: Consultable, idExpediente: number): Promise<FilaPago | null> {
  const { rows } = await db.query<FilaPago>(
    `SELECT ${COLUMNAS} FROM pago WHERE id_expediente = $1 AND tipo_pago = 'derecho_admision' AND numero_fraccion = 1`,
    [idExpediente],
  );
  return rows[0] ?? null;
}

// ¿Ya hay un comprobante con ese número en ese banco? (R19). No devuelve de quién es.
export async function existeComprobante(db: Consultable, banco: string, numeroOperacion: string): Promise<boolean> {
  const { rowCount } = await db.query("SELECT 1 FROM pago WHERE banco = $1 AND numero_operacion = $2", [banco, numeroOperacion]);
  return (rowCount ?? 0) > 0;
}

// R17: la cuota registra el pago único o la primera fracción (`numero_fraccion` = 1); la siguiente no tiene HU (C64).
export async function leerCuotaIngreso(db: Consultable, idExpediente: number): Promise<FilaPago | null> {
  const { rows } = await db.query<FilaPago>(
    `SELECT ${COLUMNAS} FROM pago WHERE id_expediente = $1 AND tipo_pago = 'cuota_ingreso' AND numero_fraccion = 1`,
    [idExpediente],
  );
  return rows[0] ?? null;
}

// La fecha de validación de un pago se deriva de la bitácora (§7 del modelo): el atencion_fin conforme de su ítem.
export async function fechaValidacionPago(db: Consultable, idPago: number): Promise<Date | null> {
  const { rows } = await db.query<{ fecha: Date | null }>(
    `SELECT max(fecha_hora) AS fecha FROM registro_auditoria
      WHERE tipo_evento = 'atencion_fin' AND detalle->>'decision' = 'conforme'
        AND detalle->'item'->>'tipo' = 'pago' AND detalle->'item'->>'id' = $1::text`,
    [idPago],
  );
  return rows[0]?.fecha ?? null;
}

export async function insertarPago(
  db: Consultable,
  d: { idExpediente: number; tipoPago: "derecho_admision" | "cuota_ingreso"; monto: number; banco: string; numeroOperacion: string; fechaPago: string; clave: string },
): Promise<FilaPago & { registrado_en: Date }> {
  const { rows } = await db.query<FilaPago & { registrado_en: Date }>(
    `INSERT INTO pago (id_expediente, tipo_pago, numero_fraccion, numero_operacion, banco, monto, fecha_pago, comprobante_url)
     VALUES ($1, $7::tipo_pago, 1, $2, $3, $4, $5::date, $6)
     RETURNING ${COLUMNAS}, now() AS registrado_en`,
    [d.idExpediente, d.numeroOperacion, d.banco, d.monto, d.fechaPago, d.clave, d.tipoPago],
  );
  return rows[0]!;
}
