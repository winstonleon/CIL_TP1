// Línea base del proceso As-Is para contrastar el OE3 en G08 (HU0019, D2-A; patrón de ADR-19). Las fuentes del proyecto no
// traen tiempos As-Is: se miden con el colegio con las mismas definiciones de G08 (compromiso C66). Hasta entonces los
// valores van en null y G08 dice «[Línea base por definir]». No se inventan cifras: cambiarlas es subir la versión aquí,
// con su `fuente`, y queda en el historial de git.
export interface BaseEtapa {
  tramo_dias: number | null;
  cycle_horas: number | null;
}

export interface LineaBase {
  version: string;
  fuente: string | null;
  // Meta de optimización del Plan de Dirección (ajuste 1 de John): se compara con (base − actual) / base.
  meta_optimizacion_pct: number;
  lead_time_dias: number | null;
  cycle_time_horas: number | null;
  etapas: Record<string, BaseEtapa>;
}

export const LINEA_BASE: LineaBase = {
  version: "borrador-1",
  fuente: null,
  meta_optimizacion_pct: 70,
  lead_time_dias: null,
  cycle_time_horas: null,
  etapas: {},
};

export interface Comparacion {
  base: number;
  optimizacion_pct: number | null;
  cumple_meta: boolean | null;
}

// % de optimización = (base − actual) / base. Sin base, no hay comparación. Con base 0 o sin dato actual, se muestra la
// base pero el porcentaje no se calcula. Negativo: el proceso empeoró.
export function compararConBase(base: number | null | undefined, actual: number | null, metaPct: number): Comparacion | null {
  if (base === null || base === undefined) return null;
  if (base === 0 || actual === null) return { base, optimizacion_pct: null, cumple_meta: null };
  const pct = ((base - actual) / base) * 100;
  return { base, optimizacion_pct: Math.round(pct * 10) / 10, cumple_meta: pct >= metaPct };
}
