// HU0002 (flujo captacion de n8n) por /internal/*: reserva y armado de la carpeta informativa (1.0, parte «correo»),
// barrido y reintentos (C27, D7), rebote síncrono del correo (2.0, parte «rechazo síncrono») y registro de fallos de
// n8n (C2). El envío real (n8n y Mailpit) se prueba en e2e/captacion.spec.ts.
import request from "supertest";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { crearApp } from "../src/app";
import { leerTokenVisita, crearTokenVisita } from "../src/crypto/enlaceVisita";
import { cerrarPool, obtenerPool } from "../src/db/pool";
import { CARPETA_INFORMATIVA, componerCarpeta } from "../src/services/carpetaInformativa";
import { crearExpediente, eventosDe } from "./ayudantes";

afterAll(cerrarPool);
afterEach(() => {
  vi.restoreAllMocks();
});

const db = () => obtenerPool();
const app = crearApp();
const TOKEN = process.env.INTERNAL_API_TOKEN!;
const conToken = (r: request.Test) => r.set("Authorization", `Bearer ${TOKEN}`);

const reservar = (id: number | string) => conToken(request(app).post(`/internal/expedientes/${id}/carpeta-informativa`));
const cerrar = (id: number | string, estado_envio: string) => conToken(request(app).patch(`/internal/notificaciones/${id}`)).send({ estado_envio });
const rebote = (id: number | string, cuerpo: object = { origen: "smtp_rechazo" }) =>
  conToken(request(app).post(`/internal/notificaciones/${id}/rebote`)).send(cuerpo);
const pendientes = async () => {
  const res = await conToken(request(app).get("/internal/captacion/pendientes"));
  expect(res.status).toBe(200);
  return (res.body.expedientes as { id_expediente: number }[]).map((e) => e.id_expediente);
};

async function carpetasDe(idExpediente: number) {
  const { rows } = await db().query(
    `SELECT id_notificacion, canal::text AS canal, tipo_evento, estado_envio::text AS estado_envio, fecha_envio
       FROM notificacion WHERE id_expediente = $1 ORDER BY id_notificacion`,
    [idExpediente],
  );
  return rows;
}

const estadoDe = async (id: number) =>
  (await db().query("SELECT estado::text AS estado FROM expediente WHERE id_expediente = $1", [id])).rows[0].estado;

// Simula el paso del tiempo solo en las filas de la prueba.
const registradoHace = (id: number, minutos: number) =>
  db().query("UPDATE expediente SET fecha_registro = now() - make_interval(mins => $2) WHERE id_expediente = $1", [id, minutos]);
const intentadaHace = (idNotificacion: number, minutos: number) =>
  db().query("UPDATE notificacion SET fecha_envio = now() - make_interval(mins => $2) WHERE id_notificacion = $1", [idNotificacion, minutos]);

const tokenDelCuerpo = (cuerpo: string) => {
  const enlace = cuerpo.match(/Agenda tu visita guiada: (\S+)/)![1]!;
  return { enlace, token: new URL(enlace).searchParams.get("t")! };
};

