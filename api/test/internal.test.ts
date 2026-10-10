// Rutas /internal/* que usa el flujo notificacion-multicanal de n8n (ADR-04).
import request from "supertest";
import { afterAll, describe, expect, it } from "vitest";
import { crearApp } from "../src/app";
import { cerrarPool, obtenerPool } from "../src/db/pool";
import { crearExpediente } from "./ayudantes";

afterAll(cerrarPool);

const app = crearApp();
const TOKEN = process.env.INTERNAL_API_TOKEN!;
const conToken = (r: request.Test) => r.set("Authorization", `Bearer ${TOKEN}`);

async function consentir(idApoderado: number, autorizaWhatsapp: boolean, fecha: string) {
  await obtenerPool().query(
    `INSERT INTO consentimiento (id_apoderado, version_politica, canal_origen, autoriza_whatsapp, fecha_hora_aceptacion)
     VALUES ($1, 'ficticia-v0', 'formulario_web', $2, $3)`,
    [idApoderado, autorizaWhatsapp, fecha],
  );
}

describe("S0-C1 token de servicio en /internal/*", () => {
  it("S0-C1 sin token responde 401 NO_AUTENTICADO", async () => {
    const res = await request(app).get("/internal/expedientes/1/contacto");
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: { codigo: "NO_AUTENTICADO", mensaje: expect.any(String) } });
  });

  it("S0-C1 un token distinto (aunque tenga el mismo largo) responde 401 TOKEN_INVALIDO", async () => {
    const otro = TOKEN.replace(/.$/, (c) => (c === "0" ? "1" : "0"));
    for (const t of [otro, "corto", ""]) {
      const res = await request(app).post("/internal/notificaciones").set("Authorization", `Bearer ${t}`).send({});
      expect(res.status).toBe(401);
    }
  });
});

describe("S0-C2 GET /internal/expedientes/:id/contacto", () => {
  it("S0-C2 devuelve el correo del titular y la autorización de WhatsApp de su consentimiento más reciente", async () => {
    const { idExpediente, idApoderado } = await crearExpediente(obtenerPool());
    await consentir(idApoderado, false, "2027-01-01T10:00:00-05:00");
    await consentir(idApoderado, true, "2027-01-02T10:00:00-05:00");

    const res = await conToken(request(app).get(`/internal/expedientes/${idExpediente}/contacto`));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ id_expediente: idExpediente, correo: expect.stringMatching(/@ejemplo\.test$/), autoriza_whatsapp: true });
  });

  it("S0-C2 sin consentimiento registrado, autoriza_whatsapp es false", async () => {
    const { idExpediente } = await crearExpediente(obtenerPool());
    const res = await conToken(request(app).get(`/internal/expedientes/${idExpediente}/contacto`));
    expect(res.status).toBe(200);
    expect(res.body.autoriza_whatsapp).toBe(false);
  });

  it("S0-C2 responde 404 si el expediente no existe y 400 si el id no es un entero positivo", async () => {
    const noExiste = await conToken(request(app).get("/internal/expedientes/999999/contacto"));
    expect(noExiste.status).toBe(404);
    expect(noExiste.body.error.codigo).toBe("EXPEDIENTE_NO_ENCONTRADO");
    for (const id of ["abc", "0", "-3", "1.5"]) {
      const res = await conToken(request(app).get(`/internal/expedientes/${id}/contacto`));
      expect(res.status).toBe(400);
      expect(res.body.error.codigo).toBe("VALIDACION");
    }
  });
});

describe("S0-C3 POST /internal/notificaciones", () => {
  it("S0-C3 registra la notificación y responde 201 con su id", async () => {
    const { idExpediente } = await crearExpediente(obtenerPool());
    const res = await conToken(request(app).post("/internal/notificaciones")).send({
      id_expediente: idExpediente,
      canal: "correo",
      tipo_evento: "prueba_sprint0",
      estado_envio: "enviado",
    });
    expect(res.status).toBe(201);
    expect(res.body).toEqual({ id_notificacion: expect.any(Number) });

    const { rows } = await obtenerPool().query(
      "SELECT id_expediente, canal::text, tipo_evento, estado_envio::text, fecha_envio FROM notificacion WHERE id_notificacion = $1",
      [res.body.id_notificacion],
    );
    expect(rows[0]).toMatchObject({ id_expediente: idExpediente, canal: "correo", tipo_evento: "prueba_sprint0", estado_envio: "enviado" });
    expect(rows[0].fecha_envio).toBeInstanceOf(Date);
  });

  it("S0-C3 también registra los envíos fallidos (R22)", async () => {
    const { idExpediente } = await crearExpediente(obtenerPool());
    const res = await conToken(request(app).post("/internal/notificaciones")).send({
      id_expediente: idExpediente,
      canal: "correo",
      tipo_evento: "prueba_sprint0",
      estado_envio: "fallido",
    });
    expect(res.status).toBe(201);
  });

  it("S0-C3 rechaza con 400 un cuerpo inválido", async () => {
    const valido = { id_expediente: 1, canal: "correo", tipo_evento: "x", estado_envio: "enviado" };
    for (const cuerpo of [
      {},
      { ...valido, canal: "sms" },
      { ...valido, estado_envio: "entregado" },
      { ...valido, tipo_evento: "   " },
      { ...valido, tipo_evento: "x".repeat(61) },
      { ...valido, id_expediente: "1" },
      { ...valido, id_expediente: 0 },
    ]) {
      const res = await conToken(request(app).post("/internal/notificaciones")).send(cuerpo);
      expect(res.status).toBe(400);
      expect(res.body.error.codigo).toBe("VALIDACION");
    }
  });

  it("S0-C3 responde 404 si el expediente no existe", async () => {
    const res = await conToken(request(app).post("/internal/notificaciones")).send({
      id_expediente: 999999,
      canal: "correo",
      tipo_evento: "prueba_sprint0",
      estado_envio: "enviado",
    });
    expect(res.status).toBe(404);
    expect(res.body.error.codigo).toBe("EXPEDIENTE_NO_ENCONTRADO");
  });
});
