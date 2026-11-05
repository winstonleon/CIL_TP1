// Validaciones en paralelo del expediente (HU0008, HU0011 y HU0024; R9): la rama documental (documentos no financieros y
// `estado_documental`, Secretaría), la financiera (documentos de categoría `financiero` y `estado_financiero`, Tesorería)
// y la del derecho de admisión (`Pago.estado_validacion`, Tesorería). Las decisiones se toman con el expediente bloqueado
// (el mismo bloqueo de la carga de documentos), así que estas lecturas ven el estado confirmado de las otras ramas.
// El aviso de observaciones de una observación son las filas `subsanacion_solicitada` con id_notificacion ≥ la primera
// (`atencion_fin.detalle.id_notificacion`), como el aviso de faltantes de HU0017 (ADR-22).
import type { Consultable } from "../db/pool";
import type { IntentoAviso } from "./aviso";

export const TIPO_OBSERVACION = "subsanacion_solicitada";

export type Rama = "documental" | "financiera";

// Filtro SQL de la categoría de cada rama (lista cerrada, nunca entra texto del usuario).
const DE_RAMA: Record<Rama, string> = {
  documental: "r.categoria <> 'financiero'",
  financiera: "r.categoria = 'financiero'",
};

export interface Cabecera {
  id_expediente: number;
  estado: string;
  estado_documental: string;
  estado_financiero: string;
  campana_admision: string;
  nombre_grado: string;
  postulante_nombres: string | null;
  postulante_apellido_paterno: string | null;
  postulante_apellido_materno: string | null;
  apoderado_nombres: string;
  apoderado_apellidos: string;
  apoderado_telefono: string;
  id_pago_derecho: number | null;
  estado_derecho: string | null;
}

export async function leerCabecera(db: Consultable, idExpediente: number): Promise<Cabecera | null> {
  const { rows } = await db.query<Cabecera>(
    `SELECT e.id_expediente, e.estado::text AS estado, e.estado_documental::text AS estado_documental,
            e.estado_financiero::text AS estado_financiero, g.campana_admision, g.nombre_grado,
            p.nombres AS postulante_nombres, p.apellido_paterno AS postulante_apellido_paterno,
            p.apellido_materno AS postulante_apellido_materno,
            a.nombres AS apoderado_nombres, a.apellidos AS apoderado_apellidos, a.telefono AS apoderado_telefono,
            pg.id_pago AS id_pago_derecho, pg.estado_validacion::text AS estado_derecho
       FROM expediente e
       JOIN grado g ON g.id_grado = e.id_grado
       JOIN apoderado a ON a.id_apoderado = e.id_apoderado_titular
       LEFT JOIN postulante p ON p.id_postulante = e.id_postulante
       LEFT JOIN pago pg ON pg.id_expediente = e.id_expediente AND pg.tipo_pago = 'derecho_admision' AND pg.numero_fraccion = 1
      WHERE e.id_expediente = $1`,
    [idExpediente],
  );
  return rows[0] ?? null;
}

export interface DocumentoDeRama {
  id_documento: number;
  id_requisito: number;
  tipo_documento: string;
  categoria: string;
  id_apoderado: number | null;
  parentesco: string | null;
  formato: string;
  tamano_kb: number;
  fecha_carga: Date;
  estado_verificacion: string;
  motivo_observacion: string | null;
  // Motivo del documento al que este reemplazó en una subsanación (A1): se muestra como «motivo anterior».
  motivo_anterior: string | null;
}

