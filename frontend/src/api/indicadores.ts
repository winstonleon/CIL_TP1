// Llamadas de G08 (Dirección, HU0019) a /direccion/indicadores. Todos los cálculos los hace la API: la pantalla solo los muestra.
import { llamarApi } from "./cliente";
import { respuesta } from "./respuesta";
import { blob } from "./validaciones";

export interface GradoFiltro {
  id_grado: number;
  nivel: string;
  grado: string;
  campana: string;
}

export interface OpcionesFiltro {
  campana_activa: string;
  campanas: string[];
  grados: GradoFiltro[];
}

export interface Filtros {
  campana: string;
  id_grado: number | null;
  desde: string;
  hasta: string;
}

export interface Comparacion {
  base: number;
  optimizacion_pct: number | null;
  cumple_meta: boolean | null;
}

export interface EtapaEmbudo {
  etapa: string;
  titulo: string;
  total: number;
  conversion_pct: number | null;
}

export interface EtapaTiempo {
  etapa: string;
  titulo: string;
  mide_cycle: boolean;
  tramo_dias: number | null;
  n_tramo: number;
  cycle_horas: number | null;
  n_cycle: number;
  linea_base: { tramo_dias: Comparacion | null; cycle_horas: Comparacion | null };
}

export interface GradoVacantes {
  id_grado: number;
  nivel: string;
  grado: string;
  autorizadas: number;
  adjudicadas: number;
  disponibles: number;
  lista_espera: number;
  ocupacion_pct: number | null;
}

export interface Aviso {
  tipo_evento: string;
  enviados: number;
  fallidos: number;
}

export interface ExpedienteIndicador {
  codigo: string;
  grado: string;
  etapa: string;
  dias: number | null;
  final: boolean;
  cycle_horas: number | null;
}

export interface ResumenLineaBase {
  version: string;
  fuente: string | null;
  definida: boolean;
  meta_pct: number;
  lead_time: Comparacion | null;
  cycle_time: Comparacion | null;
}

export interface Indicadores {
  filtros: { campana: string };
  es_demo: boolean;
  tarjetas: {
    en_curso: number;
    lead_time_dias: number | null;
    cartas: number;
    cycle_time_horas: number | null;
    ocupacion_pct: number | null;
    observados_pct: number | null;
  };
  embudo: EtapaEmbudo[];
  etapas: EtapaTiempo[];
  vacantes: GradoVacantes[];
  avisos: Aviso[];
  expedientes: ExpedienteIndicador[];
  linea_base: ResumenLineaBase;
}

const RUTA = "/direccion/indicadores";

function parametros(f: Filtros): URLSearchParams {
  const p = new URLSearchParams({ campana: f.campana });
  if (f.id_grado !== null) p.set("id_grado", String(f.id_grado));
  if (f.desde) p.set("desde", f.desde);
  if (f.hasta) p.set("hasta", f.hasta);
  return p;
}

export async function leerOpcionesFiltro(): Promise<OpcionesFiltro> {
  return respuesta<OpcionesFiltro>(await llamarApi("gestion", `${RUTA}/filtros`));
}

export async function leerIndicadores(f: Filtros): Promise<Indicadores> {
  return respuesta<Indicadores>(await llamarApi("gestion", `${RUTA}?${parametros(f)}`));
}

// El nombre del archivo viene de la API (Content-Disposition); si no llega, se usa uno genérico.
export async function exportarReporte(f: Filtros): Promise<{ contenido: Blob; nombre: string }> {
  const consulta = parametros(f);
  consulta.set("formato", "xlsx");
  const res = await llamarApi("gestion", `${RUTA}/exportacion?${consulta}`);
  const contenido = await blob(res); // lanza el error de la API antes de leer las cabeceras del archivo
  const nombre = /filename="([^"]+)"/.exec(res.headers.get("Content-Disposition") ?? "")?.[1] ?? "indicadores.xlsx";
  return { contenido, nombre };
}