describe("HU0002-1.0 reserva y armado de la carpeta informativa", () => {
  it("HU0002-1.0 [parte: correo] la reserva crea una notificación pendiente y devuelve el asunto y el cuerpo con la carpeta y el enlace para agendar", async () => {
    const { idExpediente } = await crearExpediente(db());
    const { rows: [grado] } = await db().query(
      "SELECT g.nombre_grado, g.campana_admision FROM expediente e JOIN grado g USING (id_grado) WHERE e.id_expediente = $1",
      [idExpediente],
    );

    const res = await reservar(idExpediente);

    expect(res.status).toBe(201);
    expect(res.body).toEqual({
      id_expediente: idExpediente,
      id_notificacion: expect.any(Number),
      tipo_evento: "carpeta_enviada",
      asunto: expect.any(String),
      cuerpo: expect.any(String),
    });
    expect(res.body.asunto).toBe(`Carpeta informativa · Admisión ${grado.campana_admision}`);
    const lineas = (res.body.cuerpo as string).split("\n");
    expect(lineas[0]).toBe("Hola, Prueba:");
    expect(lineas).toContain(`Grado de interés: ${grado.nombre_grado}`);
    expect(lineas).toContain(`Carpeta informativa: ${CARPETA_INFORMATIVA.sinEnlace}`); // la corrida no tiene CARPETA_INFORMATIVA_URL
    const { enlace } = tokenDelCuerpo(res.body.cuerpo);
    expect(enlace.startsWith(`${process.env.FRONTEND_PUBLIC_URL!.replace(/\/+$/, "")}/visita-guiada?t=v1.`)).toBe(true);

    expect(await carpetasDe(idExpediente)).toEqual([
      expect.objectContaining({ id_notificacion: res.body.id_notificacion, canal: "correo", tipo_evento: "carpeta_enviada", estado_envio: "pendiente" }),
    ]);
    expect(await estadoDe(idExpediente)).toBe("prospecto");
    expect(await eventosDe(db(), idExpediente)).toEqual([]);
  });

  it("HU0002-1.0 [parte: correo] el enlace identifica al expediente sin mostrar su id; un token alterado, truncado o de otra clave no identifica a nadie", async () => {
    const { idExpediente } = await crearExpediente(db());
    const { token, enlace } = tokenDelCuerpo((await reservar(idExpediente)).body.cuerpo);

    expect(leerTokenVisita(token)).toBe(idExpediente);
    // El enlace solo lleva el token: ni el id ni otro dato del expediente.
    expect([...new URL(enlace).searchParams.keys()]).toEqual(["t"]);
    expect(token).toMatch(/^v1\.[A-Za-z0-9_-]{43}$/);
    // IV aleatorio: dos enlaces del mismo expediente son distintos, así que no hay correspondencia fija id → token.
    const otro = crearTokenVisita(idExpediente);
    expect(otro).not.toBe(token);
    expect(leerTokenVisita(otro)).toBe(idExpediente);

    const datos = token.slice(3);
    const medio = 10;
    const alterado = `v1.${datos.slice(0, medio)}${datos[medio] === "A" ? "B" : "A"}${datos.slice(medio + 1)}`;
    const deOtraClave = crearTokenVisita(idExpediente, Buffer.alloc(32, 7).toString("base64"));
    for (const invalido of [alterado, token.slice(0, -4), `v2.${datos}`, deOtraClave, "v1.", "", "v1.***", `${token}.x`]) {
      expect(leerTokenVisita(invalido), invalido).toBeNull();
    }
  });

  it("HU0002-1.0 [parte: correo] los textos del colegio van entre corchetes, y sin CARPETA_INFORMATIVA_URL el cuerpo lo dice", () => {
    expect(CARPETA_INFORMATIVA.version).toBe("borrador-1");
    for (const texto of [CARPETA_INFORMATIVA.presentacion, CARPETA_INFORMATIVA.contacto, CARPETA_INFORMATIVA.sinEnlace]) {
      expect(texto).toMatch(/^\[.+: por definir con el colegio\]$/);
    }
    const base = { nombres: "Ana", nombreGrado: "3.° de primaria", campana: "2027", enlaceVisita: "http://frontend.ejemplo.test/visita-guiada?t=v1.x" };

    const sinUrl = componerCarpeta(base).cuerpo;
    expect(sinUrl).toContain(`Carpeta informativa: ${CARPETA_INFORMATIVA.sinEnlace}`);
    expect(sinUrl).toContain(CARPETA_INFORMATIVA.presentacion);
    expect(sinUrl).toContain(CARPETA_INFORMATIVA.contacto);

    const conUrl = componerCarpeta({ ...base, urlCarpeta: "https://colegio.ejemplo.test/carpeta-2027.pdf" }).cuerpo;
    expect(conUrl).toContain("Carpeta informativa: https://colegio.ejemplo.test/carpeta-2027.pdf");
    expect(conUrl).not.toContain(CARPETA_INFORMATIVA.sinEnlace);
  });

  it("HU0002-1.0 [parte: correo] marcar enviado o fallido cierra la notificación; repetirlo es idempotente y cambiar un estado cerrado da 409", async () => {
    const { idExpediente } = await crearExpediente(db());
    const id = (await reservar(idExpediente)).body.id_notificacion as number;
    await intentadaHace(id, 5);

    const enviado = await cerrar(id, "enviado");
    expect(enviado.status).toBe(200);
    expect(enviado.body).toEqual({ id_notificacion: id, estado_envio: "enviado" });
    const [fila] = await carpetasDe(idExpediente);
    expect(fila.estado_envio).toBe("enviado");
    // fecha_envio pasa a ser la hora del resultado, no la de la reserva.
    expect(Date.now() - new Date(fila.fecha_envio).getTime()).toBeLessThan(60_000);

    const repetido = await cerrar(id, "enviado"); // reintento de n8n tras perder la respuesta (C8)
    expect(repetido.status).toBe(200);
    expect((await carpetasDe(idExpediente))[0].fecha_envio).toEqual(fila.fecha_envio);

    const conflicto = await cerrar(id, "fallido");
    expect(conflicto.status).toBe(409);
    expect(conflicto.body.error.codigo).toBe("NOTIFICACION_CERRADA");

    expect((await cerrar(id, "pendiente")).status).toBe(400);
    expect((await conToken(request(app).patch(`/internal/notificaciones/${id}`)).send({ estado_envio: "enviado", extra: 1 })).status).toBe(400);
    expect((await cerrar(2147483000, "enviado")).status).toBe(404);
    expect((await carpetasDe(idExpediente))[0].estado_envio).toBe("enviado");
  });
});

