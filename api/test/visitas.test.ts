// HU0004 (G04, /visitas, solo Secretaría con fila activa, C22): agenda de la semana y visitas sin registrar (A5), registro
// de la asistencia «Asistió - Interesado en postular» (1.0: cuenta en Keycloak y cuenta_acceso, compensación como
// HU0021, C28) y «No asistió» (2.0: el expediente vuelve a prospecto, P1). Keycloak y n8n simulados.
import { randomUUID } from "node:crypto";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { cerrarPool, obtenerPool } from "../src/db/pool";
import { ORIGEN_FAMILIA, ORIGEN_PERSONAL } from "../src/identidad/keycloakAdmin";
import { crearFirmante, crearPersonal, eventosDe } from "./ayudantes";
import { citaHace, entornoVisita, estadoDe, horarioVisita, intento, prospecto } from "./ayudantesVisita";

const db = () => obtenerPool();
let firmante: Awaited<ReturnType<typeof crearFirmante>>;

beforeAll(async () => {
  firmante = await crearFirmante();
});
afterAll(cerrarPool);

type Entorno = Awaited<ReturnType<typeof entornoVisita>>;
const ASISTENTES = "María Fernanda Quispe Rojas, José Luis Quispe Huamán";

const semana = (e: Entorno, fecha?: string, token = e.tokenSecretaria) =>
  request(e.app).get(`/visitas${fecha ? `?fecha=${fecha}` : ""}`).set("Authorization", `Bearer ${token}`);
const asistencia = (e: Entorno, idCita: number, resultado: string, token = e.tokenSecretaria) =>
  request(e.app).post(`/visitas/${idCita}/asistencia`).set("Authorization", `Bearer ${token}`).send({ resultado });

// Una visita reservada por P02, como lo haría la familia.
async function visitaReservada(e: Entorno, dias = 14) {
  const p = await prospecto(db(), e.campana);
  const h = await horarioVisita(db(), e.directora, e.campana, { dias, inicio: "10:00", fin: "11:00" });
  const res = await request(e.app).post("/publico/visita-guiada/reserva").set("X-Enlace-Visita", p.token).send({ id_horario: h.id_horario, asistentes: ASISTENTES });
  expect(res.status).toBe(201);
  const { rows: [c] } = await db().query("SELECT id_cita FROM cita WHERE id_expediente = $1", [p.idExpediente]);
  e.eventos.disparar.mockClear();
  return { ...p, idCita: c.id_cita as number, fecha: h.fecha };
}

async function cuentasDe(idApoderado: number) {
  return (await db().query("SELECT keycloak_user_id::text AS kc FROM cuenta_acceso WHERE id_apoderado = $1", [idApoderado])).rows;
}
const estadoCita = async (idCita: number) => (await db().query("SELECT estado::text AS e FROM cita WHERE id_cita = $1", [idCita])).rows[0].e;

