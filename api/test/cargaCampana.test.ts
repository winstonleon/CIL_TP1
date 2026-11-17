// C26 (punto 1): carga de una campaña nueva en producción (`npm run campana:cargar`): los grados y sus requisitos documentales desde un
// archivo, en una sola transacción, solo para campañas sin grados y con los valores que el colegio todavía no entregó rechazados.
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Express } from "express";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { crearApp } from "../src/app";
import { cerrarPool, obtenerPool } from "../src/db/pool";
import { cargarCampana } from "../src/services/cargaCampana";
import { crearFirmante, crearPersonal, unico } from "./ayudantes";
import { crearIdentidadFalsa } from "./identidadFalsa";

const db = () => obtenerPool();
const PLANTILLA = resolve(import.meta.dirname, "..", "..", "db", "campanas", "plantilla-2027.json");

let firmante: Awaited<ReturnType<typeof crearFirmante>>;

beforeAll(async () => {
  firmante = await crearFirmante();
});

afterAll(cerrarPool);

const requisito = (tipo: string, extra: object = {}) => ({
  tipo_documento: tipo,
  categoria: "postulante_y_padres",
  condicion_aplicacion: "todos",
  obligatorio: true,
  por_apoderado: false,
  ...extra,
});

const grado = (nombre: string, extra: object = {}) => ({
  nivel: "primaria",
  nombre_grado: nombre,
  vacantes_autorizadas: 30,
  requiere_jornada_observacion: false,
  requiere_evaluacion_psicologica: true,
  requiere_evaluacion_academica: false,
  monto_cuota_ingreso: 7000,
  max_fracciones: 3,
  requisitos: [],
  ...extra,
});

// Dos grados: el primero solo con los requisitos comunes (2) y el segundo con uno propio más (3). Total: 5.
function campana(codigo: string, extra: object = {}) {
  return {
    campana: codigo,
    requisitos_comunes: [
      requisito("Partida de nacimiento"),
      requisito("Boletas de pago (últimos 3 meses)", { categoria: "financiero", condicion_aplicacion: "si_dependiente", por_apoderado: true }),
    ],
    grados: [
      grado("3 años", { nivel: "inicial", vacantes_autorizadas: 20, requiere_jornada_observacion: true, requiere_evaluacion_psicologica: false, max_fracciones: 1 }),
      grado("1.° de primaria", { requisitos: [requisito("Libreta de notas", { categoria: "colegio_procedencia", condicion_aplicacion: "solo_colegio_peruano" })] }),
    ],
    ...extra,
  };
}

const codigoNuevo = () => `C26-${unico()}`.slice(0, 10);
const contar = async (sql: string, ...params: unknown[]) => (await db().query<{ n: number }>(sql, params)).rows[0]!.n;
const gradosDe = (c: string) => contar("SELECT count(*)::int AS n FROM grado WHERE campana_admision = $1", c);
const requisitosDe = (c: string) =>
  contar("SELECT count(*)::int AS n FROM requisito_documental r JOIN grado g ON g.id_grado = r.id_grado WHERE g.campana_admision = $1", c);
const eventosDe = (c: string) => contar("SELECT count(*)::int AS n FROM registro_auditoria WHERE tipo_evento = 'cambio_configuracion' AND detalle->>'campana' = $1", c);

