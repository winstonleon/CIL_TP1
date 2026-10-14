// HU0021-1.0, 3.0 y 4.0: cuentas del personal por HTTP (/personal), con un Keycloak simulado en memoria.
// La integración con el Keycloak real se prueba en e2e/personal-api.spec.ts.
import { randomUUID } from "node:crypto";
import type { Express } from "express";
import request from "supertest";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { crearApp } from "../src/app";
import { cerrarPool, obtenerPool } from "../src/db/pool";
import { crearFirmante, crearPersonal, unico } from "./ayudantes";
import { crearIdentidadFalsa } from "./identidadFalsa";

const db = () => obtenerPool();

let firmante: Awaited<ReturnType<typeof crearFirmante>>;
let tokenDirectora: string;
let idDirectora: number;
let falsa: ReturnType<typeof crearIdentidadFalsa>;
let app: Express;

beforeAll(async () => {
  firmante = await crearFirmante();
  const sub = randomUUID();
  idDirectora = await crearPersonal(db(), "directora", sub);
  tokenDirectora = await firmante.token(sub, ["directora"]);
});

beforeEach(() => {
  falsa = crearIdentidadFalsa();
  app = crearApp({ opcionesToken: firmante.opcionesToken, identidad: falsa.identidad });
});

afterEach(() => {
  vi.restoreAllMocks();
});

afterAll(cerrarPool);

const correoNuevo = () => `hu0021-${unico()}@ejemplo.test`;
const conToken = (r: request.Test, token = tokenDirectora) => r.set("Authorization", `Bearer ${token}`);
const alta = (cuerpo: object, token?: string) => conToken(request(app).post("/personal"), token).send(cuerpo);
const modificar = (id: number, cuerpo: object) => conToken(request(app).patch(`/personal/${id}`)).send(cuerpo);
const desactivar = (id: number) => conToken(request(app).post(`/personal/${id}/desactivacion`));

async function filaPersonal(correo: string) {
  const { rows } = await db().query(
    "SELECT id_personal, nombres, apellidos, rol::text AS rol, activo, keycloak_user_id::text AS keycloak_user_id FROM personal WHERE correo = $1",
    [correo],
  );
  return rows[0];
}

async function eventosGestionDe(idPersonalAfectado: number) {
  const { rows } = await db().query(
    `SELECT id_personal, detalle FROM registro_auditoria
      WHERE tipo_evento = 'gestion_usuario' AND (detalle->>'id_personal_afectado')::int = $1
      ORDER BY id_evento`,
    [idPersonalAfectado],
  );
  return rows;
}

async function totalEventosGestion() {
  const { rows } = await db().query<{ n: number }>("SELECT count(*)::int AS n FROM registro_auditoria WHERE tipo_evento = 'gestion_usuario'");
  return rows[0]!.n;
}

async function cuentaCreada(rol = "tesoreria") {
  const correo = correoNuevo();
  const res = await alta({ nombres: "Cuenta", apellidos: "Ficticia", correo, rol });
  expect(res.status).toBe(201);
  return { id: res.body.id_personal as number, correo, usuario: falsa.porCorreo(correo)[0]! };
}

