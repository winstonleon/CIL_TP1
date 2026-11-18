// C85: el documento que el colegio aprueba sale del código, así que no se desfasa. Estas pruebas avisan cuando el código cambia sin que
// cambie el catálogo (api/scripts/textosColegioCatalogo.ts) y comprueban lo que el colegio recibe: versión, fecha, la decisión
// Aprobado o Corregir en cada texto, la revisión legal de la política de privacidad y la campaña que firma.
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { construirCatalogo, GRUPOS } from "../scripts/textosColegioCatalogo";
import { construirLibro, HOJAS, huellaDelContenido, leerCampanaParaVista, OPCIONES_DECISION, POR_COMPLETAR } from "../scripts/textosColegioLibro";

const RAIZ = resolve(import.meta.dirname, "..", "..");
const META = { version: 1, generado: "17 de noviembre de 2026, 10:00", commit: "abc1234" };
const PLANTILLA = join(RAIZ, "db", "campanas", "plantilla-2027.json");

// Marcadores entre corchetes de los servicios que no son un texto para las familias ni los redacta el colegio:
// - «[sin etapa registrada]»: relleno del aviso al personal cuando el expediente caducó sin una etapa guardada.
// - «[Línea base por definir]»: lo ve solo la Directora en G08 y en su reporte; es una medición con el colegio (C66), no un texto.
const NO_SON_DEL_COLEGIO = new Set(["[sin etapa registrada]", "[Línea base por definir]"]);

const leerLibro = async (contenido: Buffer) => {
  const libro = new ExcelJS.Workbook();
  await libro.xlsx.load(contenido as unknown as ArrayBuffer);
  return libro;
};
const celdas = (libro: ExcelJS.Workbook, hoja: string) => {
  const salida: string[] = [];
  libro.getWorksheet(hoja)!.eachRow((fila) => (fila.values as unknown[]).slice(1).forEach((v) => salida.push(String(v ?? ""))));
  return salida;
};

