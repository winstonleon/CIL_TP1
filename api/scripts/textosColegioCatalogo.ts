// Catálogo de los textos que el colegio debe entregar o aprobar antes de abrir el sistema a las familias (C85). Es la fuente del
// documento que genera `npm run colegio:textos`.
// - Lo que sale del código se arma con las mismas constantes y funciones que usa el sistema (los correos se componen con sus
//   funciones, con datos ficticios), así que el documento no se desfasa de lo que la familia recibe.
// - Los textos de pantalla (Vue y tema de Keycloak) no se pueden importar: cada uno lleva el archivo y el fragmento donde vive, y la
//   prueba C85 (api/test/textosColegio.test.ts) falla si el fragmento ya no está.
// - Un texto entre corchetes nuevo en los servicios sin su fila aquí también hace fallar esa prueba.
import { obtenerConfig } from "../src/config";
import type { EventoHistorial } from "../src/repositories/auditoria";
import { AVISO_CARTA, componerCartaEmitida } from "../src/services/avisosCarta";
import { AVISO_COMPLETITUD, componerFaltantes } from "../src/services/avisosCompletitud";
import {
  AVISOS_EVALUACION,
  componerAvisoResponsable,
  componerConfirmacionEvaluaciones,
  componerHabilitacion,
  componerInasistencia,
  componerNoApto,
  componerObservacionAdmision,
  componerReprogramacionFamilia,
  type CitaDelAviso,
} from "../src/services/avisosEvaluacion";
import {
  ACCION_DE_ETAPA,
  AVISOS_SEGUIMIENTO,
  componerCaducidadAdmision,
  componerCaducidadFamilia,
  componerRecordatorioInactividad,
  ETAPA_VISIBLE,
} from "../src/services/avisosSeguimiento";
import { AVISOS_VACANTE, componerCuotaPorConciliar, componerListaEspera, componerVacante } from "../src/services/avisosVacante";
import { AVISO_VALIDACION, componerObservaciones } from "../src/services/avisosValidacion";
import { AVISOS_VISITA, componerConfirmacion, componerCredenciales, componerRecordatorio, componerReprogramacion, urlPortal } from "../src/services/avisosVisita";
import { CARPETA_INFORMATIVA, componerCarpeta } from "../src/services/carpetaInformativa";
import { PREGUNTAS } from "../src/services/cuestionarioExpectativas";
import { BANCOS, CUENTA_COLEGIO } from "../src/services/derechoAdmision";
import { DECISIONES, TRANSICIONES, textoDeEvento } from "../src/services/historialFamilia";
import { PLANTILLA_CARTA } from "../src/services/plantillaCarta";
import { POLITICA_PRIVACIDAD } from "../src/services/politicaPrivacidad";

// Sube cuando se envía al colegio una ronda nueva. La huella del contenido cambia sola con cualquier texto.
export const VERSION_DOCUMENTO = 1;

export interface Fuente {
  archivo: string; // desde la raíz del repositorio
  fragmento: string;
}

export interface Texto {
  id: string;
  grupo: string;
  donde: string;
  quien: string;
  texto: string;
  ref: string;
  familia: boolean; // lo lee o lo recibe la familia: bloquea abrir el sistema (C85)
  pide: string;
  nota?: string;
  fuentes?: Fuente[];
}

export const GRUPOS = {
  correos: "Correos a las familias",
  carta: "Carta de Vacante",
  datos: "Datos y textos del colegio",
  pantallas: "Pantallas de las familias",
  ingreso: "Ingreso al portal",
  plazos: "Plazos del seguimiento",
  personal: "Avisos al personal (no bloquean)",
} as const;

const FAMILIA = "La familia";
const FAMILIA_POR_CORREO = "La familia (correo del apoderado titular)";
const ADMISION = "Personal de Admisión (buzón de Admisión)";
const TESORERIA = "Tesorería (buzón de Tesorería)";
const RESPONSABLE = "Responsable de la evaluación (su correo)";
// Los avisos de documentos, observaciones, vacante y lista de espera no tienen compromiso propio: los cubre C85.
const SIN_COMPROMISO = "C85";

const REDACTAR = "Redactar lo que está entre corchetes y revisar el resto";
const REVISAR = "Revisar y aprobar";

type Datos = Omit<Texto, "pide"> & { pide?: string };
const fila = (d: Datos): Texto => ({ ...d, pide: d.pide ?? (/\[[^\]]+\]/.test(d.texto) ? REDACTAR : REVISAR) });

// ------------------------------------------------------------------ datos ficticios de los ejemplos

