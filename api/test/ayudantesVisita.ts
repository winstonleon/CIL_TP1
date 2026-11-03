// Fixtures de la visita guiada (HU0003 y HU0004) con datos ficticios @ejemplo.test. Cada prueba usa su propia campaña
// (crearApp({ campanaActiva })) para que los horarios de P02 y las visitas de G04 no se mezclen entre pruebas.
// «Hace N minutos»: el ancla de un aviso es la transicion_estado de su cita (B1) y la bitácora es de solo inserción,
// así que para simular el paso del tiempo se INSERTA la transición con una fecha anterior (nunca se actualiza).
import { randomUUID } from "node:crypto";
import request from "supertest";
import { vi } from "vitest";
import { crearApp } from "../src/app";
import { crearTokenVisita } from "../src/crypto/enlaceVisita";
import type { Consultable } from "../src/db/pool";
import type { DisparadorN8n } from "../src/orquestacion/n8n";
import { crearFirmante, crearPersonal, unico } from "./ayudantes";
import { crearIdentidadFalsa } from "./identidadFalsa";

export const SIN_LIMITE = { maximo: 100_000, ventanaMs: 60_000 };
export const TOKEN_INTERNO = () => process.env.INTERNAL_API_TOKEN!;

// App con campaña propia, Keycloak y n8n simulados, y una secretaria con fila activa (C22).
export async function entornoVisita(db: Consultable, firmante: Awaited<ReturnType<typeof crearFirmante>>) {
  const campana = `V${unico()}`; // 9 caracteres: cabe en varchar(10)
  const falsa = crearIdentidadFalsa();
  const eventos = { disparar: vi.fn<DisparadorN8n["disparar"]>(async () => undefined) };
  const app = crearApp({
    opcionesToken: firmante.opcionesToken,
    identidad: falsa.identidad,
    campanaActiva: campana,
    eventos,
    limitePublico: SIN_LIMITE,
    limiteLecturaVisita: SIN_LIMITE,
  });
  const sub = randomUUID();
  const idSecretaria = await crearPersonal(db, "secretaria", sub);
  const tokenSecretaria = await firmante.token(sub, ["secretaria"]);
  const directora = await crearPersonal(db, "directora");
  const interno = (r: request.Test) => r.set("Authorization", `Bearer ${TOKEN_INTERNO()}`);
  return { campana, falsa, eventos, app, idSecretaria, tokenSecretaria, directora, interno };
}

// Prospecto con su enlace de P02 (como el que lleva la carpeta, HU0002).
export async function prospecto(db: Consultable, campana: string, estado = "prospecto") {
  const nombreGrado = `3.° de primaria ${unico()}`;
  const { rows: [g] } = await db.query(
    `INSERT INTO grado (nivel, nombre_grado, campana_admision, vacantes_autorizadas, vacantes_disponibles, monto_cuota_ingreso)
     VALUES ('primaria', $1, $2, 10, 10, 7000) RETURNING id_grado`,
    [nombreGrado, campana],
  );
  const correo = `visita-${unico()}@ejemplo.test`;
  const { rows: [a] } = await db.query(
    `INSERT INTO apoderado (nombres, apellidos, telefono, correo) VALUES ('María Fernanda', 'Quispe Rojas', '+51987654321', $1)
     RETURNING id_apoderado`,
    [correo],
  );
  const { rows: [e] } = await db.query(
    "INSERT INTO expediente (id_apoderado_titular, id_grado, estado) VALUES ($1, $2, $3::estado_expediente) RETURNING id_expediente",
    [a.id_apoderado, g.id_grado, estado],
  );
  return { idExpediente: e.id_expediente as number, idApoderado: a.id_apoderado as number, correo, nombreGrado, token: crearTokenVisita(e.id_expediente) };
}

// Horario de visita a `dias` días de hoy (hora de Lima). Sin pasar por G09: las pruebas fijan los cupos que necesitan.
export async function horarioVisita(
  db: Consultable,
  idPersonal: number,
  campana: string,
  o: Partial<{ dias: number; inicio: string; fin: string; cupos: number; tipo: string }> = {},
) {
  const { rows } = await db.query<{ id_horario: number; fecha: string }>(
    `INSERT INTO horario_disponible (id_personal, tipo_cita, fecha, hora_inicio, hora_fin, cupos, campana_admision)
     VALUES ($1, $2::tipo_cita, (now() AT TIME ZONE 'America/Lima')::date + $3::int, $4::time, $5::time, $6, $7)
     RETURNING id_horario, to_char(fecha, 'YYYY-MM-DD') AS fecha`,
    [idPersonal, o.tipo ?? "visita", o.dias ?? 30, o.inicio ?? "10:00", o.fin ?? "11:00", o.cupos ?? 1, campana],
  );
  return rows[0]!;
}

