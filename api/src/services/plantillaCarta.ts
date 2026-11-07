// Plantilla institucional de la Carta de Vacante en PDF (HU0016-1.0; R18; ADR-19). Lo que redacta el colegio va entre
// corchetes hasta que lo entregue. D3-A: lleva los datos del menor, el grado y la firma; nunca montos, datos de pago, dictamen
// ni datos de los apoderados, y tampoco el DNI, para no dejar una copia descifrada fuera del sistema (ADR-03). Sin logo hasta
// que el colegio lo entregue. El PDF lo genera la API: ni el archivo ni la firma pasan por n8n.
import PDFDocument from "pdfkit";
import { obtenerConfig } from "../config";

export const PLANTILLA_CARTA = {
  version: "borrador-1",
  colegio: "Colegio Internacional de Lima",
  titulo: "Carta de Vacante",
  destinatario: "[Destinatario de la carta: por definir con el colegio]",
  textoInstitucional: "[Texto institucional: por definir con el colegio]",
  ciudad: "Lima",
  cargo: "Directora",
  direccionPorDefecto: "[Dirección del colegio]",
} as const;

const NIVEL_VISIBLE: Record<string, string> = { inicial: "Inicial", primaria: "Primaria", secundaria: "Secundaria" };
const AZUL = "#10326E";
const MARGEN = 72;

export interface DatosPlantilla {
  codigo: string;
  fechaEmision: Date;
  postulante: string;
  nivel: string;
  grado: string;
  campana: string;
  directora: string;
  firma: Buffer;
}

const fechaLarga = (fecha: Date) =>
  new Intl.DateTimeFormat("es-PE", { timeZone: "America/Lima", day: "numeric", month: "long", year: "numeric" }).format(fecha);

export function generarPdfCarta(d: DatosPlantilla): Promise<Buffer> {
  return new Promise((resolver, rechazar) => {
    // El nombre del menor no va en los metadatos del archivo.
    const doc = new PDFDocument({ size: "A4", margin: MARGEN, info: { Title: PLANTILLA_CARTA.titulo, Author: PLANTILLA_CARTA.colegio } });
    const partes: Buffer[] = [];
    doc.on("data", (parte: Buffer) => partes.push(parte));
    doc.on("end", () => resolver(Buffer.concat(partes)));
    doc.on("error", rechazar);
    try {
      const { DIRECCION_COLEGIO } = obtenerConfig();
      doc.fillColor(AZUL).font("Helvetica-Bold").fontSize(18).text(PLANTILLA_CARTA.colegio);
      doc.fillColor("black").font("Helvetica").fontSize(10).text(DIRECCION_COLEGIO || PLANTILLA_CARTA.direccionPorDefecto);
      doc.moveDown(2);
      doc.fontSize(11).text(`${PLANTILLA_CARTA.ciudad}, ${fechaLarga(d.fechaEmision)}`, { align: "right" });
      doc.text(`N.° CARTA-${d.codigo}`, { align: "right" });
      doc.moveDown(2);
      doc.fillColor(AZUL).font("Helvetica-Bold").fontSize(16).text(PLANTILLA_CARTA.titulo, { align: "center" });
      doc.fillColor("black").font("Helvetica").fontSize(11).moveDown(1.5);
      doc.text(PLANTILLA_CARTA.destinatario);
      doc.moveDown();
      doc.text(PLANTILLA_CARTA.textoInstitucional);
      doc.moveDown();
      doc.text(`Postulante: ${d.postulante}`);
      doc.text(`Nivel: ${NIVEL_VISIBLE[d.nivel] ?? d.nivel}`);
      doc.text(`Grado: ${d.grado}`);
      doc.text(`Admisión: ${d.campana}`);
      doc.moveDown(3);
      doc.image(d.firma, { fit: [180, 80] });
      doc.moveDown(0.5);
      doc.font("Helvetica-Bold").text(d.directora);
      doc.font("Helvetica").text(`${PLANTILLA_CARTA.cargo} · ${PLANTILLA_CARTA.colegio}`);
      doc.end();
    } catch (error) {
      rechazar(error as Error);
    }
  });
}