const CAMPANA = "2027";
const NOMBRE = "Ana";
const CODIGO = "ADM-2027-0001";
const ENLACE_VISITA = "https://admision.ejemplo.test/visita-guiada (enlace personal de la familia)";
const VISITA = { nombres: NOMBRE, campana: CAMPANA, fecha: "2027-03-10", hora: "10:00", asistentes: "Ana Ejemplo y Luis Ejemplo" };
const cita = (tipo_cita: CitaDelAviso["tipo_cita"], fecha: string, hora_inicio: string): CitaDelAviso => ({ tipo_cita, fecha, hora_inicio });
const JORNADA = cita("jornada_observacion", "2027-03-15", "09:00");
const PSICOLOGICA = cita("evaluacion_psicologica", "2027-03-16", "10:30");
const ACADEMICA = cita("evaluacion_academica", "2027-03-17", "09:00");
const ENTREVISTA = cita("entrevista_padres", "2027-03-18", "11:00");
const AGENDA = [JORNADA, PSICOLOGICA, ACADEMICA, ENTREVISTA];
const VENCE = new Date("2027-03-25T17:00:00Z");

// ------------------------------------------------------------------ correos

type Mensaje = { asunto: string; cuerpo: string };

function correo(
  id: string,
  grupo: string,
  ref: string,
  quien: string,
  donde: string,
  mensaje: Mensaje,
  { nota, familia = true }: { nota?: string; familia?: boolean } = {},
): Texto {
  return fila({
    id,
    grupo,
    donde,
    quien: quien === FAMILIA ? FAMILIA_POR_CORREO : quien,
    texto: `Asunto: ${mensaje.asunto}\n\n${mensaje.cuerpo}`,
    ref,
    familia,
    ...(nota ? { nota } : {}),
  });
}

function correosAFamilias(): Texto[] {
  const g = GRUPOS.correos;
  return [
    correo("COR-01", g, "C33", FAMILIA, "Correo que recibe quien pidió información en el formulario P01 (con la carpeta informativa)", componerCarpeta({
      nombres: NOMBRE,
      nombreGrado: "1.° de primaria",
      campana: CAMPANA,
      enlaceVisita: ENLACE_VISITA,
    }), { nota: "El enlace a la carpeta lo entrega el colegio (fila DAT-01)." }),
    correo("COR-02", g, "C39", FAMILIA, "Correo al reservar la visita guiada (P02)", componerConfirmacion(VISITA), {
      nota: "La fecha, la hora, el lugar y los asistentes los agrega el sistema.",
    }),
    correo("COR-03", g, "C39", FAMILIA, "Recordatorio un día antes de la visita guiada", componerRecordatorio(VISITA)),
    correo("COR-04", g, "C39", FAMILIA, "Correo a la familia que no asistió a la visita guiada: la invita a agendar otra", componerReprogramacion({
      nombres: NOMBRE,
      campana: CAMPANA,
      enlaceVisita: ENLACE_VISITA,
    })),
    correo("COR-05", g, "C39", FAMILIA, "Correo a la familia que asistió a la visita: le da su usuario y su contraseña temporal del portal", componerCredenciales({
      nombres: NOMBRE,
      campana: CAMPANA,
      usuario: "familia.ejemplo@ejemplo.test",
      contrasena: "(contraseña temporal que genera el sistema)",
      urlPortal: urlPortal(),
    }), { nota: "En el ejemplo, la contraseña es un texto de relleno: el sistema genera una distinta para cada familia." }),
    correo("COR-06", g, SIN_COMPROMISO, FAMILIA, "Correo cuando faltan documentos o el derecho de admisión para completar el expediente", componerFaltantes({
      nombres: NOMBRE,
      campana: CAMPANA,
      faltantes: [
        { tipo_documento: "DNI del postulante", parentesco: null },
        { tipo_documento: "Boletas de pago (últimos 3 meses)", parentesco: "madre" },
      ],
      faltaDerecho: true,
    })),
    correo("COR-07", g, SIN_COMPROMISO, FAMILIA, "Correo cuando Secretaría o Tesorería observan documentos o comprobantes", componerObservaciones({
      nombres: NOMBRE,
      campana: CAMPANA,
      documentos: [{ tipo_documento: "DNI del postulante", parentesco: null, motivo: "La imagen está borrosa y no se lee el número." }],
      derecho: "El número de operación no figura en el estado de cuenta.",
      cuota: null,
    }), { nota: "El motivo de cada observación lo escribe el personal." }),
    correo("COR-08", g, "C55", FAMILIA, "Correo que avisa que ya puede agendar las evaluaciones (documentos y pagos validados)", componerHabilitacion({ nombres: NOMBRE, campana: CAMPANA })),
    correo("COR-09", g, "C55", FAMILIA, "Correo al confirmar las citas de evaluación, con las pautas previas de cada una", componerConfirmacionEvaluaciones({
      nombres: NOMBRE,
      campana: CAMPANA,
      citas: AGENDA,
    }), { nota: "Según el grado, la familia recibe solo las evaluaciones que le corresponden." }),
    correo("COR-10", g, "C55", FAMILIA, "Correo cuando la familia reprograma una cita de evaluación", componerReprogramacionFamilia({
      nombres: NOMBRE,
      campana: CAMPANA,
      reprogramada: { ...PSICOLOGICA, fecha: "2027-03-19", hora_inicio: "08:30", anterior: { fecha: PSICOLOGICA.fecha, hora_inicio: PSICOLOGICA.hora_inicio } },
      citas: AGENDA,
    })),
    correo("COR-11", g, "C55", FAMILIA, "Correo cuando el postulante no asistió a la evaluación académica", componerInasistencia({ nombres: NOMBRE, campana: CAMPANA, cita: ACADEMICA })),
    correo("COR-12", g, "C55", FAMILIA, "Correo con el resultado cuando el postulante no continúa en el proceso", componerNoApto({ nombres: NOMBRE, campana: CAMPANA })),
    correo("COR-13", g, SIN_COMPROMISO, FAMILIA, "Correo cuando se otorga la vacante (con la cuota de ingreso y las opciones de pago)", componerVacante({
      nombres: NOMBRE,
      campana: CAMPANA,
      grado: "1.° de primaria",
      nivel: "primaria",
      monto: 7000,
      maxFracciones: 3,
    }), { nota: "El monto y las fracciones salen de la configuración de cada grado (hoja Campaña)." }),
    correo("COR-14", g, SIN_COMPROMISO, FAMILIA, "Correo cuando el grado no tiene vacantes y el postulante queda en la lista de espera", componerListaEspera({
      nombres: NOMBRE,
      campana: CAMPANA,
      grado: "1.° de primaria",
      posicion: 2,
    })),
    correo("COR-15", g, "C79", FAMILIA, "Recordatorio cuando la familia lleva días sin completar una acción", componerRecordatorioInactividad({
      nombres: NOMBRE,
      campana: CAMPANA,
      etapa: "postulacion",
      vence: VENCE,
    })),
    correo("COR-16", g, "C79", FAMILIA, "Correo cuando la postulación caduca por vencimiento del plazo", componerCaducidadFamilia({
      nombres: NOMBRE,
      campana: CAMPANA,
      etapa: "postulacion",
      vence: VENCE,
    })),
    correo("COR-17", g, "C75", FAMILIA, "Correo cuando se emite la Carta de Vacante (la familia la descarga en el portal)", componerCartaEmitida({ nombres: NOMBRE, campana: CAMPANA })),
  ];
}

