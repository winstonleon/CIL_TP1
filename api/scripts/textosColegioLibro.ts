// Libro de Excel con los textos y datos que el colegio debe aprobar o entregar (C85). Lo arma `npm run colegio:textos` con el catálogo
// (textosColegioCatalogo.ts) y, para la hoja «Campaña», con el JSON de la carga de campaña (C26): el colegio revisa y firma ese mismo
// contenido. Funciones puras: no leen archivos ni el entorno.
import { createHash } from "node:crypto";
import ExcelJS from "exceljs";
import { GRUPOS, type Texto } from "./textosColegioCatalogo";

export interface Meta {
  version: number;
  generado: string; // «17 de noviembre de 2026, 14:35»
  commit: string; // «a1b2c3d», con la marca de cambios sin confirmar si el árbol no estaba limpio
}

export const POR_COMPLETAR = "Por completar";
export const OPCIONES_DECISION = ["Aprobado", "Corregir"] as const;
export const HOJAS = { instrucciones: "Instrucciones", textos: "Textos", campana: "Campaña", aprobacion: "Aprobación" } as const;

const AZUL = "FF10326E";
const AMARILLO = "FFFFF4C2";
const NARANJA = "FFFDE3CF";

// ------------------------------------------------------------------ huella

// Cambia sola con cualquier texto del catálogo: la versión (número) la sube a mano quien envía una ronda nueva.
export function huellaDelContenido(catalogo: Texto[]): string {
  return createHash("sha256").update(JSON.stringify(catalogo)).digest("hex").slice(0, 8);
}

// ------------------------------------------------------------------ campaña (JSON de C26 → tabla legible)

export interface RequisitoVista {
  aplicaA: string;
  documento: string;
  categoria: string;
  condicion: string;
  obligatorio: string;
  porApoderado: string;
}

export interface GradoVista {
  nivel: string;
  grado: string;
  vacantes: string | number;
  cuota: string | number;
  fracciones: string | number;
  jornada: string;
  psicologica: string;
  academica: string;
  propios: number;
}

export interface CampanaVista {
  campana: string;
  archivo: string;
  sha256: string;
  completa: boolean;
  grados: GradoVista[];
  requisitos: RequisitoVista[];
}

// Mismos nombres que G09 (frontend/src/gestion/configuracion.ts).
const ETIQUETA_CATEGORIA: Record<string, string> = {
  postulante_y_padres: "Postulante y padres",
  colegio_procedencia: "Colegio de procedencia",
  financiero: "Financiero · solo Tesorería",
  condicion_especial: "Condición especial",
};
const ETIQUETA_CONDICION: Record<string, string> = {
  todos: "Todos",
  solo_colegio_peruano: "Si estudió en otro colegio del Perú",
  solo_condicion_especial: "Si declara una condición especial",
  si_dependiente: "Si es dependiente",
  si_independiente: "Si es independiente",
};
const NIVEL_VISIBLE: Record<string, string> = { inicial: "Inicial", primaria: "Primaria", secundaria: "Secundaria" };

type Crudo = Record<string, unknown>;
const esObjeto = (v: unknown): v is Crudo => typeof v === "object" && v !== null && !Array.isArray(v);
const lista = (v: unknown): Crudo[] => (Array.isArray(v) ? v.filter(esObjeto) : []);
const texto = (v: unknown): string => (typeof v === "string" && v.trim() !== "" ? v.trim() : POR_COMPLETAR);
const numero = (v: unknown): string | number => (typeof v === "number" ? v : POR_COMPLETAR);
const siNo = (v: unknown, pordefecto: boolean | null = null): string => {
  const valor = typeof v === "boolean" ? v : pordefecto;
  return valor === null ? POR_COMPLETAR : valor ? "Sí" : "No";
};

function requisitoVista(aplicaA: string, r: Crudo): RequisitoVista {
  const categoria = typeof r.categoria === "string" ? (ETIQUETA_CATEGORIA[r.categoria] ?? r.categoria) : POR_COMPLETAR;
  const condicion = typeof r.condicion_aplicacion === "string" ? (ETIQUETA_CONDICION[r.condicion_aplicacion] ?? r.condicion_aplicacion) : ETIQUETA_CONDICION.todos!;
  return { aplicaA, documento: texto(r.tipo_documento), categoria, condicion, obligatorio: siNo(r.obligatorio, true), porApoderado: siNo(r.por_apoderado, false) };
}

