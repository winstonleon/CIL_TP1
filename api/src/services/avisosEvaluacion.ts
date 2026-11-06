// Textos de los avisos de las evaluaciones (HU0009; ADR-19): habilitación del agendamiento (C52), confirmación con las
// pautas previas (HU0009-1.0) y confirmación actualizada de una reprogramación a la familia y al responsable
// (HU0009-2.0). Bloque 7 (ADR-25): inasistencia a la evaluación académica (HU0025-2.0), dictamen En observación al buzón
// de admisión (HU0010-2.0) y dictamen No apto a la familia (HU0010-3.0). NINGUNO lleva conclusiones, observaciones,
// requisitos complementarios ni el informe psicológico: el cuerpo queda en las ejecuciones de error de n8n (C11). Lo que redacta el colegio va entre corchetes hasta que lo entregue, como los avisos de la visita (C39).
// Los arma la API porque notificacion-multicanal no redacta mensajes. El aviso al personal lleva solo el código del
// expediente, el tipo y las fechas: ningún dato del menor ni de la familia (C11). Texto plano.
import { obtenerConfig } from "../config";
import type { TipoEvaluacion } from "../repositories/evaluaciones";
import { fechaLarga, horaVisible, lugarDeLaVisita } from "./avisosVisita";

export const AVISOS_EVALUACION = {
  version: "borrador-1",
  habilitacion: "[Aviso de habilitación del agendamiento de evaluaciones: por definir con el colegio]",
  confirmacion: "[Confirmación de las citas de evaluación: por definir con el colegio]",
  reprogramacion: "[Confirmación de la cita reprogramada: por definir con el colegio]",
  responsable: "[Aviso al responsable de una cita reprogramada: por definir con el colegio]",
  liberacion: "[Aviso al responsable de un turno liberado: por definir con el colegio]",
  contacto: "[Datos de contacto de Admisión: por definir con el colegio]",
  inasistencia: "[Aviso de inasistencia a la evaluación académica: por definir con el colegio]",
  observacion: "[Aviso al personal de admisión de un dictamen En observación: por definir con el colegio]",
  noApto: "[Comunicación del resultado del proceso de admisión: por definir con el colegio]",
  // Pautas previas de cada evaluación (HU0009-1.0: «la confirmación con las pautas previas»), por entregar.
  pautas: {
    jornada_observacion: "[Pautas previas de la jornada de observación: por definir con el colegio]",
    evaluacion_psicologica: "[Pautas previas de la evaluación psicológica: por definir con el colegio]",
    evaluacion_academica: "[Pautas previas de la evaluación académica: por definir con el colegio]",
    entrevista_padres: "[Pautas previas de la entrevista a los padres: por definir con el colegio]",
  } satisfies Record<TipoEvaluacion, string>,
} as const;

// Nombres de P08.
export const NOMBRE_EVALUACION: Record<TipoEvaluacion, string> = {
  jornada_observacion: "Jornada de observación",
  evaluacion_academica: "Evaluación académica",
  evaluacion_psicologica: "Evaluación psicológica",
  entrevista_padres: "Entrevista a los padres",
};

export interface CitaDelAviso {
  tipo_cita: TipoEvaluacion;
  fecha: string;
  hora_inicio: string;
}

// Enlace a P08 (cliente portal-familias): la pantalla inicia sesión en Keycloak (decisión R1).
export function urlEvaluaciones(): string {
  return `${obtenerConfig().FRONTEND_PUBLIC_URL.replace(/\/+$/, "")}/portal/evaluaciones`;
}

const cuando = (c: { fecha: string; hora_inicio: string }) => `${fechaLarga(c.fecha)} · ${horaVisible(c.hora_inicio)}`;

function agenda(citas: CitaDelAviso[]): string[] {
  return citas.flatMap((c) => [`- ${NOMBRE_EVALUACION[c.tipo_cita]}: ${cuando(c)}`, `  ${AVISOS_EVALUACION.pautas[c.tipo_cita]}`]);
}

function pie(): string[] {
  const horas = obtenerConfig().REPROGRAMACION_MIN_HORAS;
  return [
    `Lugar: ${lugarDeLaVisita()}`,
    "",
    `Puedes reprogramar cada cita hasta ${horas} horas antes en el portal: ${urlEvaluaciones()}`,
    "",
    AVISOS_EVALUACION.contacto,
  ];
}

// C52: las tres validaciones quedaron conformes; la familia ya puede agendar en P08.
export function componerHabilitacion(d: { nombres: string; campana: string }): { asunto: string; cuerpo: string } {
  return {
    asunto: `Ya puedes agendar tus evaluaciones · Admisión ${d.campana}`,
    cuerpo: [
      `Hola, ${d.nombres}:`,
      "",
      AVISOS_EVALUACION.habilitacion,
      "",
      "Documentos, derecho de admisión y documentación financiera validados: ya puedes agendar.",
      `Elige tus turnos en el portal: ${urlEvaluaciones()}`,
      "",
      AVISOS_EVALUACION.contacto,
    ].join("\n"),
  };
}

