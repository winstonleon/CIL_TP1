// Reporte ejecutivo del tablero (HU0019-2.0): se descarga por la ruta real y se lee celda por celda. Sus cifras son las de
// G08, respeta los filtros y no expone datos personales. Datos ficticios @ejemplo.test.
import { randomUUID } from "node:crypto";
import ExcelJS from "exceljs";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { cerrarPool, obtenerPool } from "../src/db/pool";
import { TIPO_FALTANTES } from "../src/repositories/completitud";
import {
  TIPO_CONFIRMACION_EVALUACIONES,
  TIPO_CUOTA_POR_CONCILIAR,
  TIPO_DICTAMEN_NO_APTO,
  TIPO_DICTAMEN_OBSERVACION,
  TIPO_HABILITACION,
  TIPO_INASISTENCIA,
  TIPO_LIBERACION_RESPONSABLE,
  TIPO_LISTA_ESPERA,
  TIPO_REPROGRAMACION_FAMILIA,
  TIPO_REPROGRAMACION_RESPONSABLE,
  TIPO_VACANTE_ASIGNADA,
} from "../src/repositories/evaluaciones";
import { TIPO_OBSERVACION } from "../src/repositories/validacion";
import { TIPO_CONFIRMACION, TIPO_CREDENCIALES, TIPO_REPROGRAMACION } from "../src/services/agendamiento";
import { TIPO_EVENTO_CARPETA } from "../src/services/captacion";
import type { LineaBase } from "../src/services/lineaBase";
import { TIPO_RECORDATORIO } from "../src/services/recordatorios";
import { ETIQUETA_AVISO } from "../src/services/reporteIndicadores";
import { crearFirmante, crearPersonal } from "./ayudantes";
import { entornoIndicadores, RUTA_INDICADORES } from "./ayudantesIndicadores";

const db = () => obtenerPool();
const RUTA = `${RUTA_INDICADORES}/exportacion`;
let firmante: Awaited<ReturnType<typeof crearFirmante>>;

beforeAll(async () => {
  firmante = await crearFirmante();
});
afterAll(cerrarPool);

const CAMINO = [
  ["portal_habilitado", "2026-09-03T10:00:00"],
  ["en_validacion", "2026-09-08T10:00:00"],
  ["en_evaluacion", "2026-09-11T10:00:00"],
  ["apto", "2026-09-17T10:00:00"],
  ["vacante_asignada", "2026-09-18T10:00:00"],
  ["carta_emitida", "2026-09-21T10:00:00"],
] as const;

type Entorno = Awaited<ReturnType<typeof entornoIndicadores>>;

const descargar = (e: Entorno, query: Record<string, string | number> = {}, token = e.tokenDirectora) =>
  request(e.app)
    .get(RUTA)
    .query({ campana: e.campana, formato: "xlsx", ...query })
    .set("Authorization", `Bearer ${token}`)
    .responseType("blob");

async function leerLibro(contenido: Buffer) {
  const libro = new ExcelJS.Workbook();
  await libro.xlsx.load(contenido as unknown as ArrayBuffer);
  return libro;
}

const filas = (libro: ExcelJS.Workbook, hoja: string) => {
  const salida: (string | number)[][] = [];
  libro.getWorksheet(hoja)!.eachRow((fila) => salida.push((fila.values as (string | number)[]).slice(1)));
  return salida;
};
const valorDe = (libro: ExcelJS.Workbook, hoja: string, titulo: string) => filas(libro, hoja).find((f) => f[0] === titulo)?.[1];
const todasLasCeldas = (libro: ExcelJS.Workbook) => libro.worksheets.flatMap((h) => filas(libro, h.name)).flat().join(" | ");