// Documentos vigentes de una rama, con el parentesco del apoderado (nunca su nombre) y el motivo anterior si el documento
// llegó por una subsanación (evento subsanacion_registrada).
export async function documentosDeRama(db: Consultable, idExpediente: number, rama: Rama): Promise<DocumentoDeRama[]> {
  const { rows } = await db.query<DocumentoDeRama>(
    `SELECT d.id_documento, d.id_requisito, r.tipo_documento, r.categoria::text AS categoria, d.id_apoderado, pa.parentesco, d.formato, d.tamano_kb,
            d.fecha_carga, d.estado_verificacion::text AS estado_verificacion, d.motivo_observacion,
            (SELECT ant.motivo_observacion
               FROM registro_auditoria s
               JOIN documento ant ON ant.id_documento = (s.detalle->>'id_documento_anterior')::int
              WHERE s.id_expediente = d.id_expediente AND s.tipo_evento = 'subsanacion_registrada'
                AND (s.detalle->>'id_documento_nuevo')::int = d.id_documento
              LIMIT 1) AS motivo_anterior
       FROM documento d
       JOIN requisito_documental r ON r.id_requisito = d.id_requisito
       JOIN expediente e ON e.id_expediente = d.id_expediente
       LEFT JOIN postulante_apoderado pa ON pa.id_postulante = e.id_postulante AND pa.id_apoderado = d.id_apoderado
      WHERE d.id_expediente = $1 AND d.vigente AND ${DE_RAMA[rama]}
      ORDER BY r.id_requisito, d.id_apoderado NULLS FIRST, d.fecha_carga, d.id_documento`,
    [idExpediente],
  );
  return rows;
}

// Motivo del documento reemplazado en cada subsanación, por id del documento nuevo (P06: «motivo anterior»).
export async function motivosAnteriores(db: Consultable, idExpediente: number): Promise<Map<number, string>> {
  const { rows } = await db.query<{ id_documento: number; motivo: string }>(
    `SELECT (s.detalle->>'id_documento_nuevo')::int AS id_documento, ant.motivo_observacion AS motivo
       FROM registro_auditoria s
       JOIN documento ant ON ant.id_documento = (s.detalle->>'id_documento_anterior')::int
      WHERE s.id_expediente = $1 AND s.tipo_evento = 'subsanacion_registrada' AND s.detalle ? 'id_documento_nuevo'`,
    [idExpediente],
  );
  return new Map(rows.map((r) => [r.id_documento, r.motivo]));
}

export interface DocumentoConCategoria {
  id_documento: number;
  id_expediente: number;
  id_requisito: number;
  id_apoderado: number | null;
  categoria: string;
  formato: string;
  url_archivo: string;
  estado_verificacion: string;
  vigente: boolean;
}

const DOC_CATEGORIA = `SELECT d.id_documento, d.id_expediente, d.id_requisito, d.id_apoderado, r.categoria::text AS categoria, d.formato,
       d.url_archivo, d.estado_verificacion::text AS estado_verificacion, d.vigente
  FROM documento d JOIN requisito_documental r ON r.id_requisito = d.id_requisito
 WHERE d.id_documento = $1 AND d.id_expediente = $2`;

// El documento con su categoría, solo si es de ese expediente (también uno reemplazado: historial).
export async function leerDocumentoDeExpediente(db: Consultable, idDocumento: number, idExpediente: number): Promise<DocumentoConCategoria | null> {
  const { rows } = await db.query<DocumentoConCategoria>(DOC_CATEGORIA, [idDocumento, idExpediente]);
  return rows[0] ?? null;
}

export async function bloquearDocumentoDeExpediente(db: Consultable, idDocumento: number, idExpediente: number): Promise<DocumentoConCategoria | null> {
  const { rows } = await db.query<DocumentoConCategoria>(`${DOC_CATEGORIA} FOR UPDATE OF d`, [idDocumento, idExpediente]);
  return rows[0] ?? null;
}

export async function registrarDecisionDocumento(
  db: Consultable,
  d: { idDocumento: number; estado: "conforme" | "observado"; motivo: string | null; idPersonal: number },
): Promise<void> {
  await db.query(
    `UPDATE documento SET estado_verificacion = $2::estado_revision, motivo_observacion = $3, id_personal_revisor = $4
      WHERE id_documento = $1`,
    [d.idDocumento, d.estado, d.motivo, d.idPersonal],
  );
}

