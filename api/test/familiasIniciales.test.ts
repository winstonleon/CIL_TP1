// Alta manual de familias (comando `npm run familias:crear`) con el Keycloak simulado: expediente en portal_habilitado con su
// bitácora, usuario con rol familia y contraseña temporal que no se guarda en ningún lado, y compensación si algo falla.
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { cerrarPool, obtenerPool } from "../src/db/pool";
import { crearFamiliasIniciales } from "../src/services/familiasIniciales";
import { crearGrado, unico } from "./ayudantes";
import { crearIdentidadFalsa } from "./identidadFalsa";

const db = () => obtenerPool();
const CAMPANA = "T";
const RESPONSABLE = "Brayan Denis (técnico)";

let falsa: ReturnType<typeof crearIdentidadFalsa>;
beforeEach(() => {
  falsa = crearIdentidadFalsa();
});
afterAll(async () => {
  await cerrarPool();
});

const familia = (idGrado: number, extra: Record<string, unknown> = {}) => ({
  correo: `familias-${unico()}@ejemplo.test`,
  nombres: "María",
  apellidos: "Ficticia Prueba",
  telefono: "987654321",
  id_grado: idGrado,
  ...extra,
});
const alta = (entrada: unknown, responsable: string | null = RESPONSABLE, confirmado = true) =>
  crearFamiliasIniciales(falsa.identidad, CAMPANA, entrada, responsable ?? undefined, confirmado);

describe("FAMILIAS alta manual de cuentas de familia", () => {
  it("FAMILIAS crea el expediente en portal_habilitado con su bitácora, el usuario con rol familia habilitado y la contraseña temporal solo en el resultado", async () => {
    const f = familia(await crearGrado(db()));

    const [r] = await alta({ familias: [f] });

    expect(r!.error).toBeUndefined();
    expect(r!.contrasena_temporal).toHaveLength(16);
    const u = falsa.porCorreo(f.correo)[0]!;
    expect(u).toMatchObject({ habilitado: true, roles: ["familia"], origen: "api-familia", cambioPendiente: true, contrasenaTemporal: r!.contrasena_temporal });
    const { rows } = await db().query(
      `SELECT e.estado::text AS estado, a.telefono, c.canal_origen, ca.keycloak_user_id
         FROM expediente e
         JOIN apoderado a ON a.id_apoderado = e.id_apoderado_titular
         JOIN consentimiento c ON c.id_apoderado = a.id_apoderado
         JOIN cuenta_acceso ca ON ca.id_apoderado = a.id_apoderado
        WHERE e.id_expediente = $1`,
      [r!.id_expediente],
    );
    expect(rows).toEqual([{ estado: "portal_habilitado", telefono: "+51987654321", canal_origen: "alta_manual", keycloak_user_id: u.id }]);
    const eventos = await db().query("SELECT id_personal, estado_anterior, estado_nuevo, detalle FROM registro_auditoria WHERE id_expediente = $1", [r!.id_expediente]);
    expect(eventos.rows).toHaveLength(1);
    expect(eventos.rows[0]).toMatchObject({ id_personal: null, estado_anterior: "prospecto", estado_nuevo: "portal_habilitado" });
    expect(eventos.rows[0].detalle).toMatchObject({ origen: "comando_familias_crear", responsable: RESPONSABLE });
    expect(JSON.stringify(eventos.rows[0].detalle)).not.toContain(r!.contrasena_temporal!);
  });

  it("FAMILIAS cada familia recibe una contraseña distinta y una que falla no deshace a las demás", async () => {
    const idGrado = await crearGrado(db());
    const a = familia(idGrado);
    const b = familia(idGrado);
    falsa.sembrar({ correo: b.correo });

    const [ra, rb] = await alta({ familias: [a, b] });

    expect(ra!.contrasena_temporal).toBeDefined();
    expect(rb).toMatchObject({ correo: b.correo, error: expect.stringContaining("CORREO_CON_CUENTA") });
    expect(falsa.porCorreo(a.correo)[0]!.habilitado).toBe(true);
    expect((await db().query("SELECT 1 FROM apoderado WHERE correo = $1", [b.correo])).rowCount).toBe(0);
  });

  it("FAMILIAS un correo que ya es de un apoderado responde CORREO_CON_CUENTA sin crear usuario ni filas", async () => {
    const idGrado = await crearGrado(db());
    const f = familia(idGrado);
    await alta({ familias: [f] });
    const segundo = crearIdentidadFalsa();

    const [r] = await crearFamiliasIniciales(segundo.identidad, CAMPANA, { familias: [f] }, RESPONSABLE, true);

    expect(r!.error).toContain("CORREO_CON_CUENTA");
    expect(segundo.llamadas).toEqual([]);
  });

  it("FAMILIAS si Keycloak falla a mitad, no queda usuario ni filas y se puede repetir", async () => {
    const f = familia(await crearGrado(db()));
    falsa.fallarEn("habilitar");

    const [r] = await alta({ familias: [f] });

    expect(r!.error).toContain("IDENTIDAD_NO_DISPONIBLE");
    expect(falsa.porCorreo(f.correo)).toHaveLength(0);
    expect((await db().query("SELECT 1 FROM apoderado WHERE correo = $1", [f.correo])).rowCount).toBe(0);
    falsa.reparar();
    expect((await alta({ familias: [f] }))[0]!.error).toBeUndefined();
  });

  it("FAMILIAS sin --responsable, sin confirmar el consentimiento o con datos inválidos responde 400 antes de llamar a Keycloak", async () => {
    const idGrado = await crearGrado(db());
    const f = familia(idGrado);
    await expect(alta({ familias: [f] }, null)).rejects.toMatchObject({ status: 400, codigo: "RESPONSABLE_REQUERIDO" });
    await expect(alta({ familias: [f] }, RESPONSABLE, false)).rejects.toMatchObject({ status: 400, codigo: "CONSENTIMIENTO_NO_CONFIRMADO" });
    for (const entrada of [
      { familias: [{ ...f, correo: "no-es-correo" }] },
      { familias: [{ ...f, telefono: "123" }] },
      { familias: [{ ...f, nombres: " " }] },
      { familias: [{ ...f, rol: "directora" }] },
      { familias: [f, { ...f }] },
      { familias: [] },
    ]) {
      await expect(alta(entrada)).rejects.toMatchObject({ status: 400, codigo: "VALIDACION" });
    }
    expect(falsa.llamadas).toEqual([]);
  });

  it("FAMILIAS un grado que no es de la campaña activa deja esa familia con error y sin cuenta", async () => {
    const f = familia(await crearGrado(db(), { campana: "OTRA" }));

    const [r] = await alta({ familias: [f] });

    expect(r!.error).toContain("VALIDACION");
    expect(falsa.llamadas).toEqual([]);
  });
});