// No valida: solo muestra. La validación es la de `npm run campana:cargar -- <archivo> --simular`.
export function leerCampanaParaVista(contenido: string, archivo: string): CampanaVista {
  let crudo: unknown;
  try {
    crudo = JSON.parse(contenido.replace(/^\uFEFF/, ""));
  } catch {
    throw new Error("El archivo de la campaña no es un JSON válido");
  }
  if (!esObjeto(crudo)) throw new Error("El archivo de la campaña debe ser un objeto JSON");
  const grados = lista(crudo.grados);
  const vista: GradoVista[] = grados.map((g) => ({
    nivel: typeof g.nivel === "string" ? (NIVEL_VISIBLE[g.nivel] ?? g.nivel) : POR_COMPLETAR,
    grado: texto(g.nombre_grado),
    vacantes: numero(g.vacantes_autorizadas),
    cuota: numero(g.monto_cuota_ingreso),
    fracciones: numero(g.max_fracciones),
    jornada: siNo(g.requiere_jornada_observacion),
    psicologica: siNo(g.requiere_evaluacion_psicologica),
    academica: siNo(g.requiere_evaluacion_academica),
    propios: lista(g.requisitos).length,
  }));
  const requisitos = [
    ...lista(crudo.requisitos_comunes).map((r) => requisitoVista("Todos los grados", r)),
    ...grados.flatMap((g) => lista(g.requisitos).map((r) => requisitoVista(texto(g.nombre_grado), r))),
  ];
  const celdas = [
    ...vista.flatMap((g) => [g.nivel, g.grado, g.vacantes, g.cuota, g.fracciones, g.jornada, g.psicologica, g.academica]),
    ...requisitos.flatMap((r) => [r.documento, r.categoria, r.obligatorio, r.porApoderado]),
  ];
  return {
    campana: texto(crudo.campana),
    archivo,
    sha256: createHash("sha256").update(contenido).digest("hex"),
    completa: vista.length > 0 && requisitos.length > 0 && !celdas.includes(POR_COMPLETAR),
    grados: vista,
    requisitos,
  };
}

// ------------------------------------------------------------------ libro

const BORDE: Partial<ExcelJS.Borders> = {
  top: { style: "thin", color: { argb: "FFB8B8B8" } },
  left: { style: "thin", color: { argb: "FFB8B8B8" } },
  bottom: { style: "thin", color: { argb: "FFB8B8B8" } },
  right: { style: "thin", color: { argb: "FFB8B8B8" } },
};

function encabezado(fila: ExcelJS.Row): void {
  fila.eachCell((celda) => {
    celda.font = { bold: true, color: { argb: "FFFFFFFF" } };
    celda.fill = { type: "pattern", pattern: "solid", fgColor: { argb: AZUL } };
    celda.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
    celda.border = BORDE;
  });
  fila.height = 34;
}

function pie(hoja: ExcelJS.Worksheet, meta: Meta): void {
  hoja.headerFooter.oddFooter = `&L&8Textos para el colegio · versión ${meta.version} · ${meta.generado}&R&8Página &P de &N`;
}