describe("C27 recuperación e idempotencia de la carpeta", () => {
  it("C27 dos reservas simultáneas del mismo expediente: una 201 y otra 409, y una sola fila", async () => {
    const { idExpediente } = await crearExpediente(db());

    const respuestas = await Promise.all([reservar(idExpediente), reservar(idExpediente)]);

    expect(respuestas.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(respuestas.find((r) => r.status === 409)!.body.error.codigo).toBe("CARPETA_YA_REGISTRADA");
    expect(await carpetasDe(idExpediente)).toHaveLength(1);
    // Una tercera, mientras la primera sigue en curso (menos de 10 min), tampoco envía.
    expect((await reservar(idExpediente)).status).toBe(409);
    expect(await carpetasDe(idExpediente)).toHaveLength(1);
  });

  it("C27 una reserva fuera de prospecto responde 409 y no inserta nada", async () => {
    const { idExpediente } = await crearExpediente(db());
    await db().query("UPDATE expediente SET estado = 'visita_agendada' WHERE id_expediente = $1", [idExpediente]);

    const res = await reservar(idExpediente);
    expect(res.status).toBe(409);
    expect(res.body.error.codigo).toBe("ESTADO_NO_PERMITE_CARPETA");
    expect(await carpetasDe(idExpediente)).toEqual([]);

    const inexistente = await reservar(2147483000);
    expect(inexistente.status).toBe(404);
    expect(inexistente.body.error.codigo).toBe("EXPEDIENTE_NO_ENCONTRADO");
    expect((await reservar("abc")).status).toBe(400);
  });

  it("C27 los pendientes son prospectos sin carpeta registrados hace más de 1 min, y carpetas pendientes intentadas hace más de 10 min", async () => {
    const nuevo = async () => (await crearExpediente(db())).idExpediente;
    const conCarpeta = async (estado: string | null, minutosIntento: number) => {
      const id = await nuevo();
      const idNotificacion = (await reservar(id)).body.id_notificacion as number;
      if (estado) await cerrar(idNotificacion, estado);
      await intentadaHace(idNotificacion, minutosIntento);
      await registradoHace(id, 30);
      return id;
    };

    const sinCarpetaViejo = await nuevo();
    await registradoHace(sinCarpetaViejo, 2);
    const sinCarpetaReciente = await nuevo(); // el webhook todavía puede estar enviándola
    const pendienteVencida = await conCarpeta(null, 11);
    const pendienteEnCurso = await conCarpeta(null, 5);
    const enviada = await conCarpeta("enviado", 30);
    const fallida = await conCarpeta("fallido", 30);
    const fueraDeProspecto = await nuevo();
    await registradoHace(fueraDeProspecto, 30);
    await db().query("UPDATE expediente SET estado = 'contacto_no_entregado' WHERE id_expediente = $1", [fueraDeProspecto]);

    const lista = await pendientes();

    expect(lista).toContain(sinCarpetaViejo);
    expect(lista).toContain(pendienteVencida);
    for (const excluido of [sinCarpetaReciente, pendienteEnCurso, enviada, fallida, fueraDeProspecto]) {
      expect(lista).not.toContain(excluido);
    }
    // Los más antiguos primero (pendienteVencida se registró hace 30 min; sinCarpetaViejo, hace 2).
    expect(lista.indexOf(pendienteVencida)).toBeLessThan(lista.indexOf(sinCarpetaViejo));
    expect(lista.length).toBeLessThanOrEqual(20);
  });

  it("C27 (D7) una carpeta pendiente por un 502, un 500 o un error técnico de SMTP vuelve al barrido a los 10 minutos y la reserva la retoma con el mismo id_notificacion; antes de los 10 minutos responde 409", async () => {
    const { idExpediente } = await crearExpediente(db());
    await registradoHace(idExpediente, 30);
    const id = (await reservar(idExpediente)).body.id_notificacion as number;
    // El envío falló por una causa técnica: notificacion-multicanal no cerró la fila (D7), sigue pendiente.

    await intentadaHace(id, 9);
    expect(await pendientes()).not.toContain(idExpediente);
    expect((await reservar(idExpediente)).status).toBe(409);

    await intentadaHace(id, 11);
    expect(await pendientes()).toContain(idExpediente);
    const retomada = await reservar(idExpediente);
    expect(retomada.status).toBe(201);
    expect(retomada.body.id_notificacion).toBe(id);
    const [fila] = await carpetasDe(idExpediente);
    expect(fila.estado_envio).toBe("pendiente");
    expect(Date.now() - new Date(fila.fecha_envio).getTime()).toBeLessThan(60_000); // marca el nuevo intento
    expect(await carpetasDe(idExpediente)).toHaveLength(1);
    expect(await pendientes()).not.toContain(idExpediente);
    expect((await reservar(idExpediente)).status).toBe(409);
  });

  it("C27 (D7) una carpeta marcada fallida por un 400 de notificacion-multicanal queda fallida, sin notificacion_rebotada ni transición, el expediente sigue en prospecto y el barrido no la retoma", async () => {
    const { idExpediente } = await crearExpediente(db());
    await registradoHace(idExpediente, 30);
    const id = (await reservar(idExpediente)).body.id_notificacion as number;

    expect((await cerrar(id, "fallido")).status).toBe(200); // lo que hace captacion ante un 400 (D7)
    await intentadaHace(id, 60);

    expect((await carpetasDe(idExpediente))[0].estado_envio).toBe("fallido");
    expect(await eventosDe(db(), idExpediente)).toEqual([]);
    expect(await estadoDe(idExpediente)).toBe("prospecto");
    expect(await pendientes()).not.toContain(idExpediente);
    const otra = await reservar(idExpediente);
    expect(otra.status).toBe(409);
    expect(otra.body.error.codigo).toBe("CARPETA_YA_REGISTRADA");
    expect(await carpetasDe(idExpediente)).toHaveLength(1);
  });
});

describe("HU0002-2.0 rebote síncrono del correo de la carpeta", () => {
  it("HU0002-2.0 [parte: rechazo síncrono] el rebote deja la notificación fallida, audita notificacion_rebotada y pasa el expediente a contacto_no_entregado en una transacción", async () => {
    const { idExpediente } = await crearExpediente(db());
    const id = (await reservar(idExpediente)).body.id_notificacion as number;
    expect((await cerrar(id, "fallido")).status).toBe(200); // notificacion-multicanal ante el 550

    const res = await rebote(id);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ id_notificacion: id, estado_envio: "fallido", transicion: true });
    expect((await carpetasDe(idExpediente))[0].estado_envio).toBe("fallido");
    expect(await estadoDe(idExpediente)).toBe("contacto_no_entregado");
    const eventos = await eventosDe(db(), idExpediente);
    expect(eventos.map((e) => e.tipo_evento)).toEqual(["notificacion_rebotada", "transicion_estado"]);
    expect(eventos[0]).toMatchObject({
      id_personal: null,
      estado_anterior: null,
      estado_nuevo: null,
      detalle: { id_notificacion: id, canal: "correo", origen: "smtp_rechazo" },
    });
    expect(eventos[1]).toMatchObject({
      id_personal: null, // actor: el sistema (n8n)
      estado_anterior: "prospecto",
      estado_nuevo: "contacto_no_entregado",
      detalle: { campo: "estado", motivo: "rebote_carpeta", id_notificacion: id },
    });

    // También si la notificación seguía pendiente (el cierre no llegó): el rebote la deja fallida.
    const otro = (await crearExpediente(db())).idExpediente;
    const idOtra = (await reservar(otro)).body.id_notificacion as number;
    expect((await rebote(idOtra)).body).toEqual({ id_notificacion: idOtra, estado_envio: "fallido", transicion: true });
    expect((await carpetasDe(otro))[0].estado_envio).toBe("fallido");
  });

  it("HU0002-2.0 [parte: rechazo síncrono] repetir el rebote no duplica eventos; fuera de prospecto se registra sin transición", async () => {
    const { idExpediente } = await crearExpediente(db());
    const id = (await reservar(idExpediente)).body.id_notificacion as number;
    await rebote(id);
    const antes = await eventosDe(db(), idExpediente);

    const repetido = await rebote(id);
    expect(repetido.status).toBe(200);
    expect(repetido.body).toEqual({ id_notificacion: id, estado_envio: "fallido", transicion: false });
    expect(await eventosDe(db(), idExpediente)).toEqual(antes);

    // El expediente ya avanzó (p. ej. agendó por WhatsApp): el rebote queda registrado, sin transición (S3).
    const avanzado = (await crearExpediente(db())).idExpediente;
    const idAvanzado = (await reservar(avanzado)).body.id_notificacion as number;
    await db().query("UPDATE expediente SET estado = 'visita_agendada' WHERE id_expediente = $1", [avanzado]);
    const res = await rebote(idAvanzado);
    expect(res.body).toEqual({ id_notificacion: idAvanzado, estado_envio: "fallido", transicion: false });
    expect(await estadoDe(avanzado)).toBe("visita_agendada");
    expect((await eventosDe(db(), avanzado)).map((e) => e.tipo_evento)).toEqual(["notificacion_rebotada"]);

    // Solo el correo de la carpeta: otra notificación no se marca como rebote.
    const ajena = (await db().query(
      "INSERT INTO notificacion (id_expediente, canal, tipo_evento, estado_envio) VALUES ($1, 'correo', 'otro_evento', 'enviado') RETURNING id_notificacion",
      [avanzado],
    )).rows[0].id_notificacion;
    const noEsCarpeta = await rebote(ajena);
    expect(noEsCarpeta.status).toBe(409);
    expect(noEsCarpeta.body.error.codigo).toBe("NO_ES_CARPETA");

    expect((await rebote(2147483000)).status).toBe(404);
    expect((await rebote(id, { origen: "proveedor" })).status).toBe(400); // D1: solo el rechazo síncrono (C34)
    expect((await rebote(id, {})).status).toBe(400);
  });
});

