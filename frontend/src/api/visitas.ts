// Llamadas de G04 (Visitas guiadas, HU0004) a /visitas. Pasan por el cliente único llamarApi (rules/frontend.md).
import { llamarApi } from "./cliente";
import { json, respuesta } from "./respuesta";

export interface Visita {
  id_cita: number;
  fecha: string; // AAAA-MM-DD, hora de Lima
  hora_inicio: string; // HH:MM
  estado_cita: "reservada" | "asistio" | "no_asistio" | string;
  id_expediente: number;
  estado_expediente: string;
  apoderado: { nombres: string; apellidos: string; telefono: string };
  grado: { nombre_grado: string };
  asistentes: string | null;
  aviso: { tipo_evento: string; estado_envio: "enviado" | "fallido" | "pendiente" } | null;
}

export interface SemanaVisitas {
  desde: string; // lunes
  hasta: string; // domingo
  visitas: Visita[];
  sin_registrar: Visita[]; // reservadas de semanas anteriores (A5)
}

export type ResultadoAsistencia = "asistio_interesado" | "no_asistio";

export async function listarVisitas(fecha?: string): Promise<SemanaVisitas> {
  return respuesta(await llamarApi("gestion", `/visitas${fecha ? `?fecha=${encodeURIComponent(fecha)}` : ""}`));
}

export async function registrarAsistencia(idCita: number, resultado: ResultadoAsistencia): Promise<void> {
  await respuesta(await llamarApi("gestion", `/visitas/${idCita}/asistencia`, json("POST", { resultado })));
}
