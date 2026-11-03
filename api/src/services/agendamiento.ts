// Flujo agendamiento de n8n (HU0003 y HU0004) a través de /internal/*: reserva y armado del aviso de una cita según su
// estado (confirmación, invitación a reprogramar o credenciales), barrido de avisos pendientes (ADR-16) y cierre de un
// aviso (M3). Reglas de ADR-07:
// - una fila por intento; un intento de resultado desconocido queda `pendiente` y nunca se marca `fallido`;
// - un aviso se retoma si su último intento lleva más de 10 min `pendiente`, con una fila nueva;
// - tope de 6 intentos: después, una fila de cierre `fallido` (no es un envío) y 409 AVISO_AGOTADO;
// - un aviso está cerrado si tiene una fila `enviado` o `fallido` desde su ancla.
// Credenciales (D3): cada intento genera otra contraseña temporal (M2), salvo que la familia ya la haya cambiado (M4); el
// cierre `fallido` la invalida (M3). La contraseña solo viaja en la respuesta: nunca en la BD, la auditoría ni un log.
// Orden de bloqueo: expediente, cita y notificaciones (el mismo de P02 y G04).
import { generarContrasenaTemporal } from "../crypto/contrasenaTemporal";
import { enTransaccion, obtenerPool, type Consultable } from "../db/pool";
import { ErrorApi } from "../errores";
import type { IdentidadAdmin } from "../identidad/keycloakAdmin";
import { anclaDeCita, bloquearIntentos, esUltimaCitaDeVisita, insertarIntento, listarAvisosPendientes } from "../repositories/aviso";
import { bloquearCita, leerCita, type FilaCita } from "../repositories/cita";
import { usuarioDelExpediente } from "../repositories/cuentaAcceso";
import { bloquearDatosFamilia, type DatosFamilia } from "../repositories/expediente";
import { actualizarEstadoEnvio, leerNotificacion } from "../repositories/notificacion";
import { componerConfirmacion, componerCredenciales, componerReprogramacion, urlPortal } from "./avisosVisita";
import { enlaceVisita } from "./carpetaInformativa";
import { cerrarNotificacion } from "./notificaciones";

export const TIPO_CONFIRMACION = "visita_confirmada";
export const TIPO_REPROGRAMACION = "visita_reprogramacion";
export const TIPO_CREDENCIALES = "credenciales_portal";

export const MAX_INTENTOS_AVISO = 6;
export const MINUTOS_REGISTRO = 1; // el barrido deja pasar el camino normal del webhook (menos de un minuto)
export const MINUTOS_REINTENTO = 10;
export const MAXIMO_PENDIENTES = 20;

export interface AvisoReservado {
  id_expediente: number;
  id_cita: number;
  id_notificacion: number;
  tipo_evento: string;
  asunto: string;
  cuerpo: string;
}

// Qué hacer con un aviso según sus intentos (ADR-07).
export type Decision = { accion: "nuevo" } | { accion: "en_curso" | "cerrado" } | { accion: "retomar" | "agotar"; ultima: number };

export async function decidirIntento(db: Consultable, a: { idExpediente: number; tipoEvento: string; ancla: Date }): Promise<Decision> {
  const intentos = await bloquearIntentos(db, { ...a, minutosReintento: MINUTOS_REINTENTO });
  if (intentos.some((i) => i.estado_envio !== "pendiente")) return { accion: "cerrado" };
  const ultima = intentos.at(-1);
  if (!ultima) return { accion: "nuevo" };
  if (!ultima.vencido) return { accion: "en_curso" };
  return { accion: intentos.length >= MAX_INTENTOS_AVISO ? "agotar" : "retomar", ultima: ultima.id_notificacion };
}

export const avisoYaRegistrado = () => new ErrorApi(409, "AVISO_YA_REGISTRADO", "El aviso de esta cita ya está registrado o en curso");
export const avisoAgotado = () => new ErrorApi(409, "AVISO_AGOTADO", "El aviso agotó sus intentos y quedó cerrado como fallido");

// M3 (best effort): una contraseña aleatoria que nadie recibe. Solo invalida una contraseña TEMPORAL (con UPDATE_PASSWORD
// pendiente): si la familia ya definió la suya, no la toca. Si Keycloak falla, solo queda el aviso en el log (ids).
export async function invalidarContrasena(identidad: IdentidadAdmin, idUsuario: string, idNotificacion: number): Promise<void> {
  try {
    if (!(await identidad.cambioContrasenaPendiente(idUsuario))) return;
    await identidad.establecerContrasenaTemporal(idUsuario, generarContrasenaTemporal());
  } catch {
    console.error(`No se pudo invalidar la contraseña temporal (notificación ${idNotificacion}); queda vigente hasta el próximo intento o su cambio`);
  }
}

// Tipo del aviso que corresponde al estado actual de la cita y del expediente, o null si ninguno.
function tipoDelAviso(cita: FilaCita, familia: DatosFamilia): string | null {
  if (cita.estado === "reservada" && familia.estado === "visita_agendada") return TIPO_CONFIRMACION;
  if (cita.estado === "no_asistio" && familia.estado === "prospecto") return TIPO_REPROGRAMACION;
  if (cita.estado === "asistio" && familia.estado === "portal_habilitado") return TIPO_CREDENCIALES;
  return null;
}

