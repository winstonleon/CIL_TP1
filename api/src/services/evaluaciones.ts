// Agendamiento de las evaluaciones (HU0009, P08) y sus avisos por agendamiento → notificacion-multicanal (ADR-07).
// - Las evaluaciones salen del grado (`requiere_*`, más la entrevista: C25 4) y los horarios son del tipo, de la campaña
//   activa, futuros y de un responsable activo con el rol de ADR-15 (C25 7).
// - «Confirmar citas» es todo o nada: una transacción bloquea el expediente y después los horarios EN ORDEN POR ID (sin
//   interbloqueos), y cualquier turno sin cupo revierte todo. Con las tres ramas conformes (B1) pasa a en_evaluacion.
// - La entrevista a los padres va después del fin de las demás citas (decisión O de John, R11), al reservar y al
//   reprogramar.
// - Reprogramar (HU0009-2.0) exige REPROGRAMACION_MIN_HORAS de anticipación respecto de la cita actual: libera el turno
//   anterior (cupos + 1, cita `reprogramada`) y reserva el nuevo en la misma transacción, con el evento cita_reprogramada.
// - Una evaluación académica a la que no se asistió (HU0025-2.0, D2-A de ADR-25) también se reprograma, sin la regla de
//   24 h (solo vale para citas futuras): la cita vieja queda en no_asistio como evidencia y su cupo no se devuelve. Sus
//   avisos son los de toda reprogramación (ADR-24).
// P08 es de la familia: no registra atencion_* (ADR-05).
import { obtenerConfig } from "../config";
import { enTransaccion, obtenerPool, type Consultable } from "../db/pool";
import { ErrorApi } from "../errores";
import { leerCuotaDeExpediente } from "../repositories/adjudicacion";
import { insertarEvento } from "../repositories/auditoria";
import { insertarIntento } from "../repositories/aviso";
import {
  anclaHabilitacion,
  bloquearCitaEvaluacion,
  bloquearHorarios,
  bloquearIntentosEvaluacion,
  citasActivas,
  CLAVE_REPROGRAMACION,
  correoDelResponsable,
  descontarCupoHorario,
  devolverCupoHorario,
  ESTADO_DEL_AVISO,
  evaluacionesDelGrado,
  fuenteDeIntento,
  insertarCitaEvaluacion,
  leerCitaEvaluacion,
  listarAvisosEvaluacionPendientes,
  listarHorariosEvaluacion,
  marcarCitaReprogramada,
  tipoDeNotificacion,
  TIPO_CONFIRMACION_EVALUACIONES,
  TIPO_CUOTA_POR_CONCILIAR,
  TIPO_DICTAMEN_NO_APTO,
  TIPO_DICTAMEN_OBSERVACION,
  TIPO_HABILITACION,
  TIPO_INASISTENCIA,
  TIPO_LIBERACION_RESPONSABLE,
  TIPO_LISTA_ESPERA,
  TIPO_REPROGRAMACION_FAMILIA,
  TIPO_REPROGRAMACION_RESPONSABLE,
  TIPO_VACANTE_ASIGNADA,
  TIPOS_AL_RESPONSABLE,
  TIPOS_AVISO_EVALUACION,
  TIPOS_EVALUACION,
  ultimaFuente,
  type CitaEvaluacion,
  type FuenteAviso,
  type TipoAvisoEvaluacion,
  type TipoEvaluacion,
} from "../repositories/evaluaciones";
import { bloquearFichaDeExpediente, leerDatosFamilia, type ExpedienteDeFamilia } from "../repositories/expediente";
import type { ContactoExpediente } from "../repositories/notificacion";
import { ramasConformes } from "../repositories/validacion";
import { avisoAgotado, decidir, MAXIMO_PENDIENTES, MINUTOS_REGISTRO, MINUTOS_REINTENTO } from "./agendamiento";
import {
  componerAvisoResponsable,
  componerConfirmacionEvaluaciones,
  componerHabilitacion,
  componerInasistencia,
  componerNoApto,
  componerObservacionAdmision,
  componerReprogramacionFamilia,
} from "./avisosEvaluacion";
import { componerCuotaPorConciliar, componerListaEspera, componerVacante } from "./avisosVacante";
import { transicionarExpediente } from "./expedientes/transicionarExpediente";
import { codigoExpediente } from "./fichaInscripcion";

