// C22 (HU0002): las rutas del personal exigen, además del rol del token, una fila activa en personal con ese rol
// (requirePersonalActivo). Cierra la ventana del token vigente tras desactivar una cuenta o cambiarle el rol.
// Las cuentas se crean, desactivan, reactivan y modifican por /personal, con el Keycloak simulado (HU0021).
import { randomUUID } from "node:crypto";
import type { Express } from "express";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { crearApp } from "../src/app";
import { cerrarPool, obtenerPool } from "../src/db/pool";
import { crearFirmante, crearPersonal, unico } from "./ayudantes";
import { crearIdentidadFalsa } from "./identidadFalsa";

const db = () => obtenerPool();

let firmante: Awaited<ReturnType<typeof crearFirmante>>;
let falsa: ReturnType<typeof crearIdentidadFalsa>;
let app: Express;
let tokenDirectora: string;

beforeAll(async () => {
  firmante = await crearFirmante();
  falsa = crearIdentidadFalsa();
  app = crearApp({ opcionesToken: firmante.opcionesToken, identidad: falsa.identidad });
  const sub = randomUUID();
  await crearPersonal(db(), "directora", sub);
  tokenDirectora = await firmante.token(sub, ["directora"]);
});

afterAll(cerrarPool);

const pedir = (metodo: "get" | "post" | "patch", ruta: string, token: string, cuerpo?: object) => {
  const r = request(app)[metodo](ruta).set("Authorization", `Bearer ${token}`);
  return cuerpo ? r.send(cuerpo) : r;
};

// Cuenta creada por la directora en /personal (fila en personal y usuario en el Keycloak simulado).
async function cuentaNueva(rol: string) {
  const correo = `hu0002-c22-${unico()}@ejemplo.test`;
  const res = await pedir("post", "/personal", tokenDirectora, { nombres: "Cuenta", apellidos: "C22", correo, rol });
  expect(res.status).toBe(201);
  const usuario = falsa.porCorreo(correo)[0]!;
  return { id: res.body.id_personal as number, sub: usuario.id };
}

async function denegadosDePersonal(idPersonal: number) {
  const { rows } = await db().query(
    "SELECT detalle FROM registro_auditoria WHERE tipo_evento = 'acceso_denegado' AND id_personal = $1 ORDER BY id_evento",
    [idPersonal],
  );
  return rows.map((r) => r.detalle);
}

describe("C22 fila activa en personal para las rutas del personal", () => {
  it("C22 en /personal, /configuracion, /campana-activa y /prospectos, un token del personal sin fila en personal recibe 403 y queda acceso_denegado", async () => {
    const casos: [string, string][] = [
      ["/personal", "directora"],
      ["/configuracion", "secretaria"],
      ["/campana-activa", "tesoreria"],
      ["/prospectos/contacto-no-entregado", "secretaria"],
    ];
    for (const [ruta, rol] of casos) {
      const sub = randomUUID(); // sin fila en personal
      const res = await pedir("get", ruta, await firmante.token(sub, [rol]));

      expect(res.status, ruta).toBe(403);
      expect(res.body.error.codigo).toBe("ACCESO_DENEGADO");
      const { rows } = await db().query(
        `SELECT id_personal, detalle FROM registro_auditoria
          WHERE tipo_evento = 'acceso_denegado' AND detalle->>'keycloak_user_id' = $1`,
        [sub],
      );
      expect(rows, ruta).toHaveLength(1);
      expect(rows[0].id_personal).toBeNull();
      expect(rows[0].detalle).toMatchObject({ motivo: "sin_fila", metodo: "GET" });
      expect(rows[0].detalle.ruta).toMatch(new RegExp(`^${ruta}/?$`));
    }
  });

  it("C22 una cuenta desactivada recibe 403 con su token todavía vigente y, al reactivarla (HU0021-5.0), el mismo token vuelve a entrar", async () => {
    const cuenta = await cuentaNueva("tesoreria");
    const token = await firmante.token(cuenta.sub, ["tesoreria"]); // emitido antes de desactivar (vence en 5 min)
    expect((await pedir("get", "/campana-activa", token)).status).toBe(200);

    expect((await pedir("post", `/personal/${cuenta.id}/desactivacion`, tokenDirectora)).status).toBe(200);
    const bloqueado = await pedir("get", "/campana-activa", token);
    expect(bloqueado.status).toBe(403);
    expect(bloqueado.body.error.codigo).toBe("ACCESO_DENEGADO");
    expect(await denegadosDePersonal(cuenta.id)).toEqual([expect.objectContaining({ motivo: "personal_inactivo", ruta: "/campana-activa/" })]);

    expect((await pedir("post", `/personal/${cuenta.id}/reactivacion`, tokenDirectora)).status).toBe(200);
    expect((await pedir("get", "/campana-activa", token)).status).toBe(200);
    expect(await denegadosDePersonal(cuenta.id)).toHaveLength(1);
  });

  it("C22 tras el cambio de rol (HU0021-3.0), el token del rol anterior recibe 403 aunque Keycloak todavía no lo haya renovado", async () => {
    const cuenta = await cuentaNueva("secretaria");
    const tokenAnterior = await firmante.token(cuenta.sub, ["secretaria"]);
    expect((await pedir("get", "/configuracion", tokenAnterior)).status).toBe(200);

    const cambio = await pedir("patch", `/personal/${cuenta.id}`, tokenDirectora, { nombres: "Cuenta", apellidos: "C22", rol: "tesoreria" });
    expect(cambio.status).toBe(200);

    const res = await pedir("get", "/configuracion", tokenAnterior);
    expect(res.status).toBe(403);
    expect(await denegadosDePersonal(cuenta.id)).toEqual([expect.objectContaining({ motivo: "rol_distinto", ruta: "/configuracion/" })]);
    // Con el token del rol nuevo entra a lo que ese rol puede ver.
    expect((await pedir("get", "/campana-activa", await firmante.token(cuenta.sub, ["tesoreria"]))).status).toBe(200);
  });
});
