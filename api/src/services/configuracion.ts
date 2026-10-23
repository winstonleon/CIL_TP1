// Configuración de la campaña (HU0022, pantalla G09, rol secretaria): grados, vacantes, evaluaciones, cuota,
// requisitos documentales y horarios de la campaña activa (CAMPANA_ACTIVA). Cada cambio se audita como
// cambio_configuracion en la misma transacción, con el valor anterior y el nuevo y sin datos personales
// (modelo de datos §4.7). La aplicación de esta configuración en completitud, agendamiento y adjudicación
// llega con HU0017, HU0009 y HU0012 (compromiso C25).
import { enTransaccion, obtenerPool, type Consultable } from "../db/pool";
import { ErrorApi } from "../errores";
import type { RolPersonal } from "../identidad/keycloakAdmin";
import { insertarEvento } from "../repositories/auditoria";
import { actualizarGrado, bloquearGrados, existeGrado, listarGrados, type FilaGrado, type ValoresGrado } from "../repositories/grado";
import {
  bloquearAgenda,
  bloquearHorario,
  eliminarHorario,
  haySuperposicion,
  horarioEnUso,
  insertarHorario,
  listarHorarios,
  type DatosHorario,
  type FilaHorario,
} from "../repositories/horario";
import { leerRolYEstado, listarResponsables } from "../repositories/personal";
import {
  actualizarRequisito,
  bloquearRequisito,
  eliminarRequisito,
  insertarRequisito,
  listarRequisitos,
  requisitoEnUso,
  UNICIDADES_REQUISITO,
  type DatosRequisito,
  type FilaRequisito,
} from "../repositories/requisito";
import { actor } from "./actor";

// R16: derecho de admisión de S/ 300, pago único. No tiene columna: es una brecha del backlog (C26).
export const DERECHO_ADMISION = 300;

// Valores de los enums del DBML (ADR-10: propuesta; si cambian, cambia también este código).
export const TIPOS_CITA = ["visita", "jornada_observacion", "evaluacion_psicologica", "evaluacion_academica", "entrevista_padres"] as const;
export type TipoCita = (typeof TIPOS_CITA)[number];
export const CATEGORIAS_REQUISITO = ["postulante_y_padres", "colegio_procedencia", "financiero", "condicion_especial"] as const;
export const CONDICIONES_APLICACION = ["todos", "solo_colegio_peruano", "solo_condicion_especial", "si_dependiente", "si_independiente"] as const;
// CHECK ck_requisito_por_apoderado: estas condiciones se exigen a cada apoderado.
export const CONDICIONES_POR_APODERADO: readonly string[] = ["si_dependiente", "si_independiente"];

// Rol del responsable de cada tipo de cita (plan HU0022, P2).
export const RESPONSABLE_POR_TIPO: Record<TipoCita, RolPersonal> = {
  visita: "directora", // nota de Horario_Disponible.id_personal; G04 «Conduce: Dirección»
  jornada_observacion: "psicologa", // TI 6.1.3: «la Psicóloga conduce una jornada de observación»
  evaluacion_psicologica: "psicologa", // P08 «A cargo de la Psicóloga»; §4.6
  evaluacion_academica: "evaluador_academico", // P08 «A cargo del Evaluador académico»; §4.6
  entrevista_padres: "psicologa", // P08 «A cargo de la Psicóloga»; §4.6
};
const ROLES_RESPONSABLES = [...new Set(Object.values(RESPONSABLE_POR_TIPO))];

// ------------------------------------------------------------------ auditoría

type Cambios = Record<string, { anterior: unknown; nuevo: unknown }>;

// Solo los campos que cambian. En un alta `anterior` es null; en una baja, `nuevo`.
function diferencias<T extends object>(anterior: Partial<T> | null, nuevo: Partial<T> | null, campos: readonly (keyof T & string)[]): Cambios {
  const cambios: Cambios = {};
  for (const campo of campos) {
    const a = anterior?.[campo] ?? null;
    const n = nuevo?.[campo] ?? null;
    if (a !== n) cambios[campo] = { anterior: a, nuevo: n };
  }
  return cambios;
}