function avisosAlPersonal(): Texto[] {
  const g = GRUPOS.personal;
  const nota = "Lo lee solo el personal del colegio: no bloquea abrir el sistema a las familias.";
  const opciones = { familia: false, nota };
  const reprogramada = { liberacion: false, codigo: CODIGO, campana: CAMPANA, tipo_cita: PSICOLOGICA.tipo_cita, anterior: { fecha: PSICOLOGICA.fecha, hora_inicio: PSICOLOGICA.hora_inicio }, nueva: { fecha: "2027-03-19", hora_inicio: "08:30" } };
  return [
    correo("PER-01", g, "C55", RESPONSABLE, "Aviso al responsable de una evaluación cuando la cita se reprograma con él", componerAvisoResponsable(reprogramada), opciones),
    correo("PER-02", g, "C55", RESPONSABLE, "Aviso al responsable anterior cuando su turno queda libre porque la cita pasó a otro", componerAvisoResponsable({ ...reprogramada, liberacion: true }), opciones),
    correo("PER-03", g, "C55", ADMISION, "Aviso a Admisión cuando la psicóloga registra un dictamen «En observación»", componerObservacionAdmision({ codigo: CODIGO, campana: CAMPANA, idExpediente: 1 }), opciones),
    correo("PER-04", g, SIN_COMPROMISO, TESORERIA, "Aviso a Tesorería cuando hay un comprobante de la cuota de ingreso por conciliar", componerCuotaPorConciliar({ codigo: CODIGO, campana: CAMPANA }), opciones),
    correo("PER-05", g, "C79", ADMISION, "Aviso a Admisión cuando un expediente caduca", componerCaducidadAdmision({ codigo: CODIGO, campana: CAMPANA, etapa: "postulacion" }), opciones),
  ];
}

// ------------------------------------------------------------------ carta, datos y política