const ESTADO_VALIDACION = "en_validacion";
const ESTADO_EVALUACION = "en_evaluacion";

const noHabilitado = () =>
  new ErrorApi(409, "AGENDAMIENTO_NO_HABILITADO", "Tus evaluaciones se podrán agendar cuando se validen los documentos, el derecho de admisión y la documentación financiera");
const yaAgendadas = () => new ErrorApi(409, "EVALUACIONES_YA_AGENDADAS", "Tus evaluaciones ya están agendadas");
const noCorresponden = (exigidas: readonly TipoEvaluacion[]) =>
  new ErrorApi(422, "EVALUACIONES_NO_CORRESPONDEN", "Elige un turno para cada evaluación que corresponde al grado", { exigidas });
const sinCupo = (ids: number[]) =>
  new ErrorApi(409, "HORARIO_SIN_CUPO", "Uno de los turnos elegidos ya no tiene cupo. Elige otro turno.", ids.map((id_horario) => ({ id_horario })));
const noDisponible = (ids: number[]) =>
  new ErrorApi(409, "HORARIO_NO_DISPONIBLE", "Uno de los turnos elegidos ya no está disponible. Elige otro turno.", ids.map((id_horario) => ({ id_horario })));
const ordenInvalido = () =>
  new ErrorApi(422, "ORDEN_DE_CITAS", "La entrevista a los padres debe ser después de las demás evaluaciones");
const citaNoEncontrada = () => new ErrorApi(404, "CITA_NO_ENCONTRADA", "La cita no existe");
const noReprogramable = () => new ErrorApi(409, "CITA_NO_REPROGRAMABLE", "Esta cita ya no se puede reprogramar");
const plazoVencido = (horas: number) =>
  new ErrorApi(422, "PLAZO_REPROGRAMACION_VENCIDO", `Solo puedes reprogramar una cita hasta ${horas} horas antes`, { min_horas: horas });

// ¿Es la violación de uq_cita_personal_fecha? (segunda capa: el índice parcial de C40).
const esCitaDuplicada = (err: unknown) => {
  const e = err as { code?: string; constraint?: string } | null;
  return e?.code === "23505" && e.constraint === "uq_cita_personal_fecha";
};

// ---------------------------------------------------------------- orden (decisión O)

interface Turno {
  tipo_cita: string;
  inicio: Date;
  fin: Date;
}

// La entrevista a los padres empieza después del fin de cada una de las demás citas (R11: «al final»).
function verificarOrden(turnos: Turno[]): void {
  const entrevista = turnos.find((t) => t.tipo_cita === "entrevista_padres");
  if (!entrevista) return;
  if (turnos.some((t) => t !== entrevista && entrevista.inicio.getTime() < t.fin.getTime())) throw ordenInvalido();
}

// ---------------------------------------------------------------- P08 (familia)

export interface CitaVista {
  id_cita: number;
  tipo_cita: TipoEvaluacion;
  fecha: string;
  hora_inicio: string;
  estado: string;
  reprogramable: boolean;
  plazo_vencido: boolean; // reservada y futura, pero a menos de REPROGRAMACION_MIN_HORAS: P08 explica por qué no se reprograma
  inasistencia: boolean; // evaluación académica a la que no se asistió: P08 ofrece un nuevo horario (HU0025-2.0)
}

// HU0025-2.0 (D2-A): la cita vigente de la evaluación académica quedó en no_asistio y el expediente sigue en evaluación.
const esInasistenciaReprogramable = (c: { tipo_cita: string; estado: string }, estadoExpediente: string) =>
  estadoExpediente === ESTADO_EVALUACION && c.tipo_cita === "evaluacion_academica" && c.estado === "no_asistio";

