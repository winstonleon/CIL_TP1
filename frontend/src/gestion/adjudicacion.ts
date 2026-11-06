// Lógica de G07 (HU0012). La acción de cada fila depende del cupo del grado, pero el resultado lo decide la API con el
// grado bloqueado (R14): si otra adjudicación tomó el último cupo, «Aprobar y asignar vacante» termina en lista de espera
// y la pantalla debe decirlo con la posición, no suponer lo que ofrecía el botón.
import type { AptoPorDecidir, GradoInventario, ResultadoAdjudicacion } from "../api/adjudicacion";
import { nombreCompleto } from "./validacion";

export const NIVELES = [
  { valor: "inicial", texto: "Inicial" },
  { valor: "primaria", texto: "Primaria" },
  { valor: "secundaria", texto: "Secundaria" },
] as const;

export const accionDe = (p: Pick<AptoPorDecidir, "sin_vacantes">) => (p.sin_vacantes ? "Lista de espera" : "Aprobar y asignar vacante");

export const gradosDelNivel = (inventario: GradoInventario[], nivel: string) => inventario.filter((g) => g.nivel === nivel);

// Grados con un postulante por decidir y sin vacantes (el aviso de G07), sin repetir.
export const gradosSinVacantes = (pendientes: AptoPorDecidir[]) => [...new Set(pendientes.filter((p) => p.sin_vacantes).map((p) => p.grado))];

export function mensajeResultado(r: ResultadoAdjudicacion, p: Pick<AptoPorDecidir, "postulante" | "codigo" | "grado">): { texto: string; tono: "conforme" | "observado" } {
  const quien = `${nombreCompleto(p.postulante) || "El postulante"} (${p.codigo})`;
  if (r.resultado === "vacante_asignada") {
    return { texto: `Vacante asignada a ${quien}. La familia recibirá el aviso con la cuota de ingreso.`, tono: "conforme" };
  }
  return {
    texto: `La vacante no se asignó: ${p.grado} no tiene vacantes disponibles. ${quien} quedó en la lista de espera, en la posición ${r.posicion}.`,
    tono: "observado",
  };
}
