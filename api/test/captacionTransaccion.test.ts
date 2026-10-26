// HU0002-2.0: el rebote se registra en UNA transacción (R6). Archivo aparte porque simula, con vi.mock, que la transición
// del expediente falla después de marcar la notificación y auditar el rebote: no debe quedar nada de eso.
import request from "supertest";
import { afterAll, describe, expect, it, vi } from "vitest";

vi.mock("../src/services/expedientes/transicionarExpediente", async (original) => ({
  ...(await original<typeof import("../src/services/expedientes/transicionarExpediente")>()),
  transicionarExpediente: vi.fn().mockRejectedValue(new Error("falla simulada de la transición")),
}));

const { crearApp } = await import("../src/app");
const { cerrarPool, obtenerPool } = await import("../src/db/pool");
const { crearExpediente, eventosDe } = await import("./ayudantes");

afterAll(cerrarPool);

const db = () => obtenerPool();
const app = crearApp();
const conToken = (r: request.Test) => r.set("Authorization", `Bearer ${process.env.INTERNAL_API_TOKEN!}`);

describe("HU0002-2.0 rebote en una sola transacción", () => {
  it("HU0002-2.0 [parte: rechazo síncrono] si la transición falla, el rebote no deja nada: la notificación no cambia ni queda notificacion_rebotada", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined); // «Error no controlado: Error» del manejador
    const { idExpediente } = await crearExpediente(db());
    const reserva = await conToken(request(app).post(`/internal/expedientes/${idExpediente}/carpeta-informativa`));
    const id = reserva.body.id_notificacion as number;

    const res = await conToken(request(app).post(`/internal/notificaciones/${id}/rebote`)).send({ origen: "smtp_rechazo" });

    expect(res.status).toBe(500);
    const { rows } = await db().query("SELECT estado_envio::text AS estado_envio FROM notificacion WHERE id_notificacion = $1", [id]);
    expect(rows[0].estado_envio).toBe("pendiente");
    expect(await eventosDe(db(), idExpediente)).toEqual([]);
    const estado = await db().query("SELECT estado::text AS e FROM expediente WHERE id_expediente = $1", [idExpediente]);
    expect(estado.rows[0].e).toBe("prospecto");
  });
});
