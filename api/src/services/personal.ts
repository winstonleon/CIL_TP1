// Cuentas del personal (HU0021, pantalla G10). Toda alta, modificación o desactivación se audita como
// gestion_usuario en la misma transacción que el cambio en `personal` (modelo de datos §4.7).
// Keycloak es la identidad (ADR-02): sus cambios se hacen dentro de la transacción, antes del COMMIT,
// y si algo falla se compensan. Las compensaciones fallan cerrado: nunca dejan una cuenta habilitada de más.
import { enTransaccion, obtenerPool, type Consultable } from "../db/pool";
import { ErrorApi } from "../errores";
import { ORIGEN_PERSONAL, type IdentidadAdmin, type RolPersonal, type UsuarioIdentidad } from "../identidad/keycloakAdmin";
import { insertarEvento } from "../repositories/auditoria";
import {
  actualizarPersonal,
  bloquearCorreo,
  bloquearPersonal,
  buscarIdPersonalPorKeycloak,
  existeCorreo,
  insertarPersonal,
  listarPersonal as listarFilas,
  marcarInactivo,
  type FilaPersonal,
  type FilaPersonalConIdentidad,
} from "../repositories/personal";

export interface DatosAlta {
  nombres: string;
  apellidos: string;
  correo: string;
  rol: RolPersonal;
}

export interface CambiosPersonal {
  nombres?: string;
  apellidos?: string;
  rol?: RolPersonal;
}

const correoDuplicado = () => new ErrorApi(409, "CORREO_DUPLICADO", "Ya existe una cuenta con ese correo");

// Quién actúa (la directora). Si no tiene fila en personal (C18), se guarda su id de Keycloak en el detalle.
async function actor(db: Consultable, keycloakUserId: string) {
  const idPersonal = await buscarIdPersonalPorKeycloak(db, keycloakUserId);
  return { idPersonal, detalle: idPersonal === null ? { actor_keycloak_user_id: keycloakUserId } : {} };
}

async function registrarGestion(db: Consultable, keycloakUserIdActor: string, detalle: Record<string, unknown>) {
  const a = await actor(db, keycloakUserIdActor);
  await insertarEvento(db, { tipoEvento: "gestion_usuario", idPersonal: a.idPersonal, detalle: { ...detalle, ...a.detalle } });
}

// Usuario huérfano de un alta anterior (plan HU0021, Q4): lo creó esta API (origen=api-personal), quedó
// deshabilitado, nunca definió contraseña y no está en `personal`. Solo esos se adoptan.
async function esHuerfano(db: Consultable, identidad: IdentidadAdmin, u: UsuarioIdentidad): Promise<boolean> {
  if (u.origen !== ORIGEN_PERSONAL || u.habilitado) return false;
  if ((await buscarIdPersonalPorKeycloak(db, u.id)) !== null) return false;
  return !(await identidad.tieneCredenciales(u.id));
}

// Deshace el usuario que creó o adoptó un alta fallida. Si no se puede borrar, al menos se deshabilita y se
// deja en el log (solo ids) para que un nuevo intento con el mismo correo lo adopte.
async function compensarAlta(identidad: IdentidadAdmin, idIdentidad: string, paso: string): Promise<void> {
  try {
    await identidad.eliminarUsuario(idIdentidad);
    return;
  } catch {
    // se intenta deshabilitar abajo
  }
  let deshabilitado = true;
  try {
    await identidad.deshabilitar(idIdentidad);
  } catch {
    deshabilitado = false;
  }
  console.error(
    `Alta de personal incompleta: el usuario de Keycloak ${idIdentidad} quedó huérfano ` +
      `(paso: ${paso}; deshabilitado: ${deshabilitado ? "sí" : "no"}). Un nuevo intento con el mismo correo lo adopta.`,
  );
}

const esUnicidadCorreo = (e: unknown) => {
  const err = e as { code?: string; constraint?: string };
  return err?.code === "23505" && err.constraint === "uq_personal_correo";
};

export async function listarPersonal(): Promise<FilaPersonal[]> {
  return listarFilas(obtenerPool());
}

// HU0021-1.0: crea la cuenta con su rol y Keycloak envía el enlace para definir la contraseña (72 h).
export async function crearPersonal(identidad: IdentidadAdmin, keycloakUserIdActor: string, datos: DatosAlta): Promise<FilaPersonal> {
  let idIdentidad: string | null = null; // usuario de Keycloak que esta alta creó o adoptó
  let paso = "crear_usuario";
  try {
    return await enTransaccion(async (c) => {
      await bloquearCorreo(c, datos.correo);
      if (await existeCorreo(c, datos.correo)) throw correoDuplicado();

      let adoptado = false;
      const creado = await identidad.crearUsuario(datos);
      if (creado === null) {
        paso = "adoptar_usuario";
        const existente = await identidad.buscarPorCorreo(datos.correo);
        if (!existente || !(await esHuerfano(c, identidad, existente))) throw correoDuplicado();
        idIdentidad = existente.id;
        adoptado = true;
        await identidad.actualizarNombres(idIdentidad, datos.nombres, datos.apellidos);
      } else {
        idIdentidad = creado;
      }

      paso = "asignar_rol";
      await identidad.establecerRolUnico(idIdentidad, datos.rol);
      paso = "registrar";
      const fila = await insertarPersonal(c, { ...datos, keycloakUserId: idIdentidad });
      await registrarGestion(c, keycloakUserIdActor, {
        accion: "alta",
        id_personal_afectado: fila.id_personal,
        rol: fila.rol,
        enlace_contrasena: "enviado",
        ...(adoptado ? { adoptado: true } : {}),
      });
      paso = "habilitar";
      await identidad.habilitar(idIdentidad);
      paso = "enviar_enlace";
      await identidad.enviarEnlaceDefinirContrasena(idIdentidad);
      paso = "confirmar";
      return fila;
    });
  } catch (e) {
    if (idIdentidad) await compensarAlta(identidad, idIdentidad, paso);
    if (esUnicidadCorreo(e)) throw correoDuplicado();
    throw e;
  }
}

