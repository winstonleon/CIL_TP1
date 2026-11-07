// Tablero de indicadores (HU0019, G08; OE3, ADR-27). Solo lectura: agregados y códigos de expediente, sin datos personales.
// - Lead time (§4.7): del registro a `carta_emitida`. Antes de HU0016 no hay cartas: se muestra por tramos y, por
//   expediente, los días hasta su última etapa, rotulados como parciales (D1-C).
// - Cada etapa tiene dos medidas (D5-A): el tramo en días, por transiciones, y el cycle time en horas, por los pares de
//   atención (ADR-05). Las dos primeras etapas no tienen atención del personal: G04 y P* no registran `atencion_*`.
// - Ocupación: adjudicadas = autorizadas − disponibles (ADR-14, C25 3). Es una foto actual: no depende del rango.
// - Avisos: contarAvisosCerrados (C8): cada aviso una sola vez; las filas `pendiente` no cuentan como envíos.
import { obtenerPool } from "../db/pool";
import { inventarioVacantes } from "../repositories/adjudicacion";
import { contarAvisosCerrados } from "../repositories/aviso";
import { cycleTimePorEtapa, filasDeCohorte, opcionesDeFiltro, type FilaExpediente, type FiltrosIndicadores } from "../repositories/indicadores";
import { compararConBase, type Comparacion, type LineaBase } from "./lineaBase";

// La campaña de los datos ficticios de `npm run dev:demo` (D4-A): G08 y el reporte lo rotulan.
export const CAMPANA_DEMO = "DEMO";

const SEGUNDOS_DIA = 86_400;
const SEGUNDOS_HORA = 3_600;

interface Etapa {
  etapa: string;
  titulo: string;
  desde: string | null; // null = la fecha de registro
  hasta: string;
  mide_cycle: boolean;
}

// Los tramos se encadenan, así suman el lead time.
export const ETAPAS: readonly Etapa[] = [
  { etapa: "captacion_visita", titulo: "Captación → visita", desde: null, hasta: "portal_habilitado", mide_cycle: false },
  { etapa: "visita_expediente", titulo: "Visita → expediente completo", desde: "portal_habilitado", hasta: "en_validacion", mide_cycle: false },
  { etapa: "verificacion_pagos", titulo: "Verificación y pagos", desde: "en_validacion", hasta: "en_evaluacion", mide_cycle: true },
  { etapa: "evaluaciones_dictamen", titulo: "Evaluaciones y dictamen", desde: "en_evaluacion", hasta: "apto", mide_cycle: true },
  { etapa: "adjudicacion", titulo: "Adjudicación", desde: "apto", hasta: "vacante_asignada", mide_cycle: true },
  { etapa: "cuota_carta", titulo: "Cuota → carta", desde: "vacante_asignada", hasta: "carta_emitida", mide_cycle: true },
];

// Embudo acumulado, como el mockup: cada expediente cuenta en todas las etapas hasta la más avanzada que alcanzó, según su
// bitácora y su estado actual. Así el embudo nunca crece, aunque a un expediente le falte una transición intermedia.
const EMBUDO: readonly { etapa: string; titulo: string }[] = [
  { etapa: "prospectos", titulo: "Prospectos registrados" },
  { etapa: "visitas", titulo: "Visitas realizadas" },
  { etapa: "postulaciones", titulo: "Postulaciones iniciadas" },
  { etapa: "completos", titulo: "Expedientes completos" },
  { etapa: "evaluaciones", titulo: "Evaluaciones concluidas" },
  { etapa: "aptos", titulo: "Dictámenes Apto" },
  { etapa: "vacantes", titulo: "Vacantes otorgadas" },
  { etapa: "cartas", titulo: "Cartas emitidas" },
];

// Índice en EMBUDO de la etapa que acredita cada estado. Los demás (prospecto, caducado…) no acreditan ninguna.
const NIVEL_EMBUDO: Readonly<Record<string, number>> = {
  portal_habilitado: 1,
  en_postulacion: 2,
  en_validacion: 3,
  en_evaluacion: 3,
  en_observacion: 4,
  no_apto: 4,
  apto: 5,
  lista_espera: 5,
  vacante_asignada: 6,
  carta_emitida: 7,
};
const NIVEL_COMPLETO = 3;

const EN_CURSO: ReadonlySet<string> = new Set([
  "en_postulacion",
  "en_validacion",
  "en_evaluacion",
  "en_observacion",
  "apto",
  "lista_espera",
  "vacante_asignada",
]);

