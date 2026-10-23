// Etiquetas de G09 (HU0022) para los valores de los enums del DBML (ADR-10: si cambian los enums, cambia este archivo).
// Fuentes de los textos: chips de G09 (condición y «Financiero · solo Tesorería»), encabezados de P06 (categorías)
// y nombres de las citas en G04, P08 y G06.

export const TIPOS_CITA = ["visita", "jornada_observacion", "evaluacion_psicologica", "evaluacion_academica", "entrevista_padres"] as const;
export type TipoCita = (typeof TIPOS_CITA)[number];

export const CATEGORIAS = ["postulante_y_padres", "colegio_procedencia", "financiero", "condicion_especial"] as const;
export type CategoriaRequisito = (typeof CATEGORIAS)[number];

export const CONDICIONES = ["todos", "solo_colegio_peruano", "solo_condicion_especial", "si_dependiente", "si_independiente"] as const;
export type CondicionAplicacion = (typeof CONDICIONES)[number];

export const ETIQUETA_TIPO_CITA: Record<TipoCita, string> = {
  visita: "Visita guiada",
  jornada_observacion: "Jornada de observación",
  evaluacion_psicologica: "Evaluación psicológica",
  evaluacion_academica: "Evaluación académica",
  entrevista_padres: "Entrevista a los padres",
};

export const ETIQUETA_CATEGORIA: Record<CategoriaRequisito, string> = {
  postulante_y_padres: "Postulante y padres",
  colegio_procedencia: "Colegio de procedencia",
  financiero: "Financiero · solo Tesorería",
  condicion_especial: "Condición especial",
};

export const ETIQUETA_CONDICION: Record<CondicionAplicacion, string> = {
  todos: "Todos",
  solo_colegio_peruano: "Si estudió en otro colegio del Perú",
  solo_condicion_especial: "Si declara una condición especial",
  si_dependiente: "Si es dependiente",
  si_independiente: "Si es independiente",
};

// CHECK ck_requisito_por_apoderado: estas condiciones se exigen a cada apoderado.
export const CONDICIONES_POR_APODERADO: readonly CondicionAplicacion[] = ["si_dependiente", "si_independiente"];

// Rol del responsable de cada tipo de cita (plan HU0022, P2). Solo filtra el selector: la API lo vuelve a exigir (422).
export const ROL_RESPONSABLE: Record<TipoCita, string> = {
  visita: "directora",
  jornada_observacion: "psicologa",
  evaluacion_psicologica: "psicologa",
  evaluacion_academica: "evaluador_academico",
  entrevista_padres: "psicologa",
};

// Evaluaciones configurables de cada grado (chips de G09). La entrevista a los padres aplica siempre (R11).
export const EVALUACIONES = [
  { campo: "requiere_jornada_observacion", etiqueta: "Observación" },
  { campo: "requiere_evaluacion_psicologica", etiqueta: "Psicológica" },
  { campo: "requiere_evaluacion_academica", etiqueta: "Académica" },
] as const;
export type CampoEvaluacion = (typeof EVALUACIONES)[number]["campo"];

// Montos en soles como en G09: «S/ 7,000», y con céntimos solo si los tiene («S/ 6,500.50»).
export function formatearSoles(monto: string | number): string {
  const valor = Number(monto);
  const centimos = Math.round(valor * 100) % 100 !== 0;
  const formato = new Intl.NumberFormat("es-PE", { minimumFractionDigits: centimos ? 2 : 0, maximumFractionDigits: 2 });
  return `S/ ${formato.format(valor)}`;
}

// «2031-01-15» → «15/01/2031», sin pasar por Date (sin zona horaria).
export function formatearFecha(fecha: string): string {
  const [anio, mes, dia] = fecha.split("-");
  return `${dia}/${mes}/${anio}`;
}
