import request from "supertest";
import { afterAll, describe, expect, it } from "vitest";
import { crearApp } from "../src/app";
import { cerrarPool } from "../src/db/pool";

afterAll(cerrarPool);

describe("S0-B8 API base", () => {
  it("S0-B8 GET /salud responde 200 con la base de datos disponible", async () => {
    const res = await request(crearApp()).get("/salud");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ estado: "ok" });
  });

  it("S0-B8 una ruta inexistente responde 404 con el formato de error uniforme", async () => {
    const res = await request(crearApp()).get("/no-existe");
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: { codigo: "NO_ENCONTRADO", mensaje: expect.any(String) } });
  });
});
