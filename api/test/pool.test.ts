// S0-B9: regresión encontrada al recrear el contenedor de Postgres. Si el servidor cierra una
// conexión inactiva del pool, la API debe seguir viva y abrir una conexión nueva en la siguiente consulta.
import pg from "pg";
import request from "supertest";
import { afterAll, describe, expect, it } from "vitest";
import { crearApp } from "../src/app";
import { cerrarPool, obtenerPool } from "../src/db/pool";

afterAll(cerrarPool);

describe("S0-B9 resiliencia del pool de conexiones", () => {
  it("S0-B9 la API sigue respondiendo si Postgres cierra una conexión inactiva del pool", async () => {
    await obtenerPool().query("SELECT 1"); // deja un cliente inactivo en el pool

    // El mismo usuario puede terminar sus propias sesiones: simula un reinicio del servidor.
    const otro = new pg.Client({
      host: process.env.POSTGRES_HOST,
      port: Number(process.env.POSTGRES_PORT),
      database: process.env.ADMISION_DB,
      user: process.env.ADMISION_DB_USER,
      password: process.env.ADMISION_DB_PASSWORD,
    });
    await otro.connect();
    const { rows } = await otro.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM (
         SELECT pg_terminate_backend(pid) FROM pg_stat_activity
          WHERE usename = current_user AND datname = current_database() AND pid <> pg_backend_pid()
       ) t`,
    );
    await otro.end();
    expect(rows[0]!.n).toBeGreaterThan(0);
    await new Promise((r) => setTimeout(r, 300)); // da tiempo a que llegue el aviso de cierre

    const res = await request(crearApp()).get("/salud");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ estado: "ok" });
  });
});