async function registrarCambio(db: Consultable, keycloakUserIdActor: string, detalle: Record<string, unknown>) {
  const a = await actor(db, keycloakUserIdActor);
  await insertarEvento(db, { tipoEvento: "cambio_configuracion", idPersonal: a.idPersonal, detalle: { ...detalle, ...a.detalle } });
}

const noEncontrado = (que: string) => new ErrorApi(404, "NO_ENCONTRADO", `${que} no existe en la campaña activa`);

// ------------------------------------------------------------------ grados

export interface GradoConfiguracion extends Omit<FilaGrado, "vacantes_disponibles"> {
  vacantes_adjudicadas: number;
}

export type CambioGrado = { id_grado: number } & Partial<Omit<ValoresGrado, "vacantes_disponibles">>;

const CAMPOS_GRADO = [
  "vacantes_autorizadas",
  "vacantes_disponibles",
  "requiere_jornada_observacion",
  "requiere_evaluacion_psicologica",
  "requiere_evaluacion_academica",
  "monto_cuota_ingreso",
  "max_fracciones",
] as const;

// Vacantes adjudicadas (plan HU0022, P7): las autorizadas que ya no están disponibles (R14).
const adjudicadas = (g: FilaGrado) => g.vacantes_autorizadas - g.vacantes_disponibles;

// G09 muestra las adjudicadas; las disponibles son de G07 (HU0012).
function aConfiguracion(fila: FilaGrado): GradoConfiguracion {
  const { vacantes_disponibles: _, ...g } = fila;
  return { ...g, vacantes_adjudicadas: adjudicadas(fila) };
}

export async function obtenerConfiguracion(campana: string) {
  const grados = await listarGrados(obtenerPool(), campana);
  return { campana, derecho_admision: DERECHO_ADMISION, grados: grados.map(aConfiguracion) };
}

// HU0022-1.0 y 2.0: guarda en una sola transacción los cambios de uno o más grados (G09 tiene un solo «Guardar»).
// Si algún grado quedaría con menos vacantes autorizadas que las ya adjudicadas (R15), no se guarda ninguno.
export async function guardarGrados(keycloakUserIdActor: string, campana: string, cambios: CambioGrado[]): Promise<GradoConfiguracion[]> {
  return enTransaccion(async (c) => {
    const filas = await bloquearGrados(c, campana, cambios.map((g) => g.id_grado));
    const porId = new Map(filas.map((f) => [f.id_grado, f]));
    if (porId.size !== cambios.length) throw noEncontrado("El grado");

    const rechazos = cambios
      .map((cambio) => ({ grado: porId.get(cambio.id_grado)!, autorizadas: cambio.vacantes_autorizadas }))
      .filter(({ grado, autorizadas }) => autorizadas !== undefined && autorizadas < adjudicadas(grado))
      .map(({ grado }) => ({ id_grado: grado.id_grado, nombre_grado: grado.nombre_grado, minimo: adjudicadas(grado) }));
    if (rechazos.length) {
      const primero = rechazos[0]!;
      throw new ErrorApi(
        422,
        "VACANTES_MENORES_QUE_ADJUDICADAS",
        `No se puede fijar para ${primero.nombre_grado} un número de vacantes menor al de vacantes ya adjudicadas (${primero.minimo}).`,
        rechazos.map(({ id_grado, minimo }) => ({ id_grado, minimo })),
      );
    }

    const resultado: GradoConfiguracion[] = [];
    for (const { id_grado, ...cambio } of cambios) {
      const actual = porId.get(id_grado)!;
      const autorizadas = cambio.vacantes_autorizadas ?? actual.vacantes_autorizadas;
      // Las adjudicadas se conservan: las disponibles se mueven con la diferencia de las autorizadas.
      const nuevo: ValoresGrado = {
        vacantes_autorizadas: autorizadas,
        vacantes_disponibles: autorizadas - adjudicadas(actual),
        requiere_jornada_observacion: cambio.requiere_jornada_observacion ?? actual.requiere_jornada_observacion,
        requiere_evaluacion_psicologica: cambio.requiere_evaluacion_psicologica ?? actual.requiere_evaluacion_psicologica,
        requiere_evaluacion_academica: cambio.requiere_evaluacion_academica ?? actual.requiere_evaluacion_academica,
        monto_cuota_ingreso: cambio.monto_cuota_ingreso ?? actual.monto_cuota_ingreso,
        max_fracciones: cambio.max_fracciones ?? actual.max_fracciones,
      };
      const diferencia = diferencias<ValoresGrado>(actual, nuevo, CAMPOS_GRADO);
      if (!Object.keys(diferencia).length) {
        resultado.push(aConfiguracion(actual));
        continue;
      }
      const fila = await actualizarGrado(c, id_grado, nuevo);
      await registrarCambio(c, keycloakUserIdActor, { entidad: "grado", id_grado, campana, accion: "modificacion", cambios: diferencia });
      resultado.push(aConfiguracion(fila));
    }
    return resultado;
  });
}

