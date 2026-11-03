// HU0003 (P02, rutas públicas /publico/visita-guiada): horarios de la visita, reserva con el cupo descontado en una
// sola sentencia condicional (HU0003-1.0), dos reservas simultáneas del último cupo (HU0003-2.0), vigencia del token
// del enlace (C31, P2) y protecciones de ADR-17. n8n y Keycloak simulados; la BD es admision_test.
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { crearApp } from "../src/app";
import { crearTokenVisita } from "../src/crypto/enlaceVisita";
import { cerrarPool, obtenerPool } from "../src/db/pool";
import { crearFirmante, crearPersonal, eventosDe } from "./ayudantes";
import { entornoVisita, estadoDe, horarioVisita, prospecto } from "./ayudantesVisita";

const db = () => obtenerPool();
let firmante: Awaited<ReturnType<typeof crearFirmante>>;

beforeAll(async () => {
  firmante = await crearFirmante();
});
afterAll(cerrarPool);

const leer = (app: Parameters<typeof request>[0], token?: string) => {
  const r = request(app).get("/publico/visita-guiada");
  return token === undefined ? r : r.set("X-Enlace-Visita", token);
};
const reservar = (app: Parameters<typeof request>[0], token: string | undefined, cuerpo: object) => {
  const r = request(app).post("/publico/visita-guiada/reserva");
  return (token === undefined ? r : r.set("X-Enlace-Visita", token)).send(cuerpo);
};
const ASISTENTES = "María Fernanda Quispe Rojas, José Luis Quispe Huamán";

async function cuposDe(idHorario: number) {
  return (await db().query("SELECT cupos FROM horario_disponible WHERE id_horario = $1", [idHorario])).rows[0].cupos as number;
}
async function citasDe(idHorario: number) {
  return (await db().query("SELECT * FROM cita WHERE id_horario = $1", [idHorario])).rows;
}