function carta(): Texto[] {
  const g = GRUPOS.carta;
  const donde = "Carta de Vacante (PDF que la familia descarga del portal)";
  const ejemplo = "Ver el PDF de ejemplo que acompaña este documento.";
  return [
    fila({ id: "CAR-01", grupo: g, donde: `${donde} · destinatario`, quien: FAMILIA, texto: PLANTILLA_CARTA.destinatario, ref: "C75 a", familia: true, nota: ejemplo }),
    fila({ id: "CAR-02", grupo: g, donde: `${donde} · texto institucional`, quien: FAMILIA, texto: PLANTILLA_CARTA.textoInstitucional, ref: "C75 a", familia: true, nota: ejemplo }),
    fila({
      id: "CAR-03",
      grupo: g,
      donde: `${donde} · textos fijos`,
      quien: FAMILIA,
      texto: [
        `Encabezado: ${PLANTILLA_CARTA.colegio}`,
        `Título: ${PLANTILLA_CARTA.titulo}`,
        `Fecha: «${PLANTILLA_CARTA.ciudad}, <fecha de emisión>» y «N.° CARTA-<código del expediente>»`,
        "Datos del postulante: nombre, nivel, grado y campaña de admisión",
        `Pie de firma: nombre de la Directora y «${PLANTILLA_CARTA.cargo} · ${PLANTILLA_CARTA.colegio}»`,
      ].join("\n"),
      ref: "C75",
      familia: true,
      nota: ejemplo,
    }),
    fila({
      id: "CAR-04",
      grupo: g,
      donde: `${donde} · logo`,
      quien: FAMILIA,
      texto: "La carta de ejemplo no lleva logo.",
      ref: "C75 b",
      familia: true,
      pide: "Entregar el logo del colegio (archivo de imagen)",
    }),
    fila({
      id: "CAR-05",
      grupo: g,
      donde: `${donde} · firma de la Directora`,
      quien: FAMILIA,
      texto: "La carta de ejemplo lleva una firma ficticia. Sin la firma real cargada en el sistema no se emite ninguna carta.",
      ref: "C75 c",
      familia: true,
      pide: "Entregar la firma escaneada de la Directora (PNG o JPG, hasta 1 MB)",
    }),
    fila({
      id: "CAR-06",
      grupo: g,
      donde: `${donde} · datos del menor`,
      quien: FAMILIA,
      texto: "La carta no lleva el DNI del menor.",
      ref: "C75 d",
      familia: true,
      pide: "Confirmar si la carta debe llevar el DNI del menor (hoy no lo lleva)",
    }),
  ];
}

// Los ocho textos de contacto del código tienen que ser el mismo para presentarlos como una sola fila.
function textoDeContacto(): string {
  const contactos = [
    AVISOS_VISITA.contacto,
    AVISO_CARTA.contacto,
    AVISO_COMPLETITUD.contacto,
    AVISOS_EVALUACION.contacto,
    AVISOS_SEGUIMIENTO.contacto,
    AVISOS_VACANTE.contacto,
    AVISO_VALIDACION.contacto,
    CARPETA_INFORMATIVA.contacto,
  ];
  const [primero] = contactos;
  if (primero === undefined || contactos.some((c) => c !== primero)) {
    throw new Error("Los textos de contacto de Admisión de los avisos ya no son iguales: separa la fila DAT-03 por aviso");
  }
  return primero;
}

