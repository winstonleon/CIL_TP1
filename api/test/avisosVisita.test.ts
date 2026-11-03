// Flujo agendamiento por /internal/*: aviso de la cita según su estado (confirmación HU0003-1.0, credenciales HU0004-1.0,
// invitación a reprogramar HU0004-2.0), una fila por intento, retoma a los 10 min, tope de 6 intentos con fila de cierre
// (ADR-07), barrido de avisos (ADR-16), M2, M3 y M4 (D3), y la consulta de C8. El envío real se prueba en el E2E.
// «Hace N minutos»: citaHace inserta el ancla con fecha anterior (la bitácora es de solo inserción).
import { randomUUID } from "node:crypto";
import request from "supertest";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { leerTokenVisita } from "../src/crypto/enlaceVisita";
import { cerrarPool, obtenerPool } from "../src/db/pool";
import { ORIGEN_FAMILIA } from "../src/identidad/keycloakAdmin";
import { contarAvisosCerrados } from "../src/repositories/aviso";
import { AVISOS_VISITA, fechaLarga, horaVisible } from "../src/services/avisosVisita";
import { crearFirmante } from "./ayudantes";
import { citaHace, entornoVisita, estadoDe, horarioVisita, intentadaHace, intento, intentosDe, prospecto } from "./ayudantesVisita";

const db = () => obtenerPool();
let firmante: Awaited<ReturnType<typeof crearFirmante>>;

beforeAll(async () => {
  firmante = await crearFirmante();
});
afterAll(cerrarPool);
afterEach(() => {
  vi.restoreAllMocks();
});

type Entorno = Awaited<ReturnType<typeof entornoVisita>>;
const ASISTENTES = "María Fernanda Quispe Rojas, José Luis Quispe Huamán";

const aviso = (e: Entorno, idCita: number) => e.interno(request(e.app).post(`/internal/citas/${idCita}/aviso`));
const cerrar = (e: Entorno, id: number, estado_envio: string) => e.interno(request(e.app).patch(`/internal/notificaciones/${id}`)).send({ estado_envio });
const pendientes = async (e: Entorno) => {
  const res = await e.interno(request(e.app).get("/internal/agendamiento/pendientes"));
  expect(res.status).toBe(200);
  return (res.body.citas as { id_cita: number }[]).map((c) => c.id_cita);
};
const asistencia = (e: Entorno, idCita: number, resultado: string) =>
  request(e.app).post(`/visitas/${idCita}/asistencia`).set("Authorization", `Bearer ${e.tokenSecretaria}`).send({ resultado });
const reservarP02 = (e: Entorno, token: string, idHorario: number) =>
  request(e.app).post("/publico/visita-guiada/reserva").set("X-Enlace-Visita", token).send({ id_horario: idHorario, asistentes: ASISTENTES });

async function reservada(e: Entorno, dias = 14) {
  const p = await prospecto(db(), e.campana);
  const h = await horarioVisita(db(), e.directora, e.campana, { dias, inicio: "10:00", fin: "11:00" });
  expect((await reservarP02(e, p.token, h.id_horario)).status).toBe(201);
  const { rows: [c] } = await db().query("SELECT id_cita FROM cita WHERE id_expediente = $1 ORDER BY id_cita DESC LIMIT 1", [p.idExpediente]);
  return { ...p, idCita: c.id_cita as number, fecha: h.fecha };
}

// Cita `asistio` de hace 3 h, con cuenta y su usuario en el Keycloak simulado (como lo deja HU0004-1.0).
async function conCuentaHace(e: Entorno, minutos = 180) {
  const idUsuario = randomUUID();
  const c = await citaHace(db(), e.campana, { estado: "asistio", minutos, keycloakUserId: idUsuario });
  e.falsa.sembrar({ id: idUsuario, correo: c.correo, origen: ORIGEN_FAMILIA, habilitado: true, roles: ["familia"] });
  return { ...c, idUsuario };
}

const contrasenaDe = (cuerpo: string) => cuerpo.match(/^Contraseña temporal: (.+)$/m)?.[1];