describe("C26 carga de una campaña nueva", () => {
  it("C26 carga los grados con sus vacantes disponibles y los requisitos (comunes más propios), con un evento de alta por fila sin id_personal", async () => {
    const c = codigoNuevo();

    const r = await cargarCampana(JSON.stringify(campana(c)), { simular: false });

    expect(r).toEqual({ campana: c, grados: 2, requisitos: 5, simulada: false });
    const { rows } = await db().query(
      "SELECT nombre_grado, nivel::text AS nivel, vacantes_autorizadas, vacantes_disponibles, monto_cuota_ingreso::text AS cuota, max_fracciones FROM grado WHERE campana_admision = $1 ORDER BY id_grado",
      [c],
    );
    expect(rows).toEqual([
      { nombre_grado: "3 años", nivel: "inicial", vacantes_autorizadas: 20, vacantes_disponibles: 20, cuota: "7000.00", max_fracciones: 1 },
      { nombre_grado: "1.° de primaria", nivel: "primaria", vacantes_autorizadas: 30, vacantes_disponibles: 30, cuota: "7000.00", max_fracciones: 3 },
    ]);
    expect(await requisitosDe(c)).toBe(5);
    const eventos = await db().query(
      "SELECT id_personal, detalle FROM registro_auditoria WHERE tipo_evento = 'cambio_configuracion' AND detalle->>'campana' = $1",
      [c],
    );
    expect(eventos.rows).toHaveLength(7); // 2 grados + 5 requisitos
    for (const e of eventos.rows) {
      expect(e.id_personal).toBeNull();
      expect(e.detalle).toMatchObject({ accion: "alta", origen: "carga_campana" });
    }
    expect(eventos.rows.filter((e) => e.detalle.entidad === "grado")).toHaveLength(2);
    expect(eventos.rows.filter((e) => e.detalle.entidad === "requisito_documental")).toHaveLength(5);
  });

  it("C26 G09 lee la campaña cargada: sus grados sin vacantes adjudicadas, la cuota con dos decimales y los requisitos de cada grado", async () => {
    const c = codigoNuevo();
    await cargarCampana(JSON.stringify(campana(c)), { simular: false });
    const sub = randomUUID();
    await crearPersonal(db(), "secretaria", sub);
    const app: Express = crearApp({ opcionesToken: firmante.opcionesToken, identidad: crearIdentidadFalsa().identidad, campanaActiva: c });
    const token = await firmante.token(sub, ["secretaria"]);

    const config = await request(app).get("/configuracion").set("Authorization", `Bearer ${token}`);

    expect(config.status).toBe(200);
    expect(config.body.campana).toBe(c);
    expect(config.body.grados).toHaveLength(2);
    expect(config.body.grados[0]).toMatchObject({ nombre_grado: "3 años", vacantes_autorizadas: 20, vacantes_adjudicadas: 0, monto_cuota_ingreso: "7000.00" });
    const requisitos = await request(app).get(`/configuracion/grados/${config.body.grados[1].id_grado}/requisitos`).set("Authorization", `Bearer ${token}`);
    expect(requisitos.body.map((r: { tipo_documento: string }) => r.tipo_documento)).toEqual([
      "Partida de nacimiento",
      "Boletas de pago (últimos 3 meses)",
      "Libreta de notas",
    ]);
  });

  it("C26 con --simular valida todo y lo deshace: informa lo que crearía y no queda ningún grado, requisito ni evento", async () => {
    const c = codigoNuevo();

    const r = await cargarCampana(JSON.stringify(campana(c)), { simular: true });

    expect(r).toEqual({ campana: c, grados: 2, requisitos: 5, simulada: true });
    expect(await gradosDe(c)).toBe(0);
    expect(await requisitosDe(c)).toBe(0);
    expect(await eventosDe(c)).toBe(0);
  });

  it("C26 una campaña que ya tiene grados se rechaza con 409 CAMPANA_YA_CARGADA y no cambia nada: se edita en G09", async () => {
    const c = codigoNuevo();
    await cargarCampana(JSON.stringify(campana(c)), { simular: false });
    const eventos = await eventosDe(c);

    await expect(cargarCampana(JSON.stringify(campana(c, { grados: [grado("2 años")] })), { simular: false })).rejects.toMatchObject({
      status: 409,
      codigo: "CAMPANA_YA_CARGADA",
    });

    expect(await gradosDe(c)).toBe(2);
    expect(await eventosDe(c)).toBe(eventos);
  });

  it("C26 los valores por definir (null), los números inválidos y los grados sin requisitos se rechazan todos juntos con 422 CARGA_INVALIDA y no escriben nada", async () => {
    const c = codigoNuevo();
    const archivo = campana(c, {
      requisitos_comunes: [],
      grados: [
        grado("3 años", { vacantes_autorizadas: null, max_fracciones: null }),
        grado("4 años", { monto_cuota_ingreso: 7000.005, max_fracciones: 0, requisitos: [requisito("Partida de nacimiento")] }),
        grado("5 años"),
      ],
    });

    const error = await cargarCampana(JSON.stringify(archivo), { simular: false }).catch((e) => e);

    expect(error).toMatchObject({ status: 422, codigo: "CARGA_INVALIDA" });
    for (const problema of [
      "grados[0].vacantes_autorizadas: por definir con el colegio",
      "grados[0].max_fracciones: por definir con el colegio",
      "grados[1].monto_cuota_ingreso",
      "grados[1].max_fracciones",
      "grados[2].requisitos: el grado no tiene requisitos",
    ]) {
      expect(error.message, problema).toContain(problema);
    }
    expect(await gradosDe(c)).toBe(0);
    expect(await eventosDe(c)).toBe(0);
  });

  it("C26 rechaza un nombre de grado repetido, un requisito repetido sin distinguir mayúsculas y una condición por apoderado sin por_apoderado", async () => {
    const c = codigoNuevo();
    const archivo = campana(c, {
      requisitos_comunes: [requisito("Partida de nacimiento"), requisito("partida de nacimiento")],
      grados: [
        grado("3 años", { requisitos: [requisito("Boletas", { condicion_aplicacion: "si_independiente", por_apoderado: false })] }),
        grado("3 años"),
      ],
    });

    const error = await cargarCampana(JSON.stringify(archivo), { simular: false }).catch((e) => e);

    expect(error).toMatchObject({ status: 422, codigo: "CARGA_INVALIDA" });
    expect(error.message).toContain("grados[1].nombre_grado: repetido");
    expect(error.message).toContain("grados[0].requisitos[0].por_apoderado");
    expect(error.message).toContain("requisitos_comunes[1].tipo_documento: repetido");
    expect(await gradosDe(c)).toBe(0);
  });

  it("C26 un archivo que no es JSON, con campos de más o sin grados, y la campaña DEMO (C72) se rechazan sin tocar la base", async () => {
    const gradosDemo = await gradosDe("DEMO");

    await expect(cargarCampana("{no es json", { simular: false })).rejects.toMatchObject({ status: 400, codigo: "ARCHIVO_INVALIDO" });
    await expect(cargarCampana(JSON.stringify({ ...campana(codigoNuevo()), extra: 1 }), { simular: false })).rejects.toMatchObject({ codigo: "CARGA_INVALIDA" });
    await expect(cargarCampana(JSON.stringify({ ...campana(codigoNuevo()), grados: [] }), { simular: false })).rejects.toMatchObject({ codigo: "CARGA_INVALIDA" });
    await expect(cargarCampana(JSON.stringify({ ...campana(codigoNuevo()), campana: "2027 ★ larga" }), { simular: false })).rejects.toMatchObject({ codigo: "CARGA_INVALIDA" });
    await expect(cargarCampana(JSON.stringify(campana("DEMO")), { simular: false })).rejects.toMatchObject({ status: 422, codigo: "CAMPANA_RESERVADA" });

    expect(await gradosDe("DEMO")).toBe(gradosDemo);
  });

  it("C26 la plantilla db/campanas/plantilla-2027.json trae los 14 grados de §5 con sus cuotas y se rechaza mientras el colegio no entregue vacantes, fracciones y requisitos", async () => {
    const plantilla = JSON.parse(readFileSync(PLANTILLA, "utf8"));

    const porNivel = (nivel: string) => plantilla.grados.filter((g: { nivel: string }) => g.nivel === nivel);
    expect(plantilla.grados).toHaveLength(14);
    expect([porNivel("inicial").length, porNivel("primaria").length, porNivel("secundaria").length]).toEqual([3, 6, 5]);
    expect(porNivel("secundaria").every((g: { monto_cuota_ingreso: number }) => g.monto_cuota_ingreso === 4000)).toBe(true);
    expect([...porNivel("inicial"), ...porNivel("primaria")].every((g: { monto_cuota_ingreso: number }) => g.monto_cuota_ingreso === 7000)).toBe(true);

    const error = await cargarCampana(readFileSync(PLANTILLA, "utf8"), { simular: true }).catch((e) => e);
    expect(error).toMatchObject({ status: 422, codigo: "CARGA_INVALIDA" });
    expect(error.message).toContain("grados[0].vacantes_autorizadas: por definir con el colegio");
    expect(error.message).toContain("grados[13].max_fracciones: por definir con el colegio");
  });
});
