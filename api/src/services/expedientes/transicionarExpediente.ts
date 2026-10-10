// Único punto de cambio de estado del expediente (ADR-05, R6). Valida la transición y
// escribe la auditoría en la MISMA transacción: el llamador pasa un cliente con BEGIN abierto
// (enTransaccion), así la decisión, la transición y atencion_fin se confirman o revierten juntas.
import type pg from "pg";
import { ErrorApi } from "../../errores";
import { insertarEvento } from "../../repositories/auditoria";
import { actualizarEstado, bloquearEstado, esCampoEstado, esValorDeEstado, type CampoEstado } from "../../repositories/expediente";

export type { CampoEstado };

export type TransicionesPermitidas = Readonly<Record<CampoEstado, ReadonlyArray<readonly [desde: string, hacia: string]>>>;

// Ninguna fuente define todavía la matriz de transiciones (decisión del Sprint 0):
// empieza vacía y cada HU agrega solo las transiciones que sus escenarios exigen.
export const TRANSICIONES_PERMITIDAS: TransicionesPermitidas = {
  estado: [],
  estado_documental: [],
  estado_financiero: [],
};

export interface Transicion {
  idExpediente: number;
  campo: CampoEstado;
  esperado: string;
  nuevo: string;
  idPersonal: number | null; // null si el actor es la familia o el sistema (n8n)
  detalle?: Record<string, unknown>;
}

export async function transicionarExpediente(
  cliente: pg.PoolClient,
  t: Transicion,
  permitidas: TransicionesPermitidas = TRANSICIONES_PERMITIDAS,
): Promise<{ idEvento: number }> {
  if (!esCampoEstado(t.campo)) {
    throw new ErrorApi(400, "CAMPO_ESTADO_INVALIDO", "Campo de estado no reconocido");
  }
  if (!(await esValorDeEstado(cliente, t.campo, t.nuevo))) {
    throw new ErrorApi(400, "ESTADO_INVALIDO", "El estado de destino no existe");
  }
  const actual = await bloquearEstado(cliente, t.idExpediente, t.campo);
  if (actual === null) {
    throw new ErrorApi(404, "EXPEDIENTE_NO_ENCONTRADO", "El expediente no existe");
  }
  if (actual !== t.esperado) {
    throw new ErrorApi(409, "ESTADO_DESACTUALIZADO", "El expediente cambió de estado; vuelve a cargarlo");
  }
  if (!permitidas[t.campo].some(([desde, hacia]) => desde === actual && hacia === t.nuevo)) {
    throw new ErrorApi(409, "TRANSICION_NO_PERMITIDA", "La transición de estado no está permitida");
  }
  await actualizarEstado(cliente, t.idExpediente, t.campo, t.nuevo);
  const idEvento = await insertarEvento(cliente, {
    tipoEvento: "transicion_estado",
    idExpediente: t.idExpediente,
    idPersonal: t.idPersonal,
    estadoAnterior: actual,
    estadoNuevo: t.nuevo,
    detalle: { campo: t.campo, ...t.detalle },
  });
  return { idEvento };
}