function vistaCita(c: CitaEvaluacion, estadoExpediente: string): CitaVista {
  const minimo = obtenerConfig().REPROGRAMACION_MIN_HORAS;
  const reservada = estadoExpediente === ESTADO_EVALUACION && c.estado === "reservada";
  return {
    id_cita: c.id_cita,
    tipo_cita: c.tipo_cita,
    fecha: c.fecha,
    hora_inicio: c.hora_inicio,
    estado: c.estado,
    reprogramable: (reservada && c.horas_restantes >= minimo) || esInasistenciaReprogramable(c, estadoExpediente),
    plazo_vencido: reservada && c.horas_restantes > 0 && c.horas_restantes < minimo,
    inasistencia: esInasistenciaReprogramable(c, estadoExpediente),
  };
}

export type ModoP08 = "bloqueado" | "agendar" | "agendadas";

// GET /familia/expedientes/:id/evaluaciones. «agendar» con las tres ramas conformes (B1); «agendadas» en evaluación.
export async function leerEvaluaciones(e: ExpedienteDeFamilia, campana: string) {
  const db = obtenerPool();
  const { REPROGRAMACION_MIN_HORAS } = obtenerConfig();
  const exigidas = await evaluacionesDelGrado(db, e.id_expediente);
  const modo: ModoP08 =
    e.estado === ESTADO_EVALUACION ? "agendadas" : e.estado === ESTADO_VALIDACION && (await ramasConformes(db, e.id_expediente)) ? "agendar" : "bloqueado";
  const citas = modo === "agendadas" ? await citasActivas(db, e.id_expediente) : [];
  // Con citas ya agendadas se muestran sus tipos aunque el grado haya cambiado después (C25 7: siguen válidas).
  const tipos = TIPOS_EVALUACION.filter((t) => exigidas.includes(t) || citas.some((c) => c.tipo_cita === t));
  const horarios = modo === "bloqueado" ? [] : await listarHorariosEvaluacion(db, campana, tipos);
  return {
    modo,
    grado: e.nombre_grado,
    min_horas_reprogramacion: REPROGRAMACION_MIN_HORAS,
    evaluaciones: tipos.map((t) => {
      const cita = citas.find((c) => c.tipo_cita === t);
      return {
        tipo_cita: t,
        cita: cita ? vistaCita(cita, e.estado) : null,
        horarios: horarios.filter((h) => h.tipo_cita === t).map(({ tipo_cita: _t, ...h }) => h),
      };
    }),
  };
}

export interface Pedido {
  tipo_cita: TipoEvaluacion;
  id_horario: number;
}

interface ResultadoConfirmacion {
  estado: string;
  citas: CitaVista[];
  id_notificacion: number;
}

// POST /familia/expedientes/:id/evaluaciones («Confirmar citas», HU0009-1.0): todo o nada.
export async function confirmarCitas(e: ExpedienteDeFamilia, pedidos: Pedido[], campana: string): Promise<ResultadoConfirmacion> {
  const idExpediente = e.id_expediente;
  try {
    return await enTransaccion(async (c) => {
      const bloqueo = await bloquearFichaDeExpediente(c, idExpediente);
      if (!bloqueo) throw new ErrorApi(404, "EXPEDIENTE_NO_ENCONTRADO", "El expediente no existe");
      if (bloqueo.estado === ESTADO_EVALUACION) throw yaAgendadas();
      if (bloqueo.estado !== ESTADO_VALIDACION || !(await ramasConformes(c, idExpediente))) throw noHabilitado();

      const exigidas = await evaluacionesDelGrado(c, idExpediente);
      const pedidosTipos = pedidos.map((p) => p.tipo_cita);
      if (new Set(pedidosTipos).size !== pedidos.length || pedidos.length !== exigidas.length || !exigidas.every((t) => pedidosTipos.includes(t))) {
        throw noCorresponden(exigidas);
      }

      const horarios = await bloquearHorarios(c, pedidos.map((p) => p.id_horario), campana);
      const invalidos = pedidos.filter((p) => {
        const h = horarios.get(p.id_horario);
        return !h || h.tipo_cita !== p.tipo_cita || !h.vigente;
      });
      if (new Set(pedidos.map((p) => p.id_horario)).size !== pedidos.length || invalidos.length) {
        throw noDisponible(invalidos.map((p) => p.id_horario));
      }
      const agotados = pedidos.filter((p) => !horarios.get(p.id_horario)!.con_cupo);
      if (agotados.length) throw sinCupo(agotados.map((p) => p.id_horario));
      verificarOrden(pedidos.map((p) => horarios.get(p.id_horario)!));

      const idsCita: number[] = [];
      for (const p of [...pedidos].sort((a, b) => a.id_horario - b.id_horario)) {
        const h = horarios.get(p.id_horario)!;
        if (!(await descontarCupoHorario(c, h.id_horario))) throw sinCupo([h.id_horario]);
        idsCita.push(await insertarCitaEvaluacion(c, { idExpediente, idPersonal: h.id_personal, idHorario: h.id_horario, tipoCita: p.tipo_cita, fechaHora: h.inicio }));
      }
      const idNotificacion = await insertarIntento(c, { idExpediente, tipoEvento: TIPO_CONFIRMACION_EVALUACIONES, estadoEnvio: "pendiente" });
      await transicionarExpediente(c, {
        idExpediente,
        campo: "estado",
        esperado: ESTADO_VALIDACION,
        nuevo: ESTADO_EVALUACION,
        idPersonal: null,
        detalle: { id_citas: idsCita, id_notificacion: idNotificacion },
      });
      const citas = await citasActivas(c, idExpediente);
      return { estado: ESTADO_EVALUACION, citas: citas.map((x) => vistaCita(x, ESTADO_EVALUACION)), id_notificacion: idNotificacion };
    });
  } catch (err) {
    // Otra reserva confirmó primero una cita del mismo responsable a esa hora: la transacción ya se revirtió entera.
    if (esCitaDuplicada(err)) throw sinCupo(pedidos.map((p) => p.id_horario));
    throw err;
  }
}

