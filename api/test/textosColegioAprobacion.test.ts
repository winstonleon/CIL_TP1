// C85 (criterio del revisor, 17/11/2026): el documento para el colegio fija un plazo y dice qué pasa si el colegio no responde. La
// aprobación por defecto vale solo para los avisos de bajo riesgo ya redactados; la política de privacidad, la Carta de Vacante y la
// campaña exigen aprobación explícita y firma en la hoja «Aprobación», y lo que está entre corchetes no se aprueba en silencio.
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { POLITICA_PRIVACIDAD } from "../src/services/politicaPrivacidad";
import { construirCatalogo, GRUPOS } from "../scripts/textosColegioCatalogo";
import { construirLibro, DIAS_PLAZO, fechaLarga, HOJAS, leerCampanaParaVista, sumarDiasHabiles, type Meta } from "../scripts/textosColegioLibro";

const RAIZ = resolve(import.meta.dirname, "..", "..");
const PLANTILLA = join(RAIZ, "db", "campanas", "plantilla-2027.json");
const META: Meta = { version: 1, generado: "17 de noviembre de 2026, 10:00", commit: "abc1234", plazo: "viernes 20 de noviembre de 2026" };

const campana = () => leerCampanaParaVista(readFileSync(PLANTILLA, "utf8"), "plantilla-2027.json");
const armar = async (meta: Meta = META) => {
  const libro = new ExcelJS.Workbook();
  await libro.xlsx.load((await construirLibro(construirCatalogo(), campana(), meta)) as unknown as ArrayBuffer);
  return libro;
};
const celdas = (libro: ExcelJS.Workbook, hoja: string) => {
  const salida: string[] = [];
  libro.getWorksheet(hoja)!.eachRow((fila) => (fila.values as unknown[]).slice(1).forEach((v) => salida.push(String(v ?? ""))));
  return salida;
};
const entreCorchetes = (texto: string) => /\[[^\]]+\]/.test(texto);