// Documentos vigentes de la rama que todavía no están conformes (para «Dar conformidad» y «Marcar conforme»).
export async function contarNoConformes(db: Consultable, idExpediente: number, rama: Rama): Promise<number> {
  const { rows } = await db.query<{ n: string }>(
    `SELECT count(*) AS n FROM documento d JOIN requisito_documental r ON r.id_requisito = d.id_requisito
      WHERE d.id_expediente = $1 AND d.vigente AND d.estado_verificacion <> 'conforme' AND ${DE_RAMA[rama]}`,
    [idExpediente],
  );
  return Number(rows[0]!.n);
}

export async function hayObservadosVigentes(db: Consultable, idExpediente: number, rama: Rama): Promise<boolean> {
  const { rowCount } = await db.query(
    `SELECT 1 FROM documento d JOIN requisito_documental r ON r.id_requisito = d.id_requisito
      WHERE d.id_expediente = $1 AND d.vigente AND d.estado_verificacion = 'observado' AND ${DE_RAMA[rama]} LIMIT 1`,
    [idExpediente],
  );
  return (rowCount ?? 0) > 0;
}

// Condición laboral declarada de cada apoderado del postulante (G05), con su parentesco.
export async function condicionesLaborales(db: Consultable, idExpediente: number): Promise<{ parentesco: string; condicion_laboral: string | null }[]> {
  const { rows } = await db.query<{ parentesco: string; condicion_laboral: string | null }>(
    `SELECT pa.parentesco, a.condicion_laboral::text AS condicion_laboral
       FROM expediente e
       JOIN postulante_apoderado pa ON pa.id_postulante = e.id_postulante
       JOIN apoderado a ON a.id_apoderado = pa.id_apoderado
      WHERE e.id_expediente = $1
      ORDER BY a.id_apoderado = e.id_apoderado_titular DESC, a.id_apoderado`,
    [idExpediente],
  );
  return rows;
}

// ---- Derecho de admisión (HU0024)

export interface PagoDerecho {
  id_pago: number;
  id_expediente: number;
  banco: string;
  numero_operacion: string;
  monto: string;
  fecha_pago: string;
  comprobante_url: string;
  estado_validacion: string;
  motivo_observacion: string | null;
}

const PAGO = `SELECT id_pago, id_expediente, banco, numero_operacion, monto::text AS monto, to_char(fecha_pago, 'YYYY-MM-DD') AS fecha_pago,
       comprobante_url, estado_validacion::text AS estado_validacion, motivo_observacion
  FROM pago WHERE id_pago = $1 AND tipo_pago = 'derecho_admision'`;

export async function leerPagoDerecho(db: Consultable, idPago: number): Promise<PagoDerecho | null> {
  const { rows } = await db.query<PagoDerecho>(PAGO, [idPago]);
  return rows[0] ?? null;
}

export async function bloquearPagoDerecho(db: Consultable, idPago: number): Promise<PagoDerecho | null> {
  const { rows } = await db.query<PagoDerecho>(`${PAGO} FOR UPDATE`, [idPago]);
  return rows[0] ?? null;
}

export async function registrarDecisionPago(
  db: Consultable,
  d: { idPago: number; estado: "conforme" | "observado"; motivo: string | null; idPersonal: number },
): Promise<void> {
  // El motivo de una observación anterior se reemplaza con la nueva decisión (conforme: sin motivo).
  await db.query(
    `UPDATE pago SET estado_validacion = $2::estado_revision, motivo_observacion = $3, id_personal_validador = $4
      WHERE id_pago = $1`,
    [d.idPago, d.estado, d.motivo, d.idPersonal],
  );
}