// M4: la familia ya cambió la contraseña temporal (tiene credenciales y no tiene UPDATE_PASSWORD pendiente).
async function yaLaCambio(identidad: IdentidadAdmin, idUsuario: string): Promise<boolean> {
  return (await identidad.tieneCredenciales(idUsuario)) && !(await identidad.cambioContrasenaPendiente(idUsuario));
}

type Resultado = { reservado: AvisoReservado } | { conflicto: ErrorApi; invalidar?: { usuario: string; cierre: number } };

// POST /internal/citas/:id/aviso. Los conflictos se lanzan después del COMMIT: la fila de cierre (tope) y el cierre de
// M4 deben quedar guardados aunque la respuesta sea 409. M3 del tope también corre después del COMMIT.
export async function reservarAviso(identidad: IdentidadAdmin, idCita: number): Promise<AvisoReservado> {
  const r = await enTransaccion<Resultado>(async (c) => {
    const previa = await leerCita(c, idCita);
    if (!previa || previa.tipo_cita !== "visita") throw new ErrorApi(404, "CITA_NO_ENCONTRADA", "La cita no existe");
    const familia = (await bloquearDatosFamilia(c, previa.id_expediente))!;
    const cita = (await bloquearCita(c, idCita))!;
    const tipoEvento = tipoDelAviso(cita, familia);
    const usuario = tipoEvento === TIPO_CREDENCIALES ? await usuarioDelExpediente(c, cita.id_expediente) : null;
    const ancla = await anclaDeCita(c, idCita);
    if (!tipoEvento || !ancla || !(await esUltimaCitaDeVisita(c, idCita)) || (tipoEvento === TIPO_CREDENCIALES && !usuario)) {
      return { conflicto: new ErrorApi(409, "AVISO_NO_CORRESPONDE", "La cita no tiene un aviso pendiente en su estado actual") };
    }
    const idExpediente = cita.id_expediente;
    const decision = await decidirIntento(c, { idExpediente, tipoEvento, ancla });
    if (decision.accion === "cerrado" || decision.accion === "en_curso") return { conflicto: avisoYaRegistrado() };
    // M4, antes que el tope (ADR-07): si la familia ya cambió la contraseña, entró con la del último intento (cada
    // intento invalida la anterior, M2): ese correo llegó. Se cierra como enviado; no se rota ni se agota.
    if ((decision.accion === "retomar" || decision.accion === "agotar") && usuario && (await yaLaCambio(identidad, usuario))) {
      await actualizarEstadoEnvio(c, decision.ultima, "enviado");
      return { conflicto: avisoYaRegistrado() };
    }
    if (decision.accion === "agotar") {
      const cierre = await insertarIntento(c, { idExpediente, tipoEvento, estadoEnvio: "fallido" });
      return { conflicto: avisoAgotado(), ...(usuario ? { invalidar: { usuario, cierre } } : {}) };
    }
    const idNotificacion = await insertarIntento(c, { idExpediente, tipoEvento, estadoEnvio: "pendiente" });
    const base = { nombres: familia.nombres, campana: familia.campana_admision };
    let mensaje: { asunto: string; cuerpo: string };
    if (tipoEvento === TIPO_CREDENCIALES) {
      const contrasena = generarContrasenaTemporal();
      // Si Keycloak falla, la transacción se revierte (502) y no queda el intento: el barrido lo vuelve a tomar.
      await identidad.establecerContrasenaTemporal(usuario!, contrasena);
      mensaje = componerCredenciales({ ...base, usuario: familia.correo, contrasena, urlPortal: urlPortal() });
    } else if (tipoEvento === TIPO_REPROGRAMACION) {
      mensaje = componerReprogramacion({ ...base, enlaceVisita: enlaceVisita(idExpediente) });
    } else {
      mensaje = componerConfirmacion({ ...base, fecha: cita.fecha, hora: cita.hora_inicio, asistentes: cita.asistentes ?? "" });
    }
    return { reservado: { id_expediente: idExpediente, id_cita: idCita, id_notificacion: idNotificacion, tipo_evento: tipoEvento, ...mensaje } };
  });
  if ("conflicto" in r) {
    // M3 del tope: después del COMMIT, como el del cierre fallido (best effort).
    if (r.invalidar) await invalidarContrasena(identidad, r.invalidar.usuario, r.invalidar.cierre);
    throw r.conflicto;
  }
  return r.reservado;
}

// GET /internal/agendamiento/pendientes: solo ids de cita; n8n pide cada aviso con su reserva.
export async function avisosPendientes(): Promise<{ citas: { id_cita: number }[] }> {
  const ids = await listarAvisosPendientes(obtenerPool(), {
    minutosRegistro: MINUTOS_REGISTRO,
    minutosReintento: MINUTOS_REINTENTO,
    limite: MAXIMO_PENDIENTES,
  });
  return { citas: ids.map((id_cita) => ({ id_cita })) };
}

// PATCH /internal/notificaciones/:id: el cierre de siempre (HU0002) y, si es un aviso de credenciales que quedó
// `fallido` (rechazo o 400), M3 después del COMMIT.
export async function cerrarAviso(identidad: IdentidadAdmin, idNotificacion: number, estado: "enviado" | "fallido") {
  const cerrada = await cerrarNotificacion(idNotificacion, estado);
  if (estado === "fallido") {
    const n = await leerNotificacion(obtenerPool(), idNotificacion);
    const usuario = n?.tipo_evento === TIPO_CREDENCIALES ? await usuarioDelExpediente(obtenerPool(), n.id_expediente) : null;
    if (usuario) await invalidarContrasena(identidad, usuario, idNotificacion);
  }
  return cerrada;
}
