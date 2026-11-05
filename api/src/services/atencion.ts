// Medición del tiempo de atención (ADR-05 decisión 2A, modelo de datos §4.7):
// atencion_inicio cuando el personal abre un ítem; atencion_fin cuando registra su decisión.
import type pg from "pg";
import type { Consultable } from "../db/pool";
import { inicioAbierto, insertarEvento } from "../repositories/auditoria";

// Ítem atendido, p. ej. { tipo: "documento", id: 12 }. Va en registro_auditoria.detalle.
export interface ItemAtencion {
  tipo: string;
  id: number | string;
}

export interface Atencion {
  idPersonal: number;
  idExpediente: number | null;
  item: ItemAtencion;
}

export async function registrarAtencionInicio(db: Consultable, a: Atencion): Promise<number> {
  return insertarEvento(db, {
    tipoEvento: "atencion_inicio",
    idPersonal: a.idPersonal,
    idExpediente: a.idExpediente,
    detalle: { item: a.item },
  });
}

// Recibe el cliente de la transacción de la decisión, para que ambos se confirmen juntos. Siempre guarda
// `detalle.id_evento_inicio` (§4.7): el último atencion_inicio abierto (sin un atencion_fin que lo cierre) de la misma
// persona y el mismo ítem, o null si no hay. Así HU0019 empareja inicio y fin sin adivinar. `extra` agrega datos de la
// decisión (p. ej. el documento observado o la unión de las ramas), solo ids.
export async function registrarAtencionFin(
  cliente: pg.PoolClient,
  a: Atencion & { decision: string; extra?: Record<string, unknown> },
): Promise<number> {
  const idEventoInicio = await inicioAbierto(cliente, a.idPersonal, a.item);
  return insertarEvento(cliente, {
    tipoEvento: "atencion_fin",
    idPersonal: a.idPersonal,
    idExpediente: a.idExpediente,
    detalle: { item: a.item, decision: a.decision, id_evento_inicio: idEventoInicio, ...a.extra },
  });
}
