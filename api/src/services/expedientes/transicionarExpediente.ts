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
  estado: [
    ["prospecto", "contacto_no_entregado"], // HU0002-2.0: rebote del correo de la carpeta informativa
    ["prospecto", "visita_agendada"], // HU0003-1.0: reserva de la visita en P02
    ["visita_agendada", "portal_habilitado"], // HU0004-1.0: «Asistió - Interesado en postular» en G04
    ["visita_agendada", "prospecto"], // HU0004-2.0: «No asistió» (P1: la visita no concretada vuelve a prospecto)
    ["portal_habilitado", "en_postulacion"], // HU0005-2.0: primer guardado de la ficha (borrador o completa)
    ["en_postulacion", "en_validacion"], // HU0017-1.0: la verificación de completitud encontró el expediente completo
    ["en_validacion", "en_evaluacion"], // HU0009-1.0: «Confirmar citas» con las tres ramas de R9 conformes (B1)
    ["en_evaluacion", "apto"], // HU0010-1.0: dictamen «Apto» (ADR-25)
    ["en_evaluacion", "en_observacion"], // HU0010-2.0: dictamen «En observación» con requisitos complementarios
    ["en_evaluacion", "no_apto"], // HU0010-3.0: dictamen «No apto»; no_apto es final (sin salidas, D4d)
    ["en_observacion", "apto"], // HU0010-2.0: nuevo dictamen después de la observación (D4a-A)
    ["en_observacion", "no_apto"], // HU0010-2.0: nuevo dictamen después de la observación (D4a-A)
    ["apto", "vacante_asignada"], // HU0012-1.0: «Aprobar y asignar vacante» con cupo en el grado
    ["apto", "lista_espera"], // HU0012-2.0: el grado llegó a cero; la salida de la lista de espera no tiene HU (C61)
    ["vacante_asignada", "carta_emitida"], // HU0016-1.0: la carta se emite con la cuota conciliada o con cuota 0 (R18, C62)
    // HU0018-2.0 (R21): venció el plazo de la etapa con una acción pendiente de la familia; caducado es final (D2-B).
    ["portal_habilitado", "caducado"], // HU0018-2.0: postulación (ficha, documentos y derecho)
    ["en_postulacion", "caducado"], // HU0018-2.0: postulación
    ["en_validacion", "caducado"], // HU0018-2.0: subsanación o agendamiento de las evaluaciones
    ["en_evaluacion", "caducado"], // HU0018-2.0: reprogramación de la evaluación académica a la que no asistió
    ["vacante_asignada", "caducado"], // HU0018-2.0: cuota de ingreso (devuelve la vacante)
  ],
  // R9: cada rama tiene su propio ciclo de observación y subsanación (HU0008 y HU0011, plan del bloque 5).
  estado_documental: [
    ["pendiente", "observado"], // HU0008-2.0: «Solicitar subsanación» de un documento
    ["pendiente", "conforme"], // HU0008-1.0: «Dar conformidad» con todos los documentos conformes
    ["observado", "pendiente"], // A1: la familia reemplazó el último documento observado de la rama
  ],
  estado_financiero: [
    ["pendiente", "observado"], // HU0011-2.0
    ["pendiente", "conforme"], // HU0011-1.0
    ["observado", "pendiente"], // A1
  ],
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