function datos(): Texto[] {
  const g = GRUPOS.datos;
  const filas: Texto[] = [
    fila({
      id: "PRI-01",
      grupo: g,
      donde: "P01 · Formulario de solicitud de información: la familia la lee y la acepta al enviarlo",
      quien: FAMILIA,
      texto: POLITICA_PRIVACIDAD.texto,
      ref: "C29",
      familia: true,
      pide: "Entregar el texto y su versión. El abogado del colegio debe revisarlo antes de aprobarlo",
      nota: "REVISIÓN LEGAL: el abogado del colegio debe revisar esta política conforme a la Ley N.° 29733 (Ley de Protección de Datos Personales). Los consentimientos registrados con el texto provisional no valen como evidencia en producción.",
    }),
    ...PREGUNTAS.map((p, i) =>
      fila({
        id: `CUE-0${i + 1}`,
        grupo: g,
        donde: `P05 · Ficha de inscripción, paso 4 · Cuestionario de expectativas (pregunta ${i + 1})`,
        quien: FAMILIA,
        texto: p.texto,
        ref: "C42",
        familia: true,
        pide: "Redactar la pregunta",
      }),
    ),
    fila({
      id: "DAT-01",
      grupo: g,
      donde: "Correo de la carpeta informativa (COR-01) · enlace a la carpeta digital del colegio",
      quien: FAMILIA,
      texto: CARPETA_INFORMATIVA.sinEnlace,
      ref: "C33",
      familia: true,
      pide: "Entregar el enlace de la carpeta informativa",
    }),
    fila({
      id: "DAT-02",
      grupo: g,
      donde: "«Lugar» de la visita guiada (P02, correos de la visita y de las evaluaciones) y encabezado de la Carta de Vacante",
      quien: FAMILIA,
      texto: AVISOS_VISITA.sinDireccion,
      ref: "C39 b",
      familia: true,
      pide: "Entregar la dirección del colegio, como debe verse",
    }),
    fila({
      id: "DAT-03",
      grupo: g,
      donde: "Al pie de los 17 correos a las familias de la hoja (COR-01 a COR-17): datos de contacto de Admisión",
      quien: FAMILIA,
      texto: textoDeContacto(),
      ref: "C85",
      familia: true,
      pide: "Redactar el bloque de contacto (teléfono, correo y horario de atención)",
      nota: "Es el mismo texto en todos los correos.",
    }),
    fila({
      id: "DAT-04",
      grupo: g,
      donde: "Portal de las familias (P04, P05 y P05b, «¿Necesitas ayuda?») y pantalla de ingreso (P03)",
      quien: FAMILIA,
      texto: "[Teléfono y correo de admisión]",
      ref: "C42",
      familia: true,
      pide: "Entregar el teléfono y el correo de Secretaría de Admisión",
      fuentes: [
        { archivo: "frontend/src/views/portal/LayoutPortal.vue", fragmento: "[Teléfono y correo de admisión]" },
        { archivo: "infra/keycloak/themes/cil/login/p03.ftl", fragmento: "[Teléfono y correo de admisión]" },
      ],
    }),
    fila({
      id: "PAG-01",
      grupo: g,
      donde: "P07b · Derecho de admisión: lista de bancos entre los que la familia elige para registrar su comprobante",
      quien: FAMILIA,
      texto: BANCOS.join("\n"),
      ref: "C48",
      familia: true,
      pide: "Entregar la lista de bancos admitidos",
    }),
    fila({
      id: "PAG-02",
      grupo: g,
      donde: "P07b y P07 · Banco y número de cuenta del colegio donde la familia deposita",
      quien: FAMILIA,
      texto: CUENTA_COLEGIO,
      ref: "C48",
      familia: true,
      pide: "Entregar el banco y el número de cuenta (derecho de admisión y cuota de ingreso)",
    }),
  ];
  return filas;
}

// ------------------------------------------------------------------ plazos

const PLAZO_DE_ETAPA = {
  postulacion: "PLAZO_POSTULACION_DIAS",
  subsanacion: "PLAZO_SUBSANACION_DIAS",
  agendamiento: "PLAZO_AGENDAMIENTO_DIAS",
  reprogramacion: "PLAZO_REPROGRAMACION_DIAS",
  cuota: "PLAZO_CUOTA_DIAS",
} as const;

function plazos(): Texto[] {
  const config = obtenerConfig();
  return Object.entries(PLAZO_DE_ETAPA).map(([etapa, variable], i) =>
    fila({
      id: `PLA-0${i + 1}`,
      grupo: GRUPOS.plazos,
      donde: `Plazo de la etapa «${ETAPA_VISIBLE[etapa as keyof typeof PLAZO_DE_ETAPA]}»: si vence sin completarla, la postulación caduca`,
      quien: FAMILIA,
      texto: `${config[variable]} días corridos (valor provisional)`,
      ref: "C79 (1)",
      familia: true,
      pide: "Confirmar o corregir el plazo, en días corridos",
      nota: `La acción que se le pide a la familia: ${ACCION_DE_ETAPA[etapa as keyof typeof PLAZO_DE_ETAPA]}.`,
    }),
  );
}

// ------------------------------------------------------------------ pantallas

const evento = (e: Partial<EventoHistorial>): EventoHistorial => ({
  tipo_evento: "",
  estado_nuevo: null,
  fecha_hora: new Date(0),
  campo: null,
  item: null,
  decision: null,
  resultado: null,
  documentos: null,
  tipo_pago: null,
  ...e,
});

// Historial de P04 (lista blanca, ADR-29): los textos salen de la misma función que arma el panel.
function historial(): Texto[] {
  const g = GRUPOS.pantallas;
  const accionesDeLaFamilia: [string, ...EventoHistorial[]][] = [
    ["documentos cargados", evento({ tipo_evento: "documentos_confirmados" }), evento({ tipo_evento: "documentos_confirmados", documentos: "3" })],
    ["expediente incompleto", evento({ tipo_evento: "completitud_verificada", resultado: "incompleto" })],
    ["subsanación de un comprobante", evento({ tipo_evento: "subsanacion_registrada", item: "pago" })],
    ["subsanación de un documento", evento({ tipo_evento: "subsanacion_registrada", item: "documento" })],
    ["cita reprogramada", evento({ tipo_evento: "cita_reprogramada" })],
    ["cuota registrada", evento({ tipo_evento: "cuota_registrada" })],
  ];
  const textos: { donde: string; texto: string; clave: string }[] = [
    ...Object.entries(TRANSICIONES).map(([estado, texto]) => ({ donde: "cambio de etapa del expediente", texto, clave: `estado ${estado}` })),
    ...Object.entries(DECISIONES).flatMap(([item, porDecision]) =>
      Object.entries(porDecision).map(([decision, texto]) => ({ donde: "resultado de una revisión", texto, clave: `${item} ${decision}` })),
    ),
    ...accionesDeLaFamilia.map(([clave, ...eventos]) => ({
      donde: "acción de la familia",
      clave,
      texto: eventos.map((e) => textoDeEvento(e) ?? "").join("\n"),
    })),
  ];
  return textos.map((t, i) =>
    fila({
      id: `HIS-${String(i + 1).padStart(2, "0")}`,
      grupo: g,
      donde: `P04 · Panel de seguimiento · Historial (${t.donde})`,
      quien: FAMILIA,
      texto: t.texto,
      ref: `C76 · ${t.clave}`,
      familia: true,
    }),
  );
}