describe("HU0021-1.0 alta de una cuenta del personal", () => {
  it("HU0021-1.0 la directora crea la cuenta: 201, fila activa, usuario de Keycloak con el rol, habilitado al final, enlace enviado y gestion_usuario auditado", async () => {
    const correo = correoNuevo();
    const res = await alta({ nombres: " Ana Lucía ", apellidos: "Pérez Ruiz", correo: `  ${correo.toUpperCase()} `, rol: "secretaria" });

    expect(res.status).toBe(201);
    expect(res.body).toEqual({
      id_personal: expect.any(Number),
      nombres: "Ana Lucía",
      apellidos: "Pérez Ruiz",
      correo,
      rol: "secretaria",
      activo: true,
    });

    // Keycloak: un solo usuario, marcado como creado por la API, con el rol, habilitado y con el enlace enviado.
    const usuarios = falsa.porCorreo(correo);
    expect(usuarios).toHaveLength(1);
    expect(usuarios[0]).toMatchObject({ origen: "api-personal", roles: ["secretaria"], habilitado: true, enlaces: 1 });
    const orden = falsa.llamadas.map((l) => l.split(":")[0]);
    expect(orden).toEqual(["crearUsuario", "establecerRolUnico", "habilitar", "enviarEnlaceDefinirContrasena"]);

    // BD: la fila guarda el id de Keycloak; la lista de G10 la muestra.
    expect(await filaPersonal(correo)).toMatchObject({ activo: true, rol: "secretaria", keycloak_user_id: usuarios[0]!.id });
    const lista = await conToken(request(app).get("/personal"));
    expect(lista.status).toBe(200);
    expect(lista.body).toContainEqual(res.body);
    expect(lista.body[0]).not.toHaveProperty("keycloak_user_id");

    // Auditoría: la directora como actora y sin datos personales en el detalle.
    const eventos = await eventosGestionDe(res.body.id_personal);
    expect(eventos).toHaveLength(1);
    expect(eventos[0].id_personal).toBe(idDirectora);
    expect(eventos[0].detalle).toEqual({ accion: "alta", id_personal_afectado: res.body.id_personal, rol: "secretaria", enlace_contrasena: "enviado" });
    expect(JSON.stringify(eventos[0].detalle)).not.toContain(correo);
  });

  it("HU0021-1.0 un correo que ya tiene cuenta, activa o desactivada, responde 409 CORREO_DUPLICADO sin llamar a Keycloak", async () => {
    for (const activo of [true, false]) {
      const correo = correoNuevo();
      await db().query(
        `INSERT INTO personal (nombres, apellidos, rol, correo, keycloak_user_id, activo)
         VALUES ('Previa', 'Ficticia', 'secretaria', $1, $2::uuid, $3)`,
        [correo, randomUUID(), activo],
      );
      const res = await alta({ nombres: "Otra", apellidos: "Persona", correo: correo.toUpperCase(), rol: "tesoreria" });
      expect(res.status).toBe(409);
      expect(res.body).toEqual({ error: { codigo: "CORREO_DUPLICADO", mensaje: expect.any(String) } });
    }
    expect(falsa.llamadas).toEqual([]);
  });

  it("HU0021-1.0 si falla el envío del enlace no queda fila en personal, ni usuario en Keycloak, ni evento", async () => {
    const antes = await totalEventosGestion();
    falsa.fallarEn("enviarEnlaceDefinirContrasena");
    const correo = correoNuevo();

    const res = await alta({ nombres: "Sin", apellidos: "Enlace", correo, rol: "psicologa" });

    expect(res.status).toBe(502);
    expect(res.body.error.codigo).toBe("IDENTIDAD_NO_DISPONIBLE");
    expect(await filaPersonal(correo)).toBeUndefined();
    expect(falsa.porCorreo(correo)).toEqual([]);
    expect(falsa.llamadas.at(-1)).toMatch(/^eliminarUsuario:/);
    expect(await totalEventosGestion()).toBe(antes);
  });

  it("HU0021-1.0 si también falla el borrado, el huérfano queda deshabilitado y solo en el log (con su id), y el reintento con el mismo correo lo adopta", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const antes = await totalEventosGestion();
    falsa.fallarEn("enviarEnlaceDefinirContrasena", "eliminarUsuario");
    const correo = correoNuevo();

    const fallida = await alta({ nombres: "Huérfana", apellidos: "Ficticia", correo, rol: "evaluador_academico" });

    expect(fallida.status).toBe(502);
    const [huerfano] = falsa.porCorreo(correo);
    expect(huerfano).toMatchObject({ habilitado: false, origen: "api-personal", credenciales: false });
    expect(await filaPersonal(correo)).toBeUndefined();
    // Se registra solo en el log de la API, con el id de Keycloak y sin el correo (plan HU0021, Q4).
    const lineas = log.mock.calls.map((c) => String(c[0]));
    expect(lineas.some((l) => l.includes(huerfano!.id) && /huérfano/.test(l))).toBe(true);
    expect(lineas.join("\n")).not.toContain(correo);
    expect(await totalEventosGestion()).toBe(antes);

    falsa.reparar();
    const reintento = await alta({ nombres: "Huérfana", apellidos: "Adoptada", correo, rol: "evaluador_academico" });

    expect(reintento.status).toBe(201);
    expect(falsa.porCorreo(correo)).toHaveLength(1);
    expect(falsa.porCorreo(correo)[0]).toMatchObject({ id: huerfano!.id, habilitado: true, apellidos: "Adoptada", roles: ["evaluador_academico"], enlaces: 1 });
    expect(await filaPersonal(correo)).toMatchObject({ keycloak_user_id: huerfano!.id, activo: true });
    const eventos = await eventosGestionDe(reintento.body.id_personal);
    expect(eventos[0].detalle).toMatchObject({ accion: "alta", adoptado: true });
  });

  const noAdoptables: Array<[string, (correo: string) => Promise<unknown> | unknown]> = [
    ["sin el atributo origen=api-personal (p. ej. la cuenta de una familia)", (correo) => falsa.sembrar({ correo, origen: null })],
    ["habilitado", (correo) => falsa.sembrar({ correo, habilitado: true })],
    ["con credenciales", (correo) => falsa.sembrar({ correo, credenciales: true })],
    [
      "ya vinculado a una fila de personal",
      async (correo) => {
        const u = falsa.sembrar({ correo });
        await db().query(
          `INSERT INTO personal (nombres, apellidos, rol, correo, keycloak_user_id) VALUES ('Vinculada', 'Ficticia', 'secretaria', $1, $2::uuid)`,
          [`otro-${unico()}@ejemplo.test`, u.id],
        );
      },
    ],
  ];

  it.each(noAdoptables)("HU0021-1.0 no adopta un usuario de Keycloak %s: responde 409 y no lo toca", async (_caso, preparar) => {
    const correo = correoNuevo();
    await preparar(correo);
    const previo = structuredClone(falsa.porCorreo(correo)[0]);

    const res = await alta({ nombres: "Intento", apellidos: "Ficticio", correo, rol: "secretaria" });

    expect(res.status).toBe(409);
    expect(res.body.error.codigo).toBe("CORREO_DUPLICADO");
    expect(falsa.porCorreo(correo)).toEqual([previo]);
    expect(falsa.llamadas.some((l) => /^(eliminarUsuario|establecerRolUnico|habilitar|actualizarNombres)/.test(l))).toBe(false);
    expect(await filaPersonal(correo)).toBeUndefined();
  });

  it("HU0021-1.0 datos inválidos responden 400 VALIDACION y no llaman a Keycloak", async () => {
    const valido = { nombres: "Ana", apellidos: "Pérez", correo: correoNuevo(), rol: "secretaria" };
    for (const cuerpo of [
      { ...valido, nombres: "  " },
      { ...valido, correo: "no-es-correo" },
      { ...valido, rol: "familia" },
      { ...valido, apellidos: undefined },
      { ...valido, extra: true },
    ]) {
      const res = await alta(cuerpo);
      expect(res.status).toBe(400);
      expect(res.body.error.codigo).toBe("VALIDACION");
    }
    expect(falsa.llamadas).toEqual([]);
  });

  it("HU0021-1.0 un rol distinto de directora recibe 403 y queda acceso_denegado", async () => {
    const sub = randomUUID();
    const idSecretaria = await crearPersonal(db(), "secretaria", sub);
    const res = await alta({ nombres: "Ana", apellidos: "Pérez", correo: correoNuevo(), rol: "secretaria" }, await firmante.token(sub, ["secretaria"]));

    expect(res.status).toBe(403);
    expect(res.body.error.codigo).toBe("ACCESO_DENEGADO");
    expect(falsa.llamadas).toEqual([]);
    const { rows } = await db().query("SELECT detalle FROM registro_auditoria WHERE tipo_evento = 'acceso_denegado' AND id_personal = $1", [idSecretaria]);
    expect(rows).toHaveLength(1);
    expect(rows[0].detalle).toMatchObject({ metodo: "POST", ruta: expect.stringMatching(/^\/personal\/?$/), roles_requeridos: ["directora"] });
  });
});