// Subsanación del derecho (A1): el comprobante nuevo en la misma fila, que vuelve a `pendiente` sin validador. El motivo
// se conserva hasta la nueva decisión de Tesorería (nota de Pago); los datos anteriores quedan en subsanacion_registrada.
export async function subsanarPagoDerecho(
  db: Consultable,
  d: { idPago: number; banco: string; numeroOperacion: string; fechaPago: string; clave: string },
): Promise<void> {
  await db.query(
    `UPDATE pago SET banco = $2, numero_operacion = $3, fecha_pago = $4::date, comprobante_url = $5,
            estado_validacion = 'pendiente', id_personal_validador = NULL
      WHERE id_pago = $1`,
    [d.idPago, d.banco, d.numeroOperacion, d.fechaPago, d.clave],
  );
}

// R19 sin contar el propio pago: la familia puede volver a presentar el mismo número de su comprobante observado.
export async function existeComprobanteDeOtroPago(db: Consultable, banco: string, numeroOperacion: string, idPago: number): Promise<boolean> {
  const { rowCount } = await db.query("SELECT 1 FROM pago WHERE banco = $1 AND numero_operacion = $2 AND id_pago <> $3", [banco, numeroOperacion, idPago]);
  return (rowCount ?? 0) > 0;
}

// ---- Unión de las tres ramas (R9)

export async function ramasConformes(db: Consultable, idExpediente: number): Promise<boolean> {
  const { rows } = await db.query<{ conformes: boolean }>(
    `SELECT e.estado = 'en_validacion' AND e.estado_documental = 'conforme' AND e.estado_financiero = 'conforme'
            AND coalesce(p.estado_validacion = 'conforme', false) AS conformes
       FROM expediente e
       LEFT JOIN pago p ON p.id_expediente = e.id_expediente AND p.tipo_pago = 'derecho_admision' AND p.numero_fraccion = 1
      WHERE e.id_expediente = $1`,
    [idExpediente],
  );
  return rows[0]?.conformes === true;
}

// ---- Aviso de observaciones (ADR-07)

export interface Observacion {
  tipo_documento: string;
  parentesco: string | null;
  motivo: string;
}

// Observaciones vigentes del expediente: documentos vigentes observados (de las dos ramas) y el comprobante observado.
export async function observacionesVigentes(db: Consultable, idExpediente: number): Promise<{ documentos: Observacion[]; derecho: string | null }> {
  const { rows } = await db.query<Observacion>(
    `SELECT r.tipo_documento, pa.parentesco, d.motivo_observacion AS motivo
       FROM documento d
       JOIN requisito_documental r ON r.id_requisito = d.id_requisito
       JOIN expediente e ON e.id_expediente = d.id_expediente
       LEFT JOIN postulante_apoderado pa ON pa.id_postulante = e.id_postulante AND pa.id_apoderado = d.id_apoderado
      WHERE d.id_expediente = $1 AND d.vigente AND d.estado_verificacion = 'observado'
      ORDER BY r.id_requisito, d.id_apoderado NULLS FIRST, d.id_documento`,
    [idExpediente],
  );
  const pago = await db.query<{ motivo: string }>(
    `SELECT motivo_observacion AS motivo FROM pago
      WHERE id_expediente = $1 AND tipo_pago = 'derecho_admision' AND numero_fraccion = 1 AND estado_validacion = 'observado'`,
    [idExpediente],
  );
  return { documentos: rows, derecho: pago.rows[0]?.motivo ?? null };
}

// Primer intento del aviso de la última observación del expediente (null si nunca hubo una).
export async function primerIntentoUltimaObservacion(db: Consultable, idExpediente: number): Promise<number | null> {
  const { rows } = await db.query<{ id_notificacion: number }>(
    `SELECT (detalle->>'id_notificacion')::int AS id_notificacion FROM registro_auditoria
      WHERE id_expediente = $1 AND tipo_evento = 'atencion_fin' AND detalle->>'decision' = 'observado' AND detalle ? 'id_notificacion'
      ORDER BY id_evento DESC LIMIT 1`,
    [idExpediente],
  );
  return rows[0]?.id_notificacion ?? null;
}

