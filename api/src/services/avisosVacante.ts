// Textos de los avisos de la vacante y de la cuota de ingreso (HU0012 y HU0014; ADR-19). Lo que redacta el colegio va entre
// corchetes hasta que lo entregue, como los avisos de la visita (C39). Los arma la API porque notificacion-multicanal no
// redacta mensajes. Ninguno lleva datos del dictamen ni del menor: el cuerpo queda en las ejecuciones de error de n8n
// (C11). El de Tesorería lleva solo el código del expediente y el enlace a G05. Texto plano.
import { obtenerConfig } from "../config";

export const AVISOS_VACANTE = {
  version: "borrador-1",
  vacante: "[Aviso de vacante otorgada: por definir con el colegio]",
  listaEspera: "[Aviso de lista de espera: por definir con el colegio]",
  cuotaPorConciliar: "[Aviso a Tesorería de un comprobante por conciliar: por definir con el colegio]",
  contacto: "[Datos de contacto de Admisión: por definir con el colegio]",
} as const;

const base = () => obtenerConfig().FRONTEND_PUBLIC_URL.replace(/\/+$/, "");
export const urlPagos = () => `${base()}/portal/pagos`;
export const urlTesoreria = () => `${base()}/gestion/tesoreria`;

const NIVEL_VISIBLE: Record<string, string> = { inicial: "Inicial", primaria: "Primaria", secundaria: "Secundaria" };
const soles = (monto: number) => `S/ ${monto.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// HU0012-1.0: la vacante, el monto de la cuota del nivel y las opciones de pago. Con cuota 0 (C25 punto 5) no hay nada que pagar.
export function componerVacante(d: {
  nombres: string;
  campana: string;
  grado: string;
  nivel: string;
  monto: number;
  maxFracciones: number;
}): { asunto: string; cuerpo: string } {
  const pago =
    d.monto > 0
      ? [
          `Cuota de ingreso de ${NIVEL_VISIBLE[d.nivel] ?? d.nivel}: ${soles(d.monto)}.`,
          "Opciones de pago:",
          "- Pago único",
          ...(d.maxFracciones > 1 ? [`- Pago fraccionado, hasta ${d.maxFracciones} fracciones`] : []),
          "",
          `Elige la modalidad y registra tu comprobante en el portal: ${urlPagos()}`,
        ]
      : ["Este grado no tiene cuota de ingreso."];
  return {
    asunto: `Vacante otorgada · Admisión ${d.campana}`,
    cuerpo: [`Hola, ${d.nombres}:`, "", AVISOS_VACANTE.vacante, "", `Se otorgó la vacante en ${d.grado}.`, ...pago, "", AVISOS_VACANTE.contacto].join("\n"),
  };
}

// HU0012-2.0: el grado no tiene vacantes; la familia queda en la lista de espera con su posición.
export function componerListaEspera(d: { nombres: string; campana: string; grado: string; posicion: number }): { asunto: string; cuerpo: string } {
  return {
    asunto: `Lista de espera · Admisión ${d.campana}`,
    cuerpo: [
      `Hola, ${d.nombres}:`,
      "",
      AVISOS_VACANTE.listaEspera,
      "",
      `${d.grado} no tiene vacantes disponibles por ahora. Tu postulante quedó en la lista de espera del grado, en la posición ${d.posicion}.`,
      "",
      AVISOS_VACANTE.contacto,
    ].join("\n"),
  };
}

// HU0014-1.0: a Tesorería. Solo el código del expediente y el enlace a G05.
export function componerCuotaPorConciliar(d: { codigo: string; campana: string }): { asunto: string; cuerpo: string } {
  return {
    asunto: `Cuota de ingreso por conciliar: ${d.codigo}`,
    cuerpo: [
      AVISOS_VACANTE.cuotaPorConciliar,
      "",
      `Expediente: ${d.codigo}`,
      `Concilia el comprobante en la pestaña «Cuota de ingreso»: ${urlTesoreria()}`,
      "",
      `Admisión ${d.campana}`,
    ].join("\n"),
  };
}