// ------------------------------------------------------------------ requisitos documentales

const CAMPOS_REQUISITO = ["tipo_documento", "categoria", "condicion_aplicacion", "obligatorio", "por_apoderado"] as const;

const requisitoDuplicado = () =>
  new ErrorApi(409, "REQUISITO_DUPLICADO", "El grado ya tiene un requisito con ese nombre (sin distinguir mayúsculas)");
const enUso = (mensaje: string) => new ErrorApi(409, "EN_USO", mensaje);

// Traduce las violaciones de la BD que el servicio ya comprobó pero que una petición simultánea puede provocar.
function traducirError(e: unknown, enUsoMensaje?: string): unknown {
  const err = e as { code?: string; constraint?: string };
  if (err?.code === "23505" && UNICIDADES_REQUISITO.includes(err.constraint ?? "")) return requisitoDuplicado();
  if (err?.code === "23503" && enUsoMensaje) return enUso(enUsoMensaje);
  return e;
}

function exigirPorApoderado(d: DatosRequisito) {
  if (CONDICIONES_POR_APODERADO.includes(d.condicion_aplicacion) && !d.por_apoderado) {
    throw new ErrorApi(400, "VALIDACION", "Datos inválidos: por_apoderado");
  }
}

export async function requisitosDeGrado(campana: string, idGrado: number): Promise<FilaRequisito[]> {
  const db = obtenerPool();
  if (!(await existeGrado(db, campana, idGrado))) throw noEncontrado("El grado");
  return listarRequisitos(db, idGrado);
}

export async function crearRequisito(keycloakUserIdActor: string, campana: string, idGrado: number, datos: DatosRequisito): Promise<FilaRequisito> {
  exigirPorApoderado(datos);
  try {
    return await enTransaccion(async (c) => {
      if (!(await existeGrado(c, campana, idGrado))) throw noEncontrado("El grado");
      const fila = await insertarRequisito(c, idGrado, datos);
      await registrarCambio(c, keycloakUserIdActor, {
        entidad: "requisito_documental",
        id_requisito: fila.id_requisito,
        id_grado: idGrado,
        campana,
        accion: "alta",
        cambios: diferencias<DatosRequisito>(null, fila, CAMPOS_REQUISITO),
      });
      return fila;
    });
  } catch (e) {
    throw traducirError(e);
  }
}

// Edita un requisito sin cambiar su grado (plan HU0022, P4).
export async function modificarRequisito(
  keycloakUserIdActor: string,
  campana: string,
  idRequisito: number,
  cambios: Partial<DatosRequisito>,
): Promise<FilaRequisito> {
  try {
    return await enTransaccion(async (c) => {
      const actual = await bloquearRequisito(c, campana, idRequisito);
      if (!actual) throw noEncontrado("El requisito");
      const nuevo: DatosRequisito = {
        tipo_documento: cambios.tipo_documento ?? actual.tipo_documento,
        categoria: cambios.categoria ?? actual.categoria,
        condicion_aplicacion: cambios.condicion_aplicacion ?? actual.condicion_aplicacion,
        obligatorio: cambios.obligatorio ?? actual.obligatorio,
        por_apoderado: cambios.por_apoderado ?? actual.por_apoderado,
      };
      exigirPorApoderado(nuevo);
      const diferencia = diferencias<DatosRequisito>(actual, nuevo, CAMPOS_REQUISITO);
      if (!Object.keys(diferencia).length) return actual;
      const fila = await actualizarRequisito(c, idRequisito, nuevo);
      await registrarCambio(c, keycloakUserIdActor, {
        entidad: "requisito_documental",
        id_requisito: idRequisito,
        id_grado: actual.id_grado,
        campana,
        accion: "modificacion",
        cambios: diferencia,
      });
      return fila;
    });
  } catch (e) {
    throw traducirError(e);
  }
}

