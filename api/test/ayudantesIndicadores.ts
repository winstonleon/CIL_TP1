// Fixtures de HU0019: una campaña propia por prueba y trayectos de expediente con fechas fijas, escritos por SQL (la bitácora
// admite fijar fecha_hora al insertar). Así cada cálculo del tablero se compara con números exactos. Datos @ejemplo.test.
import { randomUUID } from "node:crypto";
import request from "supertest";
import { crearApp } from "../src/app";
import type { Consultable } from "../src/db/pool";
import type { LineaBase } from "../src/services/lineaBase";
import { crearApoderado, crearFirmante, crearPersonal, unico } from "./ayudantes";
import { crearIdentidadFalsa } from "./identidadFalsa";

type Firmante = Awaited<ReturnType<typeof crearFirmante>>;
type Paso = readonly [estado: string, fecha: string];

export const RUTA_INDICADORES = "/direccion/indicadores";
export const LIMA = (fecha: string) => `${fecha}-05:00`;

export async function entornoIndicadores(db: Consultable, firmante: Firmante, lineaBase?: LineaBase) {
  const campana = `I${unico()}`; // 9 caracteres: cabe en varchar(10)
  const app = crearApp({
    opcionesToken: firmante.opcionesToken,
    identidad: crearIdentidadFalsa().identidad,
    campanaActiva: campana,
    eventos: { disparar: async () => undefined },
    ...(lineaBase ? { lineaBase } : {}),
  });
  const subDirectora = randomUUID();
  const directora = await crearPersonal(db, "directora", subDirectora);
  const tokenDirectora = await firmante.token(subDirectora, ["directora"]);
  const secretaria = await crearPersonal(db, "secretaria");

  async function grado(d: Partial<{ autorizadas: number; disponibles: number; nombre: string; campana: string }> = {}) {
    const autorizadas = d.autorizadas ?? 10;
    const { rows } = await db.query<{ id_grado: number }>(
      `INSERT INTO grado (nivel, nombre_grado, campana_admision, vacantes_autorizadas, vacantes_disponibles, monto_cuota_ingreso)
       VALUES ('primaria', $1, $2, $3, $4, 7000) RETURNING id_grado`,
      [d.nombre ?? `3.° de primaria ${unico()}`, d.campana ?? campana, autorizadas, d.disponibles ?? autorizadas],
    );
    return rows[0]!.id_grado;
  }

  // Un expediente con su registro y sus transiciones de `estado`, en orden; termina en el último estado.
  async function trayecto(idGrado: number, registro: string, pasos: readonly Paso[] = []) {
    const idApoderado = await crearApoderado(db);
    const final = pasos.at(-1)?.[0] ?? "prospecto";
    const { rows } = await db.query<{ id_expediente: number }>(
      `INSERT INTO expediente (id_apoderado_titular, id_grado, fecha_registro, estado)
       VALUES ($1, $2, $3::timestamptz, $4::estado_expediente) RETURNING id_expediente`,
      [idApoderado, idGrado, LIMA(registro), final],
    );
    const idExpediente = rows[0]!.id_expediente;
    let anterior = "prospecto";
    for (const [estado, fecha] of pasos) {
      await db.query(
        `INSERT INTO registro_auditoria (id_expediente, tipo_evento, estado_anterior, estado_nuevo, detalle, fecha_hora)
         VALUES ($1, 'transicion_estado', $2, $3, '{"campo":"estado"}', $4::timestamptz)`,
        [idExpediente, anterior, estado, LIMA(fecha)],
      );
      anterior = estado;
    }
    return idExpediente;
  }

  // Un atencion_inicio y, si se indica, su atencion_fin emparejado.
  async function atencion(
    idExpediente: number,
    item: { tipo: string; id: number },
    inicio: string,
    fin: string | null,
    o: { sinEmparejar?: boolean; decision?: string } = {},
  ) {
    const { rows } = await db.query<{ id_evento: string }>(
      `INSERT INTO registro_auditoria (id_expediente, id_personal, tipo_evento, detalle, fecha_hora)
       VALUES ($1, $2, 'atencion_inicio', $3, $4::timestamptz) RETURNING id_evento`,
      [idExpediente, secretaria, JSON.stringify({ item }), LIMA(inicio)],
    );
    if (fin === null) return;
    const detalle = { item, decision: o.decision ?? "conforme", id_evento_inicio: o.sinEmparejar ? null : Number(rows[0]!.id_evento) };
    await db.query(
      `INSERT INTO registro_auditoria (id_expediente, id_personal, tipo_evento, detalle, fecha_hora)
       VALUES ($1, $2, 'atencion_fin', $3, $4::timestamptz)`,
      [idExpediente, secretaria, JSON.stringify(detalle), LIMA(fin)],
    );
  }

  async function pago(idExpediente: number, tipo: "derecho_admision" | "cuota_ingreso") {
    const { rows } = await db.query<{ id_pago: number }>(
      `INSERT INTO pago (id_expediente, tipo_pago, numero_fraccion, numero_operacion, banco, monto, fecha_pago, comprobante_url)
       VALUES ($1, $2::tipo_pago, 1, $3, 'Banco ficticio', 300, '2026-10-10', $4) RETURNING id_pago`,
      [idExpediente, tipo, `OP-${unico()}`, `clave-${unico()}`],
    );
    return rows[0]!.id_pago;
  }

  const notificacion = (idExpediente: number, tipo: string, estado: "pendiente" | "enviado" | "fallido") =>
    db.query("INSERT INTO notificacion (id_expediente, canal, tipo_evento, estado_envio) VALUES ($1, 'correo', $2, $3::estado_envio)", [idExpediente, tipo, estado]);

  const consultar = (query: Record<string, string | number> = {}, token = tokenDirectora) =>
    request(app).get(RUTA_INDICADORES).query({ campana, ...query }).set("Authorization", `Bearer ${token}`);

  return { campana, app, directora, subDirectora, tokenDirectora, secretaria, grado, trayecto, atencion, pago, notificacion, consultar };
}