describe("C85 plazo y aprobación por defecto del documento para el colegio", () => {
  it("C85 el plazo se cuenta en días hábiles: sin el día de partida, sin sábados, domingos ni feriados", () => {
    const feriados = new Set(["2026-12-08", "2026-12-09"]);
    expect(DIAS_PLAZO).toBe(3);
    expect(sumarDiasHabiles("2026-11-17", 3)).toBe("2026-11-20"); // martes → viernes
    expect(sumarDiasHabiles("2026-11-20", 3)).toBe("2026-11-25"); // viernes → miércoles: salta el fin de semana
    expect(sumarDiasHabiles("2026-11-21", 1)).toBe("2026-11-23"); // desde un sábado, el lunes es el primer día
    expect(sumarDiasHabiles("2026-12-07", 3)).toBe("2026-12-10"); // sin la lista de feriados, el 8 y el 9 cuentan
    expect(sumarDiasHabiles("2026-12-07", 3, feriados)).toBe("2026-12-14"); // con ella, salta el 8, el 9 y el fin de semana
    expect(sumarDiasHabiles("2026-11-17", 0)).toBe("2026-11-17");
    expect(fechaLarga("2026-11-20")).toBe("viernes 20 de noviembre de 2026");
  });

  it("C85 la hoja Instrucciones fija el plazo de 3 días hábiles, con su fecha cuando se conoce", async () => {
    const conFecha = celdas(await armar(), HOJAS.instrucciones).join("\n");
    expect(conFecha).toContain("Plazo para responder");
    expect(conFecha).toContain("3 días hábiles");
    expect(conFecha).toContain("hasta el viernes 20 de noviembre de 2026");

    const sinFecha = celdas(await armar({ version: META.version, generado: META.generado, commit: META.commit }), HOJAS.instrucciones).join("\n");
    expect(sinFecha).toContain("3 días hábiles");
    expect(sinFecha).not.toContain("hasta el viernes");
  });

  it("C85 la hoja Instrucciones dice que lo que no se responde en el plazo se toma como aprobado, salvo la política, la carta y la campaña", async () => {
    const catalogo = construirCatalogo();
    const cuenta = (tipo: string) => catalogo.filter((t) => t.aprobacion === tipo).length;
    const texto = celdas(await armar(), HOJAS.instrucciones).join("\n");

    expect(texto).toContain("Si el colegio no responde en el plazo");
    expect(texto).toContain(`las ${cuenta("por_defecto")} filas que lo dicen`);
    expect(texto).toContain("se toma como aprobado");
    expect(texto).toContain("NO se aprueban en silencio");
    for (const pieza of ["la política de privacidad (fila PRI-01)", "la Carta de Vacante (filas CAR-01 a CAR-06", "la campaña (hoja «Campaña»: vacantes, cuotas, fracciones y requisitos)"]) {
      expect(texto).toContain(pieza);
    }
    expect(texto).toContain("la firma en la hoja «Aprobación»");
    expect(texto).toContain(`las otras ${cuenta("respuesta")} filas`);
  });

  it("C85 la política, la Carta de Vacante y todo lo que está entre corchetes o es un dato del colegio no se aprueban por defecto", () => {
    const catalogo = construirCatalogo();
    const de = (id: string) => catalogo.find((t) => t.id === id)!;

    expect(de("PRI-01").aprobacion).toBe("firma");
    const carta = catalogo.filter((t) => t.grupo === GRUPOS.carta);
    expect(carta.map((t) => t.id)).toEqual(["CAR-01", "CAR-02", "CAR-03", "CAR-04", "CAR-05", "CAR-06"]);
    expect(carta.every((t) => t.aprobacion === "firma")).toBe(true);

    const conCorchetes = catalogo.filter((t) => entreCorchetes(t.texto));
    expect(conCorchetes.length).toBeGreaterThan(30);
    expect(conCorchetes.every((t) => t.aprobacion !== "por_defecto")).toBe(true);
    expect(catalogo.filter((t) => t.grupo === GRUPOS.datos || t.grupo === GRUPOS.plazos).every((t) => t.aprobacion !== "por_defecto")).toBe(true);
    expect(de("PAN-20").aprobacion).toBe("respuesta"); // sin corchetes, pero el colegio tiene que decir si esa condición existe
    expect(de("COR-01").aprobacion).toBe("respuesta"); // el cuerpo del correo es un marcador por definir
  });

  it("C85 solo los avisos de bajo riesgo, ya redactados, se aprueban por defecto", () => {
    const catalogo = construirCatalogo();
    const porDefecto = catalogo.filter((t) => t.aprobacion === "por_defecto");
    const gruposPermitidos: readonly string[] = [GRUPOS.pantallas, GRUPOS.ingreso, GRUPOS.correos, GRUPOS.personal];
    expect(porDefecto.length).toBeGreaterThan(50);
    expect(porDefecto.every((t) => gruposPermitidos.includes(t.grupo) && !entreCorchetes(t.texto))).toBe(true);
    expect(porDefecto.map((t) => t.id)).toEqual(expect.arrayContaining(["PAN-01", "PAN-22", "ING-04", "ING-07"]));
    expect(catalogo.every((t) => ["por_defecto", "respuesta", "firma"].includes(t.aprobacion))).toBe(true);
  });

  it("C85 cada fila de Textos dice en «Qué se pide» qué pasa si el colegio no responde", async () => {
    const catalogo = construirCatalogo();
    const porId = new Map(catalogo.map((t) => [t.id, t]));
    const hoja = (await armar()).getWorksheet(HOJAS.textos)!;
    const incorrectas: string[] = [];
    hoja.eachRow((fila, n) => {
      if (n === 1) return;
      const id = String(fila.getCell(1).value);
      const pide = String(fila.getCell(4).value);
      const aprobada = pide.includes("se toma como aprobado");
      const noPorDefecto = pide.includes("No se aprueba por defecto");
      const conFirma = pide.includes("Aprobación explícita y firma");
      const tipo = porId.get(id)!.aprobacion;
      const bien = tipo === "por_defecto" ? aprobada && !noPorDefecto && !conFirma : tipo === "respuesta" ? !aprobada && noPorDefecto && !conFirma : !aprobada && noPorDefecto && conFirma;
      if (!bien) incorrectas.push(`${id} (${tipo}): ${pide}`);
    });
    expect(incorrectas).toEqual([]);
    expect(hoja.rowCount).toBe(catalogo.length + 1);
  });

  it("C85 la hoja Aprobación pide la firma de la política (con su versión), de la Carta de Vacante y de la campaña (con la huella de su archivo)", async () => {
    const libro = await armar();
    const hoja = celdas(libro, HOJAS.aprobacion);
    const texto = hoja.join("\n");

    expect(texto).toContain("Aprobación explícita: no vale por defecto");
    expect(texto).toContain(`Política de privacidad (fila PRI-01) · versión ${POLITICA_PRIVACIDAD.version}`);
    expect(texto).toContain(`Carta de Vacante (filas CAR-01 a CAR-06 y carta-de-vacante-ejemplo-v${META.version}.pdf)`);
    expect(texto).toContain(`Campaña ${campana().campana} (hoja «Campaña»: vacantes, cuotas, fracciones y requisitos) · plantilla-2027.json · huella ${campana().sha256.slice(0, 16)}`);
    expect(texto).toContain("Revisión legal de la política de privacidad");
    expect(texto).toContain("Nombre del abogado");
    // Una firma por quien aprueba en general, por cada una de las tres piezas y por el abogado.
    expect(hoja.filter((celda) => celda === "Firma")).toHaveLength(5);
  });

  it("C85 la fila PRI-01 muestra la versión de la política que el sistema registra con cada consentimiento, no solo el marcador", () => {
    const politica = construirCatalogo().find((t) => t.id === "PRI-01")!;
    expect(politica.texto).toContain(`Versión que el sistema registra con cada consentimiento: ${POLITICA_PRIVACIDAD.version}`);
    expect(politica.texto).toContain(POLITICA_PRIVACIDAD.texto);
    expect(politica.nota).toContain("solo un marcador");
    expect(politica.nota).toContain("abogado del colegio");
  });
});