// Intentos del aviso de una observación, en orden y bloqueados hasta el fin de la transacción.
export async function bloquearIntentosObservacion(
  db: Consultable,
  a: { idExpediente: number; desde: number; minutosReintento: number },
): Promise<IntentoAviso[]> {
  const { rows } = await db.query<IntentoAviso>(
    `SELECT id_notificacion, estado_envio::text AS estado_envio, fecha_envio < now() - make_interval(mins => $3) AS vencido
       FROM notificacion
      WHERE id_expediente = $1 AND canal = 'correo' AND tipo_evento = '${TIPO_OBSERVACION}' AND id_notificacion >= $2
      ORDER BY id_notificacion
        FOR UPDATE`,
    [a.idExpediente, a.desde, a.minutosReintento],
  );
  return rows;
}

// Barrido (ADR-16): expedientes en en_validacion con observaciones vigentes cuyo aviso de la última observación no se
// cerró y tiene el último intento `pendiente` de hace más de `minutosReintento` (también el primero, si el webhook no
// llegó). Los más antiguos primero.
export async function listarObservacionesPendientes(db: Consultable, o: { minutosReintento: number; limite: number }): Promise<number[]> {
  const { rows } = await db.query<{ id_expediente: number }>(
    `SELECT e.id_expediente
       FROM expediente e
      CROSS JOIN LATERAL (
             SELECT (r.detalle->>'id_notificacion')::int AS desde FROM registro_auditoria r
              WHERE r.id_expediente = e.id_expediente AND r.tipo_evento = 'atencion_fin'
                AND r.detalle->>'decision' = 'observado' AND r.detalle ? 'id_notificacion'
              ORDER BY r.id_evento DESC LIMIT 1) o
      CROSS JOIN LATERAL (
             SELECT coalesce(bool_or(n.estado_envio <> 'pendiente'), false) AS cerrado,
                    (array_agg(n.estado_envio::text ORDER BY n.id_notificacion DESC))[1] AS ultimo_estado,
                    (array_agg(n.fecha_envio ORDER BY n.id_notificacion DESC))[1] AS ultimo_intento
               FROM notificacion n
              WHERE n.id_expediente = e.id_expediente AND n.canal = 'correo' AND n.tipo_evento = '${TIPO_OBSERVACION}'
                AND n.id_notificacion >= o.desde) f
      WHERE e.estado = 'en_validacion' AND NOT f.cerrado AND f.ultimo_estado = 'pendiente'
        AND f.ultimo_intento < now() - make_interval(mins => $1)
        AND (EXISTS (SELECT 1 FROM documento d WHERE d.id_expediente = e.id_expediente AND d.vigente AND d.estado_verificacion = 'observado')
          OR EXISTS (SELECT 1 FROM pago p WHERE p.id_expediente = e.id_expediente AND p.tipo_pago = 'derecho_admision'
                                            AND p.estado_validacion = 'observado'))
      ORDER BY f.ultimo_intento, e.id_expediente
      LIMIT $2`,
    [o.minutosReintento, o.limite],
  );
  return rows.map((r) => r.id_expediente);
}

// ---- Bandeja G02 (Secretaría) y lista G05 (Tesorería)

// Columnas comunes de un expediente en validación de la campaña: código, postulante, apoderado titular, grado, la
// última actividad (último evento de la bitácora) y desde cuándo está en en_validacion.
const EN_VALIDACION = `SELECT e.id_expediente, g.id_grado, g.nombre_grado, g.campana_admision,
       'ADM-' || g.campana_admision || '-' || lpad(e.id_expediente::text, 4, '0') AS codigo,
       p.nombres AS postulante_nombres, concat_ws(' ', p.apellido_paterno, p.apellido_materno) AS postulante_apellidos,
       a.nombres AS apoderado_nombres, a.apellidos AS apoderado_apellidos,
       e.estado_documental::text AS estado_documental, e.estado_financiero::text AS estado_financiero,
       (SELECT max(r.fecha_hora) FROM registro_auditoria r WHERE r.id_expediente = e.id_expediente) AS ultima_actividad,
       (SELECT max(r.fecha_hora) FROM registro_auditoria r
         WHERE r.id_expediente = e.id_expediente AND r.tipo_evento = 'transicion_estado'
           AND r.detalle->>'campo' = 'estado' AND r.estado_nuevo = 'en_validacion') AS en_validacion_desde
  FROM expediente e
  JOIN grado g ON g.id_grado = e.id_grado
  JOIN apoderado a ON a.id_apoderado = e.id_apoderado_titular
  LEFT JOIN postulante p ON p.id_postulante = e.id_postulante
 WHERE e.estado = 'en_validacion' AND g.campana_admision = $1`;