describe("HU0004-1.0 registro de visita conforme y apertura de postulación", () => {
  it("HU0004-1.0 «Asistió - Interesado en postular» crea el usuario familia y la cuenta de acceso, deja la cita asistio y el expediente en portal_habilitado con auditoría, y avisa a agendamiento", async () => {
    const e = await entornoVisita(db(), firmante);
    const v = await visitaReservada(e);

    const res = await asistencia(e, v.idCita, "asistio_interesado");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ id_cita: v.idCita, estado_cita: "asistio", estado_expediente: "portal_habilitado" });
    const [usuario, ...otros] = e.falsa.porCorreo(v.correo);
    expect(otros).toHaveLength(0);
    expect(usuario).toMatchObject({ origen: ORIGEN_FAMILIA, roles: ["familia"], habilitado: true, credenciales: false, contrasenaTemporal: null });
    expect(await cuentasDe(v.idApoderado)).toEqual([{ kc: usuario!.id }]);
    expect(await estadoCita(v.idCita)).toBe("asistio");
    expect(await estadoDe(db(), v.idExpediente)).toBe("portal_habilitado");
    const ultima = (await eventosDe(db(), v.idExpediente)).at(-1);
    expect(ultima).toMatchObject({
      tipo_evento: "transicion_estado",
      id_personal: e.idSecretaria,
      estado_anterior: "visita_agendada",
      estado_nuevo: "portal_habilitado",
      detalle: { campo: "estado", id_cita: v.idCita, resultado: "asistio_interesado" },
    });
    expect(JSON.stringify(ultima)).not.toContain(v.correo);
    expect(e.eventos.disparar).toHaveBeenCalledWith("agendamiento", { id_cita: v.idCita });
  });

  it("HU0004-1.0 si la BD falla después de crear el usuario, se borra de Keycloak y no queda nada; un huérfano se adopta en el siguiente intento", async () => {
    const e = await entornoVisita(db(), firmante);

    // Falla la BD (cuenta_acceso ya ocupada por ese apoderado) después de crear el usuario: se compensa.
    const v1 = await visitaReservada(e, 13);
    await db().query("INSERT INTO cuenta_acceso (id_apoderado, keycloak_user_id) VALUES ($1, $2::uuid)", [v1.idApoderado, randomUUID()]);
    const conflicto = await asistencia(e, v1.idCita, "asistio_interesado");
    expect(conflicto.status).toBe(409);
    expect(conflicto.body.error.codigo).toBe("CORREO_CON_CUENTA");
    expect(e.falsa.porCorreo(v1.correo)).toEqual([]);
    expect(e.falsa.llamadas).toContain("crearUsuario");
    expect(await estadoCita(v1.idCita)).toBe("reservada");
    expect(await estadoDe(db(), v1.idExpediente)).toBe("visita_agendada");

    // Falla Keycloak al habilitar (después de las escrituras en la BD): se revierte todo y se borra el usuario.
    const v2 = await visitaReservada(e, 12);
    e.falsa.fallarUnaVez("habilitar");
    const caida = await asistencia(e, v2.idCita, "asistio_interesado");
    expect(caida.status).toBe(502);
    expect(e.falsa.porCorreo(v2.correo)).toEqual([]);
    expect(await cuentasDe(v2.idApoderado)).toEqual([]);
    expect(await estadoCita(v2.idCita)).toBe("reservada");
    expect(await estadoDe(db(), v2.idExpediente)).toBe("visita_agendada");
    expect((await eventosDe(db(), v2.idExpediente)).map((x) => x.estado_nuevo)).toEqual(["visita_agendada"]);
    expect(e.eventos.disparar).not.toHaveBeenCalled();

    // Si tampoco se pudo borrar ni deshabilitar, queda huérfano y el siguiente intento lo adopta.
    const v3 = await visitaReservada(e, 11);
    e.falsa.fallarUnaVez("habilitar");
    e.falsa.fallarEn("eliminarUsuario");
    expect((await asistencia(e, v3.idCita, "asistio_interesado")).status).toBe(502);
    const [huerfano] = e.falsa.porCorreo(v3.correo);
    expect(huerfano).toMatchObject({ origen: ORIGEN_FAMILIA, habilitado: false });
    e.falsa.reparar();
    const reintento = await asistencia(e, v3.idCita, "asistio_interesado");
    expect(reintento.status).toBe(200);
    expect(e.falsa.porCorreo(v3.correo)).toHaveLength(1);
    expect(await cuentasDe(v3.idApoderado)).toEqual([{ kc: huerfano!.id }]);
    expect(e.falsa.usuarios.get(huerfano!.id)).toMatchObject({ habilitado: true, roles: ["familia"] });
  });

  it("HU0004-1.0 (C28) un correo que ya tiene cuenta en Keycloak responde 409 CORREO_CON_CUENTA sin cambios", async () => {
    const e = await entornoVisita(db(), firmante);
    const casos = [
      { origen: ORIGEN_FAMILIA, habilitado: true, credenciales: true }, // otro hijo o P01 repetido: familia con cuenta
      { origen: ORIGEN_PERSONAL, habilitado: true, credenciales: true }, // el correo es de una cuenta del personal
      { origen: ORIGEN_FAMILIA, habilitado: false, credenciales: true }, // no es huérfano: tiene contraseña
    ];
    let dias = 20;
    for (const caso of casos) {
      const v = await visitaReservada(e, dias--);
      const previo = e.falsa.sembrar({ correo: v.correo, ...caso });

      const res = await asistencia(e, v.idCita, "asistio_interesado");

      expect(res.status, JSON.stringify(caso)).toBe(409);
      expect(res.body.error.codigo).toBe("CORREO_CON_CUENTA");
      expect(e.falsa.porCorreo(v.correo)).toEqual([previo]);
      expect(await cuentasDe(v.idApoderado)).toEqual([]);
      expect(await estadoCita(v.idCita)).toBe("reservada");
      expect(await estadoDe(db(), v.idExpediente)).toBe("visita_agendada");
    }
    expect(e.eventos.disparar).not.toHaveBeenCalled();
  });

  it("HU0004-1.0 G04: la secretaria recibe las visitas de la semana sin DNI; otro rol recibe 403 con acceso_denegado; una visita ya registrada responde 409", async () => {
    const e = await entornoVisita(db(), firmante);
    const v = await visitaReservada(e, 21);
    const otraSemana = await visitaReservada(e, 35);

    const res = await semana(e, v.fecha);

    expect(res.status).toBe(200);
    expect(res.body.desde <= v.fecha && v.fecha <= res.body.hasta).toBe(true);
    expect(new Date(`${res.body.desde}T00:00:00Z`).getUTCDay()).toBe(1); // lunes
    expect(res.body.visitas).toEqual([
      {
        id_cita: v.idCita,
        fecha: v.fecha,
        hora_inicio: "10:00",
        estado_cita: "reservada",
        id_expediente: v.idExpediente,
        estado_expediente: "visita_agendada",
        apoderado: { nombres: "María Fernanda", apellidos: "Quispe Rojas", telefono: "+51987654321" },
        grado: { nombre_grado: v.nombreGrado },
        asistentes: ASISTENTES,
        aviso: null,
      },
    ]);
    expect(res.body.visitas.map((x: { id_cita: number }) => x.id_cita)).not.toContain(otraSemana.idCita);
    expect(JSON.stringify(res.body)).not.toMatch(/dni/i);

    for (const rol of ["tesoreria", "psicologa", "evaluador_academico", "directora"]) {
      const sub = randomUUID();
      const idPersonal = await crearPersonal(db(), rol, sub);
      const token = await firmante.token(sub, [rol]);
      expect((await semana(e, v.fecha, token)).status, rol).toBe(403);
      expect((await asistencia(e, v.idCita, "asistio_interesado", token)).status, rol).toBe(403);
      const { rows } = await db().query(
        "SELECT detalle->>'ruta' AS ruta FROM registro_auditoria WHERE tipo_evento = 'acceso_denegado' AND id_personal = $1 ORDER BY id_evento",
        [idPersonal],
      );
      // requireRol registra baseUrl + path, sin la consulta.
      expect(rows.map((r) => r.ruta), rol).toEqual(["/visitas/", `/visitas/${v.idCita}/asistencia`]);
    }
    expect((await semana(e, v.fecha, await firmante.token(randomUUID(), ["familia"]))).status).toBe(403);
    expect((await request(e.app).get("/visitas")).status).toBe(401);
    expect(await estadoCita(v.idCita)).toBe("reservada");

    expect((await asistencia(e, v.idCita, "no_asistio")).status).toBe(200);
    const repetida = await asistencia(e, v.idCita, "asistio_interesado");
    expect(repetida.status).toBe(409);
    expect(repetida.body.error.codigo).toBe("VISITA_YA_REGISTRADA");
    expect((await asistencia(e, v.idCita, "otro")).status).toBe(400);
    expect((await asistencia(e, 999999, "no_asistio")).status).toBe(404);
    expect((await semana(e, "2026-02-30")).status).toBe(400);
  });

  it("HU0004-1.0 (P-c) GET /visitas incluye en sin_registrar las visitas reservadas de semanas anteriores", async () => {
    const e = await entornoVisita(db(), firmante);
    const vieja = await citaHace(db(), e.campana, { estado: "reservada", minutos: 60 * 24 * 10, dias: -10 });
    const registrada = await citaHace(db(), e.campana, { estado: "no_asistio", minutos: 60 * 24 * 9, dias: -9 });
    const actual = await visitaReservada(e, 40);

    const res = await semana(e);

    expect(res.status).toBe(200);
    const ids = (lista: { id_cita: number }[]) => lista.map((x) => x.id_cita);
    expect(ids(res.body.sin_registrar)).toEqual([vieja.idCita]);
    expect(res.body.sin_registrar[0]).toMatchObject({ fecha: vieja.fecha, estado_cita: "reservada", estado_expediente: "visita_agendada" });
    expect(ids(res.body.sin_registrar)).not.toContain(registrada.idCita);
    expect(ids(res.body.visitas)).not.toContain(actual.idCita);
    // Desde «Sin registrar» se registra igual que desde la agenda.
    expect((await asistencia(e, vieja.idCita, "no_asistio")).status).toBe(200);
    expect((await semana(e)).body.sin_registrar).toEqual([]);
  });
});