describe("HU0021-3.0 modificación de una cuenta del personal", () => {
  it("HU0021-3.0 cambia nombres, apellidos y rol: personal y Keycloak actualizados y gestion_usuario sin los valores de los nombres", async () => {
    const { id, correo, usuario } = await cuentaCreada("tesoreria");
    falsa.llamadas.length = 0;

    const res = await modificar(id, { nombres: "Nueva", apellidos: "Persona", rol: "psicologa" });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ id_personal: id, nombres: "Nueva", apellidos: "Persona", correo, rol: "psicologa", activo: true });
    expect(await filaPersonal(correo)).toMatchObject({ nombres: "Nueva", apellidos: "Persona", rol: "psicologa" });
    expect(falsa.usuarios.get(usuario.id)).toMatchObject({ nombres: "Nueva", apellidos: "Persona", roles: ["psicologa"] });
    expect(falsa.llamadas).toEqual([`actualizarNombres:${usuario.id}`, `establecerRolUnico:${usuario.id}`]);

    const eventos = await eventosGestionDe(id);
    expect(eventos).toHaveLength(2);
    expect(eventos[1].id_personal).toBe(idDirectora);
    expect(eventos[1].detalle).toEqual({
      accion: "modificacion",
      id_personal_afectado: id,
      campos: ["nombres", "apellidos", "rol"],
      rol_anterior: "tesoreria",
      rol_nuevo: "psicologa",
    });
    expect(JSON.stringify(eventos[1].detalle)).not.toMatch(/Nueva|Persona/);
  });

  it("HU0021-3.0 solo el rol: Keycloak no toca los nombres y el evento lista solo el rol", async () => {
    const { id, usuario } = await cuentaCreada("secretaria");
    falsa.llamadas.length = 0;

    const res = await modificar(id, { rol: "directora" });

    expect(res.status).toBe(200);
    expect(falsa.llamadas).toEqual([`establecerRolUnico:${usuario.id}`]);
    expect((await eventosGestionDe(id))[1].detalle).toMatchObject({ campos: ["rol"], rol_anterior: "secretaria", rol_nuevo: "directora" });
  });

  it("HU0021-3.0 el correo no se modifica y un cuerpo vacío o inválido responde 400", async () => {
    const { id } = await cuentaCreada();
    for (const cuerpo of [{ correo: "otro@ejemplo.test" }, {}, { rol: "familia" }, { nombres: "" }]) {
      const res = await modificar(id, cuerpo);
      expect(res.status).toBe(400);
      expect(res.body.error.codigo).toBe("VALIDACION");
    }
  });

  it("HU0021-3.0 una cuenta inexistente responde 404 y una desactivada 409 CUENTA_INACTIVA", async () => {
    expect((await modificar(999999, { rol: "secretaria" })).status).toBe(404);
    const { id } = await cuentaCreada();
    expect((await desactivar(id)).status).toBe(200);
    const res = await modificar(id, { rol: "secretaria" });
    expect(res.status).toBe(409);
    expect(res.body.error.codigo).toBe("CUENTA_INACTIVA");
  });

  it("HU0021-3.0 si Keycloak falla al cambiar el rol, personal queda igual, no hay evento y se restauran los nombres y el rol anteriores", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const { id, correo, usuario } = await cuentaCreada("tesoreria");
    falsa.fallarUnaVez("establecerRolUnico");

    const res = await modificar(id, { nombres: "Otra", rol: "psicologa" });

    expect(res.status).toBe(502);
    expect(await filaPersonal(correo)).toMatchObject({ nombres: "Cuenta", rol: "tesoreria" });
    expect(falsa.usuarios.get(usuario.id)).toMatchObject({ nombres: "Cuenta", roles: ["tesoreria"] });
    expect(await eventosGestionDe(id)).toHaveLength(1);
    expect(log).not.toHaveBeenCalled();
  });
});

