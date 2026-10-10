// Middleware de token y de rol, probados por HTTP con una app mínima de prueba.
// El JWKS es local (par de claves generado en la prueba): no depende de Keycloak.
import { randomUUID } from "node:crypto";
import express from "express";
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT, type CryptoKey, type JWK } from "jose";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { requireRol } from "../src/auth/requireRol";
import { crearVerificarToken } from "../src/auth/verificarToken";
import { cerrarPool, obtenerPool } from "../src/db/pool";
import { manejadorErrores } from "../src/errores";
import { crearPersonal } from "./ayudantes";

const EMISOR = "http://keycloak.prueba/realms/cil-admision";
const AUDIENCIA = "api-admision";

let clavePrivada: CryptoKey;
let claveAjena: CryptoKey;
let app: express.Express;

beforeAll(async () => {
  const par = await generateKeyPair("RS256");
  clavePrivada = par.privateKey;
  claveAjena = (await generateKeyPair("RS256")).privateKey;
  const jwk: JWK = { ...(await exportJWK(par.publicKey)), kid: "prueba", alg: "RS256" };
  const verificarToken = crearVerificarToken({ jwks: createLocalJWKSet({ keys: [jwk] }), emisor: EMISOR, audiencia: AUDIENCIA });

  app = express();
  app.get("/solo-tesoreria", verificarToken, requireRol("tesoreria"), (req, res) => {
    res.json({ sub: req.usuario!.sub, roles: req.usuario!.roles });
  });
  app.use(manejadorErrores);
});

afterAll(cerrarPool);

interface Reclamos {
  sub?: string;
  roles?: string[];
  emisor?: string;
  audiencia?: string | string[];
  expira?: string | number;
  clave?: CryptoKey;
}

function token(r: Reclamos = {}) {
  return new SignJWT({ realm_access: { roles: r.roles ?? ["tesoreria"] } })
    .setProtectedHeader({ alg: "RS256", kid: "prueba" })
    .setSubject(r.sub ?? randomUUID())
    .setIssuer(r.emisor ?? EMISOR)
    .setAudience(r.audiencia ?? [AUDIENCIA, "account"])
    .setIssuedAt()
    .setExpirationTime(r.expira ?? "5m")
    .sign(r.clave ?? clavePrivada);
}

const pedir = async (t?: string) => {
  const req = request(app).get("/solo-tesoreria");
  return t ? req.set("Authorization", `Bearer ${t}`) : req;
};

describe("S0-B3 validación del token de Keycloak", () => {
  it("S0-B3 acepta un token válido y expone sub y roles de realm_access.roles", async () => {
    const sub = randomUUID();
    const res = await pedir(await token({ sub, roles: ["tesoreria", "default-roles-cil-admision"] }));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ sub, roles: ["tesoreria", "default-roles-cil-admision"] });
  });

  it("S0-B3 sin token responde 401 NO_AUTENTICADO", async () => {
    const res = await pedir();
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: { codigo: "NO_AUTENTICADO", mensaje: expect.any(String) } });
  });

  it("S0-B3 firma de otra clave responde 401 TOKEN_INVALIDO", async () => {
    const res = await pedir(await token({ clave: claveAjena }));
    expect(res.status).toBe(401);
    expect(res.body.error.codigo).toBe("TOKEN_INVALIDO");
  });

  it("S0-B3 emisor distinto responde 401", async () => {
    const res = await pedir(await token({ emisor: "http://otro.prueba/realms/cil-admision" }));
    expect(res.status).toBe(401);
    expect(res.body.error.codigo).toBe("TOKEN_INVALIDO");
  });

  it("S0-B3 audiencia sin api-admision responde 401", async () => {
    const res = await pedir(await token({ audiencia: "account" }));
    expect(res.status).toBe(401);
    expect(res.body.error.codigo).toBe("TOKEN_INVALIDO");
  });

  it("S0-B3 token expirado responde 401", async () => {
    const res = await pedir(await token({ expira: Math.floor(Date.now() / 1000) - 60 }));
    expect(res.status).toBe(401);
    expect(res.body.error.codigo).toBe("TOKEN_INVALIDO");
  });

  it("S0-B3 una cabecera Authorization que no es Bearer responde 401", async () => {
    const res = await request(app).get("/solo-tesoreria").set("Authorization", "Basic abc");
    expect(res.status).toBe(401);
  });
});

describe("S0-B4 autorización por rol y auditoría del acceso denegado", () => {
  const denegadosDe = async (campo: string, valor: string | number) => {
    const { rows } = await obtenerPool().query(
      `SELECT * FROM registro_auditoria WHERE tipo_evento = 'acceso_denegado' AND ${campo} = $1`,
      [valor],
    );
    return rows;
  };

  it("S0-B4 personal sin el rol requerido recibe 403 y queda un acceso_denegado con su id_personal", async () => {
    const sub = randomUUID();
    const idPersonal = await crearPersonal(obtenerPool(), "secretaria", sub);
    const res = await pedir(await token({ sub, roles: ["secretaria"] }));
    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: { codigo: "ACCESO_DENEGADO", mensaje: expect.any(String) } });

    const eventos = await denegadosDe("id_personal", idPersonal);
    expect(eventos).toHaveLength(1);
    expect(eventos[0].detalle).toMatchObject({ metodo: "GET", ruta: "/solo-tesoreria", roles_requeridos: ["tesoreria"] });
    expect(eventos[0].detalle).not.toHaveProperty("keycloak_user_id");
  });

  it("S0-B4 una familia sin el rol recibe 403 y el acceso_denegado guarda su keycloak_user_id", async () => {
    const sub = randomUUID();
    const res = await pedir(await token({ sub, roles: ["familia"] }));
    expect(res.status).toBe(403);

    const { rows } = await obtenerPool().query(
      "SELECT * FROM registro_auditoria WHERE tipo_evento = 'acceso_denegado' AND detalle->>'keycloak_user_id' = $1",
      [sub],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].id_personal).toBeNull();
  });

  it("S0-B4 con el rol requerido no registra acceso_denegado", async () => {
    const sub = randomUUID();
    const idPersonal = await crearPersonal(obtenerPool(), "tesoreria", sub);
    const res = await pedir(await token({ sub, roles: ["tesoreria"] }));
    expect(res.status).toBe(200);
    expect(await denegadosDe("id_personal", idPersonal)).toHaveLength(0);
  });
});