const REQUISITO_EN_USO = "No se puede quitar: ya hay documentos cargados para este requisito";

// Quita un requisito que ningún documento usa (plan HU0022, P4).
export async function quitarRequisito(keycloakUserIdActor: string, campana: string, idRequisito: number): Promise<void> {
  try {
    await enTransaccion(async (c) => {
      const actual = await bloquearRequisito(c, campana, idRequisito);
      if (!actual) throw noEncontrado("El requisito");
      if (await requisitoEnUso(c, idRequisito)) throw enUso(REQUISITO_EN_USO);
      await eliminarRequisito(c, idRequisito);
      await registrarCambio(c, keycloakUserIdActor, {
        entidad: "requisito_documental",
        id_requisito: idRequisito,
        id_grado: actual.id_grado,
        campana,
        accion: "baja",
        cambios: diferencias<DatosRequisito>(actual, null, CAMPOS_REQUISITO),
      });
    });
  } catch (e) {
    throw traducirError(e, REQUISITO_EN_USO);
  }
}

// ------------------------------------------------------------------ horarios

const CAMPOS_HORARIO = ["id_personal", "tipo_cita", "fecha", "hora_inicio", "hora_fin", "cupos"] as const;

export async function responsables() {
  return listarResponsables(obtenerPool(), ROLES_RESPONSABLES);
}

export async function horarios(campana: string, tipoCita?: TipoCita): Promise<FilaHorario[]> {
  return listarHorarios(obtenerPool(), campana, tipoCita);
}

// HU0022-1.0: el responsable debe estar activo y tener el rol del tipo de cita (P2), y no puede tener ese día
// otro horario que se cruce con este, en ninguna campaña (P1: evitar la doble reserva).
export async function crearHorario(keycloakUserIdActor: string, campana: string, datos: DatosHorario & { tipo_cita: TipoCita }): Promise<FilaHorario> {
  return enTransaccion(async (c) => {
    const responsable = await leerRolYEstado(c, datos.id_personal);
    if (!responsable || !responsable.activo || responsable.rol !== RESPONSABLE_POR_TIPO[datos.tipo_cita]) {
      throw new ErrorApi(422, "RESPONSABLE_NO_VALIDO", "El responsable debe ser una cuenta activa con el rol que atiende ese tipo de cita");
    }
    await bloquearAgenda(c, datos.id_personal, datos.fecha);
    if (await haySuperposicion(c, datos)) {
      throw new ErrorApi(409, "HORARIO_SUPERPUESTO", "El responsable ya tiene un horario que se cruza con este en esa fecha");
    }
    const fila = await insertarHorario(c, campana, datos);
    await registrarCambio(c, keycloakUserIdActor, {
      entidad: "horario_disponible",
      id_horario: fila.id_horario,
      campana,
      accion: "alta",
      cambios: diferencias<DatosHorario>(null, fila, CAMPOS_HORARIO),
    });
    return fila;
  });
}

const HORARIO_EN_USO = "No se puede quitar: el horario ya tiene citas";

// Quita un horario sin citas (plan HU0022, P4). Los horarios no se editan.
export async function quitarHorario(keycloakUserIdActor: string, campana: string, idHorario: number): Promise<void> {
  try {
    await enTransaccion(async (c) => {
      const actual = await bloquearHorario(c, campana, idHorario);
      if (!actual) throw noEncontrado("El horario");
      if (await horarioEnUso(c, idHorario)) throw enUso(HORARIO_EN_USO);
      await eliminarHorario(c, idHorario);
      await registrarCambio(c, keycloakUserIdActor, {
        entidad: "horario_disponible",
        id_horario: idHorario,
        campana,
        accion: "baja",
        cambios: diferencias<DatosHorario>(actual, null, CAMPOS_HORARIO),
      });
    });
  } catch (e) {
    throw traducirError(e, HORARIO_EN_USO);
  }
}