// La cita es de este expediente, de otro (se audita en la ruta) o no existe. Sin bloqueo.
export async function resolverCita(e: ExpedienteDeFamilia, idCita: number): Promise<"propia" | "ajena" | "inexistente"> {
  const cita = await leerCitaEvaluacion(obtenerPool(), idCita);
  if (!cita) return "inexistente";
  return cita.id_expediente === e.id_expediente ? "propia" : "ajena";
}

interface ResultadoReprogramacion {
  cita: CitaVista;
  avisos: number[]; // primeros intentos reservados (familia, responsable nuevo y, si cambia, el anterior)
}

// POST /familia/expedientes/:id/citas/:idCita/reprogramacion (HU0009-2.0).
export async function reprogramarCita(e: ExpedienteDeFamilia, idCita: number, idHorario: number, campana: string): Promise<ResultadoReprogramacion> {
  const idExpediente = e.id_expediente;
  const minimo = obtenerConfig().REPROGRAMACION_MIN_HORAS;
  try {
    return await enTransaccion(async (c) => {
      // Orden de bloqueo: expediente, cita y horarios (en orden por id).
      const bloqueo = await bloquearFichaDeExpediente(c, idExpediente);
      const cita = await bloquearCitaEvaluacion(c, idCita);
      if (!bloqueo || !cita || cita.id_expediente !== idExpediente) throw citaNoEncontrada();
      const inasistencia = esInasistenciaReprogramable(cita, bloqueo.estado);
      if (bloqueo.estado !== ESTADO_EVALUACION || cita.tipo_cita === ("visita" as string) || (cita.estado !== "reservada" && !inasistencia)) {
        throw noReprogramable();
      }
      // Solo la cita vigente de su tipo: una inasistencia ya reprogramada no se vuelve a reprogramar.
      const vigentes = await citasActivas(c, idExpediente);
      if (!vigentes.some((x) => x.id_cita === idCita)) throw noReprogramable();
      if (!inasistencia && cita.horas_restantes < minimo) throw plazoVencido(minimo);
      if (idHorario === cita.id_horario) throw noDisponible([idHorario]);

      const horarios = await bloquearHorarios(c, [cita.id_horario, idHorario], campana);
      const nuevo = horarios.get(idHorario);
      if (!nuevo || nuevo.tipo_cita !== cita.tipo_cita || !nuevo.vigente) throw noDisponible([idHorario]);
      if (!nuevo.con_cupo) throw sinCupo([idHorario]);
      const agenda = vigentes.map((x) => (x.id_cita === idCita ? { ...x, inicio: nuevo.inicio, fin: nuevo.fin } : x));
      // Excepción a la regla de orden (decisión A de John, ADR-24): si la entrevista ya no se puede mover (registrada, ya
      // pasada o a menos del plazo de reprogramación), una inasistencia se reprograma aunque quede después de ella: si no,
      // el expediente se detendría. El dictamen sigue esperando todos los resultados.
      const entrevista = vigentes.find((x) => x.tipo_cita === "entrevista_padres");
      const entrevistaFija = entrevista !== undefined && (entrevista.estado !== "reservada" || entrevista.horas_restantes < minimo);
      if (!inasistencia || !entrevistaFija) verificarOrden(agenda);

      // La inasistencia ya pasó: no hay turno que liberar ni cupo que devolver, y la cita queda en no_asistio.
      if (!inasistencia) {
        await devolverCupoHorario(c, cita.id_horario);
        await marcarCitaReprogramada(c, idCita);
      }
      if (!(await descontarCupoHorario(c, idHorario))) throw sinCupo([idHorario]);
      const idNueva = await insertarCitaEvaluacion(c, {
        idExpediente,
        idPersonal: nuevo.id_personal,
        idHorario,
        tipoCita: cita.tipo_cita,
        fechaHora: nuevo.inicio,
      });

      const reservar = (tipoEvento: string) => insertarIntento(c, { idExpediente, tipoEvento, estadoEnvio: "pendiente" });
      const idFamilia = await reservar(TIPO_REPROGRAMACION_FAMILIA);
      const idResponsable = await reservar(TIPO_REPROGRAMACION_RESPONSABLE);
      const idAnterior = nuevo.id_personal !== cita.id_personal ? await reservar(TIPO_LIBERACION_RESPONSABLE) : null;
      await insertarEvento(c, {
        tipoEvento: "cita_reprogramada",
        idExpediente,
        idPersonal: null,
        detalle: {
          id_cita_anterior: idCita,
          id_cita_nueva: idNueva,
          id_horario_anterior: cita.id_horario,
          id_horario_nuevo: idHorario,
          id_notificacion: idFamilia,
          id_notificacion_responsable: idResponsable,
          ...(idAnterior !== null ? { id_notificacion_responsable_anterior: idAnterior } : {}),
        },
      });
      const nueva = (await leerCitaEvaluacion(c, idNueva))!;
      return { cita: vistaCita(nueva, ESTADO_EVALUACION), avisos: [idFamilia, idResponsable, ...(idAnterior !== null ? [idAnterior] : [])] };
    });
  } catch (err) {
    if (esCitaDuplicada(err)) throw sinCupo([idHorario]);
    throw err;
  }
}

