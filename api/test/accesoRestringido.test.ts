// HU0021-2.0: la política de información restringida (R2 y R3) sobre rutas que existen SOLO en esta prueba.
// Las rutas reales de documentación financiera e informe psicológico llegan con HU0008, HU0010, HU0011 y
// HU0025 (compromiso C17). Por eso cada prueba lleva la marca [política, ruta de prueba]: la matriz de
// trazabilidad muestra el escenario como «mecanismo probado; verificación en ruta real pendiente (C17)».
import { randomUUID } from "node:crypto";
import express from "express";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { requireAccesoRestringido, type RecursoRestringido } from "../src/auth/accesoRestringido";
import { crearVerificarToken } from "../src/auth/verificarToken";
import { crearApp } from "../src/app";
import { cerrarPool, obtenerPool } from "../src/db/pool";
import { manejadorErrores } from "../src/errores";
import { crearExpediente, crearFirmante, crearPersonal } from "./ayudantes";
import { crearIdentidadFalsa } from "./identidadFalsa";

const db = () => obtenerPool();

// Contenido que la ruta devolvería si se ejecutara su handler: no debe aparecer en una respuesta bloqueada.
const CANARIO = "CONTENIDO-RESTRINGIDO-CANARIO";
const RUTAS: Record<RecursoRestringido, string> = {
  documentacion_financiera: "documentacion-financiera",
  informe_psicologico: "informe-psicologico",
};

let firmante: Awaited<ReturnType<typeof crearFirmante>>;
let app: express.Express;
let idExpediente: number;

beforeAll(async () => {
  firmante = await crearFirmante();
  const verificarToken = crearVerificarToken(firmante.opcionesToken);
  app = express();
  for (const [recurso, segmento] of Object.entries(RUTAS) as [RecursoRestringido, string][]) {
    app.get(
      `/prueba/expedientes/:id/${segmento}`,
      verificarToken,
      requireAccesoRestringido(recurso, { obtenerIdExpediente: (req) => req.params.id }),
      (_req, res) => {
        res.json({ contenido: CANARIO });
      },
    );
  }
  app.use(manejadorErrores);
  ({ idExpediente } = await crearExpediente(db()));
});

afterAll(cerrarPool);

async function abrir(rol: string, recurso: RecursoRestringido) {
  const sub = randomUUID();
  const idPersonal = await crearPersonal(db(), rol, sub);
  const res = await request(app)
    .get(`/prueba/expedientes/${idExpediente}/${RUTAS[recurso]}`)
    .set("Authorization", `Bearer ${await firmante.token(sub, [rol])}`);
  const { rows } = await db().query(
    "SELECT id_expediente, detalle FROM registro_auditoria WHERE tipo_evento = 'acceso_denegado' AND id_personal = $1",
    [idPersonal],
  );
  return { res, denegados: rows };
}

const bloqueados: Array<[string, RecursoRestringido]> = [
  ["secretaria", "documentacion_financiera"],
  ["secretaria", "informe_psicologico"],
  ["evaluador_academico", "documentacion_financiera"],
  ["evaluador_academico", "informe_psicologico"],
];

describe("HU0021-2.0 acceso denegado a información restringida", () => {
  it.each(bloqueados)(
    "HU0021-2.0 [política, ruta de prueba] %s no abre %s de un expediente: 403, sin contenido y acceso_denegado auditado",
    async (rol, recurso) => {
      const { res, denegados } = await abrir(rol, recurso);

      expect(res.status).toBe(403);
      expect(res.body).toEqual({ error: { codigo: "ACCESO_DENEGADO", mensaje: expect.any(String) } });
      expect(res.text).not.toContain(CANARIO);
      expect(denegados).toHaveLength(1);
      expect(denegados[0].id_expediente).toBe(idExpediente);
      expect(denegados[0].detalle).toMatchObject({
        metodo: "GET",
        recurso,
        roles_requeridos: recurso === "documentacion_financiera" ? ["tesoreria"] : ["psicologa", "directora"],
      });
    },
  );

  const permitidos: Array<[string, RecursoRestringido]> = [
    ["tesoreria", "documentacion_financiera"],
    ["psicologa", "informe_psicologico"],
    ["directora", "informe_psicologico"],
  ];

  it.each(permitidos)("HU0021-2.0 [política, ruta de prueba] control: %s sí abre %s y no se registra acceso_denegado", async (rol, recurso) => {
    const { res, denegados } = await abrir(rol, recurso);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ contenido: CANARIO });
    expect(denegados).toHaveLength(0);
  });

  it("HU0021-2.0 [política, ruta de prueba] un id de expediente inexistente se bloquea igual y se audita sin id_expediente", async () => {
    const sub = randomUUID();
    const idPersonal = await crearPersonal(db(), "secretaria", sub);
    const res = await request(app)
      .get("/prueba/expedientes/999999/documentacion-financiera")
      .set("Authorization", `Bearer ${await firmante.token(sub, ["secretaria"])}`);
    expect(res.status).toBe(403);
    const { rows } = await db().query("SELECT id_expediente FROM registro_auditoria WHERE tipo_evento = 'acceso_denegado' AND id_personal = $1", [idPersonal]);
    expect(rows).toEqual([{ id_expediente: null }]);
  });
});

describe("Soporte de G10: matriz «Permisos por rol»", () => {
  it("G10 GET /personal/permisos devuelve los roles de R2 y R3", async () => {
    const sub = randomUUID();
    await crearPersonal(db(), "directora", sub);
    const appReal = crearApp({ opcionesToken: firmante.opcionesToken, identidad: crearIdentidadFalsa().identidad });
    const res = await request(appReal).get("/personal/permisos").set("Authorization", `Bearer ${await firmante.token(sub, ["directora"])}`);
    expect(res.status).toBe(200);
    // Valores literales del modelo de datos (R2, R3), no la constante importada.
    expect(res.body).toEqual({ documentacion_financiera: ["tesoreria"], informe_psicologico: ["psicologa", "directora"] });
  });
});