describe("C2 fallos de n8n en el log de la API", () => {
  it("C2 /internal/errores-flujo registra solo identificadores y rechaza un mensaje o campos extra", async () => {
    const aviso = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const enviar = (cuerpo: object) => conToken(request(app).post("/internal/errores-flujo")).send(cuerpo);

    const ok = await enviar({ flujo: "captacion", nodo: "Reservar carpeta", id_ejecucion: "1234" });
    expect(ok.status).toBe(204);
    expect(aviso.mock.calls).toEqual([["Fallo en n8n (flujo=captacion, nodo=Reservar carpeta, ejecución=1234)"]]);

    for (const invalido of [
      { flujo: "captacion", nodo: "Enviar correo", id_ejecucion: "1", mensaje: "550 <alguien@ejemplo.test> rejected" },
      { flujo: "captacion", nodo: "Nodo\nlínea falsa", id_ejecucion: "1" },
      { flujo: "", nodo: "x", id_ejecucion: "1" },
      { flujo: "captacion", nodo: "x", id_ejecucion: "1 2" },
      { flujo: "captacion", nodo: "x" },
    ]) {
      expect((await enviar(invalido)).status).toBe(400);
    }
    expect(aviso).toHaveBeenCalledTimes(1);
  });
});

describe("C27 token de servicio en las rutas internas nuevas", () => {
  it("C27 las rutas internas de captacion y errores-flujo sin token de servicio responden 401", async () => {
    for (const r of [
      request(app).post("/internal/expedientes/1/carpeta-informativa"),
      request(app).patch("/internal/notificaciones/1").send({ estado_envio: "enviado" }),
      request(app).get("/internal/captacion/pendientes"),
      request(app).post("/internal/notificaciones/1/rebote").send({ origen: "smtp_rechazo" }),
      request(app).post("/internal/errores-flujo").send({ flujo: "captacion", nodo: "x", id_ejecucion: "1" }),
    ]) {
      const res = await r;
      expect(res.status).toBe(401);
      expect(res.body.error.codigo).toBe("NO_AUTENTICADO");
    }
  });
});
