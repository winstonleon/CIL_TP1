// Llamadas de P02 (HU0003) a las rutas públicas /publico/visita-guiada (ADR-17). Pasan por el cliente único con
// llamarApiPublica: sin token de sesión, porque la familia todavía no tiene cuenta. El token del enlace (ADR-18) viaja en
// la cabecera X-Enlace-Visita, nunca en la URL de la API.
import { llamarApiPublica } from "./cliente";
import { respuesta } from "./respuesta";

export interface HorarioVisita {
  id_horario: number;
  fecha: string; // AAAA-MM-DD, hora de Lima
  hora_inicio: string; // HH:MM
  hora_fin: string;
  disponible: boolean; // false: «Reservado» (sin cupo o con una cita a esa hora, A1)
}

export interface DatosVisita {
  campana: string;
  apoderado: { nombres: string; apellidos: string };
  grado: { nombre_grado: string };
  lugar: string;
  horarios: HorarioVisita[];
}

export interface VisitaReservada {
  estado: "reservada";
  fecha: string;
  hora_inicio: string;
}

const cabecera = (token: string) => ({ "X-Enlace-Visita": token });

export async function obtenerVisita(token: string): Promise<DatosVisita> {
  return respuesta(await llamarApiPublica("/publico/visita-guiada", { headers: cabecera(token) }));
}

export async function reservarVisita(token: string, datos: { id_horario: number; asistentes: string }): Promise<VisitaReservada> {
  return respuesta(
    await llamarApiPublica("/publico/visita-guiada/reserva", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...cabecera(token) },
      body: JSON.stringify(datos),
    }),
  );
}
