// carta_vacante (HU0016; R18 y C62) y la firma de la Directora (D2-A). `url_documento` y `personal.firma_url` guardan la
// clave del almacenamiento cifrado (ADR-21). Aquí vive la ÚNICA definición de cuándo corresponde emitir la carta.
import type { Consultable } from "../db/pool";

export const TIPO_CARTA = "carta_emitida";

// R18 y C62: Pago de la cuota, fracción 1, conforme; o grado con cuota 0 y ningún Pago de cuota. Con cuota 0, un Pago
// existente quiere decir que el grado cambió después de registrarlo: decide Tesorería, no el barrido (C25 7).
const CUOTA_ACREDITADA = `(
  EXISTS (SELECT 1 FROM pago p
           WHERE p.id_expediente = e.id_expediente AND p.tipo_pago = 'cuota_ingreso' AND p.numero_fraccion = 1
             AND p.estado_validacion = 'conforme')
  OR (g.monto_cuota_ingreso = 0
      AND NOT EXISTS (SELECT 1 FROM pago p WHERE p.id_expediente = e.id_expediente AND p.tipo_pago = 'cuota_ingreso')))`;

export interface FilaCarta {
  id_carta: number;
  id_expediente: number;
  id_personal_autoriza: number;
  fecha_emision: Date;
  url_documento: string;
}

const COLUMNAS_CARTA = "id_carta, id_expediente, id_personal_autoriza, fecha_emision, url_documento";

export async function leerCarta(db: Consultable, idExpediente: number): Promise<FilaCarta | null> {
  const { rows } = await db.query<FilaCarta>(`SELECT ${COLUMNAS_CARTA} FROM carta_vacante WHERE id_expediente = $1`, [idExpediente]);
  return rows[0] ?? null;
}

export async function insertarCarta(
  db: Consultable,
  c: { idExpediente: number; idPersonalAutoriza: number; fechaEmision: Date; clave: string },
): Promise<FilaCarta> {
  const { rows } = await db.query<FilaCarta>(
    `INSERT INTO carta_vacante (id_expediente, id_personal_autoriza, fecha_emision, url_documento)
     VALUES ($1, $2, $3, $4) RETURNING ${COLUMNAS_CARTA}`,
    [c.idExpediente, c.idPersonalAutoriza, c.fechaEmision, c.clave],
  );
  return rows[0]!;
}

export interface DatosDeCarta {
  estado: string;
  campana_admision: string;
  nivel: string;
  nombre_grado: string;
  nombres: string | null;
  apellido_paterno: string | null;
  apellido_materno: string | null;
  acreditada: boolean;
}

// Lo que necesita la emisión, sin el DNI (D3-A): la carta no lo lleva y no hay por qué descifrarlo.
export async function leerDatosDeCarta(db: Consultable, idExpediente: number): Promise<DatosDeCarta | null> {
  const { rows } = await db.query<DatosDeCarta>(
    `SELECT e.estado::text AS estado, g.campana_admision, g.nivel::text AS nivel, g.nombre_grado,
            p.nombres, p.apellido_paterno, p.apellido_materno, ${CUOTA_ACREDITADA} AS acreditada
       FROM expediente e
       JOIN grado g ON g.id_grado = e.id_grado
       LEFT JOIN postulante p ON p.id_postulante = e.id_postulante
      WHERE e.id_expediente = $1`,
    [idExpediente],
  );
  return rows[0] ?? null;
}

export interface FirmaVigente {
  id_personal: number;
  nombres: string;
  apellidos: string;
  firma_url: string;
}

// D2-A: la directora activa con firma cargada; si hay varias, la que adjudicó la vacante. Así, si la directora cambió entre
// la adjudicación y el pago, firma la vigente.
export async function leerFirmaVigente(db: Consultable, idExpediente: number): Promise<FirmaVigente | null> {
  const { rows } = await db.query<FirmaVigente>(
    `SELECT d.id_personal, d.nombres, d.apellidos, d.firma_url
       FROM personal d
      WHERE d.rol = 'directora' AND d.activo AND d.firma_url IS NOT NULL
      ORDER BY d.id_personal = (SELECT r.id_personal FROM registro_auditoria r
                                 WHERE r.id_expediente = $1 AND r.tipo_evento = 'transicion_estado'
                                   AND r.detalle->>'campo' = 'estado' AND r.estado_nuevo = 'vacante_asignada'
                                 ORDER BY r.id_evento DESC LIMIT 1) DESC NULLS LAST,
               d.id_personal
      LIMIT 1`,
    [idExpediente],
  );
  return rows[0] ?? null;
}

