// Llamadas de P05 y P05b (HU0005) a /familia. Pasan por el cliente único llamarApi con el cliente `portal`
// (rules/frontend.md). El id del expediente sale de GET /familia/expedientes: la API solo entrega los de esta familia.
import { llamarApi } from "./cliente";
import { json, respuesta } from "./respuesta";

export interface ResumenExpediente {
  id_expediente: number;
  codigo: string;
  estado: string;
  grado: string;
  postulante: string | null;
  ficha_completa: boolean;
}

export type Parentesco = "madre" | "padre" | "apoderado" | "otro";
export type CondicionLaboral = "dependiente" | "independiente";

export interface Pregunta {
  id: string;
  texto: string;
}

export interface Ficha {
  id_expediente: number;
  codigo: string;
  estado: string;
  ficha_completa: boolean;
  guardado_en: string | null; // ISO 8601; null si todavía no se guardó nada
  grado: { nombre_grado: string; nivel: string };
  postulante: {
    nombres: string | null;
    apellido_paterno: string | null;
    apellido_materno: string | null;
    dni: string | null;
    fecha_nacimiento: string | null; // AAAA-MM-DD
    estudio_en_colegio_peruano: boolean | null; // null = sin responder
    colegio_procedencia: string | null;
    tiene_condicion_especial: boolean | null;
  };
  // Nombres, apellidos, teléfono y correo vienen de P01 y son de solo lectura.
  titular: {
    nombres: string;
    apellidos: string;
    telefono: string;
    correo: string;
    parentesco: Parentesco | null;
    dni: string | null;
    condicion_laboral: CondicionLaboral | null;
  };
  segundo_apoderado: {
    parentesco: Parentesco;
    nombres: string;
    apellidos: string;
    dni: string | null;
    telefono: string;
    correo: string;
    condicion_laboral: CondicionLaboral | null;
  } | null;
  cuestionario: { version: string; preguntas: Pregunta[]; respuestas: Record<string, string> };
}

export interface Requisito {
  id_requisito: number;
  tipo_documento: string;
  categoria: string;
  obligatorio: boolean;
  por_apoderado: boolean;
  id_apoderado: number | null;
  apoderado: string | null;
}

// Lo que falta o está mal. `campo` es la ruta del campo en el cuerpo, p. ej. «segundo_apoderado.telefono».
export interface Pendiente {
  campo: string;
  codigo: string;
}

// Estado completo del formulario: el guardado reemplaza al anterior (gana el último, ADR-20).
export interface CuerpoFicha {
  modo: "borrador" | "completa";
  postulante: {
    nombres: string;
    apellido_paterno: string;
    apellido_materno: string;
    dni: string;
    fecha_nacimiento: string;
    estudio_en_colegio_peruano: boolean | null;
    colegio_procedencia: string;
    tiene_condicion_especial: boolean | null;
  };
  titular: { parentesco: string; dni: string; condicion_laboral: string };
  segundo_apoderado: {
    parentesco: string;
    nombres: string;
    apellidos: string;
    dni: string;
    telefono: string;
    correo: string;
    condicion_laboral: string;
  } | null;
  respuestas: Record<string, string>;
}

export type RespuestaGuardado =
  | { ficha_completa: false; guardado_en: string; pendientes: Pendiente[] }
  | { ficha_completa: true; guardado_en: string; requisitos: Requisito[] };

const ruta = (id: number, parte: string) => `/familia/expedientes/${id}/${parte}`;

export async function listarExpedientes(): Promise<ResumenExpediente[]> {
  return respuesta(await llamarApi("portal", "/familia/expedientes"));
}

export async function leerFicha(id: number): Promise<Ficha> {
  return respuesta(await llamarApi("portal", ruta(id, "ficha")));
}

// `keepalive`: el guardado al ocultar o cerrar la pestaña (HU0005-2.0) debe poder terminar aunque la página se descargue.
export async function guardarFicha(id: number, cuerpo: CuerpoFicha, keepalive = false): Promise<RespuestaGuardado> {
  return respuesta(await llamarApi("portal", ruta(id, "ficha"), { ...json("PUT", cuerpo), keepalive }));
}

export async function listaRequisitos(id: number): Promise<Requisito[]> {
  return (await respuesta<{ requisitos: Requisito[] }>(await llamarApi("portal", ruta(id, "requisitos")))).requisitos;
}