const ETIQUETA_ESTADO: Readonly<Record<string, string>> = {
  prospecto: "Prospecto",
  contacto_no_entregado: "Contacto no entregado",
  no_desea_postular: "No desea postular",
  visita_agendada: "Visita agendada",
  portal_habilitado: "Portal habilitado",
  en_postulacion: "En postulación",
  incompleto: "Incompleto",
  en_validacion: "En validación",
  en_evaluacion: "En evaluación",
  en_observacion: "En observación",
  no_apto: "No apto",
  apto: "Apto",
  lista_espera: "Lista de espera",
  vacante_asignada: "Vacante otorgada",
  carta_emitida: "Carta emitida",
  caducado: "Caducado",
};

const redondear = (valor: number, decimales: number) => {
  const factor = 10 ** decimales;
  return Math.round(valor * factor) / factor;
};
const promedio = (valores: number[]): number | null => (valores.length ? valores.reduce((a, b) => a + b, 0) / valores.length : null);
const enDias = (segundos: number | null) => (segundos === null ? null : redondear(segundos / SEGUNDOS_DIA, 1));
const enHoras = (segundos: number | null) => (segundos === null ? null : redondear(segundos / SEGUNDOS_HORA, 2));
const porcentaje = (parte: number, total: number) => (total > 0 ? redondear((parte / total) * 100, 1) : null);

const nivelAlcanzado = (f: FilaExpediente) => Math.max(0, ...[f.estado, ...Object.keys(f.hitos)].map((e) => NIVEL_EMBUDO[e] ?? 0));

function embudo(filas: FilaExpediente[]) {
  const niveles = filas.map(nivelAlcanzado);
  let anterior: number | null = null;
  return EMBUDO.map(({ etapa, titulo }, indice) => {
    const total = niveles.filter((n) => n >= indice).length;
    const conversion_pct = anterior === null ? null : porcentaje(total, anterior);
    anterior = total;
    return { etapa, titulo, total, conversion_pct };
  });
}

function duracionTramo(f: FilaExpediente, e: Etapa): number | null {
  const inicio = e.desde === null ? f.registro : f.hitos[e.desde];
  const fin = f.hitos[e.hasta];
  return inicio === undefined || fin === undefined ? null : fin - inicio;
}

// Los segundos de atención de cada expediente por etapa, y el total por expediente.
function agruparCycle(cycle: { id_expediente: number; etapa: string; segundos: number }[]) {
  const porEtapa = new Map<string, number[]>();
  const porExpediente = new Map<number, number>();
  for (const c of cycle) {
    porEtapa.set(c.etapa, [...(porEtapa.get(c.etapa) ?? []), c.segundos]);
    porExpediente.set(c.id_expediente, (porExpediente.get(c.id_expediente) ?? 0) + c.segundos);
  }
  return { porEtapa, porExpediente };
}

function etapas(filas: FilaExpediente[], porEtapa: Map<string, number[]>, base: LineaBase) {
  return ETAPAS.map((e) => {
    const tramos = filas.map((f) => duracionTramo(f, e)).filter((d): d is number => d !== null);
    const atencion = porEtapa.get(e.etapa) ?? [];
    const tramo = promedio(tramos);
    const cycle = promedio(atencion);
    const baseEtapa = base.etapas[e.etapa];
    return {
      etapa: e.etapa,
      titulo: e.titulo,
      mide_cycle: e.mide_cycle,
      tramo_dias: enDias(tramo),
      n_tramo: tramos.length,
      cycle_horas: enHoras(cycle),
      n_cycle: atencion.length,
      linea_base: {
        tramo_dias: compararConBase(baseEtapa?.tramo_dias, tramo === null ? null : tramo / SEGUNDOS_DIA, base.meta_optimizacion_pct),
        cycle_horas: compararConBase(baseEtapa?.cycle_horas, cycle === null ? null : cycle / SEGUNDOS_HORA, base.meta_optimizacion_pct),
      },
    };
  });
}

function agruparAvisos(filas: { tipo_evento: string; estado_envio: string; avisos: number }[]) {
  const avisos = new Map<string, { tipo_evento: string; enviados: number; fallidos: number }>();
  for (const f of filas) {
    const a = avisos.get(f.tipo_evento) ?? { tipo_evento: f.tipo_evento, enviados: 0, fallidos: 0 };
    if (f.estado_envio === "enviado") a.enviados = f.avisos;
    else a.fallidos = f.avisos;
    avisos.set(f.tipo_evento, a);
  }
  return [...avisos.values()];
}