// Barrido de generacion-carta: cartas por emitir, y cartas cuyo aviso no tiene intentos o espera una retoma (ADR-07; la API
// pudo caer entre la emisión y la reserva). Sin espera inicial: la emisión y la reserva son idempotentes, así que un barrido
// que se cruza con el webhook no duplica nada. Los barridos de n8n no filtran por campaña: la demo se excluye aquí (C72).
export async function listarCartasPendientes(
  db: Consultable,
  o: { campanaExcluida: string; tipoEvento: string; minutosReintento: number; limite: number },
): Promise<number[]> {
  const { rows } = await db.query<{ id_expediente: number }>(
    `WITH por_emitir AS (
       SELECT e.id_expediente
         FROM expediente e
         JOIN grado g ON g.id_grado = e.id_grado
        WHERE e.estado = 'vacante_asignada' AND g.campana_admision <> $1
          AND NOT EXISTS (SELECT 1 FROM carta_vacante cv WHERE cv.id_expediente = e.id_expediente)
          AND ${CUOTA_ACREDITADA}
     ), por_avisar AS (
       SELECT cv.id_expediente
         FROM carta_vacante cv
         JOIN expediente e ON e.id_expediente = cv.id_expediente
         JOIN grado g ON g.id_grado = e.id_grado
         CROSS JOIN LATERAL (
           SELECT count(*)::int AS intentos,
                  coalesce(bool_or(n.estado_envio <> 'pendiente'), false) AS cerrado,
                  (array_agg(n.fecha_envio ORDER BY n.id_notificacion DESC))[1] AS ultimo_intento
             FROM notificacion n
            WHERE n.id_expediente = cv.id_expediente AND n.canal = 'correo' AND n.tipo_evento = $2
         ) f
        WHERE g.campana_admision <> $1
          AND (f.intentos = 0 OR (NOT f.cerrado AND f.ultimo_intento < now() - make_interval(mins => $3)))
     )
     SELECT id_expediente FROM por_emitir
     UNION
     SELECT id_expediente FROM por_avisar
     ORDER BY id_expediente
     LIMIT $4`,
    [o.campanaExcluida, o.tipoEvento, o.minutosReintento, o.limite],
  );
  return rows.map((r) => r.id_expediente);
}

export interface VacanteOtorgada {
  id_expediente: number;
  nombres: string | null;
  apellidos: string | null;
  nombre_grado: string;
  monto_cuota_ingreso: string;
  estado_pago: string | null;
  acreditada: boolean;
}

// G07 (D5-A): los expedientes con la vacante otorgada de la campaña y el estado de su cuota.
export async function listarVacantesOtorgadas(db: Consultable, campana: string): Promise<VacanteOtorgada[]> {
  const { rows } = await db.query<VacanteOtorgada>(
    `SELECT e.id_expediente, p.nombres, concat_ws(' ', p.apellido_paterno, p.apellido_materno) AS apellidos, g.nombre_grado,
            g.monto_cuota_ingreso::text AS monto_cuota_ingreso, c.estado_validacion::text AS estado_pago, ${CUOTA_ACREDITADA} AS acreditada
       FROM expediente e
       JOIN grado g ON g.id_grado = e.id_grado
       LEFT JOIN postulante p ON p.id_postulante = e.id_postulante
       LEFT JOIN pago c ON c.id_expediente = e.id_expediente AND c.tipo_pago = 'cuota_ingreso' AND c.numero_fraccion = 1
      WHERE e.estado = 'vacante_asignada' AND g.campana_admision = $1
      ORDER BY e.id_expediente`,
    [campana],
  );
  return rows;
}

// La fila de una directora activa, bloqueada para que dos cargas de la firma no se pisen. null si el correo no es de una.
export async function bloquearDirectora(db: Consultable, correo: string): Promise<{ id_personal: number; firma_url: string | null } | null> {
  const { rows } = await db.query<{ id_personal: number; firma_url: string | null }>(
    "SELECT id_personal, firma_url FROM personal WHERE lower(correo) = lower($1) AND rol = 'directora' AND activo FOR UPDATE",
    [correo],
  );
  return rows[0] ?? null;
}

export async function fijarFirma(db: Consultable, idPersonal: number, clave: string): Promise<void> {
  await db.query("UPDATE personal SET firma_url = $2 WHERE id_personal = $1", [idPersonal, clave]);
}
