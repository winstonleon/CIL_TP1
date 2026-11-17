// C18: cuenta inicial de la Directora en producción (comando `npm run directora:crear`). Reutiliza el alta de G10 (HU0021) con el
// Keycloak simulado: la fila activa en personal, el rol y el enlace para definir la contraseña. Sin una directora que actúe, la
// bitácora deja el origen del comando. Con una directora activa se niega; sin fila en personal no entraría a G10 (C22).
import type { Express } from "express";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { crearApp } from "../src/app";
import { cerrarPool, obtenerPool } from "../src/db/pool";
import { crearDirectoraInicial } from "../src/services/directoraInicial";
import { crearFirmante, crearPersonal, unico } from "./ayudantes";
import { crearIdentidadFalsa } from "./identidadFalsa";

const db = () => obtenerPool();

let firmante: Awaited<ReturnType<typeof crearFirmante>>;
let falsa: ReturnType<typeof crearIdentidadFalsa>;
let directorasDeOtrasPruebas: number[] = [];

beforeAll(async () => {
  firmante = await crearFirmante();
  // La base de pruebas es compartida: se aparta a las directoras activas de otros archivos y se les devuelve al terminar.
  const { rows } = await db().query<{ id_personal: number }>(
    "UPDATE personal SET activo = false WHERE rol = 'directora' AND activo RETURNING id_personal",
  );
  directorasDeOtrasPruebas = rows.map((r) => r.id_personal);
});

beforeEach(async () => {
  falsa = crearIdentidadFalsa();
  await db().query("UPDATE personal SET activo = false WHERE rol = 'directora' AND activo");
});

afterAll(async () => {
  await db().query("UPDATE personal SET activo = false WHERE rol = 'directora' AND activo");
  await db().query("UPDATE personal SET activo = true WHERE id_personal = ANY($1::int[])", [directorasDeOtrasPruebas]);
  await cerrarPool();
});

const datos = () => ({ correo: `c18-${unico()}@ejemplo.test`, nombres: "Dirección", apellidos: "Inicial" });
const filasDe = async (correo: string) => (await db().query("SELECT 1 FROM personal WHERE correo = $1", [correo])).rowCount;

describe("C18 cuenta inicial de la directora", () => {
  it("C18 crea el usuario en Keycloak con el rol directora y el enlace de 72 h, la fila activa en personal y la bitácora sin id_personal con el origen del comando", async () => {
    const d = datos();

    const fila = await crearDirectoraInicial(falsa.identidad, d);

    expect(fila).toMatchObject({ correo: d.correo, nombres: "Dirección", apellidos: "Inicial", rol: "directora", activo: true });
    expect(falsa.porCorreo(d.correo)).toHaveLength(1);
    expect(falsa.porCorreo(d.correo)[0]).toMatchObject({ habilitado: true, roles: ["directora"], enlaces: 1, credenciales: false });
    const { rows } = await db().query(
      "SELECT id_personal, detalle FROM registro_auditoria WHERE tipo_evento = 'gestion_usuario' AND (detalle->>'id_personal_afectado')::int = $1",
      [fila.id_personal],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].id_personal).toBeNull();
    expect(rows[0].detalle).toMatchObject({ accion: "alta", rol: "directora", enlace_contrasena: "enviado", origen: "comando_directora_inicial" });
    expect(JSON.stringify(rows[0].detalle)).not.toContain(d.correo);
  });

  it("C18 la cuenta creada entra a las rutas del personal: con su fila en personal, su token abre G10 (sin ella, 403 por C22)", async () => {
    const d = datos();
    const fila = await crearDirectoraInicial(falsa.identidad, d);
    const app: Express = crearApp({ opcionesToken: firmante.opcionesToken, identidad: falsa.identidad });
    const sub = falsa.porCorreo(d.correo)[0]!.id;

    const res = await request(app).get("/personal").set("Authorization", `Bearer ${await firmante.token(sub, ["directora"])}`);

    expect(res.status).toBe(200);
    expect(res.body.map((p: { id_personal: number }) => p.id_personal)).toContain(fila.id_personal);
  });

  it("C18 con una directora activa se niega con 409 DIRECTORA_YA_EXISTE, sin tocar Keycloak ni la base: las demás cuentas se crean en G10", async () => {
    await crearPersonal(db(), "directora");
    const d = datos();

    await expect(crearDirectoraInicial(falsa.identidad, d)).rejects.toMatchObject({ status: 409, codigo: "DIRECTORA_YA_EXISTE" });

    expect(falsa.llamadas).toEqual([]);
    expect(await filasDe(d.correo)).toBe(0);
  });

  it("C18 con la única directora desactivada permite crear otra (recuperar el acceso)", async () => {
    const idAnterior = await crearPersonal(db(), "directora");
    await db().query("UPDATE personal SET activo = false WHERE id_personal = $1", [idAnterior]);

    const fila = await crearDirectoraInicial(falsa.identidad, datos());

    expect(fila.activo).toBe(true);
    expect(fila.id_personal).not.toBe(idAnterior);
  });

  it("C18 un correo inválido, un nombre vacío o un campo de más responden 400 VALIDACION antes de llamar a Keycloak", async () => {
    const entradas = [
      { ...datos(), correo: "no-es-un-correo" },
      { ...datos(), nombres: "   " },
      { ...datos(), apellidos: "" },
      { ...datos(), rol: "secretaria" },
      { correo: datos().correo },
      null,
    ];
    for (const entrada of entradas) {
      await expect(crearDirectoraInicial(falsa.identidad, entrada)).rejects.toMatchObject({ status: 400, codigo: "VALIDACION" });
    }
    expect(falsa.llamadas).toEqual([]);
  });

  it("C18 si Keycloak no puede enviar el enlace (SMTP sin configurar, C12), no queda usuario ni fila y se puede repetir", async () => {
    const d = datos();
    falsa.fallarEn("enviarEnlaceDefinirContrasena");

    await expect(crearDirectoraInicial(falsa.identidad, d)).rejects.toMatchObject({ status: 502, codigo: "IDENTIDAD_NO_DISPONIBLE" });

    expect(falsa.porCorreo(d.correo)).toHaveLength(0);
    expect(await filasDe(d.correo)).toBe(0);
    falsa.reparar();
    expect((await crearDirectoraInicial(falsa.identidad, d)).activo).toBe(true);
  });
});
