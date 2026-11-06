// Adjudicación de vacantes (HU0012, G07; R14 y R15) y datos de la cuota de ingreso del expediente (HU0013, R17).
// La decisión se toma con el expediente y después el grado bloqueados: el mismo FOR UPDATE de la fila del grado que usa
// G09 (bloquearGrados), así dos adjudicaciones no venden el mismo cupo y R15 no se cruza con una adjudicación.
import type { Consultable } from "../db/pool";

export interface AptoPorDecidir {
  id_expediente: number;
  codigo: string;
  postulante_nombres: string | null;
  postulante_apellidos: string | null;
  nombre_grado: string;
  dictamen: string;
  vacantes_disponibles: number;
  recibido: Date | null;
}

// Expedientes en `apto` de la campaña: «deriva a la Dirección» (HU0010-1.0, C58). «Recibido» es la entrada a apto.
export async function listarAptos(db: Consultable, campana: string): Promise<AptoPorDecidir[]> {
  const { rows } = await db.query<AptoPorDecidir>(
    `SELECT e.id_expediente, 'ADM-' || g.campana_admision || '-' || lpad(e.id_expediente::text, 4, '0') AS codigo,
            p.nombres AS postulante_nombres, concat_ws(' ', p.apellido_paterno, p.apellido_materno) AS postulante_apellidos,
            g.nombre_grado, d.dictamen::text AS dictamen, g.vacantes_disponibles,
            (SELECT max(r.fecha_hora) FROM registro_auditoria r
              WHERE r.id_expediente = e.id_expediente AND r.tipo_evento = 'transicion_estado'
                AND r.detalle->>'campo' = 'estado' AND r.estado_nuevo = 'apto') AS recibido
       FROM expediente e
       JOIN grado g ON g.id_grado = e.id_grado
       JOIN dictamen_admision d ON d.id_expediente = e.id_expediente
       LEFT JOIN postulante p ON p.id_postulante = e.id_postulante
      WHERE e.estado = 'apto' AND g.campana_admision = $1
      ORDER BY recibido NULLS LAST, e.id_expediente`,
    [campana],
  );
  return rows;
}

export interface FilaInventario {
  id_grado: number;
  nivel: string;
  nombre_grado: string;
  vacantes_autorizadas: number;
  vacantes_disponibles: number;
  lista_espera: number;
}

// Inventario de G07. Adjudicadas = autorizadas − disponibles (R15, ADR-14): la calcula el servicio.
export async function inventarioVacantes(db: Consultable, campana: string): Promise<FilaInventario[]> {
  const { rows } = await db.query<FilaInventario>(
    `SELECT g.id_grado, g.nivel::text AS nivel, g.nombre_grado, g.vacantes_autorizadas, g.vacantes_disponibles,
            (SELECT count(*)::int FROM expediente e WHERE e.id_grado = g.id_grado AND e.estado = 'lista_espera') AS lista_espera
       FROM grado g
      WHERE g.campana_admision = $1
      ORDER BY g.nivel, g.id_grado`,
    [campana],
  );
  return rows;
}

export interface GradoBloqueado {
  id_grado: number;
  vacantes_disponibles: number;
  monto_cuota_ingreso: string; // numeric llega como texto
}

// La fila del grado del expediente, bloqueada hasta el fin de la transacción (R14).
export async function bloquearGradoDeExpediente(db: Consultable, idExpediente: number): Promise<GradoBloqueado | null> {
  const { rows } = await db.query<GradoBloqueado>(
    `SELECT g.id_grado, g.vacantes_disponibles, g.monto_cuota_ingreso::text AS monto_cuota_ingreso
       FROM grado g JOIN expediente e ON e.id_grado = g.id_grado
      WHERE e.id_expediente = $1
        FOR UPDATE OF g`,
    [idExpediente],
  );
  return rows[0] ?? null;
}

export async function descontarVacante(db: Consultable, idGrado: number): Promise<void> {
  await db.query("UPDATE grado SET vacantes_disponibles = vacantes_disponibles - 1 WHERE id_grado = $1", [idGrado]);
}

// La posición siguiente de la lista de espera del grado (R14). Con la fila del grado bloqueada, dos expedientes no la repiten.
export async function siguientePosicion(db: Consultable, idGrado: number): Promise<number> {
  const { rows } = await db.query<{ posicion: number }>(
    `SELECT coalesce(max(posicion_lista_espera), 0)::int + 1 AS posicion FROM expediente
      WHERE id_grado = $1 AND estado = 'lista_espera'`,
    [idGrado],
  );
  return rows[0]!.posicion;
}

// Después de la transición: ck_expediente_posicion_lista_espera exige estado = lista_espera y no se puede diferir (C4).
export async function fijarPosicion(db: Consultable, idExpediente: number, posicion: number): Promise<void> {
  await db.query("UPDATE expediente SET posicion_lista_espera = $2 WHERE id_expediente = $1", [idExpediente, posicion]);
}

export interface CuotaDeExpediente {
  nombre_grado: string;
  nivel: string;
  monto: string; // numeric llega como texto
  max_fracciones: number;
  modalidad: "unico" | "fraccionado" | null;
  numero_fracciones: number | null;
  posicion_lista_espera: number | null;
}

// Configuración vigente del grado (G09) y lo que eligió la familia (C25 punto 7: rige el valor vigente).
export async function leerCuotaDeExpediente(db: Consultable, idExpediente: number): Promise<CuotaDeExpediente | null> {
  const { rows } = await db.query<CuotaDeExpediente>(
    `SELECT g.nombre_grado, g.nivel::text AS nivel, g.monto_cuota_ingreso::text AS monto, g.max_fracciones,
            e.modalidad_pago_cuota::text AS modalidad, e.numero_fracciones, e.posicion_lista_espera
       FROM expediente e JOIN grado g ON g.id_grado = e.id_grado
      WHERE e.id_expediente = $1`,
    [idExpediente],
  );
  return rows[0] ?? null;
}

export async function fijarModalidad(db: Consultable, idExpediente: number, modalidad: "unico" | "fraccionado", numeroFracciones: number): Promise<void> {
  await db.query("UPDATE expediente SET modalidad_pago_cuota = $2::modalidad_pago, numero_fracciones = $3 WHERE id_expediente = $1", [
    idExpediente,
    modalidad,
    numeroFracciones,
  ]);
}