// ---------------------------------------------------------------- avisos (n8n: flujo agendamiento, ADR-07)

export interface AvisoEvaluacion {
  id_expediente: number;
  id_notificacion: number;
  tipo_evento: string;
  asunto: string;
  cuerpo: string;
}

const avisoNoCorresponde = () => new ErrorApi(409, "AVISO_NO_CORRESPONDE", "El expediente no tiene ese aviso de evaluaciones pendiente");
const avisoYaRegistrado = () => new ErrorApi(409, "AVISO_YA_REGISTRADO", "El aviso de evaluaciones ya está registrado o en curso");

const esTipoAviso = (t: string | null): t is TipoAvisoEvaluacion => t !== null && (TIPOS_AVISO_EVALUACION as readonly string[]).includes(t);

const citaDelAviso = (c: CitaEvaluacion) => ({ tipo_cita: c.tipo_cita, fecha: c.fecha, hora_inicio: c.hora_inicio });

async function componerMensaje(db: Consultable, idExpediente: number, tipo: TipoAvisoEvaluacion, fuente: FuenteAviso | null) {
  const familia = (await leerDatosFamilia(db, idExpediente))!;
  const base = { nombres: familia.nombres, campana: familia.campana_admision };
  if (tipo === TIPO_HABILITACION) return componerHabilitacion(base);
  if (tipo === TIPO_CUOTA_POR_CONCILIAR) return componerCuotaPorConciliar({ codigo: codigoExpediente(familia.campana_admision, idExpediente), campana: familia.campana_admision });
  if (tipo === TIPO_VACANTE_ASIGNADA || tipo === TIPO_LISTA_ESPERA) {
    const q = (await leerCuotaDeExpediente(db, idExpediente))!;
    if (tipo === TIPO_LISTA_ESPERA) return componerListaEspera({ ...base, grado: q.nombre_grado, posicion: q.posicion_lista_espera! });
    return componerVacante({ ...base, grado: q.nombre_grado, nivel: q.nivel, monto: Number(q.monto), maxFracciones: q.max_fracciones });
  }
  if (tipo === TIPO_DICTAMEN_NO_APTO) return componerNoApto(base);
  if (tipo === TIPO_DICTAMEN_OBSERVACION) {
    return componerObservacionAdmision({ codigo: codigoExpediente(familia.campana_admision, idExpediente), campana: familia.campana_admision, idExpediente });
  }
  if (tipo === TIPO_INASISTENCIA) {
    const item = fuente!.detalle.item as { id: number };
    return componerInasistencia({ ...base, cita: citaDelAviso((await leerCitaEvaluacion(db, Number(item.id)))!) });
  }
  const citas = (await citasActivas(db, idExpediente)).map(citaDelAviso);
  if (tipo === TIPO_CONFIRMACION_EVALUACIONES) return componerConfirmacionEvaluaciones({ ...base, citas });
  const anterior = (await leerCitaEvaluacion(db, Number(fuente!.detalle.id_cita_anterior)))!;
  const nueva = (await leerCitaEvaluacion(db, Number(fuente!.detalle.id_cita_nueva)))!;
  if (tipo === TIPO_REPROGRAMACION_FAMILIA) {
    return componerReprogramacionFamilia({ ...base, reprogramada: { ...citaDelAviso(nueva), anterior: citaDelAviso(anterior) }, citas });
  }
  return componerAvisoResponsable({
    liberacion: tipo === TIPO_LIBERACION_RESPONSABLE,
    codigo: codigoExpediente(familia.campana_admision, idExpediente),
    campana: familia.campana_admision,
    tipo_cita: nueva.tipo_cita,
    anterior: citaDelAviso(anterior),
    nueva: citaDelAviso(nueva),
  });
}