function hojaInstrucciones(libro: ExcelJS.Workbook, catalogo: Texto[], meta: Meta, huella: string): void {
  const hoja = libro.addWorksheet(HOJAS.instrucciones);
  hoja.getColumn(1).width = 120;
  const bloquean = catalogo.filter((t) => t.familia).length;
  const lineas: { texto: string; estilo?: "titulo" | "seccion" | "destacado" }[] = [
    { texto: "Textos y datos del Colegio Internacional de Lima para el sistema de admisión", estilo: "titulo" },
    { texto: `Versión ${meta.version} · ${meta.generado} (hora de Lima)` },
    { texto: `Generado desde el código del sistema · versión del código ${meta.commit} · huella del contenido ${huella}` },
    { texto: "" },
    { texto: "Qué se le pide al colegio", estilo: "seccion" },
    {
      texto:
        "Antes de abrir el sistema a las familias, el colegio debe aprobar —o corregir— todo texto que las familias leen o reciben, y entregar los datos que hoy faltan. " +
        `Hay ${bloquean} textos o datos de ese tipo (los marcados «Sí» en la hoja Textos) y ${catalogo.length - bloquean} avisos que solo lee el personal.`,
    },
    {
      texto:
        "En la hoja «Textos» hay una fila por texto. La columna «Texto actual» muestra exactamente lo que el sistema dice hoy: los correos aparecen completos, con datos ficticios. " +
        "Lo que está entre corchetes todavía no existe y lo debe redactar el colegio.",
    },
    { texto: "" },
    { texto: "Cómo responder", estilo: "seccion" },
    { texto: "1. En «Decisión del colegio» elija Aprobado o Corregir." },
    { texto: "2. Si elige Corregir, o si el texto está entre corchetes, escriba el texto completo en «Texto corregido o comentario»." },
    { texto: "3. Si el colegio debe entregar un archivo (logo, firma de la Directora), la fila lo dice en «Qué se pide»: entréguelo aparte y anote en la fila que lo entregó." },
    { texto: "4. Al terminar, complete la hoja «Aprobación» y devuelva este mismo archivo. El equipo incorpora cada texto al sistema y conserva este archivo como constancia." },
    { texto: "" },
    { texto: "Revisión legal de la política de privacidad", estilo: "seccion" },
    {
      texto:
        "La política de privacidad (fila PRI-01) debe ser revisada por el abogado del colegio, conforme a la Ley N.° 29733 (Ley de Protección de Datos Personales), antes de aprobarla. " +
        "Los consentimientos que una familia acepte con un texto provisional no valen como evidencia.",
      estilo: "destacado",
    },
    { texto: "" },
    { texto: "Qué más incluye", estilo: "seccion" },
    { texto: "Hoja «Campaña»: los grados, las vacantes, las cuotas y los requisitos con los que se abrirá la campaña. El colegio la revisa, completa lo que falta y la firma." },
    { texto: "Hoja «Aprobación»: nombre, firma y fecha de quien aprueba los textos y del abogado que revisa la política." },
    { texto: "Archivo aparte: ejemplo de la Carta de Vacante (PDF), con datos ficticios, para ver cómo queda el documento que recibe la familia." },
    { texto: "" },
    { texto: "Qué pasa si un texto cambia", estilo: "seccion" },
    { texto: "Este documento lo genera el sistema con los textos reales del código. Si un texto cambia, se genera una versión nueva con otra fecha y otra huella: lo aprobado en una versión no vale para la siguiente sin volver a revisarlo." },
  ];
  lineas.forEach(({ texto: contenido, estilo }) => {
    const fila = hoja.addRow([contenido]);
    const celda = fila.getCell(1);
    celda.alignment = { wrapText: true, vertical: "top" };
    if (estilo === "titulo") celda.font = { bold: true, size: 16, color: { argb: AZUL } };
    if (estilo === "seccion") celda.font = { bold: true, size: 12, color: { argb: AZUL } };
    if (estilo === "destacado") {
      celda.font = { bold: true, color: { argb: "FF9C0006" } };
      celda.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFDE9E7" } };
    }
  });
  pie(hoja, meta);
}