describe("HU0003-1.0 confirmación por el flujo agendamiento", () => {
  it("HU0003-1.0 el aviso de confirmación crea la notificación pendiente con fecha, hora, lugar y asistentes; repetirlo responde 409", async () => {
    const e = await entornoVisita(db(), firmante);
    const v = await reservada(e);

    const res = await aviso(e, v.idCita);

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ id_expediente: v.idExpediente, id_cita: v.idCita, tipo_evento: "visita_confirmada" });
    expect(res.body.asunto).toBe(`Visita guiada confirmada · Admisión ${e.campana}`);
    expect((res.body.cuerpo as string).split("\n")).toEqual([
      "Hola, María Fernanda:",
      "",
      AVISOS_VISITA.confirmacion,
      "",
      `Fecha: ${fechaLarga(v.fecha)}`,
      "Hora: 10:00 a. m.",
      "Lugar: [Dirección del colegio]",
      `Asistentes: ${ASISTENTES}`,
      "",
      AVISOS_VISITA.contacto,
    ]);
    expect(await intentosDe(db(), v.idExpediente, "visita_confirmada")).toEqual([
      { id_notificacion: res.body.id_notificacion, tipo_evento: "visita_confirmada", estado_envio: "pendiente" },
    ]);
    const repetido = await aviso(e, v.idCita);
    expect(repetido.status).toBe(409);
    expect(repetido.body.error.codigo).toBe("AVISO_YA_REGISTRADO");
    expect((await cerrar(e, res.body.id_notificacion, "enviado")).status).toBe(200);
    expect((await aviso(e, v.idCita)).body.error.codigo).toBe("AVISO_YA_REGISTRADO");
    expect(fechaLarga("2026-11-05")).toBe("jueves 5 de noviembre de 2026");
    expect([horaVisible("08:30"), horaVisible("12:30"), horaVisible("00:15")]).toEqual(["8:30 a. m.", "12:30 p. m.", "12:15 a. m."]);
  });

  it("HU0003-1.0 un intento de resultado desconocido se retoma a los 10 min con una fila nueva y la anterior sigue pendiente", async () => {
    const e = await entornoVisita(db(), firmante);
    const c = await citaHace(db(), e.campana, { estado: "reservada", minutos: 120 });
    const primero = await aviso(e, c.idCita);
    expect(primero.status).toBe(201);
    await intentadaHace(db(), primero.body.id_notificacion, 9);
    expect((await aviso(e, c.idCita)).body.error.codigo).toBe("AVISO_YA_REGISTRADO"); // en curso

    await intentadaHace(db(), primero.body.id_notificacion, 11);
    const retoma = await aviso(e, c.idCita);

    expect(retoma.status).toBe(201);
    expect(retoma.body.id_notificacion).not.toBe(primero.body.id_notificacion);
    expect((await intentosDe(db(), c.idExpediente)).map((x) => [x.id_notificacion, x.estado_envio])).toEqual([
      [primero.body.id_notificacion, "pendiente"],
      [retoma.body.id_notificacion, "pendiente"],
    ]);
  });

  it("HU0003-1.0 (tope) 6 intentos de confirmación con resultado desconocido dejan una sola fila de cierre fallido y ningún intento más", async () => {
    const e = await entornoVisita(db(), firmante);
    const c = await citaHace(db(), e.campana, { estado: "reservada", minutos: 180 });
    for (const minutos of [170, 150, 130, 110, 90, 70]) await intento(db(), c.idExpediente, "visita_confirmada", "pendiente", minutos);
    expect(await pendientes(e)).toContain(c.idCita);

    const res = await aviso(e, c.idCita);

    expect(res.status).toBe(409);
    expect(res.body.error).toEqual({ codigo: "AVISO_AGOTADO", mensaje: "El aviso agotó sus intentos y quedó cerrado como fallido" });
    const filas = await intentosDe(db(), c.idExpediente, "visita_confirmada");
    expect(filas.map((x) => x.estado_envio)).toEqual(["pendiente", "pendiente", "pendiente", "pendiente", "pendiente", "pendiente", "fallido"]);
    expect(await pendientes(e)).not.toContain(c.idCita);
    expect((await aviso(e, c.idCita)).body.error.codigo).toBe("AVISO_YA_REGISTRADO");
    expect(await intentosDe(db(), c.idExpediente, "visita_confirmada")).toHaveLength(7);
  });

  it("HU0003-1.0 (barrido) el barrido selecciona avisos, no filas: una pendiente vieja de un aviso con un intento más reciente, o con una fila enviado o fallido, no vuelve a los pendientes", async () => {
    const e = await entornoVisita(db(), firmante);
    const T = "visita_confirmada";
    const sinIntentos = await citaHace(db(), e.campana, { estado: "reservada", minutos: 120 });
    const vencida = await citaHace(db(), e.campana, { estado: "reservada", minutos: 120 });
    await intento(db(), vencida.idExpediente, T, "pendiente", 30);
    const conReciente = await citaHace(db(), e.campana, { estado: "reservada", minutos: 120 });
    await intento(db(), conReciente.idExpediente, T, "pendiente", 60);
    await intento(db(), conReciente.idExpediente, T, "pendiente", 2);
    const enviada = await citaHace(db(), e.campana, { estado: "reservada", minutos: 120 });
    await intento(db(), enviada.idExpediente, T, "pendiente", 60);
    await intento(db(), enviada.idExpediente, T, "enviado", 50);
    const fallida = await citaHace(db(), e.campana, { estado: "reservada", minutos: 120 });
    await intento(db(), fallida.idExpediente, T, "pendiente", 60);
    await intento(db(), fallida.idExpediente, T, "fallido", 50);
    const reciente = await citaHace(db(), e.campana, { estado: "reservada", minutos: 0 }); // ancla de menos de 1 min
    // Estado anterior: una confirmación pendiente vieja de una cita que ya está `no_asistio` y cuya invitación se envió.
    const estadoAnterior = await citaHace(db(), e.campana, { estado: "no_asistio", minutos: 30 });
    await intento(db(), estadoAnterior.idExpediente, T, "pendiente", 25);
    await intento(db(), estadoAnterior.idExpediente, "visita_reprogramacion", "enviado", 20);

    const ids = await pendientes(e);

    expect(ids).toContain(sinIntentos.idCita);
    expect(ids).toContain(vencida.idCita);
    for (const fuera of [conReciente, enviada, fallida, reciente, estadoAnterior]) expect(ids).not.toContain(fuera.idCita);
  });

  it("HU0003-1.0 (indicadores) la consulta de C8 cuenta cada aviso una sola vez, aunque tenga varias filas", async () => {
    const e = await entornoVisita(db(), firmante);
    const agotada = await citaHace(db(), e.campana, { estado: "reservada", minutos: 300 });
    for (const minutos of [290, 270, 250, 230, 210, 190]) await intento(db(), agotada.idExpediente, "visita_confirmada", "pendiente", minutos);
    await intento(db(), agotada.idExpediente, "visita_confirmada", "fallido", 170);
    const enviada = await citaHace(db(), e.campana, { estado: "reservada", minutos: 300 });
    await intento(db(), enviada.idExpediente, "visita_confirmada", "pendiente", 290);
    await intento(db(), enviada.idExpediente, "visita_confirmada", "pendiente", 270);
    await intento(db(), enviada.idExpediente, "visita_confirmada", "enviado", 250);
    const credenciales = await citaHace(db(), e.campana, { estado: "asistio", minutos: 300 });
    await intento(db(), credenciales.idExpediente, "credenciales_portal", "pendiente", 290);
    await intento(db(), credenciales.idExpediente, "credenciales_portal", "enviado", 270);
    await intento(db(), credenciales.idExpediente, "recordatorio_visita", "pendiente", 260); // sin cierre: no cuenta

    expect(await contarAvisosCerrados(db(), e.campana)).toEqual([
      { tipo_evento: "credenciales_portal", estado_envio: "enviado", avisos: 1 },
      { tipo_evento: "visita_confirmada", estado_envio: "enviado", avisos: 1 },
      { tipo_evento: "visita_confirmada", estado_envio: "fallido", avisos: 1 },
    ]);
  });
});