const PORTAL = "frontend/src/views/portal";
const SERVICIOS = "api/src/services";

function pantalla(id: string, ref: string, donde: string, texto: string, archivo: string, fragmento: string = texto, pide?: string): Texto {
  return fila({ id, grupo: GRUPOS.pantallas, donde, quien: FAMILIA, texto, ref, familia: true, fuentes: [{ archivo, fragmento }], ...(pide ? { pide } : {}) });
}

// Textos de las pantallas de las familias que no están en los mockups (C39 c, C55, C65, C76).
function pantallas(): Texto[] {
  const visita = `${PORTAL}/VisitaGuiada.vue`;
  const evaluaciones = `${PORTAL}/EvaluacionesAgenda.vue`;
  const pagos = `${PORTAL}/PagosAdmision.vue`;
  const panel = `${PORTAL}/PanelSeguimiento.vue`;
  const accion = `${SERVICIOS}/panelSeguimiento.ts`;
  return [
    pantalla("PAN-01", "C39 c", "P02 · Agendar la visita guiada · mientras cargan los horarios", "Cargando los horarios…", visita),
    pantalla("PAN-02", "C39 c", "P02 · Agendar la visita guiada · no hay horarios", "Por ahora no hay horarios disponibles para la visita guiada.", visita),
    pantalla("PAN-03", "C55", "P08 · Evaluaciones · mientras cargan", "Cargando tus evaluaciones…", evaluaciones),
    pantalla("PAN-04", "C55", "P08 · Evaluaciones · no hay turnos para una evaluación", "Por ahora no hay turnos disponibles para esta evaluación.", evaluaciones),
    pantalla("PAN-05", "C55", "P08 · Evaluaciones · al confirmar las citas", "Citas confirmadas. Te enviamos la confirmación con las pautas previas por correo.", evaluaciones),
    pantalla("PAN-06", "C55", "P08 · Evaluaciones · al reprogramar una cita", "Cita reprogramada. Te enviamos la confirmación actualizada por correo.", evaluaciones),
    pantalla("PAN-07", "C55", "P08 · Evaluaciones · cita que ya no se puede reprogramar", "Ya no se puede reprogramar: faltan menos de 24 horas.", evaluaciones, "Ya no se puede reprogramar: faltan menos de"),
    pantalla("PAN-08", "C55", "P08 · Evaluaciones · etiqueta de una cita ya agendada", "Agendada", evaluaciones, ">Agendada<"),
    pantalla("PAN-09", "C55", "P08 · Evaluaciones · resumen de una evaluación sin turno elegido", "Sin elegir", "frontend/src/portal/agendaEvaluaciones.ts", '"Sin elegir"'),
    pantalla("PAN-10", "C55", "P08 · Evaluaciones · resumen de una evaluación sin cita", "Sin agendar", evaluaciones, "Sin agendar"),
    pantalla("PAN-11", "C55", "P08 · Evaluaciones · botón para cambiar una cita agendada", "Reprogramar", evaluaciones, '"Reprogramar"'),
    pantalla("PAN-12", "C55", "P08 · Evaluaciones · botón para confirmar el cambio", "Confirmar cambio", evaluaciones, ">Confirmar cambio<"),
    pantalla("PAN-13", "C55", "P08 · Evaluaciones · botón para dejar la reprogramación", "Cancelar", evaluaciones, ">Cancelar<"),
    pantalla("PAN-14", "C55", "P08 · Evaluaciones · quién conduce la jornada de observación", "A cargo de la Psicóloga", "frontend/src/portal/agendaEvaluaciones.ts", 'jornada_observacion: "A cargo de la Psicóloga"'),
    pantalla("PAN-15", "C55", "P08 · Evaluaciones · cita a la que el postulante no asistió", "No registramos tu asistencia a esta cita. Elige un nuevo horario.", evaluaciones),
    pantalla("PAN-16", "C65", "P07 · Pagos · antes de que se otorgue la vacante", "La cuota de ingreso se habilita cuando se te otorgue la vacante.", pagos),
    pantalla("PAN-17", "C65", "P07 · Pagos · grado sin cuota de ingreso", "Este grado no tiene cuota de ingreso.", pagos),
    pantalla("PAN-18", "C65", "P07 · Pagos · botón para cambiar la modalidad de pago", "Cambiar modalidad", pagos, ">Cambiar modalidad<"),
    pantalla("PAN-19", "C65", "P07 · Pagos · botón para corregir un comprobante observado", "Regularizar el pago", pagos, '"Regularizar el pago"'),
    fila({
      id: "PAN-20",
      grupo: GRUPOS.pantallas,
      donde: "P07 · Pagos · línea del mockup que hoy no se muestra",
      quien: FAMILIA,
      texto: "Pago único para alumnos ingresantes por primera vez · Inicial y Primaria",
      ref: "C65",
      familia: true,
      pide: "Decir si esta condición existe y si debe mostrarse (ninguna fuente la define)",
    }),
    pantalla("PAN-21", "C76", "P04 · Panel de seguimiento · mientras carga", "Cargando tu postulación…", panel),
    pantalla("PAN-22", "C76", "P04 · Panel de seguimiento · cuando no hay nada pendiente", "No tienes acciones pendientes.", panel),
    pantalla("PAN-23", "C76", "P04 · Panel de seguimiento · historial vacío", "Todavía no hay movimientos en tu expediente.", panel),
    pantalla("PAN-24", "C76", "P04 · Panel de seguimiento · aviso de la Carta de Vacante emitida", "Tu Carta de Vacante está emitida.", panel),
    pantalla("PAN-25", "C76", "P04 · Panel de seguimiento · botón de descarga de la carta", "Descargar Carta de Vacante", panel, ">Descargar Carta de Vacante<"),
    pantalla("PAN-26", "C76", "P04 · Panel de seguimiento · botón de una acción pendiente", "Continuar", panel, '"Continuar"'),
    pantalla("PAN-27", "C76", "P04 · Panel de seguimiento · motivo de una observación (el motivo lo escribe el personal)", "Motivo: …", panel, "Motivo: {{ a.motivo }}"),
    pantalla("PAN-28", "C76", "P04 · Panel de seguimiento · botón cuando falla la carga", "Reintentar", panel, ">Reintentar<"),
    pantalla("PAN-29", "C76", "P04 · Panel de seguimiento · cuando el postulante aún no tiene nombre", "tu postulante", panel, '"tu postulante"'),
    pantalla("PAN-30", "C79", "P04 · Panel de seguimiento · postulación caducada", "Tu postulación caducó el <fecha>.", panel, "Tu postulación caducó"),
    pantalla(
      "PAN-31",
      "C79",
      "P04 · Panel de seguimiento · postulación caducada (segunda línea)",
      "Venció el plazo para <acción>. Comunícate con Secretaría de Admisión · <contacto>",
      panel,
      "Venció el plazo para",
    ),
    pantalla("PAN-32", "C76", "P04 · Acciones pendientes · ficha sin completar", "Completa la ficha y el cuestionario", accion),
    pantalla("PAN-33", "C76", "P04 · Acciones pendientes · documentos sin cargar", "Carga y confirma tus documentos", accion),
    pantalla("PAN-34", "C76", "P04 · Acciones pendientes · derecho de admisión sin registrar", "Registra el comprobante del derecho de admisión", accion),
    pantalla("PAN-35", "C76", "P04 · Acciones pendientes · Secretaría observó un documento", "Secretaría observó un documento: <documento>", accion, "Secretaría observó un documento"),
    pantalla("PAN-36", "C76", "P04 · Acciones pendientes · Tesorería observó la documentación financiera", "Tesorería observó tu documentación financiera: <documento>", accion, "Tesorería observó tu documentación financiera"),
    pantalla("PAN-37", "C76", "P04 · Acciones pendientes · Tesorería observó el derecho de admisión", "Tesorería observó tu comprobante del derecho de admisión", accion),
    pantalla("PAN-38", "C76", "P04 · Acciones pendientes · Tesorería observó la cuota de ingreso", "Tesorería observó el comprobante de tu cuota de ingreso", accion),
    pantalla("PAN-39", "C76", "P04 · Acciones pendientes · evaluaciones por agendar", "Agenda tus evaluaciones", accion),
    pantalla(
      "PAN-40",
      "C76",
      "P04 · Acciones pendientes · evaluaciones aún no habilitadas",
      "Tus evaluaciones se podrán agendar cuando se validen los documentos, el derecho de admisión y la documentación financiera.",
      accion,
    ),
    pantalla("PAN-41", "C76", "P04 · Acciones pendientes · modalidad de la cuota de ingreso", "Elige la modalidad de pago de la cuota de ingreso", accion),
    pantalla("PAN-42", "C76", "P04 · Acciones pendientes · comprobante de la cuota de ingreso", "Registra el comprobante de la cuota de ingreso", accion),
    pantalla(
      "PAN-43",
      "C76",
      "P04 · Acciones pendientes · Tesorería concilia la cuota",
      "Tesorería está conciliando tu comprobante. La Carta de Vacante se emite al conciliarlo.",
      accion,
    ),
  ];
}

