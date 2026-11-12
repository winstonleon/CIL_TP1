// Presentación de G08 (HU0019). Solo da formato: las cifras ya vienen calculadas de la API.
import type { Comparacion, EtapaTiempo, Indicadores } from "../api/indicadores";

export const AVISO_DEMO = "Datos ficticios de demostración";
export const SIN_LINEA_BASE = "[Línea base por definir]";
export const VACIO = "—";

// Etiqueta de cada tipo de aviso. El reporte tiene el mismo mapa (api/src/services/reporteIndicadores.ts): si se agrega un
// tipo, va en los dos. Un tipo sin etiqueta se muestra tal cual.
const ETIQUETA_AVISO: Readonly<Record<string, string>> = {
  carpeta_enviada: "Carpeta informativa",
  visita_confirmada: "Confirmación de la visita",
  visita_reprogramacion: "Invitación a reprogramar la visita",
  credenciales_portal: "Credenciales del portal",
  recordatorio_visita: "Recordatorio de la visita",
  documentos_faltantes: "Documentos faltantes",
  subsanacion_solicitada: "Observaciones por subsanar",
  evaluaciones_habilitadas: "Evaluaciones habilitadas",
  evaluaciones_confirmadas: "Confirmación de las evaluaciones",
  evaluacion_reprogramada: "Evaluación reprogramada (familia)",
  evaluacion_reprogramada_responsable: "Evaluación reprogramada (responsable)",
  evaluacion_liberada_responsable: "Turno liberado (responsable)",
  evaluacion_inasistencia: "Inasistencia a la evaluación",
  dictamen_en_observacion: "Dictamen en observación (Admisión)",
  dictamen_no_apto: "Dictamen No apto",
  vacante_asignada: "Vacante otorgada",
  lista_espera: "Lista de espera",
  cuota_por_conciliar: "Cuota por conciliar (Tesorería)",
  carta_emitida: "Carta de Vacante emitida",
  recordatorio_48h: "Recordatorio por inactividad",
  expediente_caducado: "Postulación caducada (familia)",
  expediente_caducado_admision: "Postulación caducada (Admisión)",
};

export const etiquetaAviso = (tipo: string) => ETIQUETA_AVISO[tipo] ?? tipo;

const numero = new Intl.NumberFormat("es-PE", { maximumFractionDigits: 2 });

export const conVacio = (v: number | null, sufijo = "") => (v === null ? VACIO : `${numero.format(v)}${sufijo}`);
export const textoDias = (v: number | null) => conVacio(v, " d");
export const textoHoras = (v: number | null) => conVacio(v, " h");
export const textoPct = (v: number | null) => conVacio(v, " %");

// Ancho o alto de una barra, en % del mayor valor.
export const proporcion = (valor: number, maximo: number) => (maximo > 0 ? (valor / maximo) * 100 : 0);

export function textoCycle(e: Pick<EtapaTiempo, "mide_cycle" | "cycle_horas">): string {
  return e.mide_cycle ? `Atención: ${textoHoras(e.cycle_horas)}` : "No se mide: sin atención del personal";
}

export interface FilaComparacion {
  indicador: string;
  comparacion: Comparacion;
  actual: string;
}

// Filas de la línea base: los totales y cada medida de etapa que tenga un valor base.
export function filasLineaBase(ind: Indicadores): FilaComparacion[] {
  const filas: (FilaComparacion | null)[] = [
    ind.linea_base.lead_time && { indicador: "Lead time", comparacion: ind.linea_base.lead_time, actual: textoDias(ind.tarjetas.lead_time_dias) },
    ind.linea_base.cycle_time && { indicador: "Cycle time", comparacion: ind.linea_base.cycle_time, actual: textoHoras(ind.tarjetas.cycle_time_horas) },
    ...ind.etapas.flatMap((e) => [
      e.linea_base.tramo_dias && { indicador: `${e.titulo} (tramo)`, comparacion: e.linea_base.tramo_dias, actual: textoDias(e.tramo_dias) },
      e.linea_base.cycle_horas && { indicador: `${e.titulo} (atención)`, comparacion: e.linea_base.cycle_horas, actual: textoHoras(e.cycle_horas) },
    ]),
  ];
  return filas.filter((f): f is FilaComparacion => Boolean(f));
}

export function textoCumple(c: Comparacion): string {
  if (c.cumple_meta === null) return VACIO;
  return c.cumple_meta ? "Cumple" : "No cumple";
}

// Guarda el archivo que devolvió la API: el token no permite un enlace directo (ADR-21).
export function guardarArchivo(contenido: Blob, nombre: string): void {
  const url = URL.createObjectURL(contenido);
  const enlace = document.createElement("a");
  enlace.href = url;
  enlace.download = nombre;
  document.body.append(enlace);
  enlace.click();
  enlace.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
