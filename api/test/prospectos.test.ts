// HU0002-2.0: «alerta al personal de admisión» = sección «Prospectos con contacto no entregado» de G04, por HTTP
// (/prospectos, solo Secretaría con fila activa, C22). El archivo usa su propia campaña para no mezclar prospectos.
// Los rebotes se registran por /internal/*, como lo hace el flujo captacion.
import { randomUUID } from "node:crypto";
import type { Express } from "express";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { crearApp } from "../src/app";
import { cerrarPool, obtenerPool } from "../src/db/pool";
import { crearFirmante, crearGrado, crearPersonal, unico } from "./ayudantes";
import { crearIdentidadFalsa } from "./identidadFalsa";

const db = () => obtenerPool();
const CAMPANA = `P${unico()}`; // 9 caracteres: cabe en grado.campana_admision (varchar(10))

let firmante: Awaited<ReturnType<typeof crearFirmante>>;
let app: Express;
let tokenSecretaria: string;

beforeAll(async () => {
  firmante = await crearFirmante();
  app = crearApp({ opcionesToken: firmante.opcionesToken, identidad: crearIdentidadFalsa().identidad, campanaActiva: CAMPANA });
  const sub = randomUUID();
  await crearPersonal(db(), "secretaria", sub);
  tokenSecretaria = await firmante.token(sub, ["secretaria"]);
});

afterAll(cerrarPool);

const interno = (r: request.Test) => r.set("Authorization", `Bearer ${process.env.INTERNAL_API_TOKEN!}`);
const listar = (token = tokenSecretaria) =>
  request(app).get("/prospectos/contacto-no-entregado").set("Authorization", `Bearer ${token}`);

async function prospecto(campana: string, datos: { nombres: string; apellidos: string; telefono: string; correo: string }) {
  const idGrado = await crearGrado(db(), { campana, nombre: `2.° de primaria ${unico()}` });
  const { rows } = await db().query<{ id_apoderado: number }>(
    "INSERT INTO apoderado (nombres, apellidos, telefono, correo) VALUES ($1, $2, $3, $4) RETURNING id_apoderado",
    [datos.nombres, datos.apellidos, datos.telefono, datos.correo],
  );
  const exp = await db().query<{ id_expediente: number }>(
    "INSERT INTO expediente (id_apoderado_titular, id_grado) VALUES ($1, $2) RETURNING id_expediente",
    [rows[0]!.id_apoderado, idGrado],
  );
  return { idExpediente: exp.rows[0]!.id_expediente, idGrado };
}

// Lo que hace captacion ante el 550: reservar, cerrar como fallida y registrar el rebote.
async function rebotar(idExpediente: number) {
  const reserva = await interno(request(app).post(`/internal/expedientes/${idExpediente}/carpeta-informativa`));
  const id = reserva.body.id_notificacion as number;
  await interno(request(app).patch(`/internal/notificaciones/${id}`)).send({ estado_envio: "fallido" });
  const res = await interno(request(app).post(`/internal/notificaciones/${id}/rebote`)).send({ origen: "smtp_rechazo" });
  expect(res.body.transicion).toBe(true);
}

describe("HU0002-2.0 G04: prospectos con contacto no entregado", () => {
  it("HU0002-2.0 [parte: rechazo síncrono] G04: la secretaria recibe los prospectos con contacto no entregado (nombre, grado, correo, teléfono y fecha), sin DNI", async () => {
    const correo = `hu0002-${unico()}@rebota.ejemplo.test`;
    const rebotado = await prospecto(CAMPANA, { nombres: "Jorge", apellidos: "Paredes Linares", telefono: "+51984222731", correo });
    await rebotar(rebotado.idExpediente);
    const sinRebote = await prospecto(CAMPANA, { nombres: "Ana", apellidos: "Sin Rebote", telefono: "+51900000001", correo: `hu0002-${unico()}@ejemplo.test` });
    const otraCampana = await prospecto(`O${unico()}`, { nombres: "Otra", apellidos: "Campaña", telefono: "+51900000002", correo: `hu0002-${unico()}@rebota.ejemplo.test` });
    await rebotar(otraCampana.idExpediente);

    const res = await listar();

    expect(res.status).toBe(200);
    const { rows } = await db().query(
      "SELECT fecha_hora FROM registro_auditoria WHERE id_expediente = $1 AND tipo_evento = 'notificacion_rebotada'",
      [rebotado.idExpediente],
    );
    const { rows: [grado] } = await db().query("SELECT nombre_grado FROM grado WHERE id_grado = $1", [rebotado.idGrado]);
    expect(res.body).toEqual({
      prospectos: [
        {
          id_expediente: rebotado.idExpediente,
          nombres: "Jorge",
          apellidos: "Paredes Linares",
          grado: { nivel: "primaria", nombre_grado: grado.nombre_grado },
          correo,
          telefono: "+51984222731",
          fecha_rebote: (rows[0].fecha_hora as Date).toISOString(),
        },
      ],
    });
    const ids = (res.body.prospectos as { id_expediente: number }[]).map((p) => p.id_expediente);
    expect(ids).not.toContain(sinRebote.idExpediente);
    expect(ids).not.toContain(otraCampana.idExpediente);
    expect(JSON.stringify(res.body)).not.toMatch(/dni/i);
  });

  it("HU0002-2.0 [parte: rechazo síncrono] G04: otro rol recibe 403 y el intento se audita como acceso_denegado", async () => {
    for (const rol of ["tesoreria", "psicologa", "evaluador_academico", "directora"]) {
      const sub = randomUUID();
      const idPersonal = await crearPersonal(db(), rol, sub);
      const res = await listar(await firmante.token(sub, [rol]));

      expect(res.status, rol).toBe(403);
      expect(res.body.error.codigo).toBe("ACCESO_DENEGADO");
      const { rows } = await db().query(
        "SELECT detalle->>'ruta' AS ruta FROM registro_auditoria WHERE tipo_evento = 'acceso_denegado' AND id_personal = $1",
        [idPersonal],
      );
      expect(rows.map((r) => r.ruta)).toEqual(["/prospectos/contacto-no-entregado"]);
    }
    expect((await listar(await firmante.token(randomUUID(), ["familia"]))).status).toBe(403);
    expect((await request(app).get("/prospectos/contacto-no-entregado")).status).toBe(401);
  });
});
