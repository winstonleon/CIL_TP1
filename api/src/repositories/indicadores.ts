// Consultas del tablero de indicadores (HU0019, G08). Solo lectura, y solo ids, códigos y fechas: ninguna columna con datos
// personales ni cifrada. La cohorte son los expedientes de la campaña (y del grado) con fecha de registro en el rango, en
// días de Lima (decisión de John, 05/11/2026): así el embudo nunca crece de una etapa a la siguiente.
import type { Consultable } from "../db/pool";

export interface FiltrosIndicadores {
  campana: string;
  idGrado?: number;
  desde?: string; // AAAA-MM-DD, incluido
  hasta?: string; // AAAA-MM-DD, incluido
}

const COHORTE = `
  SELECT e.id_expediente, e.fecha_registro, e.estado::text AS estado, g.nombre_grado,
         'ADM-' || g.campana_admision || '-' || lpad(e.id_expediente::text, 4, '0') AS codigo
    FROM expediente e
    JOIN grado g ON g.id_grado = e.id_grado
   WHERE g.campana_admision = $1
     AND ($2::int IS NULL OR g.id_grado = $2)
     AND ($3::date IS NULL OR e.fecha_registro >= $3::date::timestamp AT TIME ZONE 'America/Lima')
     AND ($4::date IS NULL OR e.fecha_registro < ($4::date + 1)::timestamp AT TIME ZONE 'America/Lima')`;

const parametros = (f: FiltrosIndicadores) => [f.campana, f.idGrado ?? null, f.desde ?? null, f.hasta ?? null];

export interface FilaExpediente {
  id_expediente: number;
  codigo: string;
  nombre_grado: string;
  estado: string;
  registro: number; // epoch en segundos, como las llegadas
  hitos: Record<string, number>; // primera llegada a cada estado del expediente
  ultima: number | null; // la transición de estado más reciente
  observado: boolean; // alguna observación del personal («Requirieron subsanación»)
}

// Una fila por expediente de la cohorte, con sus transiciones de `estado` (no las de las ramas de R9).
export async function filasDeCohorte(db: Consultable, f: FiltrosIndicadores): Promise<FilaExpediente[]> {
  const { rows } = await db.query<FilaExpediente>(
    `WITH cohorte AS (${COHORTE})
     SELECT c.id_expediente, c.codigo, c.nombre_grado, c.estado,
            extract(epoch FROM c.fecha_registro)::float8 AS registro,
            coalesce(h.hitos, '{}'::jsonb) AS hitos, h.ultima,
            EXISTS (SELECT 1 FROM registro_auditoria o
                     WHERE o.id_expediente = c.id_expediente AND o.tipo_evento = 'atencion_fin'
                       AND o.detalle->>'decision' = 'observado') AS observado
       FROM cohorte c
       LEFT JOIN LATERAL (
         SELECT jsonb_object_agg(t.estado_nuevo, t.llegada) AS hitos, max(t.ultima) AS ultima
           FROM (SELECT r.estado_nuevo,
                        extract(epoch FROM min(r.fecha_hora))::float8 AS llegada,
                        extract(epoch FROM max(r.fecha_hora))::float8 AS ultima
                   FROM registro_auditoria r
                  WHERE r.id_expediente = c.id_expediente AND r.tipo_evento = 'transicion_estado'
                    AND r.detalle->>'campo' = 'estado'
                  GROUP BY r.estado_nuevo) t) h ON true
      ORDER BY c.id_expediente`,
    parametros(f),
  );
  return rows;
}

export interface FilaCycleTime {
  id_expediente: number;
  etapa: string;
  segundos: number;
}

// Cycle time (ADR-05, §4.7): suma por expediente y etapa de los intervalos entre cada atencion_fin y el atencion_inicio de
// su id_evento_inicio. Un inicio sin fin en 8 h no se cuenta: tampoco el que se cerró después, porque inicioAbierto no
// limita el tiempo. Un fin con inicio nulo no se cuenta (el JOIN lo descarta).
export async function cycleTimePorEtapa(db: Consultable, f: FiltrosIndicadores): Promise<FilaCycleTime[]> {
  const { rows } = await db.query<FilaCycleTime>(
    `WITH cohorte AS (${COHORTE}),
     pares AS (
       SELECT fin.id_expediente,
              CASE fin.detalle->'item'->>'tipo'
                WHEN 'validacion_documental' THEN 'verificacion_pagos'
                WHEN 'documentacion_financiera' THEN 'verificacion_pagos'
                WHEN 'cita' THEN 'evaluaciones_dictamen'
                WHEN 'dictamen' THEN 'evaluaciones_dictamen'
                WHEN 'adjudicacion' THEN 'adjudicacion'
                WHEN 'pago' THEN CASE p.tipo_pago::text WHEN 'derecho_admision' THEN 'verificacion_pagos'
                                                        WHEN 'cuota_ingreso' THEN 'cuota_carta' END
              END AS etapa,
              extract(epoch FROM fin.fecha_hora - ini.fecha_hora)::float8 AS segundos
         FROM cohorte c
         JOIN registro_auditoria fin ON fin.id_expediente = c.id_expediente AND fin.tipo_evento = 'atencion_fin'
         JOIN registro_auditoria ini ON ini.id_evento = (fin.detalle->>'id_evento_inicio')::bigint
                                    AND ini.tipo_evento = 'atencion_inicio'
         LEFT JOIN pago p ON fin.detalle->'item'->>'tipo' = 'pago' AND p.id_pago = (fin.detalle->'item'->>'id')::int
        WHERE fin.fecha_hora - ini.fecha_hora <= interval '8 hours')
     SELECT id_expediente, etapa, sum(segundos)::float8 AS segundos
       FROM pares
      WHERE etapa IS NOT NULL
      GROUP BY id_expediente, etapa`,
    parametros(f),
  );
  return rows;
}

// Filtros de G08: las campañas que tienen grados y los grados de cada una.
export async function opcionesDeFiltro(db: Consultable): Promise<{ id_grado: number; nivel: string; nombre_grado: string; campana_admision: string }[]> {
  const { rows } = await db.query<{ id_grado: number; nivel: string; nombre_grado: string; campana_admision: string }>(
    `SELECT id_grado, nivel::text AS nivel, nombre_grado, campana_admision
       FROM grado
      ORDER BY campana_admision DESC, nivel, id_grado`,
  );
  return rows;
}
