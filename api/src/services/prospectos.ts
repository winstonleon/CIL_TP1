// Prospectos con contacto no entregado (G04, HU0002-2.0): la «alerta al personal de admisión» es la sección de G04 que
// lista los prospectos cuyo correo de la carpeta rebotó, para que Secretaría corrija los datos y reenvíe la carpeta.
// Corregir y reenviar no tienen escenario todavía (brecha C32).
import { obtenerPool } from "../db/pool";
import { listarContactoNoEntregado } from "../repositories/prospecto";

export interface ProspectoContactoNoEntregado {
  id_expediente: number;
  nombres: string;
  apellidos: string;
  grado: { nivel: string; nombre_grado: string };
  correo: string;
  telefono: string;
  fecha_rebote: string | null;
}

export async function prospectosContactoNoEntregado(campana: string): Promise<{ prospectos: ProspectoContactoNoEntregado[] }> {
  const filas = await listarContactoNoEntregado(obtenerPool(), campana);
  return {
    prospectos: filas.map((f) => ({
      id_expediente: f.id_expediente,
      nombres: f.nombres,
      apellidos: f.apellidos,
      grado: { nivel: f.nivel, nombre_grado: f.nombre_grado },
      correo: f.correo,
      telefono: f.telefono,
      fecha_rebote: f.fecha_rebote?.toISOString() ?? null,
    })),
  };
}
