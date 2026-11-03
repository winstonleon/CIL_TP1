// Flujo seguimiento-recordatorios por /internal/* (HU0003-1.0, D4): la cita entra en los pendientes al llegar a
// RECORDATORIO_VISITA_HORAS antes de la visita, un solo recordatorio por cita y nada pasada la hora de la visita.
// La fecha_hora de la cita se mueve solo en la BD de prueba para simular el paso del tiempo.
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { cerrarPool, obtenerPool } from "../src/db/pool";
import { AVISOS_VISITA, fechaLarga } from "../src/services/avisosVisita";
import { crearFirmante } from "./ayudantes";
import { citaHace, entornoVisita, intentadaHace, intentosDe } from "./ayudantesVisita";

const db = () => obtenerPool();
let firmante: Awaited<ReturnType<typeof crearFirmante>>;

beforeAll(async () => {
  firmante = await crearFirmante();
});
afterAll(cerrarPool);

type Entorno = Awaited<ReturnType<typeof entornoVisita>>;
const reservar = (e: Entorno, idCita: number) => e.interno(request(e.app).post(`/internal/citas/${idCita}/recordatorio`));
const pendientes = async (e: Entorno) =>
  ((await e.interno(request(e.app).get("/internal/recordatorios/pendientes"))).body.citas as { id_cita: number }[]).map((c) => c.id_cita);
const visitaEn = (idCita: number, intervalo: string) =>
  db().query(`UPDATE cita SET fecha_hora = now() + interval '${intervalo}' WHERE id_cita = $1`, [idCita]);

describe("HU0003-1.0 recordatorio previo a la visita (seguimiento-recordatorios)", () => {
  it("HU0003-1.0 el recordatorio entra en los pendientes al llegar a RECORDATORIO_VISITA_HORAS antes y su reserva es única por cita: nunca hay dos", async () => {
    expect(process.env.RECORDATORIO_VISITA_HORAS).toBe("24");
    const e = await entornoVisita(db(), firmante);
    const c = await citaHace(db(), e.campana, { estado: "reservada", minutos: 60 });

    await visitaEn(c.idCita, "25 hours"); // todavía fuera de la ventana de 24 h
    expect(await pendientes(e)).not.toContain(c.idCita);
    const temprano = await reservar(e, c.idCita);
    expect(temprano.status).toBe(409);
    expect(temprano.body.error.codigo).toBe("FUERA_DE_VENTANA");

    await visitaEn(c.idCita, "23 hours");
    expect(await pendientes(e)).toContain(c.idCita);
    const res = await reservar(e, c.idCita);
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ id_expediente: c.idExpediente, id_cita: c.idCita, tipo_evento: "recordatorio_visita" });
    expect(res.body.asunto).toBe(`Recordatorio de tu visita guiada · Admisión ${e.campana}`);
    const { rows: [f] } = await db().query(
      "SELECT to_char(fecha_hora AT TIME ZONE 'America/Lima', 'YYYY-MM-DD') AS fecha FROM cita WHERE id_cita = $1",
      [c.idCita],
    );
    const lineas = (res.body.cuerpo as string).split("\n");
    expect(lineas.slice(0, 5)).toEqual(["Hola, María Fernanda:", "", AVISOS_VISITA.recordatorio, "", `Fecha: ${fechaLarga(f.fecha)}`]);
    expect(lineas).toContain("Lugar: [Dirección del colegio]");
    expect(lineas).toContain("Asistentes: María Fernanda Quispe Rojas");

    // Nunca dos: en curso, cerrado, y el barrido ya no lo toma.
    expect((await reservar(e, c.idCita)).body.error.codigo).toBe("RECORDATORIO_YA_REGISTRADO");
    expect(await pendientes(e)).not.toContain(c.idCita);
    await e.interno(request(e.app).patch(`/internal/notificaciones/${res.body.id_notificacion}`)).send({ estado_envio: "enviado" });
    await intentadaHace(db(), res.body.id_notificacion, 30);
    expect((await reservar(e, c.idCita)).body.error.codigo).toBe("RECORDATORIO_YA_REGISTRADO");
    expect(await pendientes(e)).not.toContain(c.idCita);
    expect(await intentosDe(db(), c.idExpediente, "recordatorio_visita")).toHaveLength(1);
  });

  it("HU0003-1.0 pasada la hora de la visita el recordatorio deja de intentarse y sus filas conservan su estado", async () => {
    const e = await entornoVisita(db(), firmante);
    const c = await citaHace(db(), e.campana, { estado: "reservada", minutos: 120 });
    await visitaEn(c.idCita, "3 hours");
    const res = await reservar(e, c.idCita);
    expect(res.status).toBe(201);
    await intentadaHace(db(), res.body.id_notificacion, 11);
    expect(await pendientes(e)).toContain(c.idCita); // retoma pendiente

    await visitaEn(c.idCita, "-1 minute");

    expect(await pendientes(e)).not.toContain(c.idCita);
    expect((await reservar(e, c.idCita)).body.error.codigo).toBe("FUERA_DE_VENTANA");
    expect((await intentosDe(db(), c.idExpediente, "recordatorio_visita")).map((x) => x.estado_envio)).toEqual(["pendiente"]);
    // Una cita que ya no está reservada tampoco recibe recordatorio.
    const otra = await citaHace(db(), e.campana, { estado: "no_asistio", minutos: 30 });
    await visitaEn(otra.idCita, "2 hours");
    expect(await pendientes(e)).not.toContain(otra.idCita);
    expect((await reservar(e, otra.idCita)).body.error.codigo).toBe("FUERA_DE_VENTANA");
  });
});
