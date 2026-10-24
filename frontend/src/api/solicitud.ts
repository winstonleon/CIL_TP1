// Llamadas de P01 (HU0001) a la ruta pública /publico/solicitud-informacion (ADR-17). Pasan por el cliente único
// (rules/frontend.md) con llamarApiPublica: sin token, porque la familia todavía no tiene sesión.
import type { CanalOrigen } from "../portal/reglasSolicitud";
import { llamarApiPublica } from "./cliente";
import { json, respuesta } from "./respuesta";

// Solo lo que P01 muestra: la API no expone vacantes ni cuotas en esta ruta.
export interface GradoPublico {
  id_grado: number;
  nivel: string;
  nombre_grado: string;
}

export interface FormularioSolicitud {
  campana: string;
  politica: { version: string; texto: string };
  grados: GradoPublico[];
}

export interface DatosSolicitud {
  nombres: string;
  apellidos: string;
  telefono: string; // E.164
  correo: string;
  id_grado: number;
  autoriza_whatsapp: boolean;
  acepta_politica: true;
  canal_origen: CanalOrigen;
  comentario: string; // campo trampa (ADR-17): una persona lo deja vacío
}

export async function obtenerFormulario(): Promise<FormularioSolicitud> {
  return respuesta(await llamarApiPublica("/publico/solicitud-informacion"));
}

// La API responde 201 { estado: "registrada" }, siempre igual y sin identificadores.
export async function enviarSolicitud(datos: DatosSolicitud): Promise<void> {
  await respuesta(await llamarApiPublica("/publico/solicitud-informacion", json("POST", datos)));
}