describe("HU0004-1.0 credenciales temporales por el flujo agendamiento (D3)", () => {
  it("HU0004-1.0 el aviso de credenciales fija una contraseña temporal en Keycloak y devuelve el correo con el usuario, la contraseña y el enlace al portal; la retoma la rota y no la toca si la familia ya la cambió", async () => {
    const e = await entornoVisita(db(), firmante);
    const v = await reservada(e);
    expect((await asistencia(e, v.idCita, "asistio_interesado")).status).toBe(200);
    const [usuario] = e.falsa.porCorreo(v.correo);

    const res = await aviso(e, v.idCita);

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ id_expediente: v.idExpediente, id_cita: v.idCita, tipo_evento: "credenciales_portal" });
    expect(res.body.asunto).toBe(`Acceso al portal de postulación · Admisión ${e.campana}`);
    const contrasena = contrasenaDe(res.body.cuerpo)!;
    expect(contrasena).toBe(usuario!.contrasenaTemporal);
    expect(usuario).toMatchObject({ cambioPendiente: true, credenciales: true });
    const frontend = process.env.FRONTEND_PUBLIC_URL!.replace(/\/+$/, "");
    expect((res.body.cuerpo as string).split("\n")).toEqual([
      "Hola, María Fernanda:",
      "",
      AVISOS_VISITA.credenciales,
      "",
      `Portal de postulación: ${frontend}/portal`,
      `Usuario: ${v.correo}`,
      `Contraseña temporal: ${contrasena}`,
      "",
      "Al ingresar por primera vez, el portal te pedirá crear una contraseña nueva.",
      "Si recibes más de un correo, usa el más reciente.",
      "",
      AVISOS_VISITA.contacto,
    ]);

    // M2: con ancla vieja, el intento vencido se retoma con otra contraseña; la anterior deja de valer.
    const c = await conCuentaHace(e);
    const p1 = await aviso(e, c.idCita);
    await intentadaHace(db(), p1.body.id_notificacion, 11);
    const p2 = await aviso(e, c.idCita);
    expect(p2.status).toBe(201);
    expect(contrasenaDe(p2.body.cuerpo)).not.toBe(contrasenaDe(p1.body.cuerpo));
    expect(e.falsa.usuarios.get(c.idUsuario)!.contrasenaTemporal).toBe(contrasenaDe(p2.body.cuerpo));

    // M4: la familia ya cambió la contraseña (sin UPDATE_PASSWORD): la última fila se marca enviado y no se rota.
    await intentadaHace(db(), p2.body.id_notificacion, 11);
    e.falsa.usuarios.get(c.idUsuario)!.cambioPendiente = false;
    const m4 = await aviso(e, c.idCita);
    expect(m4.status).toBe(409);
    expect(m4.body.error.codigo).toBe("AVISO_YA_REGISTRADO");
    expect(e.falsa.usuarios.get(c.idUsuario)!.contrasenaTemporal).toBe(contrasenaDe(p2.body.cuerpo));
    expect((await intentosDe(db(), c.idExpediente)).map((x) => x.estado_envio)).toEqual(["pendiente", "enviado"]);
    expect(await pendientes(e)).not.toContain(c.idCita);
  });

  it("HU0004-1.0 (tope) 6 intentos de credenciales con resultado desconocido dejan una sola fila de cierre fallido, ningún intento más, y M3 invalida la contraseña", async () => {
    const e = await entornoVisita(db(), firmante);
    const c = await conCuentaHace(e, 240);
    const ultima = await aviso(e, c.idCita); // fija una contraseña conocida (sexto intento más abajo)
    const enviada = contrasenaDe(ultima.body.cuerpo)!;
    await db().query("DELETE FROM notificacion WHERE id_notificacion = $1", [ultima.body.id_notificacion]);
    for (const minutos of [230, 200, 170, 140, 110, 80]) await intento(db(), c.idExpediente, "credenciales_portal", "pendiente", minutos);

    const res = await aviso(e, c.idCita);

    expect(res.status).toBe(409);
    expect(res.body.error.codigo).toBe("AVISO_AGOTADO");
    expect((await intentosDe(db(), c.idExpediente, "credenciales_portal")).map((x) => x.estado_envio)).toEqual([
      "pendiente", "pendiente", "pendiente", "pendiente", "pendiente", "pendiente", "fallido",
    ]);
    const vigente = e.falsa.usuarios.get(c.idUsuario)!.contrasenaTemporal;
    expect(vigente).not.toBe(enviada);
    expect(vigente).toHaveLength(16);
    expect(await pendientes(e)).not.toContain(c.idCita);
    expect((await aviso(e, c.idCita)).body.error.codigo).toBe("AVISO_YA_REGISTRADO");
  });

  it("D3 (M3) M3 solo invalida una contraseña temporal: si la familia ya la cambió, el tope no cierra el aviso como fallido (M4) y un cierre fallido no la toca", async () => {
    const e = await entornoVisita(db(), firmante);
    // Seis intentos sin resultado, pero la familia ya entró con la del último y la cambió (sin UPDATE_PASSWORD).
    const c = await conCuentaHace(e, 240);
    const previo = await aviso(e, c.idCita);
    await db().query("DELETE FROM notificacion WHERE id_notificacion = $1", [previo.body.id_notificacion]);
    for (const minutos of [230, 200, 170, 140, 110, 80]) await intento(db(), c.idExpediente, "credenciales_portal", "pendiente", minutos);
    const propia = e.falsa.usuarios.get(c.idUsuario)!;
    propia.cambioPendiente = false;
    propia.contrasenaTemporal = "la-que-eligio-la-familia";

    const res = await aviso(e, c.idCita);

    expect(res.status).toBe(409);
    expect(res.body.error.codigo).toBe("AVISO_YA_REGISTRADO");
    expect((await intentosDe(db(), c.idExpediente)).map((x) => x.estado_envio)).toEqual([
      "pendiente", "pendiente", "pendiente", "pendiente", "pendiente", "enviado",
    ]);
    expect(propia.contrasenaTemporal).toBe("la-que-eligio-la-familia");
    expect(await pendientes(e)).not.toContain(c.idCita);

    // Un cierre fallido que llega cuando la familia ya cambió la contraseña tampoco la toca.
    const otra = await conCuentaHace(e);
    const r = await aviso(e, otra.idCita);
    const usuario = e.falsa.usuarios.get(otra.idUsuario)!;
    usuario.cambioPendiente = false;
    usuario.contrasenaTemporal = "otra-que-eligio-la-familia";
    expect((await cerrar(e, r.body.id_notificacion, "fallido")).status).toBe(200);
    expect(usuario.contrasenaTemporal).toBe("otra-que-eligio-la-familia");
  });

  it("D3 (M3) una notificación de credenciales cerrada como fallida invalida la contraseña en Keycloak", async () => {
    const e = await entornoVisita(db(), firmante);
    const c = await conCuentaHace(e);
    const res = await aviso(e, c.idCita);
    const enviada = contrasenaDe(res.body.cuerpo)!;

    expect((await cerrar(e, res.body.id_notificacion, "fallido")).status).toBe(200);

    const vigente = e.falsa.usuarios.get(c.idUsuario)!.contrasenaTemporal;
    expect(vigente).not.toBe(enviada);
    expect(vigente).toHaveLength(16);
    // Un cierre `enviado` no la toca, y M3 es best effort: si Keycloak falla, el cierre queda igual.
    const otra = await conCuentaHace(e);
    const r2 = await aviso(e, otra.idCita);
    expect((await cerrar(e, r2.body.id_notificacion, "enviado")).status).toBe(200);
    expect(e.falsa.usuarios.get(otra.idUsuario)!.contrasenaTemporal).toBe(contrasenaDe(r2.body.cuerpo));
    const tercera = await conCuentaHace(e);
    const r3 = await aviso(e, tercera.idCita);
    e.falsa.fallarUnaVez("establecerContrasenaTemporal");
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const cierre = await cerrar(e, r3.body.id_notificacion, "fallido");
    expect(cierre.status).toBe(200);
    expect(cierre.body).toEqual({ id_notificacion: r3.body.id_notificacion, estado_envio: "fallido" });
  });

  it("D3 la contraseña temporal no aparece en notificacion, registro_auditoria ni en los logs de la API (camino normal, retoma y fallos)", async () => {
    const e = await entornoVisita(db(), firmante);
    const salidas: string[] = [];
    for (const metodo of ["log", "info", "warn", "error", "debug"] as const) {
      vi.spyOn(console, metodo).mockImplementation((...args: unknown[]) => {
        salidas.push(args.map(String).join(" "));
      });
    }
    const contrasenas: string[] = [];
    // Camino normal (desde G04) y retoma con rotación.
    const v = await reservada(e);
    await asistencia(e, v.idCita, "asistio_interesado");
    const normal = await aviso(e, v.idCita);
    contrasenas.push(contrasenaDe(normal.body.cuerpo)!);
    const c = await conCuentaHace(e);
    const r1 = await aviso(e, c.idCita);
    contrasenas.push(contrasenaDe(r1.body.cuerpo)!);
    await intentadaHace(db(), r1.body.id_notificacion, 11);
    const r2 = await aviso(e, c.idCita);
    contrasenas.push(contrasenaDe(r2.body.cuerpo)!);
    // Fallo de Keycloak al fijarla: 502, se revierte y no queda el intento.
    const c2 = await conCuentaHace(e);
    e.falsa.fallarUnaVez("establecerContrasenaTemporal");
    const caida = await aviso(e, c2.idCita);
    expect(caida.status).toBe(502);
    expect(await intentosDe(db(), c2.idExpediente)).toEqual([]);
    // Cierre fallido con M3 (la contraseña de invalidación también se busca).
    await cerrar(e, r2.body.id_notificacion, "fallido");
    contrasenas.push(e.falsa.usuarios.get(c.idUsuario)!.contrasenaTemporal!);
    expect(new Set(contrasenas).size).toBe(4);

    const { rows: [n] } = await db().query("SELECT coalesce(string_agg(row_to_json(n)::text, ' '), '') AS t FROM notificacion n");
    const { rows: [a] } = await db().query("SELECT coalesce(string_agg(row_to_json(r)::text, ' '), '') AS t FROM registro_auditoria r");
    for (const valor of contrasenas) {
      expect(n.t.includes(valor), "la contraseña temporal aparece en notificacion").toBe(false);
      expect(a.t.includes(valor), "la contraseña temporal aparece en registro_auditoria").toBe(false);
      expect(salidas.some((s) => s.includes(valor)), "la contraseña temporal aparece en el log de la API").toBe(false);
    }
  });
});

