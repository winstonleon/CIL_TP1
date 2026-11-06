// Etiquetas y formatos de G02, G03 y G05 (validaciones en paralelo: HU0008, HU0011 y HU0024). Los textos de los estados
// son los de los mockups (rules/frontend.md): «Completo · en revisión», «Subsanado», «Por revisar», «Por validar»,
// «Conforme», «Observado». Un ítem que volvió a pendiente tras una subsanación muestra su motivo como «motivo anterior»,
// nunca como observación vigente (pedido de John, tramo 2).
import type { EstadoRevision, FilaBandeja, ItemTesoreria, Persona } from "../api/validaciones";
import { horaVisible } from "../portal/calendarioVisita";

export type Tono = "revision" | "conforme" | "observado" | "subsanado";
export interface Etiqueta {
  texto: string;
  tono: Tono;
}

// Texto de ayuda del motivo (G03 y G05): el motivo viaja en el correo y queda en las ejecuciones de error de n8n (C11).
export const AYUDA_MOTIVO = "Describe el problema del documento; no copies su contenido";
export const LARGO_MAXIMO_MOTIVO = 500;

export const nombreCompleto = (p: Persona) => [p.nombres, p.apellidos].filter(Boolean).join(" ");

// «María Fernanda Quispe Rojas» → «María F. Quispe» (columna «Postulante» de G02: «Apod.: María F. Quispe»).
export function nombreAbreviado(p: Persona): string {
  const [primero, ...otros] = (p.nombres ?? "").split(/\s+/).filter(Boolean);
  const inicial = otros.length ? ` ${otros[0]![0]}.` : "";
  const apellido = (p.apellidos ?? "").split(/\s+/).filter(Boolean)[0] ?? "";
  return [primero ? `${primero}${inicial}` : "", apellido].filter(Boolean).join(" ");
}

export function etiquetaDocumento(estado: EstadoRevision): Etiqueta {
  if (estado === "conforme") return { texto: "Conforme", tono: "conforme" };
  if (estado === "observado") return { texto: "Observado", tono: "observado" };
  if (estado === "en_revision") return { texto: "En revisión", tono: "revision" };
  return { texto: "Por revisar", tono: "revision" };
}

// Columna «Estado» de G02 (rama documental de un expediente ya verificado como completo).
export function etiquetaBandeja(f: Pick<FilaBandeja, "estado_documental" | "subsanado">): Etiqueta {
  if (f.estado_documental === "conforme") return { texto: "Conforme", tono: "conforme" };
  if (f.estado_documental === "observado") return { texto: "Observado", tono: "observado" };
  return f.subsanado ? { texto: "Subsanado", tono: "subsanado" } : { texto: "Completo · en revisión", tono: "revision" };
}

// Chips del encabezado de G03 con el estado de cada rama.
export function chipsRamas(r: { documental: EstadoRevision; financiera: EstadoRevision; derecho: EstadoRevision | null }): Etiqueta[] {
  const de = (estado: EstadoRevision | null, textos: Record<"pendiente" | "conforme" | "observado", string>): Etiqueta =>
    estado === "conforme"
      ? { texto: textos.conforme, tono: "conforme" }
      : estado === "observado"
        ? { texto: textos.observado, tono: "observado" }
        : { texto: textos.pendiente, tono: "revision" };
  return [
    de(r.documental, { pendiente: "Documentos: en revisión", conforme: "Documentos: conformes", observado: "Documentos: observados" }),
    de(r.derecho, { pendiente: "Derecho de admisión: por validar", conforme: "Derecho de admisión: validado", observado: "Derecho de admisión: observado" }),
    de(r.financiera, { pendiente: "Doc. financiera: en revisión", conforme: "Doc. financiera: conforme", observado: "Doc. financiera: observada" }),
  ];
}

export function conceptoTesoreria(i: Pick<ItemTesoreria, "concepto" | "monto" | "modalidad" | "numero_fraccion">): string {
  if (i.concepto === "cuota_ingreso") {
    if (i.modalidad === "fraccionado") return `Cuota de ingreso · ${i.numero_fraccion ?? 1}.ª fracción`;
    return `Cuota de ingreso · pago único S/ ${(i.monto ?? 0).toLocaleString("en-US")}`;
  }
  return i.concepto === "derecho_admision" ? `Derecho de admisión · S/ ${i.monto ?? ""}` : "Documentación financiera";
}

export function etiquetaTesoreria(i: Pick<ItemTesoreria, "concepto" | "estado" | "subsanado">): Etiqueta {
  if (i.estado === "observado") return { texto: "Observado", tono: "observado" };
  if (i.subsanado) return { texto: "Subsanado", tono: "subsanado" };
  const textos = { derecho_admision: "Por validar", cuota_ingreso: "Por conciliar", documentacion_financiera: "Por revisar" };
  return { texto: textos[i.concepto], tono: "revision" };
}

// Fechas relativas de G02 y G05 en la hora de Lima: «Hoy, 9:12 a. m.», «Ayer», «Hace 3 días».
const ZONA = "America/Lima";
const diaLima = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: ZONA }).format(d);
const horaLima = new Intl.DateTimeFormat("en-GB", { timeZone: ZONA, hour: "2-digit", minute: "2-digit", hour12: false });
const DIA_MS = 24 * 3600 * 1000;
const diasEntre = (a: Date, b: Date) => Math.round((Date.parse(diaLima(b)) - Date.parse(diaLima(a))) / DIA_MS);

export function fechaRelativa(iso: string | null, ahora = new Date()): string {
  if (!iso) return "—";
  const fecha = new Date(iso);
  const dias = diasEntre(fecha, ahora);
  if (dias <= 0) return `Hoy, ${horaVisible(horaLima.format(fecha))}`;
  if (dias === 1) return "Ayer";
  return `Hace ${dias} días`;
}

// Columna «En proceso» de G02: días desde que el expediente pasó a validación.
export function diasEnProceso(desde: string | null, ahora = new Date()): string {
  if (!desde) return "—";
  const dias = Math.max(0, diasEntre(new Date(desde), ahora));
  return dias === 1 ? "1 día" : `${dias} días`;
}

// El motivo de una observación: obligatorio y de hasta 500 caracteres (la API vuelve a validarlo).
export function errorMotivo(motivo: string): string {
  if (!motivo.trim()) return "Escribe el motivo de la observación.";
  if (motivo.trim().length > LARGO_MAXIMO_MOTIVO) return `El motivo admite hasta ${LARGO_MAXIMO_MOTIVO} caracteres.`;
  return "";
}

// Abre un archivo descargado con el token en una pestaña nueva. La ventana se abre en el gesto del clic: después de esperar
// la descarga, el navegador la bloquearía.
export async function abrirArchivo(descargar: () => Promise<Blob>): Promise<void> {
  const ventana = window.open("about:blank", "_blank");
  try {
    const url = URL.createObjectURL(await descargar());
    if (ventana) ventana.location.href = url;
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  } catch (e) {
    ventana?.close();
    throw e;
  }
}