function hojaTextos(libro: ExcelJS.Workbook, catalogo: Texto[], meta: Meta): void {
  const hoja = libro.addWorksheet(HOJAS.textos);
  hoja.columns = [
    { header: "N.º", key: "id", width: 9 },
    { header: "Grupo", key: "grupo", width: 20 },
    { header: "Dónde se ve y quién lo recibe", key: "donde", width: 42 },
    { header: "Qué se pide", key: "pide", width: 28 },
    { header: "Texto actual", key: "texto", width: 80 },
    { header: "¿Bloquea abrir a las familias?", key: "bloquea", width: 15 },
    { header: "Decisión del colegio", key: "decision", width: 16 },
    { header: "Texto corregido o comentario", key: "correccion", width: 60 },
    { header: "Nota", key: "nota", width: 46 },
    { header: "Ref. del equipo", key: "ref", width: 18 },
  ];
  encabezado(hoja.getRow(1));
  const ordenGrupo: string[] = Object.values(GRUPOS);
  const ordenado = [...catalogo].sort((a, b) => ordenGrupo.indexOf(a.grupo) - ordenGrupo.indexOf(b.grupo));
  ordenado.forEach((t) => {
    const fila = hoja.addRow({
      id: t.id,
      grupo: t.grupo,
      donde: `${t.donde}\nLo recibe o lo ve: ${t.quien}`,
      pide: t.pide,
      texto: t.texto,
      bloquea: t.familia ? "Sí" : "No",
      decision: null,
      correccion: null,
      nota: t.nota ?? null,
      ref: t.ref,
    });
    fila.eachCell({ includeEmpty: true }, (celda) => {
      celda.alignment = { wrapText: true, vertical: "top" };
      celda.border = BORDE;
    });
    fila.getCell("id").font = { bold: true };
    fila.getCell("bloquea").alignment = { horizontal: "center", vertical: "top" };
    if (t.familia) fila.getCell("bloquea").font = { bold: true };
    if (/\[[^\]]+\]/.test(t.texto)) fila.getCell("texto").fill = { type: "pattern", pattern: "solid", fgColor: { argb: NARANJA } };
    for (const clave of ["decision", "correccion"]) fila.getCell(clave).fill = { type: "pattern", pattern: "solid", fgColor: { argb: AMARILLO } };
    fila.getCell("decision").alignment = { horizontal: "center", vertical: "top" };
    fila.getCell("decision").dataValidation = {
      type: "list",
      allowBlank: true,
      formulae: [`"${OPCIONES_DECISION.join(",")}"`],
      showErrorMessage: true,
      errorTitle: "Decisión del colegio",
      error: `Elija ${OPCIONES_DECISION.join(" o ")}.`,
    };
    if (t.nota?.startsWith("REVISIÓN LEGAL")) fila.getCell("nota").font = { bold: true, color: { argb: "FF9C0006" } };
  });
  hoja.views = [{ state: "frozen", xSplit: 1, ySplit: 1 }];
  hoja.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: 10 } };
  hoja.pageSetup = { paperSize: 9, orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0, printTitlesRow: "1:1" };
  pie(hoja, meta);
}

function bloqueDeFirma(hoja: ExcelJS.Worksheet, titulo: string, nombres: string[]): void {
  const cabecera = hoja.addRow([titulo]);
  cabecera.getCell(1).font = { bold: true, size: 12, color: { argb: AZUL } };
  for (const nombre of nombres) {
    const fila = hoja.addRow([nombre, ""]);
    fila.getCell(1).font = { bold: true };
    fila.getCell(1).border = BORDE;
    fila.getCell(2).border = BORDE;
    fila.height = 30;
  }
  hoja.addRow([]);
}

