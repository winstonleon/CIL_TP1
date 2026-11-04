// HU0006-2.0 · validación previa del archivo en P06 y P07b: formato por su firma (no por la extensión ni el tipo que declara
// el navegador) y máximo de 10 MB. La API vuelve a validar; esto solo avisa de inmediato.
import { describe, expect, it } from "vitest";
import { MAXIMO_BYTES, MENSAJE_ARCHIVO, validarArchivo } from "./validarArchivo";

const archivo = (bytes: number[] | Uint8Array, nombre: string, tipo = "") => new File([new Uint8Array(bytes)], nombre, { type: tipo });
const PDF = [0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34];
const JPG = [0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10];
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00];
const ZIP = [0x50, 0x4b, 0x03, 0x04, 0x14, 0x00];
const EXE = [0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00];

describe("HU0006-2.0 validación previa del archivo", () => {
  it("HU0006-2.0 acepta PDF, JPG y PNG por su firma, aunque el nombre o el tipo declarado digan otra cosa", async () => {
    expect(await validarArchivo(archivo(PDF, "partida.pdf", "application/pdf"))).toBeNull();
    expect(await validarArchivo(archivo(JPG, "dni.jpg", "image/jpeg"))).toBeNull();
    expect(await validarArchivo(archivo(PNG, "voucher.png", "image/png"))).toBeNull();
    expect(await validarArchivo(archivo(PDF, "sin-extension"))).toBeNull();
    expect(await validarArchivo(archivo(JPG, "foto.exe", "application/octet-stream"))).toBeNull();
  });

  it("HU0006-2.0 rechaza un ZIP, un XLSX, un ejecutable renombrado a .pdf y un archivo vacío con el mensaje de formatos admitidos", async () => {
    expect(await validarArchivo(archivo(ZIP, "comprimido.zip", "application/zip"))).toBe(MENSAJE_ARCHIVO);
    expect(await validarArchivo(archivo(ZIP, "hoja.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"))).toBe(MENSAJE_ARCHIVO);
    expect(await validarArchivo(archivo(EXE, "factura.pdf", "application/pdf"))).toBe(MENSAJE_ARCHIVO);
    expect(await validarArchivo(archivo([], "vacio.pdf", "application/pdf"))).toBe(MENSAJE_ARCHIVO);
    expect(MENSAJE_ARCHIVO).toBe("Solo se aceptan archivos PDF, JPG o PNG de hasta 10 MB.");
  });

  it("HU0006-2.0 acepta exactamente 10 MB y rechaza un byte más", async () => {
    const justo = new Uint8Array(MAXIMO_BYTES);
    justo.set(PDF);
    const pasado = new Uint8Array(MAXIMO_BYTES + 1);
    pasado.set(PDF);
    expect(await validarArchivo(archivo(justo, "justo.pdf"))).toBeNull();
    expect(await validarArchivo(archivo(pasado, "grande.pdf"))).toBe(MENSAJE_ARCHIVO);
  });
});
