// G04, visitas guiadas (HU0004; rol secretaria, §4.6): agenda de la semana, visitas sin registrar de semanas anteriores
// (A5) y registro de la asistencia. G04 no registra atencion_inicio ni atencion_fin (no está en §4.7).
// «Asistió - Interesado en postular» (HU0004-1.0) crea la cuenta de la familia en Keycloak (rol familia) y en
// cuenta_acceso, deja la cita `asistio` y pasa el expediente a `portal_habilitado`. Como en HU0021, los cambios en
// Keycloak se hacen dentro de la transacción y, si algo falla, se compensan. «No asistió» (HU0004-2.0) deja la cita
// `no_asistio` («Visita no concretada») y devuelve el expediente a `prospecto` (P1). Los avisos los envía agendamiento.
import { enTransaccion, obtenerPool, type Consultable } from "../db/pool";
import { ErrorApi } from "../errores";
import { ORIGEN_FAMILIA, type IdentidadAdmin, type UsuarioIdentidad } from "../identidad/keycloakAdmin";
import { estadoDeAvisos } from "../repositories/aviso";
import { actualizarEstadoCita, bloquearCita, leerCita, listarVisitas, listarVisitasSinRegistrar, type FilaVisita } from "../repositories/cita";
import { existeCuentaDeUsuario, insertarCuentaAcceso } from "../repositories/cuentaAcceso";
import { bloquearDatosFamilia } from "../repositories/expediente";
import { actor } from "./actor";
import { compensarAlta } from "./altaIdentidad";
import { transicionarExpediente } from "./expedientes/transicionarExpediente";

export const RESULTADOS_ASISTENCIA = ["asistio_interesado", "no_asistio"] as const;
export type ResultadoAsistencia = (typeof RESULTADOS_ASISTENCIA)[number];

const DESTINO: Record<ResultadoAsistencia, { cita: "asistio" | "no_asistio"; expediente: string }> = {
  asistio_interesado: { cita: "asistio", expediente: "portal_habilitado" },
  no_asistio: { cita: "no_asistio", expediente: "prospecto" },
};

export interface Visita {
  id_cita: number;
  fecha: string;
  hora_inicio: string;
  estado_cita: string;
  id_expediente: number;
  estado_expediente: string;
  apoderado: { nombres: string; apellidos: string; telefono: string };
  grado: { nombre_grado: string };
  asistentes: string | null;
  aviso: { tipo_evento: string; estado_envio: string } | null;
}

const FECHA = /^\d{4}-\d{2}-\d{2}$/;