describe("HU0004-2.0 registro de inasistencia a la visita guiada", () => {
  it("HU0004-2.0 «No asistió» deja la cita no_asistio, devuelve el expediente a prospecto con auditoría y avisa a agendamiento", async () => {
    const e = await entornoVisita(db(), firmante);
    const v = await visitaReservada(e);

    const res = await asistencia(e, v.idCita, "no_asistio");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ id_cita: v.idCita, estado_cita: "no_asistio", estado_expediente: "prospecto" });
    expect(await estadoCita(v.idCita)).toBe("no_asistio");
    expect(await estadoDe(db(), v.idExpediente)).toBe("prospecto");
    expect((await eventosDe(db(), v.idExpediente)).at(-1)).toMatchObject({
      tipo_evento: "transicion_estado",
      id_personal: e.idSecretaria,
      estado_anterior: "visita_agendada",
      estado_nuevo: "prospecto",
      detalle: { campo: "estado", id_cita: v.idCita, resultado: "no_asistio" },
    });
    expect(e.falsa.porCorreo(v.correo)).toEqual([]);
    expect(await cuentasDe(v.idApoderado)).toEqual([]);
    expect(e.eventos.disparar).toHaveBeenCalledWith("agendamiento", { id_cita: v.idCita });
  });

  it("HU0004-2.0 (G04) la etiqueta de una visita anterior conserva su invitación después de que la familia vuelve a reservar", async () => {
    const e = await entornoVisita(db(), firmante);
    const interno = (ruta: string) => e.interno(request(e.app).post(ruta));
    const cerrar = (id: number, estado_envio: string) => e.interno(request(e.app).patch(`/internal/notificaciones/${id}`)).send({ estado_envio });
    const reservarCon = async (token: string, inicio: string, fin: string) => {
      const h = await horarioVisita(db(), e.directora, e.campana, { dias: 22, inicio, fin });
      const res = await request(e.app).post("/publico/visita-guiada/reserva").set("X-Enlace-Visita", token).send({ id_horario: h.id_horario, asistentes: ASISTENTES });
      expect(res.status).toBe(201);
      return (await db().query("SELECT max(id_cita) AS id FROM cita WHERE id_expediente = (SELECT id_expediente FROM cita WHERE id_horario = $1)", [h.id_horario])).rows[0].id as number;
    };
    const p = await prospecto(db(), e.campana);
    // Primera visita: no asistió y la invitación se envió.
    const cita1 = await reservarCon(p.token, "09:00", "10:00");
    expect((await asistencia(e, cita1, "no_asistio")).status).toBe(200);
    const invitacion1 = await interno(`/internal/citas/${cita1}/aviso`);
    expect((await cerrar(invitacion1.body.id_notificacion, "enviado")).status).toBe(200);
    // Vuelve a reservar con el mismo enlace (ADR-18) y tampoco asiste; su invitación queda en curso.
    const cita2 = await reservarCon(p.token, "15:00", "16:00");
    expect((await asistencia(e, cita2, "no_asistio")).status).toBe(200);
    expect((await interno(`/internal/citas/${cita2}/aviso`)).status).toBe(201);

    const res = await semana(e, (await db().query("SELECT to_char(fecha_hora AT TIME ZONE 'America/Lima', 'YYYY-MM-DD') AS f FROM cita WHERE id_cita = $1", [cita1])).rows[0].f);

    const aviso = (id: number) => res.body.visitas.find((x: { id_cita: number }) => x.id_cita === id)?.aviso;
    expect(aviso(cita1)).toEqual({ tipo_evento: "visita_reprogramacion", estado_envio: "enviado" });
    expect(aviso(cita2)).toEqual({ tipo_evento: "visita_reprogramacion", estado_envio: "pendiente" });
  });

  it("HU0004-2.0 (G04) con varias filas por aviso, la etiqueta de la invitación muestra el cierre (enviado o fallido) si existe y, si no, «pendiente»", async () => {
    const e = await entornoVisita(db(), firmante);
    const enviada = await citaHace(db(), e.campana, { estado: "no_asistio", minutos: 120, dias: 50 });
    const agotada = await citaHace(db(), e.campana, { estado: "no_asistio", minutos: 120, dias: 50 });
    const pendiente = await citaHace(db(), e.campana, { estado: "no_asistio", minutos: 120, dias: 50 });
    const sinIntentos = await citaHace(db(), e.campana, { estado: "no_asistio", minutos: 120, dias: 50 });
    const TIPO = "visita_reprogramacion";
    // Dos intentos de resultado desconocido y uno enviado (el cierre).
    await intento(db(), enviada.idExpediente, TIPO, "pendiente", 100);
    await intento(db(), enviada.idExpediente, TIPO, "pendiente", 80);
    await intento(db(), enviada.idExpediente, TIPO, "enviado", 60);
    // Seis intentos de resultado desconocido y la fila de cierre del tope.
    for (const minutos of [110, 100, 90, 80, 70, 60]) await intento(db(), agotada.idExpediente, TIPO, "pendiente", minutos);
    await intento(db(), agotada.idExpediente, TIPO, "fallido", 50);
    // Dos intentos sin cierre.
    await intento(db(), pendiente.idExpediente, TIPO, "pendiente", 100);
    await intento(db(), pendiente.idExpediente, TIPO, "pendiente", 20);

    const res = await semana(e, enviada.fecha);

    const aviso = (id: number) => res.body.visitas.find((x: { id_cita: number }) => x.id_cita === id)?.aviso;
    expect(aviso(enviada.idCita)).toEqual({ tipo_evento: TIPO, estado_envio: "enviado" });
    expect(aviso(agotada.idCita)).toEqual({ tipo_evento: TIPO, estado_envio: "fallido" });
    expect(aviso(pendiente.idCita)).toEqual({ tipo_evento: TIPO, estado_envio: "pendiente" });
    expect(aviso(sinIntentos.idCita)).toBeNull();
  });
});