describe("HU0019-2.0 reporte ejecutivo", () => {
  it("HU0019-2.0 la directora descarga un Excel con las mismas cifras del tablero", async () => {
    const e = await entornoIndicadores(db(), firmante);
    const g = await e.grado({ autorizadas: 10, disponibles: 9, nombre: `Grado reporte ${e.campana}` });
    const a = await e.trayecto(g, "2026-09-01T10:00:00", CAMINO);
    await e.trayecto(g, "2026-09-01T10:00:00", CAMINO.slice(0, 2));
    await e.atencion(a, { tipo: "validacion_documental", id: a }, "2026-09-09T09:00:00", "2026-09-09T10:30:00");
    await e.notificacion(a, "carpeta_enviada", "enviado");

    const res = await descargar(e);
    const pantalla = (await e.consultar()).body;

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("spreadsheetml.sheet");
    expect(res.headers["content-disposition"]).toMatch(new RegExp(`^attachment; filename="indicadores-${e.campana}-\\d{4}-\\d{2}-\\d{2}\\.xlsx"$`));
    expect(res.headers["cache-control"]).toBe("no-store");

    const libro = await leerLibro(res.body);
    expect(libro.worksheets.map((h) => h.name)).toEqual(["Resumen", "Embudo", "Tiempos por etapa", "Vacantes", "Avisos", "Expedientes"]);
    expect(valorDe(libro, "Resumen", "Lead time promedio (días)")).toBe(20);
    expect(valorDe(libro, "Resumen", "Vacantes ocupadas (%)")).toBe(pantalla.tarjetas.ocupacion_pct);
    expect(todasLasCeldas(libro)).toContain("No incluye datos personales de los postulantes.");
    expect(filas(libro, "Embudo").slice(1).map((f) => f[1])).toEqual(pantalla.embudo.map((x: { total: number }) => x.total));
    expect(filas(libro, "Tiempos por etapa")[3]).toEqual(["Verificación y pagos", 3, 1, 1.5, 1]);
    expect(filas(libro, "Tiempos por etapa")[1]?.[3]).toBe("No se mide");
    expect(filas(libro, "Vacantes")[1]).toEqual(["primaria", `Grado reporte ${e.campana}`, 10, 1, 9, 0, 10]);
    expect(filas(libro, "Avisos")[1]).toEqual(["Carpeta informativa", 1, 0]);
    expect(filas(libro, "Expedientes").slice(1).map((f) => [f[0], f[3], f[4]])).toEqual(
      pantalla.expedientes.map((x: { codigo: string; dias: number; final: boolean }) => [x.codigo, x.dias, x.final ? "Completo" : "Parcial, hasta su etapa"]),
    );
  });

  it("HU0019-2.0 cada tipo de aviso de la API tiene su etiqueta en el reporte, y uno desconocido se muestra tal cual", async () => {
    const tipos = [
      TIPO_EVENTO_CARPETA, TIPO_CONFIRMACION, TIPO_REPROGRAMACION, TIPO_CREDENCIALES, TIPO_RECORDATORIO, TIPO_FALTANTES, TIPO_OBSERVACION,
      TIPO_HABILITACION, TIPO_CONFIRMACION_EVALUACIONES, TIPO_REPROGRAMACION_FAMILIA, TIPO_REPROGRAMACION_RESPONSABLE, TIPO_LIBERACION_RESPONSABLE,
      TIPO_INASISTENCIA, TIPO_DICTAMEN_OBSERVACION, TIPO_DICTAMEN_NO_APTO, TIPO_VACANTE_ASIGNADA, TIPO_LISTA_ESPERA, TIPO_CUOTA_POR_CONCILIAR,
    ];
    expect(tipos.filter((t) => !ETIQUETA_AVISO[t])).toEqual([]);
    expect(Object.keys(ETIQUETA_AVISO)).toHaveLength(tipos.length);

    const e = await entornoIndicadores(db(), firmante);
    const a = await e.trayecto(await e.grado(), "2026-09-01T10:00:00");
    await e.notificacion(a, "tipo_futuro", "enviado");
    expect(filas(await leerLibro((await descargar(e)).body), "Avisos")[1]).toEqual(["tipo_futuro", 1, 0]);
  });

  it("HU0019-2.0 aplica el rango de fechas y lo declara", async () => {
    const e = await entornoIndicadores(db(), firmante);
    const g = await e.grado();
    await e.trayecto(g, "2026-08-15T10:00:00");
    await e.trayecto(g, "2026-09-15T10:00:00");

    const res = await descargar(e, { desde: "2026-09-01", hasta: "2026-09-30" });

    const libro = await leerLibro(res.body);
    expect(valorDe(libro, "Resumen", "Periodo de registro")).toBe("2026-09-01 a 2026-09-30");
    expect(filas(libro, "Expedientes")).toHaveLength(2); // encabezado y un expediente
    expect(valorDe(libro, "Embudo", "Prospectos registrados")).toBe(1);
  });

  it("HU0019-2.0 no expone datos personales de los postulantes", async () => {
    const e = await entornoIndicadores(db(), firmante);
    const g = await e.grado({ nombre: "Grado neutro" });
    const id = await e.trayecto(g, "2026-09-01T10:00:00", CAMINO);
    const correo = `sensible-${e.campana}@ejemplo.test`;
    await db().query("UPDATE apoderado SET nombres = 'NombreSensible', apellidos = 'ApellidoSensible', telefono = '+51911222333', correo = $2 WHERE id_apoderado = (SELECT id_apoderado_titular FROM expediente WHERE id_expediente = $1)", [id, correo]);
    const { rows } = await db().query<{ id_postulante: number }>(
      `INSERT INTO postulante (nombres, apellido_paterno, apellido_materno) VALUES ('PostulanteSensible', 'PaternoSensible', 'MaternoSensible') RETURNING id_postulante`,
    );
    await db().query("UPDATE expediente SET id_postulante = $2 WHERE id_expediente = $1", [id, rows[0]!.id_postulante]);

    const texto = todasLasCeldas(await leerLibro((await descargar(e)).body));

    expect(texto).toContain(`ADM-${e.campana}-`);
    for (const dato of ["NombreSensible", "ApellidoSensible", "PostulanteSensible", "PaternoSensible", "MaternoSensible", "+51911222333", correo, "@ejemplo.test"]) {
      expect(texto).not.toContain(dato);
    }
  });

  it("HU0019-2.0 un nombre de grado con forma de fórmula se guarda como texto", async () => {
    const e = await entornoIndicadores(db(), firmante);
    await e.grado({ nombre: "=1+1" });

    const libro = await leerLibro((await descargar(e)).body);

    const celda = libro.getWorksheet("Vacantes")!.getRow(2).getCell(2);
    expect(celda.type).toBe(ExcelJS.ValueType.String);
    expect(celda.value).toBe("=1+1");
  });

  it("HU0019-2.0 sin línea base dice que está por definir, y con valores trae el % de optimización y la meta", async () => {
    const sinBase = await entornoIndicadores(db(), firmante);
    await sinBase.trayecto(await sinBase.grado(), "2026-09-01T10:00:00", CAMINO);
    expect(todasLasCeldas(await leerLibro((await descargar(sinBase)).body))).toContain("[Línea base por definir]");

    const lineaBase: LineaBase = {
      version: "prueba-1",
      fuente: "Medición ficticia de prueba",
      meta_optimizacion_pct: 70,
      lead_time_dias: 100,
      cycle_time_horas: null,
      etapas: { captacion_visita: { tramo_dias: 4, cycle_horas: null } },
    };
    const e = await entornoIndicadores(db(), firmante, lineaBase);
    await e.trayecto(await e.grado(), "2026-09-01T10:00:00", CAMINO);

    const libro = await leerLibro((await descargar(e)).body);

    expect(valorDe(libro, "Resumen", "Meta de optimización (%)")).toBe(70);
    expect(valorDe(libro, "Resumen", "Lead time: línea base (días)")).toBe(100);
    expect(valorDe(libro, "Resumen", "Lead time: actual (días)")).toBe(20);
    expect(valorDe(libro, "Resumen", "Lead time: optimización (%)")).toBe(80);
    expect(valorDe(libro, "Resumen", "Lead time: cumple la meta de 70 %")).toBe("Sí");
    expect(filas(libro, "Tiempos por etapa")[1]?.slice(5, 8)).toEqual([4, 50, "No"]);
  });

  it("HU0019-2.0 la campaña DEMO dice «Datos ficticios de demostración» en cada hoja, y otra campaña no", async () => {
    const e = await entornoIndicadores(db(), firmante);
    await e.grado({ campana: "DEMO", nombre: `Grado demo ${e.campana}` });

    const demo = await leerLibro((await descargar(e, { campana: "DEMO" })).body);
    const real = await leerLibro((await descargar(e)).body);

    for (const hoja of demo.worksheets) expect(filas(demo, hoja.name)[0]?.[0], hoja.name).toBe("Datos ficticios de demostración");
    expect(todasLasCeldas(real)).not.toContain("Datos ficticios");
  });

  it("HU0019-2.0 (acceso) otro rol recibe 403 auditado y una directora desactivada también", async () => {
    const e = await entornoIndicadores(db(), firmante);
    const sub = randomUUID();
    const tesoreria = await crearPersonal(db(), "tesoreria", sub);

    const res = await descargar(e, {}, await firmante.token(sub, ["tesoreria"]));

    expect(res.status).toBe(403);
    const { rows } = await db().query("SELECT detalle FROM registro_auditoria WHERE id_personal = $1 AND tipo_evento = 'acceso_denegado'", [tesoreria]);
    expect(rows[0]?.detalle).toMatchObject({ ruta: RUTA, roles_requeridos: ["directora"] });

    await db().query("UPDATE personal SET activo = false WHERE id_personal = $1", [e.directora]);
    expect((await descargar(e)).status).toBe(403);
  });

  it.each([
    ["sin formato", { formato: undefined }],
    ["formato no admitido", { formato: "pdf" }],
    ["rango invertido", { desde: "2026-10-01", hasta: "2026-09-01" }],
  ])("HU0019-2.0 (filtros) %s responde 400", async (_caso, query) => {
    const e = await entornoIndicadores(db(), firmante);

    const res = await descargar(e, query as Record<string, string>);

    expect(res.status).toBe(400);
  });
});