describe("HU0021-4.0 desactivación de una cuenta del personal", () => {
  it("HU0021-4.0 desactiva la cuenta: Keycloak deshabilitado y sin sesiones, activo = false, gestion_usuario y el historial anterior intacto", async () => {
    const { id, correo, usuario } = await cuentaCreada("secretaria");
    falsa.usuarios.get(usuario.id)!.sesiones = 2;
    falsa.llamadas.length = 0;

    const res = await desactivar(id);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id_personal: id, correo, activo: false });
    expect(falsa.usuarios.get(usuario.id)).toMatchObject({ habilitado: false, sesiones: 0 });
    expect(falsa.llamadas).toEqual([`deshabilitar:${usuario.id}`, `cerrarSesiones:${usuario.id}`]);
    // La fila se conserva (no se elimina) y la lista de G10 la muestra inactiva.
    expect(await filaPersonal(correo)).toMatchObject({ activo: false, keycloak_user_id: usuario.id });
    const lista = await conToken(request(app).get("/personal"));
    expect(lista.body).toContainEqual(expect.objectContaining({ id_personal: id, activo: false }));
    // El historial se conserva: el alta sigue y se agrega la desactivación.
    const eventos = await eventosGestionDe(id);
    expect(eventos.map((e) => e.detalle.accion)).toEqual(["alta", "desactivacion"]);
    expect(eventos[1].id_personal).toBe(idDirectora);
  });

  it("HU0021-4.0 una cuenta ya desactivada responde 409 CUENTA_INACTIVA y una inexistente 404", async () => {
    const { id } = await cuentaCreada();
    expect((await desactivar(id)).status).toBe(200);
    const otra = await desactivar(id);
    expect(otra.status).toBe(409);
    expect(otra.body.error.codigo).toBe("CUENTA_INACTIVA");
    expect((await desactivar(999999)).status).toBe(404);
  });

  it("HU0021-4.0 si falla el cierre de sesiones, la cuenta no se vuelve a habilitar y personal queda sin cambios", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const { id, correo, usuario } = await cuentaCreada();
    falsa.fallarEn("cerrarSesiones");

    const res = await desactivar(id);

    expect(res.status).toBe(502);
    expect(falsa.usuarios.get(usuario.id)!.habilitado).toBe(false);
    expect(await filaPersonal(correo)).toMatchObject({ activo: true });
    expect(await eventosGestionDe(id)).toHaveLength(1);
    expect(log.mock.calls.map((c) => String(c[0])).some((l) => l.includes(usuario.id))).toBe(true);
  });
});