const ESTADO_EXPEDIENTE: Record<string, string> = { reservada: "visita_agendada", no_asistio: "prospecto", asistio: "portal_habilitado" };

// Cita de visita en el estado dado cuya última transición (su ancla) ocurrió hace `minutos`; si la cita ya se registró,
// la reserva ocurrió un minuto antes. Si la cita está `asistio` y se pasa `keycloakUserId`, el apoderado tiene
// cuenta_acceso con ese usuario.
export async function citaHace(
  db: Consultable,
  campana: string,
  o: { estado: "reservada" | "asistio" | "no_asistio"; minutos: number; dias?: number; keycloakUserId?: string },
) {
  const p = await prospecto(db, campana, ESTADO_EXPEDIENTE[o.estado]);
  const directora = await crearPersonal(db, "directora");
  const h = await horarioVisita(db, directora, campana, { dias: o.dias ?? 30, cupos: 0 });
  const { rows: [c] } = await db.query(
    `INSERT INTO cita (id_expediente, id_personal, id_horario, tipo_cita, fecha_hora, estado, asistentes)
     VALUES ($1, $2, $3, 'visita', ($4::date + time '10:00') AT TIME ZONE 'America/Lima', $5::estado_cita, 'María Fernanda Quispe Rojas')
     RETURNING id_cita`,
    [p.idExpediente, directora, h.id_horario, h.fecha, o.estado],
  );
  const transicion = (anterior: string, nuevo: string, minutos: number) =>
    db.query(
      `INSERT INTO registro_auditoria (id_expediente, tipo_evento, estado_anterior, estado_nuevo, fecha_hora, detalle)
       VALUES ($1, 'transicion_estado', $2, $3, now() - make_interval(mins => $4), $5)`,
      [p.idExpediente, anterior, nuevo, minutos, JSON.stringify({ campo: "estado", id_cita: c.id_cita })],
    );
  await transicion("prospecto", "visita_agendada", o.estado === "reservada" ? o.minutos : o.minutos + 1);
  if (o.estado !== "reservada") await transicion("visita_agendada", ESTADO_EXPEDIENTE[o.estado]!, o.minutos);
  if (o.keycloakUserId) {
    await db.query("INSERT INTO cuenta_acceso (id_apoderado, keycloak_user_id) VALUES ($1, $2::uuid)", [p.idApoderado, o.keycloakUserId]);
  }
  return { ...p, idCita: c.id_cita as number, fecha: h.fecha };
}

// Una fila de intento insertada a mano, con su fecha hace `minutos` (siempre después del ancla de citaHace).
export async function intento(db: Consultable, idExpediente: number, tipoEvento: string, estado: string, minutos: number) {
  const { rows } = await db.query<{ id_notificacion: number }>(
    `INSERT INTO notificacion (id_expediente, canal, tipo_evento, estado_envio, fecha_envio)
     VALUES ($1, 'correo', $2, $3::estado_envio, now() - make_interval(mins => $4)) RETURNING id_notificacion`,
    [idExpediente, tipoEvento, estado, minutos],
  );
  return rows[0]!.id_notificacion;
}

export async function intentosDe(db: Consultable, idExpediente: number, tipoEvento?: string) {
  const { rows } = await db.query<{ id_notificacion: number; tipo_evento: string; estado_envio: string }>(
    `SELECT id_notificacion, tipo_evento, estado_envio::text AS estado_envio FROM notificacion
      WHERE id_expediente = $1 AND ($2::text IS NULL OR tipo_evento = $2) ORDER BY id_notificacion`,
    [idExpediente, tipoEvento ?? null],
  );
  return rows;
}

// Simula el paso del tiempo solo en la fila de la prueba (sigue después del ancla de citaHace).
export const intentadaHace = (db: Consultable, idNotificacion: number, minutos: number) =>
  db.query("UPDATE notificacion SET fecha_envio = now() - make_interval(mins => $2) WHERE id_notificacion = $1", [idNotificacion, minutos]);

export const estadoDe = async (db: Consultable, idExpediente: number) =>
  (await db.query("SELECT estado::text AS estado FROM expediente WHERE id_expediente = $1", [idExpediente])).rows[0].estado as string;