function hojaCampana(libro: ExcelJS.Workbook, campana: CampanaVista, meta: Meta): void {
  const hoja = libro.addWorksheet(HOJAS.campana);
  hoja.columns = [
    { width: 24 },
    { width: 34 },
    { width: 18 },
    { width: 22 },
    { width: 20 },
    { width: 20 },
    { width: 20 },
    { width: 20 },
    { width: 22 },
  ];
  const titulo = hoja.addRow([`Campaña de admisión ${campana.campana}: grados, vacantes, cuotas y requisitos`]);
  titulo.getCell(1).font = { bold: true, size: 14, color: { argb: AZUL } };
  hoja.addRow([`Archivo: ${campana.archivo} · huella SHA-256: ${campana.sha256.slice(0, 16)}`]);
  hoja.addRow([campana.completa ? "Estado: completa." : "Estado: PLANTILLA SIN COMPLETAR. Las celdas amarillas «Por completar» las debe entregar el colegio."]).getCell(1).font = {
    bold: true,
    color: { argb: campana.completa ? "FF006100" : "FF9C0006" },
  };
  hoja.addRow(["El colegio revisa esta hoja y la firma. Después de la firma no se cambia ni una coma sin repetir la simulación de la carga. Lo que se carga es exactamente lo que dice el archivo indicado arriba."]);
  hoja.addRow([]);

  const marcar = (fila: ExcelJS.Row) =>
    fila.eachCell({ includeEmpty: true }, (celda) => {
      celda.border = BORDE;
      celda.alignment = { wrapText: true, vertical: "top" };
      if (celda.value === POR_COMPLETAR) celda.fill = { type: "pattern", pattern: "solid", fgColor: { argb: AMARILLO } };
    });

  encabezado(
    hoja.addRow(["Nivel", "Grado", "Vacantes autorizadas", "Cuota de ingreso (S/)", "Máx. de fracciones del pago", "Jornada de observación", "Evaluación psicológica", "Evaluación académica", "Requisitos propios del grado"]),
  );
  for (const g of campana.grados) {
    marcar(hoja.addRow([g.nivel, g.grado, g.vacantes, g.cuota, g.fracciones, g.jornada, g.psicologica, g.academica, g.propios]));
  }
  hoja.addRow([]);

  const subtitulo = hoja.addRow(["Requisitos documentales"]);
  subtitulo.getCell(1).font = { bold: true, size: 12, color: { argb: AZUL } };
  encabezado(hoja.addRow(["Aplica a", "Documento", "Categoría", "Condición", "Obligatorio", "Por apoderado"]));
  if (campana.requisitos.length === 0) {
    marcar(hoja.addRow([POR_COMPLETAR, "El colegio debe indicar los documentos que exige a cada grado", POR_COMPLETAR, POR_COMPLETAR, POR_COMPLETAR, POR_COMPLETAR]));
  }
  for (const r of campana.requisitos) marcar(hoja.addRow([r.aplicaA, r.documento, r.categoria, r.condicion, r.obligatorio, r.porApoderado]));
  hoja.addRow([]);
  bloqueDeFirma(hoja, "Conformidad del colegio con esta campaña", ["Nombre y cargo", "Firma", "Fecha"]);
  hoja.pageSetup = { paperSize: 9, orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0 };
  pie(hoja, meta);
}

function hojaAprobacion(libro: ExcelJS.Workbook, meta: Meta, huella: string): void {
  const hoja = libro.addWorksheet(HOJAS.aprobacion);
  hoja.getColumn(1).width = 46;
  hoja.getColumn(2).width = 70;
  hoja.addRow(["Aprobación de los textos"]).getCell(1).font = { bold: true, size: 14, color: { argb: AZUL } };
  hoja.addRow([`Versión ${meta.version} · ${meta.generado} · huella del contenido ${huella}`]);
  hoja.addRow(["Los textos marcados «Aprobado» en la hoja Textos pueden enviarse a las familias del Colegio Internacional de Lima tal como están. Los marcados «Corregir» se incorporan con el texto que el colegio escribió."]).getCell(1).alignment = {
    wrapText: true,
  };
  hoja.mergeCells("A3:B3");
  hoja.getRow(3).height = 48;
  hoja.addRow([]);
  bloqueDeFirma(hoja, "Quien aprueba por el colegio", ["Nombre y cargo", "Firma", "Fecha"]);
  bloqueDeFirma(hoja, "Revisión legal de la política de privacidad (Ley N.° 29733)", ["Nombre del abogado", "Firma", "Fecha"]);
  pie(hoja, meta);
}

export async function construirLibro(catalogo: Texto[], campana: CampanaVista, meta: Meta): Promise<Buffer> {
  const libro = new ExcelJS.Workbook();
  libro.creator = "Sistema de admisión del CIL";
  libro.title = `Textos para el colegio · versión ${meta.version}`;
  const huella = huellaDelContenido(catalogo);
  hojaInstrucciones(libro, catalogo, meta, huella);
  hojaTextos(libro, catalogo, meta);
  hojaCampana(libro, campana, meta);
  hojaAprobacion(libro, meta, huella);
  return Buffer.from(await libro.xlsx.writeBuffer());
}
