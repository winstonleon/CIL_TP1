// identidad/keycloakAdmin contra un servidor HTTP local que imita la Admin API de Keycloak:
// verifica las peticiones exactas (token, cuerpos, URLs y orden). El Keycloak real se prueba en el E2E.
import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { ErrorApi } from "../src/errores";
import { crearKeycloakAdmin, type IdentidadAdmin } from "../src/identidad/keycloakAdmin";

interface Peticion {
  metodo: string;
  ruta: string;
  consulta: URLSearchParams;
  autorizacion?: string;
  cuerpo: string;
}

const ID = "11111111-2222-3333-4444-555555555555";
const ADMIN = "/admin/realms/cil-admision";
const peticiones: Peticion[] = [];
let fallarCon: number | null = null;
let servidor: Server;
let identidad: IdentidadAdmin;

const representacion = {
  id: ID,
  username: "persona@ejemplo.test",
  email: "persona@ejemplo.test",
  firstName: "Persona",
  lastName: "Ficticia",
  enabled: false,
  attributes: { origen: ["api-personal"] },
};

function leer(req: IncomingMessage): Promise<string> {
  return new Promise((ok) => {
    let datos = "";
    req.on("data", (c) => (datos += c));
    req.on("end", () => ok(datos));
  });
}

beforeAll(async () => {
  servidor = createServer(async (req, res) => {
    const url = new URL(req.url!, "http://local");
    peticiones.push({ metodo: req.method!, ruta: url.pathname, consulta: url.searchParams, autorizacion: req.headers.authorization, cuerpo: await leer(req) });
    const json = (estado: number, cuerpo?: unknown, cabeceras: Record<string, string> = {}) => {
      res.writeHead(estado, { "Content-Type": "application/json", ...cabeceras });
      res.end(cuerpo === undefined ? "" : JSON.stringify(cuerpo));
    };
    if (fallarCon && url.pathname.startsWith(ADMIN)) return json(fallarCon, { error: "falla simulada" });
    const r = `${req.method} ${url.pathname}`;
    if (r === "POST /realms/cil-admision/protocol/openid-connect/token") return json(200, { access_token: "token-sa", expires_in: 300 });
    if (r === `POST ${ADMIN}/users`) {
      const { username } = JSON.parse(peticiones.at(-1)!.cuerpo);
      return username === "existe@ejemplo.test" ? json(409, { errorMessage: "User exists" }) : json(201, undefined, { Location: `http://kc${ADMIN}/users/${ID}` });
    }
    if (r === `GET ${ADMIN}/users`) return json(200, url.searchParams.get("email") === representacion.email ? [representacion] : []);
    if (r === `GET ${ADMIN}/users/${ID}`) return json(200, representacion);
    if (r === `GET ${ADMIN}/users/${ID}/credentials`) return json(200, []);
    if (r === `GET ${ADMIN}/users/${ID}/role-mappings/realm`)
      return json(200, [{ id: "r-def", name: "default-roles-cil-admision" }, { id: "r-sec", name: "secretaria" }]);
    if (r === `GET ${ADMIN}/users/${ID}/role-mappings/realm/available`)
      return json(200, [{ id: "r-psi", name: "psicologa" }, { id: "r-tes", name: "tesoreria" }]);
    return json(204);
  });
  await new Promise<void>((ok) => servidor.listen(0, "127.0.0.1", ok));
  const { port } = servidor.address() as AddressInfo;
  identidad = crearKeycloakAdmin({
    urlInterna: `http://127.0.0.1:${port}`,
    realm: "cil-admision",
    clienteId: "api-admision",
    secreto: "secreto-de-prueba",
    urlFrontend: "http://frontend.prueba/",
  });
});

afterEach(() => {
  peticiones.length = 0;
  fallarCon = null;
  vi.restoreAllMocks();
});

afterAll(() => new Promise<void>((ok) => servidor.close(() => ok())));

const admin = () => peticiones.filter((p) => p.ruta.startsWith(ADMIN));