// ¿La rama tuvo alguna subsanación? (etiqueta «Subsanado» de G02 y G05 cuando la rama volvió a `pendiente`).
const SUBSANADO = (tipoItem: string, id: string) => `EXISTS (SELECT 1 FROM registro_auditoria s
   WHERE s.id_expediente = b.id_expediente AND s.tipo_evento = 'subsanacion_registrada'
     AND s.detalle->'item'->>'tipo' = '${tipoItem}' AND (s.detalle->'item'->>'id')::int = ${id})`;

// Motivos de las observaciones ya subsanadas de una rama cuyo documento nuevo espera revisión (G02 y G05: «motivo
// anterior», nunca como observación vigente).
const MOTIVOS_ANTERIORES = (tipoItem: string) => `coalesce((SELECT array_agg(ant.motivo_observacion ORDER BY s.id_evento)
   FROM registro_auditoria s
   JOIN documento nuevo ON nuevo.id_documento = (s.detalle->>'id_documento_nuevo')::int
                       AND nuevo.vigente AND nuevo.estado_verificacion = 'pendiente'
   JOIN documento ant ON ant.id_documento = (s.detalle->>'id_documento_anterior')::int
  WHERE s.id_expediente = b.id_expediente AND s.tipo_evento = 'subsanacion_registrada'
    AND s.detalle->'item'->>'tipo' = '${tipoItem}'), '{}')`;

export interface FilaBandeja {
  id_expediente: number;
  id_grado: number;
  nombre_grado: string;
  codigo: string;
  postulante_nombres: string | null;
  postulante_apellidos: string | null;
  apoderado_nombres: string;
  apoderado_apellidos: string;
  estado_documental: string;
  subsanado: boolean;
  motivos_anteriores: string[];
  ultima_actividad: Date | null;
  en_validacion_desde: Date | null;
}

export type VistaBandeja = "por_revisar" | "observados" | "todos";
const FILTRO_VISTA: Record<VistaBandeja, string> = {
  por_revisar: "b.estado_documental = 'pendiente'",
  observados: "b.estado_documental = 'observado'",
  todos: "true",
};