type ResultadoAviso = { aviso: AvisoEvaluacion } | { conflicto: ErrorApi };

// POST /internal/expedientes/:id/aviso-evaluacion, como el aviso de observaciones (ADR-23):
// - con `id_notificacion` (webhook de la API): el primer intento que la acción ya reservó, si sigue siendo el último y no
//   venció; si no, 409 y lo toma el barrido;
// - con `tipo_evento` (barrido): ADR-07, primer intento de la habilitación, retoma con una fila nueva o cierre con la fila
//   `fallido` del tope.
// Los conflictos se lanzan después del COMMIT: la fila de cierre del tope debe quedar guardada.
export async function reservarAvisoEvaluacion(idExpediente: number, entrada: { id_notificacion?: number; tipo_evento?: string }): Promise<AvisoEvaluacion> {
  const r = await enTransaccion<ResultadoAviso>(async (c) => {
    const bloqueo = await bloquearFichaDeExpediente(c, idExpediente);
    if (!bloqueo) throw new ErrorApi(404, "EXPEDIENTE_NO_ENCONTRADO", "El expediente no existe");
    const tipo = entrada.id_notificacion !== undefined ? await tipoDeNotificacion(c, entrada.id_notificacion, idExpediente) : (entrada.tipo_evento ?? null);
    if (!esTipoAviso(tipo) || bloqueo.estado !== ESTADO_DEL_AVISO[tipo]) return { conflicto: avisoNoCorresponde() };

    let fuente: FuenteAviso | null = null;
    let desde = 0;
    if (tipo === TIPO_HABILITACION) {
      // C52: una sola vez por expediente (B1): todas las filas del tipo son de este aviso.
      if (entrada.id_notificacion !== undefined || !(await ramasConformes(c, idExpediente)) || !(await anclaHabilitacion(c, idExpediente))) {
        return { conflicto: avisoNoCorresponde() };
      }
    } else {
      fuente = await ultimaFuente(c, idExpediente, tipo);
      if (!fuente) return { conflicto: avisoNoCorresponde() };
      desde = fuente.desde;
    }

    const intentos = await bloquearIntentosEvaluacion(c, { idExpediente, tipo, desde, minutosReintento: MINUTOS_REINTENTO });
    let id: number;
    if (entrada.id_notificacion !== undefined) {
      const ultimo = intentos.at(-1);
      if (!intentos.some((i) => i.id_notificacion === entrada.id_notificacion)) return { conflicto: avisoNoCorresponde() };
      if (intentos.some((i) => i.estado_envio !== "pendiente") || ultimo?.id_notificacion !== entrada.id_notificacion || ultimo.vencido) {
        return { conflicto: avisoYaRegistrado() };
      }
      id = entrada.id_notificacion;
    } else {
      const decision = decidir(intentos);
      if (decision.accion === "cerrado" || decision.accion === "en_curso") return { conflicto: avisoYaRegistrado() };
      if (decision.accion === "agotar") {
        await insertarIntento(c, { idExpediente, tipoEvento: tipo, estadoEnvio: "fallido" });
        return { conflicto: avisoAgotado() };
      }
      id = await insertarIntento(c, { idExpediente, tipoEvento: tipo, estadoEnvio: "pendiente" });
    }
    const mensaje = await componerMensaje(c, idExpediente, tipo, fuente);
    return { aviso: { id_expediente: idExpediente, id_notificacion: id, tipo_evento: tipo, ...mensaje } };
  });
  if ("conflicto" in r) throw r.conflicto;
  return r.aviso;
}