describe("HU0003-1.0 reserva exitosa de la visita guiada", () => {
  it("HU0003-1.0 con el enlace de la carpeta, P02 recibe los horarios de visita futuros de la campaña con su cupo, el apoderado, el grado y el lugar", async () => {
    const e = await entornoVisita(db(), firmante);
    const p = await prospecto(db(), e.campana);
    const libre = await horarioVisita(db(), e.directora, e.campana, { dias: 20, inicio: "10:00", fin: "11:00" });
    const sinCupo = await horarioVisita(db(), e.directora, e.campana, { dias: 20, inicio: "11:30", fin: "12:30", cupos: 0 });
    await horarioVisita(db(), e.directora, e.campana, { dias: -1 }); // ya pasó
    await horarioVisita(db(), e.directora, `O${e.campana.slice(1)}`, { dias: 20, inicio: "08:00", fin: "09:00" }); // otra campaña
    const psicologa = await crearPersonal(db(), "psicologa");
    await horarioVisita(db(), psicologa, e.campana, { dias: 20, tipo: "evaluacion_psicologica" }); // no es visita

    const res = await leer(e.app, p.token);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      campana: e.campana,
      apoderado: { nombres: "María Fernanda", apellidos: "Quispe Rojas" },
      grado: { nombre_grado: p.nombreGrado },
      lugar: "[Dirección del colegio]",
      horarios: [
        { id_horario: libre.id_horario, fecha: libre.fecha, hora_inicio: "10:00", hora_fin: "11:00", disponible: true },
        { id_horario: sinCupo.id_horario, fecha: sinCupo.fecha, hora_inicio: "11:30", hora_fin: "12:30", disponible: false },
      ],
    });
    expect(JSON.stringify(res.body)).not.toMatch(/dni|correo|telefono|id_expediente/i);
  });

  it("HU0003-1.0 la reserva descuenta el cupo, registra la cita con los asistentes, pasa el expediente a visita_agendada con su auditoría y avisa a agendamiento después de responder", async () => {
    const e = await entornoVisita(db(), firmante);
    const p = await prospecto(db(), e.campana);
    const h = await horarioVisita(db(), e.directora, e.campana, { dias: 15, inicio: "10:00", fin: "11:00" });

    const res = await reservar(e.app, p.token, { id_horario: h.id_horario, asistentes: `  ${ASISTENTES}  ` });

    expect(res.status).toBe(201);
    expect(res.body).toEqual({ estado: "reservada", fecha: h.fecha, hora_inicio: "10:00" });
    expect(await cuposDe(h.id_horario)).toBe(0);
    const [cita, ...otras] = await citasDe(h.id_horario);
    expect(otras).toHaveLength(0);
    expect(cita).toMatchObject({ id_expediente: p.idExpediente, id_personal: e.directora, tipo_cita: "visita", estado: "reservada", asistentes: ASISTENTES });
    const { rows: [hora] } = await db().query(
      "SELECT to_char(fecha_hora AT TIME ZONE 'America/Lima', 'YYYY-MM-DD HH24:MI') AS local FROM cita WHERE id_cita = $1",
      [cita.id_cita],
    );
    expect(hora.local).toBe(`${h.fecha} 10:00`);
    expect(await estadoDe(db(), p.idExpediente)).toBe("visita_agendada");
    const eventos = await eventosDe(db(), p.idExpediente);
    expect(eventos).toHaveLength(1);
    expect(eventos[0]).toMatchObject({
      tipo_evento: "transicion_estado",
      id_personal: null,
      estado_anterior: "prospecto",
      estado_nuevo: "visita_agendada",
      detalle: { campo: "estado", id_cita: cita.id_cita, id_horario: h.id_horario },
    });
    expect(e.eventos.disparar).toHaveBeenCalledTimes(1);
    expect(e.eventos.disparar).toHaveBeenCalledWith("agendamiento", { id_cita: cita.id_cita });
  });

  it("HU0003-1.0 (C25) solo se ofrecen y reservan horarios de visita de la campaña activa cuyo responsable es una directora activa", async () => {
    const e = await entornoVisita(db(), firmante);
    const inactiva = await crearPersonal(db(), "directora");
    await db().query("UPDATE personal SET activo = false WHERE id_personal = $1", [inactiva]);
    const otroRol = await crearPersonal(db(), "psicologa");
    const deInactiva = await horarioVisita(db(), inactiva, e.campana, { dias: 12 });
    const deOtroRol = await horarioVisita(db(), otroRol, e.campana, { dias: 12, inicio: "15:00", fin: "16:00" });
    const otraCampana = await horarioVisita(db(), e.directora, `O${e.campana.slice(1)}`, { dias: 12 });
    const pasado = await horarioVisita(db(), e.directora, e.campana, { dias: -2 });
    const p = await prospecto(db(), e.campana);

    expect((await leer(e.app, p.token)).body.horarios).toEqual([]);
    for (const h of [deInactiva, deOtroRol, pasado]) {
      const res = await reservar(e.app, p.token, { id_horario: h.id_horario, asistentes: ASISTENTES });
      expect(res.status, String(h.id_horario)).toBe(409);
      expect(res.body.error.codigo).toBe("HORARIO_NO_DISPONIBLE");
    }
    for (const id of [otraCampana.id_horario, 999999]) {
      const res = await reservar(e.app, p.token, { id_horario: id, asistentes: ASISTENTES });
      expect(res.status).toBe(404);
      expect(res.body.error.codigo).toBe("HORARIO_NO_DISPONIBLE");
    }
    expect(await estadoDe(db(), p.idExpediente)).toBe("prospecto");
    expect(await cuposDe(deInactiva.id_horario)).toBe(1);
    expect(e.eventos.disparar).not.toHaveBeenCalled();
  });
});