// Escapa los comodines de LIKE en la búsqueda libre.
const patron = (q: string) => `%${q.toLowerCase().replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

export async function listarBandeja(
  db: Consultable,
  f: { campana: string; vista: VistaBandeja; idGrado?: number; q?: string; recientes: boolean },
): Promise<{ filas: FilaBandeja[]; conteos: Record<VistaBandeja, number> }> {
  const { rows } = await db.query<FilaBandeja>(
    `WITH b AS (${EN_VALIDACION})
     SELECT b.id_expediente, b.id_grado, b.nombre_grado, b.codigo, b.postulante_nombres, b.postulante_apellidos,
            b.apoderado_nombres, b.apoderado_apellidos, b.estado_documental, ${SUBSANADO("validacion_documental", "b.id_expediente")} AS subsanado,
            ${MOTIVOS_ANTERIORES("validacion_documental")} AS motivos_anteriores, b.ultima_actividad, b.en_validacion_desde
       FROM b
      WHERE ${FILTRO_VISTA[f.vista]}
        AND ($2::int IS NULL OR b.id_grado = $2)
        AND ($3::text IS NULL OR lower(concat_ws(' ', b.codigo, b.postulante_nombres, b.postulante_apellidos,
                                                b.apoderado_nombres, b.apoderado_apellidos)) LIKE $3)
      ORDER BY b.en_validacion_desde ${f.recientes ? "DESC" : "ASC"} NULLS LAST, b.id_expediente`,
    [f.campana, f.idGrado ?? null, f.q ? patron(f.q) : null],
  );
  const conteo = await db.query<{ por_revisar: number; observados: number; todos: number }>(
    `WITH b AS (${EN_VALIDACION})
     SELECT count(*) FILTER (WHERE ${FILTRO_VISTA.por_revisar})::int AS por_revisar,
            count(*) FILTER (WHERE ${FILTRO_VISTA.observados})::int AS observados,
            count(*)::int AS todos
       FROM b`,
    [f.campana],
  );
  return { filas: rows, conteos: conteo.rows[0]! };
}

export interface ItemTesoreria {
  concepto: "documentacion_financiera" | "derecho_admision";
  id_expediente: number;
  id_pago: number | null;
  codigo: string;
  postulante_nombres: string | null;
  postulante_apellidos: string | null;
  nombre_grado: string;
  monto: string | null;
  estado: string;
  subsanado: boolean;
  motivos_anteriores: string[];
  recibido: Date | null;
}

// Lista de G05: la documentación financiera y el comprobante del derecho que no están conformes. «Recibido»: la última
// subsanación del ítem o, si no hubo, la entrada a en_validacion (Pago no guarda su fecha de registro, C49).
export async function listarTesoreria(db: Consultable, campana: string): Promise<ItemTesoreria[]> {
  const { rows } = await db.query<ItemTesoreria>(
    `WITH b AS (${EN_VALIDACION})
     SELECT 'documentacion_financiera' AS concepto, b.id_expediente, NULL::int AS id_pago, b.codigo, b.postulante_nombres,
            b.postulante_apellidos, b.nombre_grado, NULL::text AS monto, b.estado_financiero AS estado,
            ${SUBSANADO("documentacion_financiera", "b.id_expediente")} AS subsanado,
            ${MOTIVOS_ANTERIORES("documentacion_financiera")} AS motivos_anteriores,
            coalesce((SELECT max(s.fecha_hora) FROM registro_auditoria s WHERE s.id_expediente = b.id_expediente
                        AND s.tipo_evento = 'subsanacion_registrada' AND s.detalle->'item'->>'tipo' = 'documentacion_financiera'),
                     b.en_validacion_desde) AS recibido
       FROM b WHERE b.estado_financiero <> 'conforme'
     UNION ALL
     SELECT 'derecho_admision', b.id_expediente, p.id_pago, b.codigo, b.postulante_nombres, b.postulante_apellidos,
            b.nombre_grado, p.monto::text, p.estado_validacion::text, ${SUBSANADO("pago", "p.id_pago")},
            -- El motivo se conserva hasta la nueva decisión (nota de Pago): en pendiente es el de la observación subsanada.
            CASE WHEN p.estado_validacion = 'pendiente' AND p.motivo_observacion IS NOT NULL THEN ARRAY[p.motivo_observacion]
                 ELSE '{}'::text[] END,
            coalesce((SELECT max(s.fecha_hora) FROM registro_auditoria s WHERE s.id_expediente = b.id_expediente
                        AND s.tipo_evento = 'subsanacion_registrada' AND s.detalle->'item'->>'tipo' = 'pago'),
                     b.en_validacion_desde)
       FROM b JOIN pago p ON p.id_expediente = b.id_expediente AND p.tipo_pago = 'derecho_admision' AND p.numero_fraccion = 1
      WHERE p.estado_validacion <> 'conforme'
      ORDER BY recibido NULLS LAST, id_expediente, concepto`,
    [campana],
  );
  return rows;
}
