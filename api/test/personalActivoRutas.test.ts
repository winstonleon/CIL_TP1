// C22: todas las rutas del personal exigen, además del rol del token, una fila ACTIVA en personal con ese rol. personalActivo.test.ts prueba
// las cuatro primeras; esta recorre los diez montajes de app.ts, para que un router nuevo del personal no quede abierto con un token vigente.
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Express } from "express";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { crearApp } from "../src/app";
import { cerrarPool, obtenerPool } from "../src/db/pool";
import { crearFirmante, crearPersonal } from "./ayudantes";
import { crearIdentidadFalsa } from "./identidadFalsa";

const db = () => obtenerPool();

// [ruta GET, rol] de cada montaje del personal de app.ts. Si se monta otro router del personal, se agrega aquí.
const MONTAJES: [string, string][] = [
  ["/personal", "directora"],
  ["/campana-activa", "secretaria"],
  ["/configuracion", "secretaria"],
  ["/prospectos/contacto-no-entregado", "secretaria"],
  ["/visitas", "secretaria"],
  ["/bandeja/expedientes", "secretaria"],
  ["/tesoreria/validaciones", "tesoreria"],
  ["/psicologia/agenda", "psicologa"],
  ["/evaluacion-academica/agenda", "evaluador_academico"],
  ["/direccion/adjudicacion", "directora"],
];

let firmante: Awaited<ReturnType<typeof crearFirmante>>;
let app: Express;

beforeAll(async () => {
  firmante = await crearFirmante();
  app = crearApp({ opcionesToken: firmante.opcionesToken, identidad: crearIdentidadFalsa().identidad });
});

afterAll(cerrarPool);

async function denegadoDe(sub: string) {
  const { rows } = await db().query("SELECT detalle FROM registro_auditoria WHERE tipo_evento = 'acceso_denegado' AND detalle->>'keycloak_user_id' = $1", [sub]);
  return rows.map((r) => r.detalle);
}

// Con fila en personal, el evento se liga por id_personal.
async function denegadoDePersonal(idPersonal: number) {
  const { rows } = await db().query("SELECT detalle FROM registro_auditoria WHERE tipo_evento = 'acceso_denegado' AND id_personal = $1", [idPersonal]);
  return rows.map((r) => r.detalle);
}

describe("C22 las diez rutas del personal exigen una fila activa en personal", () => {
  it("C22 con un token vigente sin fila en personal, cada ruta responde 403 ACCESO_DENEGADO y deja acceso_denegado con motivo sin_fila", async () => {
    for (const [ruta, rol] of MONTAJES) {
      const sub = randomUUID();

      const res = await request(app).get(ruta).set("Authorization", `Bearer ${await firmante.token(sub, [rol])}`);

      expect(res.status, ruta).toBe(403);
      expect(res.body.error.codigo, ruta).toBe("ACCESO_DENEGADO");
      const eventos = await denegadoDe(sub);
      expect(eventos, ruta).toHaveLength(1);
      expect(eventos[0], ruta).toMatchObject({ motivo: "sin_fila", metodo: "GET" });
    }
  });

  it("C22 con la cuenta desactivada, cada ruta responde 403 y deja acceso_denegado con motivo personal_inactivo aunque el token siga vigente", async () => {
    for (const [ruta, rol] of MONTAJES) {
      const sub = randomUUID();
      const id = await crearPersonal(db(), rol, sub);
      await db().query("UPDATE personal SET activo = false WHERE id_personal = $1", [id]);

      const res = await request(app).get(ruta).set("Authorization", `Bearer ${await firmante.token(sub, [rol])}`);

      expect(res.status, ruta).toBe(403);
      const eventos = await denegadoDePersonal(id);
      expect(eventos, ruta).toHaveLength(1);
      expect(eventos[0], ruta).toMatchObject({ motivo: "personal_inactivo" });
    }
  });

  it("C22 todo montaje de app.ts con requireRol, salvo el de la familia, lleva requirePersonalActivo, y esta prueba los cubre todos", () => {
    const fuente = readFileSync(resolve(import.meta.dirname, "..", "src", "app.ts"), "utf8");
    const montajes = fuente.split("app.use(").slice(1).filter((m) => m.includes("requireRol("));
    const delPersonal = montajes.filter((m) => !m.includes('requireRol("familia")'));

    expect(delPersonal.length).toBeGreaterThan(0);
    for (const m of delPersonal) expect(m.includes("requirePersonalActivo("), `el montaje «${m.slice(0, 30)}…» no lleva requirePersonalActivo`).toBe(true);
    expect(delPersonal).toHaveLength(MONTAJES.length);
  });
});