describe("identidad/keycloakAdmin", () => {
  it("HU0021-1.0 crea el usuario deshabilitado y con origen=api-personal, con un token de client credentials pedido una sola vez", async () => {
    const id = await identidad.crearUsuario({ correo: "nueva@ejemplo.test", nombres: "Nueva", apellidos: "Persona" });
    await identidad.tieneCredenciales(ID);

    expect(id).toBe(ID);
    const tokens = peticiones.filter((p) => p.ruta.endsWith("/openid-connect/token"));
    expect(tokens).toHaveLength(1);
    expect(Object.fromEntries(new URLSearchParams(tokens[0]!.cuerpo))).toEqual({
      grant_type: "client_credentials",
      client_id: "api-admision",
      client_secret: "secreto-de-prueba",
    });
    expect(admin().every((p) => p.autorizacion === "Bearer token-sa")).toBe(true);
    expect(JSON.parse(admin()[0]!.cuerpo)).toEqual({
      username: "nueva@ejemplo.test",
      email: "nueva@ejemplo.test",
      firstName: "Nueva",
      lastName: "Persona",
      enabled: false,
      attributes: { origen: ["api-personal"] },
    });
  });

  it("HU0021-1.0 si Keycloak responde 409 (el usuario ya existe), crearUsuario devuelve null; buscarPorCorreo trae habilitado y origen", async () => {
    expect(await identidad.crearUsuario({ correo: "existe@ejemplo.test", nombres: "Ya", apellidos: "Existe" })).toBeNull();
    expect(await identidad.buscarPorCorreo("persona@ejemplo.test")).toEqual({ id: ID, habilitado: false, origen: "api-personal" });
    expect(await identidad.buscarPorCorreo("nadie@ejemplo.test")).toBeNull();
  });

  it("HU0021-1.0 envía el enlace UPDATE_PASSWORD hacia gestion-interna con vigencia de 72 h", async () => {
    await identidad.enviarEnlaceDefinirContrasena(ID);

    const [p] = admin();
    expect(p).toMatchObject({ metodo: "PUT", ruta: `${ADMIN}/users/${ID}/execute-actions-email` });
    expect(Object.fromEntries(p!.consulta)).toEqual({
      client_id: "gestion-interna",
      redirect_uri: "http://frontend.prueba/gestion",
      lifespan: "259200",
    });
    expect(JSON.parse(p!.cuerpo)).toEqual(["UPDATE_PASSWORD"]);
  });

  it("HU0021-1.0 habilitar y actualizarNombres envían la representación completa (no borran atributos del perfil)", async () => {
    await identidad.habilitar(ID);
    await identidad.actualizarNombres(ID, "Otra", "Persona");

    const puts = admin().filter((p) => p.metodo === "PUT").map((p) => JSON.parse(p.cuerpo));
    expect(puts[0]).toEqual({ ...representacion, enabled: true });
    expect(puts[1]).toEqual({ ...representacion, firstName: "Otra", lastName: "Persona" });
  });

  it("HU0021-3.0 establecerRolUnico quita primero los otros roles de la app y después agrega el nuevo (falla cerrado)", async () => {
    await identidad.establecerRolUnico(ID, "psicologa");

    const pasos = admin().map((p) => `${p.metodo} ${p.ruta.replace(`${ADMIN}/users/${ID}`, "")}`);
    expect(pasos).toEqual([
      "GET /role-mappings/realm",
      "DELETE /role-mappings/realm",
      "GET /role-mappings/realm/available",
      "POST /role-mappings/realm",
    ]);
    const [, quitar, , agregar] = admin();
    // No toca los roles técnicos de Keycloak (default-roles-…).
    expect(JSON.parse(quitar!.cuerpo)).toEqual([{ id: "r-sec", name: "secretaria" }]);
    expect(JSON.parse(agregar!.cuerpo)).toEqual([{ id: "r-psi", name: "psicologa" }]);
  });

  it("HU0021-4.0 deshabilitar hace PUT con enabled false y cerrarSesiones hace POST /logout", async () => {
    await identidad.deshabilitar(ID);
    await identidad.cerrarSesiones(ID);

    const [, put, logout] = admin();
    expect(JSON.parse(put!.cuerpo)).toEqual({ ...representacion, enabled: false });
    expect(logout).toMatchObject({ metodo: "POST", ruta: `${ADMIN}/users/${ID}/logout` });
  });

  it("HU0021-1.0 un error de Keycloak o la falta de respuesta se traducen en 502 IDENTIDAD_NO_DISPONIBLE, sin el correo en el log", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    fallarCon = 500;
    const error = await identidad.buscarPorCorreo("persona@ejemplo.test").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ErrorApi);
    expect(error).toMatchObject({ status: 502, codigo: "IDENTIDAD_NO_DISPONIBLE" });

    const sinServidor = crearKeycloakAdmin({ urlInterna: "http://127.0.0.1:9", realm: "cil-admision", clienteId: "x", secreto: "y", urlFrontend: "http://f" });
    await expect(sinServidor.eliminarUsuario(ID)).rejects.toMatchObject({ status: 502, codigo: "IDENTIDAD_NO_DISPONIBLE" });

    expect(log.mock.calls.map((c) => String(c[0])).join("\n")).not.toContain("persona@ejemplo.test");
  });
});
