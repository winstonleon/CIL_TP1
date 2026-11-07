// Reporte ejecutivo de G08 en Excel (HU0019-2.0, D3-A). Sale de los mismos indicadores de la pantalla, para que las cifras
// coincidan: solo agregados y códigos de expediente, sin datos personales. Cada celda se escribe como valor, nunca como
// fórmula: el nombre de un grado lo escribe Secretaría en G09 y no debe ejecutarse al abrir el archivo.
import ExcelJS from "exceljs";
import type { Indicadores } from "./indicadores";
import type { Comparacion } from "./lineaBase";

export const AVISO_DEMO = "Datos ficticios de demostración";
export const SIN_DATOS_PERSONALES = "No incluye datos personales de los postulantes.";
const SIN_LINEA_BASE = "[Línea base por definir]";
const VACIO = "—";

// Etiqueta de cada tipo de aviso. G08 tiene el mismo mapa (frontend/src/gestion/indicadores.ts): si se agrega un tipo, va en
// los dos. Un tipo sin etiqueta se muestra tal cual.
export const ETIQUETA_AVISO: Readonly<Record<string, string>> = {
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
};

export const TIPO_XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

type Celda = string | number | null;

const celda = (v: Celda) => v ?? VACIO;
const fechaHoraLima = (d: Date) => new Intl.DateTimeFormat("es-PE", { dateStyle: "short", timeStyle: "short", timeZone: "America/Lima" }).format(d);
const siNo = (v: boolean | null) => (v === null ? VACIO : v ? "Sí" : "No");

function nuevaHoja(libro: ExcelJS.Workbook, nombre: string, ind: Indicadores, anchos: number[], encabezados?: string[]) {
  const hoja = libro.addWorksheet(nombre);
  hoja.columns = anchos.map((width) => ({ width }));
  if (ind.es_demo) hoja.addRow([AVISO_DEMO]).font = { bold: true, color: { argb: "FF8A4B08" } };
  if (encabezados) hoja.addRow(encabezados).font = { bold: true };
  return hoja;
}

function comparacion(hoja: ExcelJS.Worksheet, titulo: string, unidad: string, c: Comparacion | null, actual: number | null, metaPct: number) {
  if (!c) return;
  hoja.addRow([`${titulo}: línea base (${unidad})`, c.base]);
  hoja.addRow([`${titulo}: actual (${unidad})`, celda(actual)]);
  hoja.addRow([`${titulo}: optimización (%)`, celda(c.optimizacion_pct)]);
  hoja.addRow([`${titulo}: cumple la meta de ${metaPct} %`, siNo(c.cumple_meta)]);
}

function hojaResumen(libro: ExcelJS.Workbook, ind: Indicadores, generado: Date) {
  const hoja = nuevaHoja(libro, "Resumen", ind, [46, 26]);
  const { filtros: f, tarjetas: t, linea_base: base } = ind;
  const grado = f.id_grado === null ? "Todos los grados" : (ind.vacantes.find((g) => g.id_grado === f.id_grado)?.grado ?? VACIO);
  hoja.addRow(["Reporte ejecutivo de indicadores de admisión"]).font = { bold: true, size: 14 };
  hoja.addRows([
    ["Campaña", f.campana],
    ["Grado", grado],
    ["Periodo de registro", f.desde || f.hasta ? `${f.desde ?? "inicio"} a ${f.hasta ?? "hoy"}` : "Toda la campaña"],
    ["Generado", fechaHoraLima(generado)],
    [SIN_DATOS_PERSONALES],
    [],
    ["Postulaciones en curso", t.en_curso],
    ["Lead time promedio (días)", t.lead_time_dias ?? "Sin cartas emitidas"],
    ["Cartas emitidas", t.cartas],
    ["Cycle time promedio por expediente (horas)", celda(t.cycle_time_horas)],
    ["Vacantes ocupadas (%)", celda(t.ocupacion_pct)],
    ["Expedientes observados (%)", celda(t.observados_pct)],
    [],
  ]);
  hoja.addRow(["Línea base del proceso As-Is"]).font = { bold: true };
  if (!base.definida) hoja.addRow([SIN_LINEA_BASE]);
  else {
    hoja.addRow(["Versión", base.version]);
    hoja.addRow(["Fuente", base.fuente ?? SIN_LINEA_BASE]);
    hoja.addRow(["Meta de optimización (%)", base.meta_pct]);
    comparacion(hoja, "Lead time", "días", base.lead_time, t.lead_time_dias, base.meta_pct);
    comparacion(hoja, "Cycle time", "horas", base.cycle_time, t.cycle_time_horas, base.meta_pct);
  }
  hoja.addRows([
    [],
    ["Definiciones"],
    ["Lead time: de la creación del expediente a la carta emitida."],
    ["Tramo: días entre la primera llegada a un hito y la primera llegada al siguiente."],
    ["Cycle time: suma de los pares de inicio y fin de atención del personal; un inicio sin fin en 8 horas no se cuenta."],
    ["Vacantes adjudicadas: autorizadas menos disponibles, a la fecha del reporte."],
    ["Avisos: cada aviso cuenta una vez; los intentos sin resultado no cuentan como envíos."],
  ]);
}