async function cuentaActiva(db: Consultable, idPersonal: number): Promise<FilaPersonalConIdentidad> {
  const actual = await bloquearPersonal(db, idPersonal);
  if (!actual) throw new ErrorApi(404, "NO_ENCONTRADO", "La cuenta no existe");
  if (!actual.activo) throw new ErrorApi(409, "CUENTA_INACTIVA", "La cuenta está desactivada");
  return actual;
}

const sinIdentidad = ({ keycloak_user_id: _, ...fila }: FilaPersonalConIdentidad): FilaPersonal => fila;

// HU0021-3.0: cambia nombres, apellidos o rol. El correo no se modifica (plan HU0021, Q1).
// El token vigente conserva el rol anterior hasta que vence (ventana aceptada, Q2; compromiso C22).
export async function modificarPersonal(
  identidad: IdentidadAdmin,
  keycloakUserIdActor: string,
  idPersonal: number,
  cambios: CambiosPersonal,
): Promise<FilaPersonal> {
  const restauraciones: Array<() => Promise<void>> = [];
  let idIdentidad = "";
  try {
    return await enTransaccion(async (c) => {
      const actual = await cuentaActiva(c, idPersonal);
      idIdentidad = actual.keycloak_user_id;
      const nuevo = {
        nombres: cambios.nombres ?? actual.nombres,
        apellidos: cambios.apellidos ?? actual.apellidos,
        rol: cambios.rol ?? (actual.rol as RolPersonal),
      };
      const campos = (["nombres", "apellidos", "rol"] as const).filter((k) => nuevo[k] !== actual[k]);
      if (!campos.length) return sinIdentidad(actual);

      const fila = await actualizarPersonal(c, idPersonal, nuevo);
      // Sin los valores de los nombres: la bitácora no guarda datos personales.
      await registrarGestion(c, keycloakUserIdActor, {
        accion: "modificacion",
        id_personal_afectado: idPersonal,
        campos,
        ...(campos.includes("rol") ? { rol_anterior: actual.rol, rol_nuevo: nuevo.rol } : {}),
      });
      if (campos.includes("nombres") || campos.includes("apellidos")) {
        restauraciones.push(() => identidad.actualizarNombres(idIdentidad, actual.nombres, actual.apellidos));
        await identidad.actualizarNombres(idIdentidad, nuevo.nombres, nuevo.apellidos);
      }
      if (campos.includes("rol")) {
        restauraciones.push(() => identidad.establecerRolUnico(idIdentidad, actual.rol as RolPersonal));
        await identidad.establecerRolUnico(idIdentidad, nuevo.rol);
      }
      return fila;
    });
  } catch (e) {
    for (const restaurar of restauraciones.reverse()) {
      try {
        await restaurar();
      } catch {
        console.error(`Modificación de personal incompleta: el usuario de Keycloak ${idIdentidad} quedó distinto de personal; reintentar la modificación`);
      }
    }
    throw e;
  }
}

// HU0021-4.0: la persona ya no puede iniciar sesión (Keycloak deshabilitado y sin sesiones), la fila se
// conserva con activo = false y el historial de auditoría queda intacto.
export async function desactivarPersonal(identidad: IdentidadAdmin, keycloakUserIdActor: string, idPersonal: number): Promise<FilaPersonal> {
  let idIdentidad = "";
  let deshabilitado = false;
  try {
    return await enTransaccion(async (c) => {
      const actual = await cuentaActiva(c, idPersonal);
      idIdentidad = actual.keycloak_user_id;
      const fila = await marcarInactivo(c, idPersonal);
      await registrarGestion(c, keycloakUserIdActor, { accion: "desactivacion", id_personal_afectado: idPersonal });
      await identidad.deshabilitar(idIdentidad);
      deshabilitado = true;
      await identidad.cerrarSesiones(idIdentidad);
      return fila;
    });
  } catch (e) {
    // Falla cerrado: si Keycloak ya la deshabilitó, no se vuelve a habilitar.
    if (deshabilitado) {
      console.error(`Desactivación de personal incompleta: el usuario de Keycloak ${idIdentidad} quedó deshabilitado; reintentar la desactivación`);
    }
    throw e;
  }
}