// HU0009-1.0: confirmación de las citas con las pautas previas.
export function componerConfirmacionEvaluaciones(d: { nombres: string; campana: string; citas: CitaDelAviso[] }): { asunto: string; cuerpo: string } {
  return {
    asunto: `Citas de evaluación confirmadas · Admisión ${d.campana}`,
    cuerpo: [`Hola, ${d.nombres}:`, "", AVISOS_EVALUACION.confirmacion, "", "Tus citas:", ...agenda(d.citas), "", ...pie()].join("\n"),
  };
}

// HU0009-2.0: confirmación actualizada a la familia, con la agenda vigente completa.
export function componerReprogramacionFamilia(d: {
  nombres: string;
  campana: string;
  reprogramada: CitaDelAviso & { anterior: { fecha: string; hora_inicio: string } };
  citas: CitaDelAviso[];
}): { asunto: string; cuerpo: string } {
  const r = d.reprogramada;
  return {
    asunto: `Cita reprogramada · Admisión ${d.campana}`,
    cuerpo: [
      `Hola, ${d.nombres}:`,
      "",
      AVISOS_EVALUACION.reprogramacion,
      "",
      `${NOMBRE_EVALUACION[r.tipo_cita]}: pasó del ${cuando(r.anterior)} al ${cuando(r)}.`,
      "",
      "Tus citas actualizadas:",
      ...agenda(d.citas),
      "",
      ...pie(),
    ].join("\n"),
  };
}

// HU0009-2.0: al responsable de la cita nueva (o al de la anterior, si es otra persona: decisión R3).
export function componerAvisoResponsable(d: {
  liberacion: boolean;
  codigo: string;
  campana: string;
  tipo_cita: TipoEvaluacion;
  anterior: { fecha: string; hora_inicio: string };
  nueva: { fecha: string; hora_inicio: string };
}): { asunto: string; cuerpo: string } {
  const nombre = NOMBRE_EVALUACION[d.tipo_cita];
  return {
    asunto: `${d.liberacion ? "Turno liberado" : "Cita reprogramada"}: ${nombre} · ${d.codigo}`,
    cuerpo: [
      d.liberacion ? AVISOS_EVALUACION.liberacion : AVISOS_EVALUACION.responsable,
      "",
      `Expediente: ${d.codigo}`,
      `Evaluación: ${nombre}`,
      d.liberacion ? `Turno liberado: ${cuando(d.anterior)}` : `Antes: ${cuando(d.anterior)}`,
      d.liberacion ? `La cita pasó a otro responsable (${cuando(d.nueva)}).` : `Ahora: ${cuando(d.nueva)}`,
      "",
      `Admisión ${d.campana}`,
    ].join("\n"),
  };
}

// Enlace al detalle del expediente de Secretaría (G03, cliente gestion-interna), donde lee los requisitos complementarios.
export function urlDetalleSecretaria(idExpediente: number): string {
  return `${obtenerConfig().FRONTEND_PUBLIC_URL.replace(/\/+$/, "")}/gestion/bandeja/${idExpediente}`;
}

// HU0025-2.0: el postulante no se presentó a la evaluación académica; la familia la reprograma en P08 (D2-A).
export function componerInasistencia(d: { nombres: string; campana: string; cita: CitaDelAviso }): { asunto: string; cuerpo: string } {
  return {
    asunto: `Reprograma la ${NOMBRE_EVALUACION[d.cita.tipo_cita].toLowerCase()} · Admisión ${d.campana}`,
    cuerpo: [
      `Hola, ${d.nombres}:`,
      "",
      AVISOS_EVALUACION.inasistencia,
      "",
      `No registramos la asistencia a la ${NOMBRE_EVALUACION[d.cita.tipo_cita].toLowerCase()} del ${cuando(d.cita)}.`,
      `Elige un nuevo horario en el portal: ${urlEvaluaciones()}`,
      "",
      AVISOS_EVALUACION.contacto,
    ].join("\n"),
  };
}

// HU0010-2.0: al buzón de admisión. Solo el código del expediente y el enlace a G03: los requisitos complementarios se leen
// en el sistema, nunca en el correo (C11).
export function componerObservacionAdmision(d: { codigo: string; campana: string; idExpediente: number }): { asunto: string; cuerpo: string } {
  return {
    asunto: `Dictamen en observación: ${d.codigo}`,
    cuerpo: [
      AVISOS_EVALUACION.observacion,
      "",
      `Expediente: ${d.codigo}`,
      "La psicóloga registró un dictamen En observación con requisitos complementarios.",
      `Coordina los requisitos con la familia antes del nuevo dictamen. Ver el detalle: ${urlDetalleSecretaria(d.idExpediente)}`,
      "",
      `Admisión ${d.campana}`,
    ].join("\n"),
  };
}

// HU0010-3.0: a la familia, sin el contenido del informe psicológico.
export function componerNoApto(d: { nombres: string; campana: string }): { asunto: string; cuerpo: string } {
  return {
    asunto: `Resultado del proceso de admisión · Admisión ${d.campana}`,
    cuerpo: [
      `Hola, ${d.nombres}:`,
      "",
      AVISOS_EVALUACION.noApto,
      "",
      "El proceso de admisión de tu postulante concluyó y no continuará a la etapa de asignación de vacantes.",
      "",
      AVISOS_EVALUACION.contacto,
    ].join("\n"),
  };
}
