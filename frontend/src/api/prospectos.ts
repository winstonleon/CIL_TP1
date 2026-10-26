// Llamadas de G04 (Visitas guiadas, HU0002-2.0) a /prospectos. Pasan por el cliente único llamarApi (rules/frontend.md).
import { llamarApi } from "./cliente";
import { respuesta } from "./respuesta";

export interface ProspectoContactoNoEntregado {
  id_expediente: number;
  nombres: string;
  apellidos: string;
  grado: { nivel: string; nombre_grado: string };
  correo: string;
  telefono: string; // E.164, p. ej. "+51984222731" (ADR-17)
  fecha_rebote: string | null; // ISO 8601 del último notificacion_rebotada
}

// Prospectos cuyo correo de la carpeta informativa rebotó, los más recientes primero.
export async function listarContactoNoEntregado(): Promise<ProspectoContactoNoEntregado[]> {
  const cuerpo = await respuesta<{ prospectos: ProspectoContactoNoEntregado[] }>(
    await llamarApi("gestion", "/prospectos/contacto-no-entregado"),
  );
  return cuerpo.prospectos;
}