// Hoy en Lima, como «AAAA-MM-DD».
function hoyEnLima(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Lima", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

const sumarDias = (fecha: string, dias: number) => {
  const d = new Date(`${fecha}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
};

// Semana de lunes a domingo que contiene la fecha (de Lima).
export function semanaDe(fecha: string): { desde: string; hasta: string } {
  const dia = new Date(`${fecha}T00:00:00Z`).getUTCDay(); // 0 = domingo
  const desde = sumarDias(fecha, -((dia + 6) % 7));
  return { desde, hasta: sumarDias(desde, 6) };
}

export function fechaValida(fecha: string): boolean {
  return FECHA.test(fecha) && new Date(`${fecha}T00:00:00Z`).toISOString().slice(0, 10) === fecha;
}

async function conAviso(db: Consultable, filas: FilaVisita[]): Promise<Visita[]> {
  const avisos = await estadoDeAvisos(db, filas.map((f) => f.id_cita));
  return filas.map((f) => ({
    id_cita: f.id_cita,
    fecha: f.fecha,
    hora_inicio: f.hora_inicio,
    estado_cita: f.estado_cita,
    id_expediente: f.id_expediente,
    estado_expediente: f.estado_expediente,
    apoderado: { nombres: f.nombres, apellidos: f.apellidos, telefono: f.telefono },
    grado: { nombre_grado: f.nombre_grado },
    asistentes: f.asistentes,
    aviso: avisos.get(f.id_cita) ?? null,
  }));
}

// GET /visitas?fecha=: la semana de la fecha (por omisión, la de hoy) y las visitas reservadas de antes (A5). Sin DNI.
export async function visitasDeLaSemana(campana: string, fecha?: string) {
  const { desde, hasta } = semanaDe(fecha ?? hoyEnLima());
  const db = obtenerPool();
  return {
    desde,
    hasta,
    visitas: await conAviso(db, await listarVisitas(db, campana, desde, hasta)),
    sin_registrar: await conAviso(db, await listarVisitasSinRegistrar(db, campana, desde)),
  };
}

// Usuario huérfano de un alta de familia anterior: lo creó esta API (origen=api-familia), quedó deshabilitado, nunca
// tuvo contraseña y no tiene cuenta_acceso. Solo esos se adoptan; cualquier otro usuario con ese correo es un 409 (C28).
async function esHuerfanoFamilia(db: Consultable, identidad: IdentidadAdmin, u: UsuarioIdentidad): Promise<boolean> {
  if (u.origen !== ORIGEN_FAMILIA || u.habilitado) return false;
  if (await existeCuentaDeUsuario(db, u.id)) return false;
  return !(await identidad.tieneCredenciales(u.id));
}

const correoConCuenta = () =>
  new ErrorApi(409, "CORREO_CON_CUENTA", "El correo de la familia ya tiene una cuenta; no se registró la asistencia"); // C28

const esCuentaDuplicada = (e: unknown) => {
  const err = e as { code?: string; constraint?: string };
  return err?.code === "23505" && (err.constraint === "uq_cuenta_acceso_apoderado" || err.constraint === "uq_cuenta_acceso_keycloak");
};

// POST /visitas/:idCita/asistencia (HU0004-1.0 y 2.0).
export async function registrarAsistencia(
  identidad: IdentidadAdmin,
  keycloakUserIdActor: string,
  idCita: number,
  resultado: ResultadoAsistencia,
): Promise<{ id_cita: number; estado_cita: string; estado_expediente: string }> {
  const destino = DESTINO[resultado];
  let idIdentidad: string | null = null; // usuario de Keycloak que este registro creó o adoptó
  let paso = "crear_usuario";
  try {
    return await enTransaccion(async (c) => {
      const previa = await leerCita(c, idCita);
      if (!previa || previa.tipo_cita !== "visita") throw new ErrorApi(404, "VISITA_NO_ENCONTRADA", "La visita no existe");
      const familia = (await bloquearDatosFamilia(c, previa.id_expediente))!;
      const cita = (await bloquearCita(c, idCita))!;
      if (cita.estado !== "reservada") throw new ErrorApi(409, "VISITA_YA_REGISTRADA", "La asistencia de esta visita ya está registrada");
      if (familia.estado !== "visita_agendada") throw new ErrorApi(409, "ESTADO_DESACTUALIZADO", "El expediente cambió de estado; vuelve a cargarlo");
      const a = await actor(c, keycloakUserIdActor);

      if (resultado === "asistio_interesado") {
        const datos = { correo: familia.correo, nombres: familia.nombres, apellidos: familia.apellidos };
        const creado = await identidad.crearUsuario(datos, ORIGEN_FAMILIA);
        if (creado === null) {
          paso = "adoptar_usuario";
          const existente = await identidad.buscarPorCorreo(familia.correo);
          if (!existente || !(await esHuerfanoFamilia(c, identidad, existente))) throw correoConCuenta();
          idIdentidad = existente.id;
          await identidad.actualizarNombres(idIdentidad, familia.nombres, familia.apellidos);
        } else {
          idIdentidad = creado;
        }
        paso = "asignar_rol";
        await identidad.establecerRolUnico(idIdentidad, "familia");
        paso = "registrar";
        await insertarCuentaAcceso(c, familia.id_apoderado, idIdentidad);
      }

      await actualizarEstadoCita(c, idCita, destino.cita);
      await transicionarExpediente(c, {
        idExpediente: cita.id_expediente,
        campo: "estado",
        esperado: "visita_agendada",
        nuevo: destino.expediente,
        idPersonal: a.idPersonal,
        detalle: { id_cita: idCita, resultado, ...a.detalle },
      });
      if (idIdentidad) {
        paso = "habilitar";
        await identidad.habilitar(idIdentidad);
      }
      paso = "confirmar";
      return { id_cita: idCita, estado_cita: destino.cita, estado_expediente: destino.expediente };
    });
  } catch (e) {
    if (idIdentidad) await compensarAlta(identidad, idIdentidad, paso, "familia");
    if (esCuentaDuplicada(e)) throw correoConCuenta();
    throw e;
  }
}