function hojaEmbudo(libro: ExcelJS.Workbook, ind: Indicadores) {
  const hoja = nuevaHoja(libro, "Embudo", ind, [30, 14, 16], ["Etapa", "Expedientes", "Conversión (%)"]);
  for (const e of ind.embudo) hoja.addRow([e.titulo, e.total, celda(e.conversion_pct)]);
}

function hojaEtapas(libro: ExcelJS.Workbook, ind: Indicadores) {
  const conBase = ind.linea_base.definida;
  const encabezados = ["Etapa", "Tramo (días)", "Expedientes del tramo", "Cycle time (horas)", "Expedientes con atención"];
  if (conBase) encabezados.push("Base tramo (días)", "Optimización tramo (%)", "Tramo cumple la meta", "Base cycle (horas)", "Optimización cycle (%)", "Cycle cumple la meta");
  const hoja = nuevaHoja(libro, "Tiempos por etapa", ind, [30, ...encabezados.slice(1).map(() => 16)], encabezados);
  for (const e of ind.etapas) {
    const fila: Celda[] = [e.titulo, celda(e.tramo_dias), e.n_tramo, e.mide_cycle ? celda(e.cycle_horas) : "No se mide", e.n_cycle];
    if (conBase) {
      const { tramo_dias: tramo, cycle_horas: cycle } = e.linea_base;
      fila.push(celda(tramo?.base ?? null), celda(tramo?.optimizacion_pct ?? null), siNo(tramo?.cumple_meta ?? null));
      fila.push(celda(cycle?.base ?? null), celda(cycle?.optimizacion_pct ?? null), siNo(cycle?.cumple_meta ?? null));
    }
    hoja.addRow(fila);
  }
}

function hojaVacantes(libro: ExcelJS.Workbook, ind: Indicadores) {
  const hoja = nuevaHoja(libro, "Vacantes", ind, [12, 30, 13, 13, 13, 14, 14], [
    "Nivel",
    "Grado",
    "Autorizadas",
    "Adjudicadas",
    "Disponibles",
    "Lista de espera",
    "Ocupación (%)",
  ]);
  for (const g of ind.vacantes) hoja.addRow([g.nivel, g.grado, g.autorizadas, g.adjudicadas, g.disponibles, g.lista_espera, celda(g.ocupacion_pct)]);
}

function hojaAvisos(libro: ExcelJS.Workbook, ind: Indicadores) {
  const hoja = nuevaHoja(libro, "Avisos", ind, [36, 12, 12], ["Tipo de aviso", "Enviados", "Fallidos"]);
  for (const a of ind.avisos) hoja.addRow([ETIQUETA_AVISO[a.tipo_evento] ?? a.tipo_evento, a.enviados, a.fallidos]);
}

function hojaExpedientes(libro: ExcelJS.Workbook, ind: Indicadores) {
  const hoja = nuevaHoja(libro, "Expedientes", ind, [20, 30, 24, 10, 22, 18], [
    "Código",
    "Grado",
    "Etapa alcanzada",
    "Días",
    "Lead time",
    "Cycle time (horas)",
  ]);
  for (const x of ind.expedientes) hoja.addRow([x.codigo, x.grado, x.etapa, celda(x.dias), x.final ? "Completo" : "Parcial, hasta su etapa", celda(x.cycle_horas)]);
}

export async function generarReporte(ind: Indicadores, generado = new Date()): Promise<Buffer> {
  const libro = new ExcelJS.Workbook();
  libro.creator = "Sistema de tramitación de admisión";
  libro.created = generado;
  hojaResumen(libro, ind, generado);
  hojaEmbudo(libro, ind);
  hojaEtapas(libro, ind);
  hojaVacantes(libro, ind);
  hojaAvisos(libro, ind);
  hojaExpedientes(libro, ind);
  return Buffer.from(await libro.xlsx.writeBuffer());
}

export const nombreReporte = (campana: string, generado = new Date()) =>
  `indicadores-${campana}-${new Intl.DateTimeFormat("en-CA", { timeZone: "America/Lima" }).format(generado)}.xlsx`;
