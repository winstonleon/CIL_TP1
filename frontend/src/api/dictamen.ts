// Llamadas de G06 (Psicología, /psicologia), G11 (Evaluación académica, /evaluacion-academica) y la sección de requisitos
// complementarios de G03 (Secretaría, /bandeja) para HU0010 y HU0025 (ADR-25). Pasan por el cliente único llamarApi con el
// cliente `gestion` (rules/frontend.md). El informe se descarga con el token: la API no publica ninguna URL (ADR-21).
import { llamarApi } from "./cliente";
import type { TipoEvaluacion } from "./evaluaciones";
import { json, respuesta } from "./respuesta";
import type { Persona } from "./validaciones";

export type AreaEvaluacion = "psicologia" | "evaluacion-academica";

export interface CitaDeAgenda {
  id_cita: number;
  id_expediente: number;
  codigo: string;
  postulante: Persona;
  grado: string;
  tipo_cita: TipoEvaluacion;
  fecha: string; // AAAA-MM-DD, hora de Lima
  hora_inicio: string; // HH:MM
  hora_fin: string;
  estado: string; // reservada, asistio o no_asistio
  resultado_registrado: boolean;
}

export interface AgendaDia {
  fecha: string;
  citas: CitaDeAgenda[];
}

export interface DetalleCita extends CitaDeAgenda {
  iniciada: boolean; // la hora de la cita ya llegó
  registrable: boolean; // espera el resultado
  resultado: { resultado: string; observaciones: string | null } | null;
}

export async function leerAgenda(area: AreaEvaluacion, fecha: string): Promise<AgendaDia> {
  return respuesta(await llamarApi("gestion", `/${area}/agenda?fecha=${encodeURIComponent(fecha)}`));
}

// Abrir la cita registra atencion_inicio en la API si espera el resultado (ADR-05).
export async function leerCita(area: AreaEvaluacion, idCita: number): Promise<DetalleCita> {
  return respuesta(await llamarApi("gestion", `/${area}/citas/${idCita}`));
}

export async function registrarResultado(area: AreaEvaluacion, idCita: number, r: { resultado: string; observaciones: string }): Promise<void> {
  await respuesta(await llamarApi("gestion", `/${area}/citas/${idCita}/resultado`, json("POST", r)));
}

// «Marcar “No asistió”» (G11, HU0025-2.0).
export async function registrarInasistencia(idCita: number): Promise<void> {
  await respuesta(await llamarApi("gestion", `/evaluacion-academica/citas/${idCita}/inasistencia`, json("POST", {})));
}

// ---- G06 · dictamen

export type TipoDictamen = "apto" | "en_observacion" | "no_apto";

export interface ComponenteEvaluacion {
  id_cita: number;
  tipo_cita: TipoEvaluacion;
  estado: string;
  fecha: string;
  hora_inicio: string;
  resultado: string | null;
  observaciones: string | null;
}

export interface DetalleDictamen {
  id_expediente: number;
  codigo: string;
  postulante: Persona;
  grado: string;
  edad: number | null;
  estado: string;
  exigidas: TipoEvaluacion[];
  faltan: TipoEvaluacion[];
  componentes: ComponenteEvaluacion[];
  habilitado: boolean;
  opciones: TipoDictamen[];
  dictamen: {
    dictamen: TipoDictamen;
    conclusiones: string | null;
    requisitos_complementarios: string | null;
    tiene_informe: boolean;
    fecha_emision: string;
  } | null;
}

const rutaDictamen = (id: number) => `/psicologia/expedientes/${id}/dictamen`;

// `abrir`: la psicóloga abre el panel del dictamen, y la API registra atencion_inicio si espera el dictamen (ADR-05). Una
// recarga no abre un ítem.
export async function leerDictamen(idExpediente: number, abrir = false): Promise<DetalleDictamen> {
  return respuesta(await llamarApi("gestion", `${rutaDictamen(idExpediente)}${abrir ? "?abrir=1" : ""}`));
}

export interface EntradaDictamen {
  dictamen: TipoDictamen;
  conclusiones: string;
  requisitos_complementarios?: string;
  informe?: File | null;
}

// «Guardar dictamen»: multipart con los campos antes del archivo (ADR-21).
export async function emitirDictamen(idExpediente: number, d: EntradaDictamen): Promise<{ estado: string; tiene_informe: boolean }> {
  const datos = new FormData();
  datos.append("dictamen", d.dictamen);
  datos.append("conclusiones", d.conclusiones);
  if (d.requisitos_complementarios !== undefined) datos.append("requisitos_complementarios", d.requisitos_complementarios);
  if (d.informe) datos.append("archivo", d.informe, d.informe.name);
  return respuesta(await llamarApi("gestion", rutaDictamen(idExpediente), { method: "POST", body: datos }));
}

export async function descargarInforme(idExpediente: number): Promise<Blob> {
  const res = await llamarApi("gestion", `${rutaDictamen(idExpediente)}/informe`);
  if (!res.ok) await respuesta(res);
  return res.blob();
}

// ---- G03 · requisitos complementarios (Secretaría, R13)

export interface RequisitosComplementarios {
  id_expediente: number;
  codigo: string;
  postulante: Persona;
  grado: string;
  requisitos_complementarios: string;
  fecha_emision: string;
}

export async function leerRequisitosComplementarios(idExpediente: number): Promise<RequisitosComplementarios> {
  return respuesta(await llamarApi("gestion", `/bandeja/expedientes/${idExpediente}/requisitos-complementarios`));
}