describe("HU0004-2.0 invitación a reprogramar por el flujo agendamiento", () => {
  it("HU0004-2.0 el aviso de reprogramación trae un enlace nuevo de P02 que vuelve a aceptar una reserva, y el de la carpeta también vale", async () => {
    const e = await entornoVisita(db(), firmante);
    const v = await reservada(e);
    expect((await asistencia(e, v.idCita, "no_asistio")).status).toBe(200);

    const res = await aviso(e, v.idCita);

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ id_expediente: v.idExpediente, id_cita: v.idCita, tipo_evento: "visita_reprogramacion" });
    expect(res.body.asunto).toBe(`Reprograma tu visita guiada · Admisión ${e.campana}`);
    const enlace = (res.body.cuerpo as string).match(/agenda una nueva visita: (\S+)/)![1]!;
    const frontend = process.env.FRONTEND_PUBLIC_URL!.replace(/\/+$/, "");
    expect(enlace.startsWith(`${frontend}/visita-guiada?t=v1.`)).toBe(true);
    const nuevo = new URL(enlace).searchParams.get("t")!;
    expect(nuevo).not.toBe(v.token);
    expect(leerTokenVisita(nuevo)).toBe(v.idExpediente);
    expect((res.body.cuerpo as string).split("\n")).toEqual([
      "Hola, María Fernanda:",
      "",
      AVISOS_VISITA.reprogramacion,
      "",
      `Si aún te interesa conocer el colegio, agenda una nueva visita: ${enlace}`,
      "",
      AVISOS_VISITA.contacto,
    ]);
    for (const t of [nuevo, v.token]) {
      const lectura = await request(e.app).get("/publico/visita-guiada").set("X-Enlace-Visita", t);
      expect(lectura.status).toBe(200);
    }
    const h = await horarioVisita(db(), e.directora, e.campana, { dias: 16, inicio: "15:00", fin: "16:00" });
    expect((await reservarP02(e, nuevo, h.id_horario)).status).toBe(201);
    expect(await estadoDe(db(), v.idExpediente)).toBe("visita_agendada");
  });

  it("HU0004-2.0 (B1) tras «No asistió» y una nueva reserva, la cita 2 recibe su propia visita_confirmada y su recordatorio, aunque la cita 1 ya los tuvo", async () => {
    const e = await entornoVisita(db(), firmante);
    const v = await reservada(e, 18);
    const conf1 = await aviso(e, v.idCita);
    expect((await cerrar(e, conf1.body.id_notificacion, "enviado")).status).toBe(200);
    expect((await asistencia(e, v.idCita, "no_asistio")).status).toBe(200);
    const reprog = await aviso(e, v.idCita);
    expect((await cerrar(e, reprog.body.id_notificacion, "enviado")).status).toBe(200);

    const h2 = await horarioVisita(db(), e.directora, e.campana, { dias: 19, inicio: "09:00", fin: "10:00" });
    expect((await reservarP02(e, v.token, h2.id_horario)).status).toBe(201);
    const { rows: [c2] } = await db().query("SELECT id_cita FROM cita WHERE id_expediente = $1 ORDER BY id_cita DESC LIMIT 1", [v.idExpediente]);
    expect(c2.id_cita).not.toBe(v.idCita);
    expect((await aviso(e, v.idCita)).body.error.codigo).toBe("AVISO_NO_CORRESPONDE"); // la cita 1 ya no tiene aviso

    const conf2 = await aviso(e, c2.id_cita);

    expect(conf2.status).toBe(201);
    expect(conf2.body.tipo_evento).toBe("visita_confirmada");
    expect(conf2.body.id_notificacion).not.toBe(conf1.body.id_notificacion);
    // Recordatorio de la cita 2: dentro de su ventana (se adelanta su fecha_hora solo en la BD de prueba).
    await db().query("UPDATE cita SET fecha_hora = now() + interval '2 hours' WHERE id_cita = $1", [c2.id_cita]);
    const rec = await e.interno(request(e.app).post(`/internal/citas/${c2.id_cita}/recordatorio`));
    expect(rec.status).toBe(201);
    expect(rec.body).toMatchObject({ id_cita: c2.id_cita, tipo_evento: "recordatorio_visita" });
    expect((await intentosDe(db(), v.idExpediente)).map((x) => [x.tipo_evento, x.estado_envio])).toEqual([
      ["visita_confirmada", "enviado"],
      ["visita_reprogramacion", "enviado"],
      ["visita_confirmada", "pendiente"],
      ["recordatorio_visita", "pendiente"],
    ]);
  });
});

describe("Rutas internas de agendamiento y recordatorios", () => {
  it("HU0003-1.0 las rutas /internal/* de agendamiento y recordatorios responden 401 sin el token de servicio", async () => {
    const e = await entornoVisita(db(), firmante);
    const c = await citaHace(db(), e.campana, { estado: "reservada", minutos: 60 });
    for (const [metodo, ruta] of [
      ["post", `/internal/citas/${c.idCita}/aviso`],
      ["get", "/internal/agendamiento/pendientes"],
      ["post", `/internal/citas/${c.idCita}/recordatorio`],
      ["get", "/internal/recordatorios/pendientes"],
    ] as const) {
      expect((await request(e.app)[metodo](ruta)).status, ruta).toBe(401);
    }
    expect(await intentosDe(db(), c.idExpediente)).toEqual([]);
    expect((await aviso(e, 999999)).status).toBe(404);
  });
});
