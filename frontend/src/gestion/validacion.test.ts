// Etiquetas y formatos de G02, G03 y G05 (validaciones en paralelo). Los textos esperados son los de los mockups.
import { describe, expect, it } from "vitest";
import {
  chipsRamas,
  conceptoTesoreria,
  diasEnProceso,
  errorMotivo,
  etiquetaBandeja,
  etiquetaDocumento,
  etiquetaTesoreria,
  fechaRelativa,
  nombreAbreviado,
} from "./validacion";

// 05/11/2026, 10:00 en Lima (UTC−5).
const AHORA = new Date("2026-11-05T15:00:00.000Z");

describe("HU0017-1.0 G02: estado del expediente en la bandeja", () => {
  it("HU0017-1.0 [parte: bandeja] un expediente recién verificado como completo se muestra «Completo · en revisión», con la actividad y los días del mockup", () => {
    expect(etiquetaBandeja({ estado_documental: "pendiente", subsanado: false })).toEqual({ texto: "Completo · en revisión", tono: "revision" });
    expect(fechaRelativa("2026-11-05T14:12:00.000Z", AHORA)).toBe("Hoy, 9:12 a. m.");
    expect(fechaRelativa("2026-11-04T23:00:00.000Z", AHORA)).toBe("Ayer");
    expect(fechaRelativa("2026-11-03T12:00:00.000Z", AHORA)).toBe("Hace 2 días");
    expect(fechaRelativa(null, AHORA)).toBe("—");
    expect(diasEnProceso("2026-10-30T12:00:00.000Z", AHORA)).toBe("6 días");
    expect(diasEnProceso("2026-11-04T12:00:00.000Z", AHORA)).toBe("1 día");
    expect(nombreAbreviado({ nombres: "María Fernanda", apellidos: "Quispe Rojas" })).toBe("María F. Quispe");
    expect(nombreAbreviado({ nombres: "Carlos", apellidos: "Huamán" })).toBe("Carlos Huamán");
  });
});

describe("HU0008-2.0 estados observados y subsanados", () => {
  it("HU0008-2.0 [parte: correo] la rama observada se muestra «Observado» y la que volvió a revisión tras una subsanación, «Subsanado»", () => {
    expect(etiquetaBandeja({ estado_documental: "observado", subsanado: false }).texto).toBe("Observado");
    expect(etiquetaBandeja({ estado_documental: "observado", subsanado: true }).texto).toBe("Observado");
    expect(etiquetaBandeja({ estado_documental: "pendiente", subsanado: true })).toEqual({ texto: "Subsanado", tono: "subsanado" });
    expect(etiquetaBandeja({ estado_documental: "conforme", subsanado: true }).texto).toBe("Conforme");
    expect(etiquetaDocumento("pendiente").texto).toBe("Por revisar");
    expect(etiquetaDocumento("observado").texto).toBe("Observado");
  });

  it("HU0008-2.0 [parte: correo] el motivo es obligatorio y de hasta 500 caracteres", () => {
    expect(errorMotivo("   ")).toBe("Escribe el motivo de la observación.");
    expect(errorMotivo("x".repeat(501))).toBe("El motivo admite hasta 500 caracteres.");
    expect(errorMotivo("La imagen está borrosa.")).toBe("");
  });
});

describe("HU0008-1.0 G03: estado de las tres ramas", () => {
  it("HU0008-1.0 los chips del encabezado usan los textos del mockup para cada rama", () => {
    expect(chipsRamas({ documental: "pendiente", derecho: "conforme", financiera: "observado" })).toEqual([
      { texto: "Documentos: en revisión", tono: "revision" },
      { texto: "Derecho de admisión: validado", tono: "conforme" },
      { texto: "Doc. financiera: observada", tono: "observado" },
    ]);
  });
});

describe("HU0024-1.0 y HU0011-1.0 G05: lista de Tesorería", () => {
  it("HU0024-1.0 el comprobante pendiente se muestra «Por validar» con su monto", () => {
    const item = { concepto: "derecho_admision" as const, monto: 300, estado: "pendiente" as const, subsanado: false };
    expect(conceptoTesoreria(item)).toBe("Derecho de admisión · S/ 300");
    expect(etiquetaTesoreria(item).texto).toBe("Por validar");
    expect(etiquetaTesoreria({ ...item, subsanado: true }).texto).toBe("Subsanado");
  });

  it("HU0011-1.0 la documentación financiera pendiente se muestra «Por revisar»; la observada, «Observado»", () => {
    const item = { concepto: "documentacion_financiera" as const, monto: null, estado: "pendiente" as const, subsanado: false };
    expect(conceptoTesoreria(item)).toBe("Documentación financiera");
    expect(etiquetaTesoreria(item).texto).toBe("Por revisar");
    expect(etiquetaTesoreria({ ...item, estado: "observado" }).texto).toBe("Observado");
  });
});