describe("C85 documento para el colegio", () => {
  it("C85 cada texto entre corchetes de los servicios tiene su fila en el catálogo", () => {
    const carpeta = resolve(RAIZ, "api", "src", "services");
    const marcadores = readdirSync(carpeta)
      .filter((archivo) => archivo.endsWith(".ts"))
      .flatMap((archivo) => [...readFileSync(join(carpeta, archivo), "utf8").matchAll(/"(\[[^"\]\n]{6,}\])"/g)].map((m) => ({ archivo, marcador: m[1]! })))
      .filter((m) => !NO_SON_DEL_COLEGIO.has(m.marcador));
    expect(marcadores.length).toBeGreaterThan(30); // si la búsqueda no encuentra nada, la prueba no demuestra nada
    const catalogo = construirCatalogo().map((t) => t.texto).join("\n");
    const sinFila = marcadores.filter((m) => !catalogo.includes(m.marcador)).map((m) => `${m.archivo}: ${m.marcador}`);
    expect(sinFila).toEqual([]);
  });

  it("C85 cada texto de pantalla del catálogo sigue en el archivo donde vive", () => {
    const fuentes = construirCatalogo().flatMap((t) => (t.fuentes ?? []).map((f) => ({ id: t.id, ...f })));
    expect(fuentes.length).toBeGreaterThan(40);
    const desfasados = fuentes.filter((f) => !readFileSync(join(RAIZ, f.archivo), "utf8").includes(f.fragmento)).map((f) => `${f.id}: «${f.fragmento}» ya no está en ${f.archivo}`);
    expect(desfasados).toEqual([]);
  });

  it("C85 bloquean abrir a las familias los textos que ellas leen o reciben, y no los avisos al personal", () => {
    const catalogo = construirCatalogo(); // lanza si dos filas repiten su identificador
    const personal = catalogo.filter((t) => !t.familia);
    expect(personal.length).toBeGreaterThan(0);
    expect(personal.every((t) => t.grupo === GRUPOS.personal && !t.quien.startsWith("La familia"))).toBe(true);
    const familia = catalogo.filter((t) => t.familia);
    expect(familia.every((t) => t.grupo !== GRUPOS.personal && t.quien.startsWith("La familia"))).toBe(true);
    // Lo que el criterio nombra: la plantilla de la carta, el logo y la firma real.
    const ids = familia.map((t) => t.id);
    expect(ids).toEqual(expect.arrayContaining(["CAR-01", "CAR-02", "CAR-04", "CAR-05", "PRI-01", "COR-17"]));
  });

  it("C85 la huella del contenido cambia cuando cambia cualquier texto", () => {
    const catalogo = construirCatalogo();
    expect(huellaDelContenido(catalogo)).toMatch(/^[0-9a-f]{8}$/);
    expect(huellaDelContenido(catalogo)).toBe(huellaDelContenido(construirCatalogo()));
    const [primero, ...resto] = catalogo;
    expect(huellaDelContenido([{ ...primero!, texto: `${primero!.texto} ` }, ...resto])).not.toBe(huellaDelContenido(catalogo));
  });

  it("C85 el libro trae la versión, la fecha, Aprobado o Corregir en cada texto y la revisión legal de la política de privacidad", async () => {
    const catalogo = construirCatalogo();
    const campana = leerCampanaParaVista(readFileSync(PLANTILLA, "utf8"), "plantilla-2027.json");
    const libro = await leerLibro(await construirLibro(catalogo, campana, META));
    expect(libro.worksheets.map((h) => h.name)).toEqual([HOJAS.instrucciones, HOJAS.textos, HOJAS.campana, HOJAS.aprobacion]);

    const instrucciones = celdas(libro, HOJAS.instrucciones).join("\n");
    expect(instrucciones).toContain(`Versión ${META.version} · ${META.generado}`);
    expect(instrucciones).toContain(META.commit);
    expect(instrucciones).toContain(huellaDelContenido(catalogo));
    expect(instrucciones).toContain("abogado del colegio");
    expect(instrucciones).toContain("Ley N.° 29733");

    const textos = libro.getWorksheet(HOJAS.textos)!;
    expect(textos.rowCount).toBe(catalogo.length + 1);
    expect(textos.getRow(1).getCell(7).value).toBe("Decisión del colegio");
    const sinDecision: string[] = [];
    const idsEnLibro: string[] = [];
    textos.eachRow((fila, n) => {
      if (n === 1) return;
      idsEnLibro.push(String(fila.getCell(1).value));
      const validacion = fila.getCell(7).dataValidation;
      if (validacion?.type !== "list" || validacion.formulae?.[0] !== `"${OPCIONES_DECISION.join(",")}"`) sinDecision.push(String(fila.getCell(1).value));
    });
    expect(sinDecision).toEqual([]);
    expect([...idsEnLibro].sort()).toEqual(catalogo.map((t) => t.id).sort());

    const politica = [...Array(textos.rowCount).keys()].map((k) => textos.getRow(k + 1)).find((f) => f.getCell(1).value === "PRI-01")!;
    expect(String(politica.getCell(9).value)).toContain("abogado del colegio");
    expect(String(politica.getCell(9).value)).toContain("Ley N.° 29733");

    const aprobacion = celdas(libro, HOJAS.aprobacion).join("\n");
    expect(aprobacion).toContain("Nombre del abogado");
    expect(aprobacion).toContain("Revisión legal de la política de privacidad");
  });

  it("C85 los correos del libro son los que compone el sistema, con el contacto de Admisión una sola vez como dato del colegio", async () => {
    const catalogo = construirCatalogo();
    const correos = catalogo.filter((t) => t.id.startsWith("COR-"));
    expect(correos).toHaveLength(17);
    expect(correos.every((t) => t.texto.startsWith("Asunto: ") && t.texto.includes("[Datos de contacto de Admisión: por definir con el colegio]"))).toBe(true);
    expect(catalogo.filter((t) => t.id === "DAT-03")).toHaveLength(1);
  });

  it("C85 la hoja Campaña de la plantilla marca «Por completar» lo que el colegio no entregó y trae la huella del archivo", async () => {
    const contenido = readFileSync(PLANTILLA, "utf8");
    const campana = leerCampanaParaVista(contenido, "plantilla-2027.json");
    expect(campana.completa).toBe(false);
    expect(campana.grados).toHaveLength(14);
    expect(campana.sha256).toMatch(/^[0-9a-f]{64}$/);
    const libro = await leerLibro(await construirLibro(construirCatalogo(), campana, META));
    const hoja = celdas(libro, HOJAS.campana);
    expect(hoja.filter((c) => c === POR_COMPLETAR).length).toBeGreaterThanOrEqual(28); // vacantes y fracciones de 14 grados
    expect(hoja.join("\n")).toContain(campana.sha256.slice(0, 16));
    expect(hoja.join("\n")).toContain("PLANTILLA SIN COMPLETAR");
    expect(hoja).toContain("Firma");
  });

  it("C85 una campaña completa se muestra sin «Por completar» y con sus requisitos", async () => {
    const completa = JSON.stringify({
      campana: "2027",
      requisitos_comunes: [{ tipo_documento: "DNI del postulante", categoria: "postulante_y_padres", condicion_aplicacion: "todos", obligatorio: true, por_apoderado: false }],
      grados: [
        {
          nivel: "primaria",
          nombre_grado: "1.° de primaria",
          vacantes_autorizadas: 30,
          requiere_jornada_observacion: false,
          requiere_evaluacion_psicologica: true,
          requiere_evaluacion_academica: false,
          monto_cuota_ingreso: 7000,
          max_fracciones: 3,
          requisitos: [{ tipo_documento: "Boletas de pago", categoria: "financiero", condicion_aplicacion: "si_dependiente", por_apoderado: true }],
        },
      ],
    });
    const campana = leerCampanaParaVista(completa, "campana-2027.json");
    expect(campana.completa).toBe(true);
    expect(campana.requisitos).toHaveLength(2);
    const libro = await leerLibro(await construirLibro(construirCatalogo(), campana, META));
    const hoja = celdas(libro, HOJAS.campana);
    expect(hoja).not.toContain(POR_COMPLETAR);
    expect(hoja).toEqual(expect.arrayContaining(["Todos los grados", "DNI del postulante", "Financiero · solo Tesorería", "Si es dependiente", "Sí"]));
    expect(hoja.join("\n")).toContain("Estado: completa.");
  });

  it("C85 un archivo de campaña que no es JSON se rechaza con un mensaje claro", () => {
    expect(() => leerCampanaParaVista("{no es json", "x.json")).toThrow("no es un JSON válido");
    expect(() => leerCampanaParaVista("[]", "x.json")).toThrow("debe ser un objeto JSON");
  });
});