// GET /internal/evaluaciones/avisos-pendientes: solo ids y el tipo del aviso.
export async function avisosEvaluacionPendientes(): Promise<{ avisos: { id_expediente: number; tipo_evento: string }[] }> {
  const avisos = await listarAvisosEvaluacionPendientes(obtenerPool(), {
    minutosRegistro: MINUTOS_REGISTRO,
    minutosReintento: MINUTOS_REINTENTO,
    limite: MAXIMO_PENDIENTES,
  });
  return { avisos };
}

// Contacto de un intento (notificacion-multicanal, «Obtener contacto»): los avisos al responsable (decisión R3) van al
// correo del personal de la cita, el del dictamen En observación al buzón de admisión (CORREO_ADMISION, D4c-A) y el de la
// cuota por conciliar al buzón de Tesorería (CORREO_TESORERIA, ADR-26), sin WhatsApp. null si el intento no es un aviso al personal: sigue el camino de siempre (la familia). Un aviso al
// responsable sin contacto responde 404: nunca cae al correo de la familia.
export async function contactoDelResponsable(idExpediente: number, idNotificacion: number): Promise<ContactoExpediente | null> {
  const db = obtenerPool();
  const tipo = await tipoDeNotificacion(db, idNotificacion, idExpediente);
  if (tipo === TIPO_DICTAMEN_OBSERVACION) return { id_expediente: idExpediente, correo: obtenerConfig().CORREO_ADMISION, autoriza_whatsapp: false };
  if (tipo === TIPO_CUOTA_POR_CONCILIAR) return { id_expediente: idExpediente, correo: obtenerConfig().CORREO_TESORERIA, autoriza_whatsapp: false };
  if (tipo === null || !TIPOS_AL_RESPONSABLE.includes(tipo)) return null;
  const sinContacto = () => new ErrorApi(404, "CONTACTO_NO_ENCONTRADO", "El aviso no tiene un responsable con correo");
  const fuente = await fuenteDeIntento(db, idExpediente, tipo, idNotificacion);
  if (!fuente || !(CLAVE_REPROGRAMACION[tipo]! in fuente.detalle)) throw sinContacto();
  const idCita = Number(tipo === TIPO_REPROGRAMACION_RESPONSABLE ? fuente.detalle.id_cita_nueva : fuente.detalle.id_cita_anterior);
  const correo = await correoDelResponsable(db, idCita);
  if (!correo) throw sinContacto();
  return { id_expediente: idExpediente, correo, autoriza_whatsapp: false };
}
