// Lógica de G06 y G11 sin pantalla (HU0010 y HU0025): estados de las citas con los nombres de los mockups («Programada»,
// «En curso», «Registrada»; y «No asistió», que el mockup no dibuja), estado de cada componente del dictamen, días de la
// agenda y validación de los formularios antes de llamar a la API (que vuelve a validar todo).
import type { CitaDeAgenda, ComponenteEvaluacion, TipoDictamen } from "../api/dictamen";
import type { TipoEvaluacion } from "../api/evaluaciones";
import { diaYMes, horaVisible } from "../portal/calendarioVisita";
import type { Etiqueta } from "./validacion";

export const LARGO_MAXIMO_RESULTADO = 50; // Resultado_Evaluacion.resultado (escala por definir, S4 de ADR-25)
export const LARGO_MAXIMO_TEXTO = 4000;
// Ayuda del campo de G06 (decisión D4b-B de John): los requisitos los lee Secretaría y no deben llevar las conclusiones.
export const AYUDA_REQUISITOS = "Indica qué debe presentar la familia; no copies las conclusiones";

export const NOMBRE_DICTAMEN: Record<TipoDictamen, string> = {
  apto: "Apto",
  en_observacion: "En observación",
  no_apto: "No apto",
};

// Componentes de G06: «Evaluación académica (Evaluador académico)».
export const COMPONENTE: Record<TipoEvaluacion, string> = {
  jornada_observacion: "Jornada de observación",
  evaluacion_academica: "Evaluación académica (Evaluador académico)",
  evaluacion_psicologica: "Evaluación psicológica",
  entrevista_padres: "Entrevista a los padres",
};

// Estado de una cita en la agenda (G11: «Programada», «En curso», «Registrada»). «En curso» = ya empezó y aún no termina.
export function etiquetaCita(c: Pick<CitaDeAgenda, "estado" | "fecha" | "hora_inicio" | "hora_fin" | "resultado_registrado">, ahora = new Date()): Etiqueta {
  if (c.estado === "no_asistio") return { texto: "No asistió", tono: "observado" };
  if (c.resultado_registrado || c.estado === "asistio") return { texto: "Registrada", tono: "conforme" };
  const enLima = (hora: string) => new Date(`${c.fecha}T${hora}:00-05:00`).getTime();
  const t = ahora.getTime();
  if (t >= enLima(c.hora_inicio) && t < enLima(c.hora_fin)) return { texto: "En curso", tono: "subsanado" };
  return { texto: "Programada", tono: "revision" };
}

// Estado de un componente del dictamen (G06: «Registrada», «Realizada» para la entrevista, «Pendiente»).
export function etiquetaComponente(c: ComponenteEvaluacion | undefined): Etiqueta {
  if (!c) return { texto: "Sin agendar", tono: "observado" };
  if (c.estado === "no_asistio") return { texto: "No asistió", tono: "observado" };
  if (c.estado === "asistio" && c.resultado !== null) {
    return { texto: c.tipo_cita === "entrevista_padres" ? "Realizada" : "Registrada", tono: "conforme" };
  }
  return { texto: "Pendiente", tono: "revision" };
}

// «Entrevista a los padres (29 oct.)»
export function nombreComponente(tipo: TipoEvaluacion, c?: ComponenteEvaluacion): string {
  if (!c || tipo !== "entrevista_padres") return COMPONENTE[tipo];
  const [, mes, dia] = c.fecha.split("-");
  const MESES = ["ene.", "feb.", "mar.", "abr.", "may.", "jun.", "jul.", "ago.", "set.", "oct.", "nov.", "dic."];
  return `${COMPONENTE[tipo]} (${Number(dia)} ${MESES[Number(mes) - 1]})`;
}

// «Martes 27 de octubre» (título de la agenda).
export function tituloDia(fecha: string): string {
  const d = diaYMes(fecha);
  return `${d.charAt(0).toUpperCase()}${d.slice(1)}`;
}

// G06 muestra «8:00»; G11, «8:00 a. m.».
export const horaCorta = (hora: string) => {
  const [h, m] = hora.split(":").map(Number);
  return `${((h! + 11) % 12) + 1}:${String(m).padStart(2, "0")}`;
};
export const horaLarga = horaVisible;

// Un día más o menos (AAAA-MM-DD, sin zonas horarias).
export function sumarDias(fecha: string, n: number): string {
  const d = new Date(`${fecha}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

// Errores de los campos del formulario de resultado (G06 y G11); vacío si se puede enviar.
export function erroresResultado(r: { resultado: string; observaciones: string }): Partial<Record<"resultado" | "observaciones", string>> {
  const e: Partial<Record<"resultado" | "observaciones", string>> = {};
  const resultado = r.resultado.trim();
  if (!resultado) e.resultado = "Ingresa el resultado";
  else if (resultado.length > LARGO_MAXIMO_RESULTADO) e.resultado = `Máximo ${LARGO_MAXIMO_RESULTADO} caracteres`;
  else if (resultado.toLowerCase() === "inasistencia") e.resultado = "La inasistencia se registra con «Marcar “No asistió”»";
  if (!r.observaciones.trim()) e.observaciones = "Ingresa las observaciones";
  else if (r.observaciones.trim().length > LARGO_MAXIMO_TEXTO) e.observaciones = `Máximo ${LARGO_MAXIMO_TEXTO} caracteres`;
  return e;
}

// Errores del dictamen (G06): resultado elegido, conclusiones y, solo con «En observación», los requisitos complementarios.
export function erroresDictamen(d: { dictamen: TipoDictamen | null; conclusiones: string; requisitos: string }): Partial<Record<"dictamen" | "conclusiones" | "requisitos", string>> {
  const e: Partial<Record<"dictamen" | "conclusiones" | "requisitos", string>> = {};
  if (!d.dictamen) e.dictamen = "Elige el resultado del dictamen";
  if (!d.conclusiones.trim()) e.conclusiones = "Ingresa las conclusiones";
  else if (d.conclusiones.trim().length > LARGO_MAXIMO_TEXTO) e.conclusiones = `Máximo ${LARGO_MAXIMO_TEXTO} caracteres`;
  if (d.dictamen === "en_observacion") {
    if (!d.requisitos.trim()) e.requisitos = "Detalla los requisitos complementarios";
    else if (d.requisitos.trim().length > LARGO_MAXIMO_TEXTO) e.requisitos = `Máximo ${LARGO_MAXIMO_TEXTO} caracteres`;
  }
  return e;
}