// ------------------------------------------------------------------ ingreso (tema de login de Keycloak)

function ingreso(): Texto[] {
  const g = GRUPOS.ingreso;
  const p03 = "infra/keycloak/themes/cil/login/p03.ftl";
  const p03b = "infra/keycloak/themes/cil/login/p03b.ftl";
  const requisitos = ["[Requisito 1 de la política por definir]", "[Requisito 2 de la política por definir]", "[Requisito 3 de la política por definir]"];
  return [
    fila({
      id: "ING-01",
      grupo: g,
      donde: "P03b · Crear contraseña nueva · requisitos de la política de contraseñas",
      quien: FAMILIA,
      texto: requisitos.join("\n"),
      ref: "C6",
      familia: true,
      pide: "Definir los requisitos de la contraseña (largo, mayúsculas, números, símbolos)",
      fuentes: requisitos.map((fragmento) => ({ archivo: p03b, fragmento })),
    }),
    fila({
      id: "ING-02",
      grupo: g,
      donde: "P03b · Crear contraseña nueva · nota de la política de seguridad",
      quien: FAMILIA,
      texto: "[Política de seguridad de la contraseña por definir]",
      ref: "C6",
      familia: true,
      pide: "Redactar la nota sobre la política de seguridad de la contraseña",
      fuentes: [{ archivo: p03b, fragmento: "[Política de seguridad de la contraseña por definir]" }],
    }),
    fila({
      id: "ING-03",
      grupo: g,
      donde: "P03c · Cuenta bloqueada tras varios intentos fallidos · tiempo de bloqueo",
      quien: FAMILIA,
      texto: "[tiempo de bloqueo por definir]",
      ref: "C6",
      familia: true,
      pide: "Definir cuánto tiempo queda bloqueada la cuenta",
      fuentes: [{ archivo: p03, fragmento: "[tiempo de bloqueo por definir]" }],
    }),
    fila({
      id: "ING-04",
      grupo: g,
      donde: "P03 · Ingreso al portal · aviso del primer ingreso",
      quien: FAMILIA,
      texto: "Si es tu primer ingreso, al continuar te pediremos crear una contraseña nueva.",
      ref: "C81",
      familia: true,
      fuentes: [{ archivo: p03, fragmento: "Si es tu primer ingreso, al continuar te pediremos crear una contraseña nueva." }],
    }),
    fila({
      id: "ING-05",
      grupo: g,
      donde: "P03b · Crear contraseña nueva · al recuperar la contraseña",
      quien: FAMILIA,
      texto: "Elige una contraseña nueva para tu cuenta.",
      ref: "C81",
      familia: true,
      fuentes: [{ archivo: p03b, fragmento: "Elige una contraseña nueva para tu cuenta." }],
    }),
    fila({
      id: "ING-06",
      grupo: g,
      donde: "P03c · Cuenta bloqueada · cuando no está habilitada la recuperación de la contraseña",
      quien: FAMILIA,
      texto: "Si no recuerdas tu contraseña, comunícate con Secretaría de Admisión.",
      ref: "C81",
      familia: true,
      fuentes: [{ archivo: p03, fragmento: "Si no recuerdas tu contraseña, comunícate con Secretaría de Admisión." }],
    }),
    fila({
      id: "ING-07",
      grupo: g,
      donde: "P03 · Ingreso al portal · enlace para quien aún no visitó el colegio",
      quien: FAMILIA,
      texto: "Aún no visito el colegio",
      ref: "C81",
      familia: true,
      fuentes: [{ archivo: p03, fragmento: "Aún no visito el colegio" }],
    }),
  ];
}

// ------------------------------------------------------------------ catálogo

export function construirCatalogo(): Texto[] {
  const catalogo = [
    ...correosAFamilias(),
    ...carta(),
    ...datos(),
    ...plazos(),
    ...historial(),
    ...pantallas(),
    ...ingreso(),
    ...avisosAlPersonal(),
  ];
  const ids = catalogo.map((t) => t.id);
  const repetidos = ids.filter((id, i) => ids.indexOf(id) !== i);
  if (repetidos.length) throw new Error(`Identificadores repetidos en el catálogo: ${[...new Set(repetidos)].join(", ")}`);
  return catalogo;
}