export interface ResumenLineaBase {
  version: string;
  fuente: string | null;
  definida: boolean;
  meta_pct: number;
  lead_time: Comparacion | null;
  cycle_time: Comparacion | null;
}

const lineaDefinida = (b: LineaBase) =>
  b.lead_time_dias !== null ||
  b.cycle_time_horas !== null ||
  Object.values(b.etapas).some((e) => e.tramo_dias !== null || e.cycle_horas !== null);

export type Indicadores = Awaited<ReturnType<typeof calcularIndicadores>>;

export async function calcularIndicadores(f: FiltrosIndicadores, base: LineaBase) {
  const db = obtenerPool();
  const [filas, cycle, inventario, avisos] = await Promise.all([
    filasDeCohorte(db, f),
    cycleTimePorEtapa(db, f),
    inventarioVacantes(db, f.campana),
    contarAvisosCerrados(db, f.campana, f),
  ]);

  const { porEtapa, porExpediente } = agruparCycle(cycle);
  const vacantes = inventario
    .filter((g) => f.idGrado === undefined || g.id_grado === f.idGrado)
    .map((g) => {
      const adjudicadas = g.vacantes_autorizadas - g.vacantes_disponibles;
      return {
        id_grado: g.id_grado,
        nivel: g.nivel,
        grado: g.nombre_grado,
        autorizadas: g.vacantes_autorizadas,
        adjudicadas,
        disponibles: g.vacantes_disponibles,
        lista_espera: g.lista_espera,
        ocupacion_pct: porcentaje(adjudicadas, g.vacantes_autorizadas),
      };
    });

  const conCarta = filas.filter((x) => x.hitos.carta_emitida !== undefined);
  const leadTime = promedio(conCarta.map((x) => x.hitos.carta_emitida! - x.registro));
  const cycleTotal = promedio([...porExpediente.values()]);
  const completos = filas.filter((x) => nivelAlcanzado(x) >= NIVEL_COMPLETO);

  return {
    filtros: { campana: f.campana, id_grado: f.idGrado ?? null, desde: f.desde ?? null, hasta: f.hasta ?? null },
    es_demo: f.campana === CAMPANA_DEMO,
    tarjetas: {
      en_curso: filas.filter((x) => EN_CURSO.has(x.estado)).length,
      lead_time_dias: enDias(leadTime),
      cartas: conCarta.length,
      cycle_time_horas: enHoras(cycleTotal),
      ocupacion_pct: porcentaje(
        vacantes.reduce((s, g) => s + g.adjudicadas, 0),
        vacantes.reduce((s, g) => s + g.autorizadas, 0),
      ),
      observados_pct: porcentaje(completos.filter((x) => x.observado).length, completos.length),
    },
    embudo: embudo(filas),
    etapas: etapas(filas, porEtapa, base),
    vacantes,
    avisos: agruparAvisos(avisos),
    expedientes: filas.map((x) => {
      const carta = x.hitos.carta_emitida;
      const segundos = porExpediente.get(x.id_expediente);
      return {
        codigo: x.codigo,
        grado: x.nombre_grado,
        etapa: ETIQUETA_ESTADO[x.estado] ?? x.estado,
        dias: enDias((carta ?? x.ultima ?? x.registro) - x.registro),
        final: carta !== undefined,
        cycle_horas: segundos === undefined ? null : enHoras(segundos),
      };
    }),
    linea_base: {
      version: base.version,
      fuente: base.fuente,
      definida: lineaDefinida(base),
      meta_pct: base.meta_optimizacion_pct,
      lead_time: compararConBase(base.lead_time_dias, leadTime === null ? null : leadTime / SEGUNDOS_DIA, base.meta_optimizacion_pct),
      cycle_time: compararConBase(base.cycle_time_horas, cycleTotal === null ? null : cycleTotal / SEGUNDOS_HORA, base.meta_optimizacion_pct),
    } satisfies ResumenLineaBase,
  };
}

// GET /direccion/indicadores/filtros: la campaña activa, las campañas con grados y los grados de cada una.
export async function filtrosDeIndicadores(campanaActiva: string) {
  const grados = await opcionesDeFiltro(obtenerPool());
  const campanas = [...new Set([campanaActiva, ...grados.map((g) => g.campana_admision)])];
  return {
    campana_activa: campanaActiva,
    campanas,
    grados: grados.map((g) => ({ id_grado: g.id_grado, nivel: g.nivel, grado: g.nombre_grado, campana: g.campana_admision })),
  };
}