describe("HU0003-2.0 horario tomado simultáneamente", () => {
  it("HU0003-2.0 dos reservas simultáneas del último cupo: una 201 y otra 409 HORARIO_SIN_CUPO, los cupos quedan en 0 y hay una sola cita", async () => {
    const e = await entornoVisita(db(), firmante);
    const h = await horarioVisita(db(), e.directora, e.campana, { dias: 10 });
    const [a, b] = await Promise.all([prospecto(db(), e.campana), prospecto(db(), e.campana)]);

    const respuestas = await Promise.all([a, b].map((p) => reservar(e.app, p.token, { id_horario: h.id_horario, asistentes: ASISTENTES })));

    expect(respuestas.map((r) => r.status).sort()).toEqual([201, 409]);
    const rechazo = respuestas.find((r) => r.status === 409)!;
    expect(rechazo.body.error).toEqual({ codigo: "HORARIO_SIN_CUPO", mensaje: "El horario ya no tiene cupo. Elige otro horario o día." });
    expect(await cuposDe(h.id_horario)).toBe(0);
    const citas = await citasDe(h.id_horario);
    expect(citas).toHaveLength(1);
    const perdedor = citas[0].id_expediente === a.idExpediente ? b : a;
    expect(await estadoDe(db(), perdedor.idExpediente)).toBe("prospecto");
    expect(await eventosDe(db(), perdedor.idExpediente)).toHaveLength(0);
    expect(e.eventos.disparar).toHaveBeenCalledTimes(1);
  });

  it("HU0003-2.0 después del rechazo, P02 recibe ese horario como «Reservado» para elegir otro", async () => {
    const e = await entornoVisita(db(), firmante);
    const tomado = await horarioVisita(db(), e.directora, e.campana, { dias: 9, inicio: "11:30", fin: "12:30" });
    const otro = await horarioVisita(db(), e.directora, e.campana, { dias: 9, inicio: "08:30", fin: "09:30" });
    const [a, b] = await Promise.all([prospecto(db(), e.campana), prospecto(db(), e.campana)]);
    expect((await reservar(e.app, a.token, { id_horario: tomado.id_horario, asistentes: ASISTENTES })).status).toBe(201);
    expect((await reservar(e.app, b.token, { id_horario: tomado.id_horario, asistentes: ASISTENTES })).status).toBe(409);

    const res = await leer(e.app, b.token);

    expect(res.body.horarios).toEqual([
      { id_horario: otro.id_horario, fecha: otro.fecha, hora_inicio: "08:30", hora_fin: "09:30", disponible: true },
      { id_horario: tomado.id_horario, fecha: tomado.fecha, hora_inicio: "11:30", hora_fin: "12:30", disponible: false },
    ]);
    expect((await reservar(e.app, b.token, { id_horario: otro.id_horario, asistentes: ASISTENTES })).status).toBe(201);
  });

  it("HU0003-2.0 (B2) con cupos 2, después de la primera reserva P02 muestra el horario como «Reservado» y una segunda reserva responde 409", async () => {
    const e = await entornoVisita(db(), firmante);
    const h = await horarioVisita(db(), e.directora, e.campana, { dias: 8, cupos: 2 });
    const [a, b, c, d] = await Promise.all([
      prospecto(db(), e.campana),
      prospecto(db(), e.campana),
      prospecto(db(), e.campana),
      prospecto(db(), e.campana),
    ]);

    expect((await reservar(e.app, a.token, { id_horario: h.id_horario, asistentes: ASISTENTES })).status).toBe(201);
    expect(await cuposDe(h.id_horario)).toBe(1);
    expect((await leer(e.app, b.token)).body.horarios).toEqual([expect.objectContaining({ id_horario: h.id_horario, disponible: false })]);
    const segunda = await reservar(e.app, b.token, { id_horario: h.id_horario, asistentes: ASISTENTES });
    expect(segunda.status).toBe(409);
    expect(segunda.body.error.codigo).toBe("HORARIO_SIN_CUPO");
    expect(await cuposDe(h.id_horario)).toBe(1);

    // Simultáneas sobre otro horario con 2 cupos: uq_cita_personal_fecha es la segunda capa y el descuento se revierte.
    const h2 = await horarioVisita(db(), e.directora, e.campana, { dias: 8, inicio: "15:00", fin: "16:00", cupos: 2 });
    const simultaneas = await Promise.all([c, d].map((p) => reservar(e.app, p.token, { id_horario: h2.id_horario, asistentes: ASISTENTES })));
    expect(simultaneas.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(simultaneas.find((r) => r.status === 409)!.body.error.codigo).toBe("HORARIO_SIN_CUPO");
    expect(await cuposDe(h2.id_horario)).toBe(1);
    expect(await citasDe(h2.id_horario)).toHaveLength(1);
  });
});

describe("C31 vigencia del enlace de P02 (P2: según el estado)", () => {
  it("C31 un token alterado, truncado, de otra clave o mal formado responde 404 ENLACE_NO_VALIDO, igual que uno de un expediente inexistente", async () => {
    const e = await entornoVisita(db(), firmante);
    const p = await prospecto(db(), e.campana);
    const h = await horarioVisita(db(), e.directora, e.campana, { dias: 7 });
    const datos = p.token.slice(3);
    const medio = Math.floor(datos.length / 2);
    const invalidos = [
      `v1.${datos.slice(0, medio)}${datos[medio] === "A" ? "B" : "A"}${datos.slice(medio + 1)}`,
      p.token.slice(0, -4),
      crearTokenVisita(p.idExpediente, Buffer.alloc(32, 9).toString("base64")),
      "v1.***",
      "",
      crearTokenVisita(2147483000), // bien formado, de un expediente que no existe
      undefined, // sin cabecera
    ];
    const esperado = {
      error: {
        codigo: "ENLACE_NO_VALIDO",
        mensaje: "Este enlace no es válido o ya no está vigente. Si deseas agendar tu visita, comunícate con Admisión.",
      },
    };
    for (const t of invalidos) {
      const lectura = await leer(e.app, t);
      expect(lectura.status, String(t)).toBe(404);
      expect(lectura.body).toEqual(esperado);
      const reserva = await reservar(e.app, t, { id_horario: h.id_horario, asistentes: ASISTENTES });
      expect(reserva.status, String(t)).toBe(404);
      expect(reserva.body).toEqual(esperado);
    }
    expect(await cuposDe(h.id_horario)).toBe(1);
    expect(await estadoDe(db(), p.idExpediente)).toBe("prospecto");
  });

  it("C31 el enlace ya usado para reservar responde 409 VISITA_YA_AGENDADA y no crea otra cita", async () => {
    const e = await entornoVisita(db(), firmante);
    const p = await prospecto(db(), e.campana);
    const h1 = await horarioVisita(db(), e.directora, e.campana, { dias: 6 });
    const h2 = await horarioVisita(db(), e.directora, e.campana, { dias: 6, inicio: "15:00", fin: "16:00" });
    expect((await reservar(e.app, p.token, { id_horario: h1.id_horario, asistentes: ASISTENTES })).status).toBe(201);

    const lectura = await leer(e.app, p.token);
    const reserva = await reservar(e.app, p.token, { id_horario: h2.id_horario, asistentes: ASISTENTES });

    const esperado = { error: { codigo: "VISITA_YA_AGENDADA", mensaje: "Ya tienes una visita agendada. Revisa el correo de confirmación." } };
    expect(lectura.status).toBe(409);
    expect(lectura.body).toEqual(esperado);
    expect(reserva.status).toBe(409);
    expect(reserva.body).toEqual(esperado);
    expect(await citasDe(h2.id_horario)).toHaveLength(0);
    expect(await cuposDe(h2.id_horario)).toBe(1);
  });

  it("C31 el enlace de un expediente que ya no admite reservar (vencido) responde 404 ENLACE_NO_VALIDO", async () => {
    const e = await entornoVisita(db(), firmante);
    const h = await horarioVisita(db(), e.directora, e.campana, { dias: 5 });
    for (const estado of ["contacto_no_entregado", "portal_habilitado", "no_desea_postular", "en_postulacion", "caducado"]) {
      const p = await prospecto(db(), e.campana, estado);
      expect((await leer(e.app, p.token)).body.error.codigo, estado).toBe("ENLACE_NO_VALIDO");
      const reserva = await reservar(e.app, p.token, { id_horario: h.id_horario, asistentes: ASISTENTES });
      expect(reserva.status, estado).toBe(404);
      expect(reserva.body.error.codigo).toBe("ENLACE_NO_VALIDO");
      expect(await estadoDe(db(), p.idExpediente)).toBe(estado);
    }
    expect(await cuposDe(h.id_horario)).toBe(1);
  });

  it("C31 el expediente sale solo del token: un id_expediente en el cuerpo responde 400 y no reserva para nadie", async () => {
    const e = await entornoVisita(db(), firmante);
    const [a, b] = await Promise.all([prospecto(db(), e.campana), prospecto(db(), e.campana)]);
    const h = await horarioVisita(db(), e.directora, e.campana, { dias: 4 });

    const res = await reservar(e.app, a.token, { id_horario: h.id_horario, asistentes: ASISTENTES, id_expediente: b.idExpediente });

    expect(res.status).toBe(400);
    expect(res.body.error.codigo).toBe("VALIDACION");
    expect(await citasDe(h.id_horario)).toHaveLength(0);
    expect(await estadoDe(db(), a.idExpediente)).toBe("prospecto");
    expect(await estadoDe(db(), b.idExpediente)).toBe("prospecto");
    for (const cuerpo of [{ id_horario: h.id_horario }, { id_horario: h.id_horario, asistentes: "   " }, { id_horario: h.id_horario, asistentes: "x".repeat(301) }]) {
      expect((await reservar(e.app, a.token, cuerpo)).status).toBe(400);
    }
  });

  it("C31 las rutas de P02 cumplen ADR-17: 413, 429 en el POST y en el GET con contadores propios, y el token solo en la cabecera", async () => {
    const e = await entornoVisita(db(), firmante);
    const p = await prospecto(db(), e.campana);
    const h = await horarioVisita(db(), e.directora, e.campana, { dias: 3 });

    const grande = await reservar(e.app, p.token, { id_horario: h.id_horario, asistentes: "x".repeat(5000) });
    expect(grande.status).toBe(413);

    // El token en la URL no se lee: P02 lo envía en X-Enlace-Visita.
    expect((await request(e.app).get(`/publico/visita-guiada?t=${encodeURIComponent(p.token)}`)).status).toBe(404);

    let ahora = 1_000_000;
    const conLimite = crearApp({
      campanaActiva: e.campana,
      eventos: e.eventos,
      limitePublico: { maximo: 2, ventanaMs: 60_000, ahora: () => ahora },
      limiteLecturaVisita: { maximo: 3, ventanaMs: 60_000, ahora: () => ahora },
    });
    for (let i = 0; i < 3; i++) expect((await leer(conLimite, p.token)).status).toBe(200);
    const lecturaLimitada = await leer(conLimite, p.token);
    expect(lecturaLimitada.status).toBe(429);
    expect(lecturaLimitada.headers["retry-after"]).toBeDefined();
    // El POST tiene su propio contador: las lecturas no lo consumieron.
    expect((await reservar(conLimite, "v1.x", { id_horario: h.id_horario, asistentes: ASISTENTES })).status).toBe(404);
    expect((await reservar(conLimite, "v1.x", { id_horario: h.id_horario, asistentes: ASISTENTES })).status).toBe(404);
    expect((await reservar(conLimite, p.token, { id_horario: h.id_horario, asistentes: ASISTENTES })).status).toBe(429);
    ahora += 60_000;
    expect((await reservar(conLimite, p.token, { id_horario: h.id_horario, asistentes: ASISTENTES })).status).toBe(201);
  });
});
