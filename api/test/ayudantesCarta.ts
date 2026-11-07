// Fixtures de la Carta de Vacante (HU0016): la firma ficticia de la directora, el postulante del expediente, la conciliación
// por la ruta real de G05 y la lectura del PDF con pdfjs-dist: se prueba el texto que ve quien abre la carta, no el formato
// interno. Datos ficticios @ejemplo.test; n8n se simula.
import { crc32, deflateSync } from "node:zlib";
import request from "supertest";
import { getDocument, OPS } from "pdfjs-dist/legacy/build/pdf.mjs";
import { crearAlmacenamientoDesdeConfig } from "../src/almacenamiento";
import type { Consultable } from "../src/db/pool";
import { cargarFirma } from "../src/services/cartaVacante";
import type { crearFirmante } from "./ayudantes";
import { entornoAdjudicacion } from "./ayudantesAdjudicacion";
import { CONFORME, rutaDecisionPago, TOKEN_INTERNO } from "./ayudantesValidacion";

type Firmante = Awaited<ReturnType<typeof crearFirmante>>;

export const rutaCartaInterna = (id: number) => `/internal/expedientes/${id}/carta-vacante`;
export const rutaCartaDireccion = (id: number) => `/direccion/expedientes/${id}/carta`;
export const rutaCartaFamilia = (id: number) => `/familia/expedientes/${id}/carta`;
export const POSTULANTE = { nombres: "Sofía", paterno: "Quispe", materno: "Rojas" };

// Un PNG real y mínimo (en escala de grises): `png()` de ayudantesCarga solo tiene la firma de bytes y pdfkit no lo podría leer.
export function pngFirma(lado = 8): Buffer {
  const bloque = (tipo: string, datos: Buffer) => {
    const cuerpo = Buffer.concat([Buffer.from(tipo, "latin1"), datos]);
    const largo = Buffer.alloc(4);
    largo.writeUInt32BE(datos.length);
    const control = Buffer.alloc(4);
    control.writeUInt32BE(crc32(cuerpo));
    return Buffer.concat([largo, cuerpo, control]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(lado, 0);
  ihdr.writeUInt32BE(lado, 4);
  ihdr[8] = 8; // 8 bits por muestra
  const fila = Buffer.concat([Buffer.from([0]), Buffer.alloc(lado, 0x40)]);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    bloque("IHDR", ihdr),
    bloque("IDAT", deflateSync(Buffer.concat(Array.from({ length: lado }, () => fila)))),
    bloque("IEND", Buffer.alloc(0)),
  ]);
}

export interface PdfLeido {
  texto: string;
  imagenes: number;
}

export async function leerPdf(contenido: Buffer): Promise<PdfLeido> {
  const tarea = getDocument({ data: new Uint8Array(contenido), verbosity: 0 });
  const documento = await tarea.promise;
  const pagina = await documento.getPage(1);
  const { items } = await pagina.getTextContent();
  const { fnArray } = await pagina.getOperatorList();
  const texto = items.map((i) => ("str" in i ? i.str : "")).join(" ");
  await tarea.destroy();
  return { texto, imagenes: fnArray.filter((f) => f === OPS.paintImageXObject).length };
}

export const correoDe = async (db: Consultable, idPersonal: number) =>
  (await db.query<{ correo: string }>("SELECT correo FROM personal WHERE id_personal = $1", [idPersonal])).rows[0]!.correo;

export async function entornoCarta(db: Consultable, firmante: Firmante) {
  const e = await entornoAdjudicacion(db, firmante);
  const almacenamiento = crearAlmacenamientoDesdeConfig();
  const cartaN8n = {
    emitir: (id: number) => request(e.app).post(rutaCartaInterna(id)).set("Authorization", `Bearer ${TOKEN_INTERNO()}`),
    pendientes: async () =>
      (await request(e.app).get("/internal/cartas/pendientes").set("Authorization", `Bearer ${TOKEN_INTERNO()}`)).body.expedientes.map(
        (x: { id_expediente: number }) => x.id_expediente,
      ) as number[],
  };

  // La BD de prueba sobrevive a la corrida y sus archivos no: se limpian las firmas de corridas anteriores.
  await db.query("UPDATE personal SET firma_url = NULL WHERE firma_url IS NOT NULL");
  const firmar = async (idPersonal = e.directora) => cargarFirma(almacenamiento, await correoDe(db, idPersonal), pngFirma());
  await firmar();

  async function conPostulante<T extends { idExpediente: number }>(f: T): Promise<T> {
    const { rows } = await db.query<{ id_postulante: number }>(
      "INSERT INTO postulante (nombres, apellido_paterno, apellido_materno) VALUES ($1, $2, $3) RETURNING id_postulante",
      [POSTULANTE.nombres, POSTULANTE.paterno, POSTULANTE.materno],
    );
    await db.query("UPDATE expediente SET id_postulante = $2 WHERE id_expediente = $1", [f.idExpediente, rows[0]!.id_postulante]);
    return f;
  }

  // Comprobante en conciliación, con el postulante.
  async function porConciliar(d: Parameters<typeof e.enConciliacion>[0] = {}) {
    const x = await e.enConciliacion(d);
    await conPostulante(x.f);
    return x;
  }

  // Tesorería concilia por la ruta real de G05.
  async function conciliada(d: Parameters<typeof e.enConciliacion>[0] = {}) {
    const x = await porConciliar(d);
    const res = await e.api(e.tesoreria.token).post(rutaDecisionPago(x.idPago), CONFORME);
    if (res.status !== 200) throw new Error(`Conciliación de prueba fallida (${res.status})`);
    return x;
  }

  return { ...e, almacenamiento, cartaN8n, firmar, conPostulante, porConciliar, conciliada };
}
