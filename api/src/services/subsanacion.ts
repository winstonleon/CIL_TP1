// Subsanación de la familia en en_validacion (decisión A1 del bloque 5; HU0008-2.0, HU0011-2.0 y HU0024-2.0): reemplaza
// solo un documento observado, o registra el comprobante nuevo del derecho observado en la misma fila del Pago. Cada
// subsanación deja `subsanacion_registrada` (§4.7) para HU0019. Cuando la rama de documentos ya no tiene observados
// vigentes, vuelve de `observado` a `pendiente` (actor familia) y reaparece en la bandeja como «Subsanado».
// Se llama con el expediente ya bloqueado, dentro de la transacción de la carga.
import type pg from "pg";
import { insertarEvento } from "../repositories/auditoria";
import { hayObservadosVigentes, leerCabecera, type Rama } from "../repositories/validacion";
import type { ItemAtencion } from "./atencion";
import { transicionarExpediente } from "./expedientes/transicionarExpediente";

export const ESTADO_SUBSANACION = "en_validacion";

// Ítem de cada rama (§4.7): el expediente en las ramas de documentos, el pago en la del derecho.
export const itemDeRama = (rama: Rama, idExpediente: number): ItemAtencion => ({
  tipo: rama === "documental" ? "validacion_documental" : "documentacion_financiera",
  id: idExpediente,
});
export const itemDePago = (idPago: number): ItemAtencion => ({ tipo: "pago", id: idPago });

export const ramaDeCategoria = (categoria: string): Rama => (categoria === "financiero" ? "financiera" : "documental");

export async function registrarSubsanacionDocumento(
  cliente: pg.PoolClient,
  s: { idExpediente: number; categoria: string; idDocumentoNuevo: number; idDocumentoAnterior: number },
): Promise<void> {
  const rama = ramaDeCategoria(s.categoria);
  await insertarEvento(cliente, {
    tipoEvento: "subsanacion_registrada",
    idExpediente: s.idExpediente,
    detalle: { item: itemDeRama(rama, s.idExpediente), id_documento_nuevo: s.idDocumentoNuevo, id_documento_anterior: s.idDocumentoAnterior },
  });
  const cab = (await leerCabecera(cliente, s.idExpediente))!;
  const estado = rama === "documental" ? cab.estado_documental : cab.estado_financiero;
  if (estado === "observado" && !(await hayObservadosVigentes(cliente, s.idExpediente, rama))) {
    await transicionarExpediente(cliente, {
      idExpediente: s.idExpediente,
      campo: rama === "documental" ? "estado_documental" : "estado_financiero",
      esperado: "observado",
      nuevo: "pendiente",
      idPersonal: null,
      detalle: { origen: "subsanacion", id_documento: s.idDocumentoNuevo },
    });
  }
}

// El Pago no tiene historial: el banco, el número de operación, la clave del comprobante anterior y el motivo de su
// observación quedan en el evento (ajuste 1 de John; el motivo, para que no se pierda cuando Tesorería da la conformidad).
// Su archivo no se borra.
export async function registrarSubsanacionPago(
  cliente: pg.PoolClient,
  s: { idExpediente: number; idPago: number; anterior: { banco: string; numero_operacion: string; clave: string; motivo: string | null; monto?: number } },
): Promise<void> {
  await insertarEvento(cliente, {
    tipoEvento: "subsanacion_registrada",
    idExpediente: s.idExpediente,
    detalle: { item: itemDePago(s.idPago), id_pago: s.idPago, anterior: s.anterior },
  });
}
