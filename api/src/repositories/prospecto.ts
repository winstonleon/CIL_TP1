// Prospectos para Secretaría (G04, HU0002-2.0). Sin DNI: G04 muestra nombre, grado de interés, correo, teléfono y fecha.
import type { Consultable } from "../db/pool";

export interface FilaContactoNoEntregado {
  id_expediente: number;
  nombres: string;
  apellidos: string;
  nivel: string;
  nombre_grado: string;
  correo: string;
  telefono: string;
  fecha_rebote: Date | null;
}

// Expedientes en contacto_no_entregado de la campaña, con la fecha de su último rebote (notificacion_rebotada).
// Los rebotes más recientes primero.
export async function listarContactoNoEntregado(db: Consultable, campana: string): Promise<FilaContactoNoEntregado[]> {
  const { rows } = await db.query<FilaContactoNoEntregado>(
    `SELECT e.id_expediente, a.nombres, a.apellidos, g.nivel::text AS nivel, g.nombre_grado, a.correo, a.telefono,
            (SELECT max(r.fecha_hora) FROM registro_auditoria r
              WHERE r.id_expediente = e.id_expediente AND r.tipo_evento = 'notificacion_rebotada') AS fecha_rebote
       FROM expediente e
       JOIN apoderado a ON a.id_apoderado = e.id_apoderado_titular
       JOIN grado g ON g.id_grado = e.id_grado
      WHERE e.estado = 'contacto_no_entregado' AND g.campana_admision = $1
      ORDER BY fecha_rebote DESC NULLS LAST, e.id_expediente DESC`,
    [campana],
  );
  return rows;
}
