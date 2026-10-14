// Keycloak simulado en memoria para las pruebas de /personal (implementa IdentidadAdmin).
// Registra cada llamada en orden y permite hacer fallar un método para probar las compensaciones.
import { randomUUID } from "node:crypto";
import { ErrorApi } from "../src/errores";
import { ORIGEN_PERSONAL, type IdentidadAdmin, type RolPersonal } from "../src/identidad/keycloakAdmin";

export interface UsuarioFalso {
  id: string;
  correo: string;
  nombres: string;
  apellidos: string;
  habilitado: boolean;
  origen: string | null;
  roles: string[];
  credenciales: boolean;
  sesiones: number;
  enlaces: number;
}

type Metodo = keyof IdentidadAdmin;

export function crearIdentidadFalsa() {
  const usuarios = new Map<string, UsuarioFalso>();
  const llamadas: string[] = [];
  // Método → cuántas llamadas más deben fallar (Infinity = todas).
  const fallas = new Map<Metodo, number>();

  const fallarSi = (m: Metodo) => {
    const restantes = fallas.get(m) ?? 0;
    if (restantes <= 0) return;
    fallas.set(m, restantes - 1);
    throw new ErrorApi(502, "IDENTIDAD_NO_DISPONIBLE", "Keycloak simulado no disponible");
  };
  const usuario = (id: string) => {
    const u = usuarios.get(id);
    if (!u) throw new ErrorApi(502, "IDENTIDAD_NO_DISPONIBLE", "Usuario inexistente en el Keycloak simulado");
    return u;
  };
  const registrar = (m: Metodo, id?: string) => {
    llamadas.push(id ? `${m}:${id}` : m);
    fallarSi(m);
  };

  const identidad: IdentidadAdmin = {
    async crearUsuario({ correo, nombres, apellidos }) {
      registrar("crearUsuario");
      if ([...usuarios.values()].some((u) => u.correo === correo)) return null;
      const id = randomUUID();
      usuarios.set(id, {
        id, correo, nombres, apellidos, habilitado: false, origen: ORIGEN_PERSONAL,
        roles: [], credenciales: false, sesiones: 0, enlaces: 0,
      });
      return id;
    },
    async buscarPorCorreo(correo) {
      registrar("buscarPorCorreo");
      const u = [...usuarios.values()].find((x) => x.correo === correo);
      return u ? { id: u.id, habilitado: u.habilitado, origen: u.origen } : null;
    },
    async tieneCredenciales(id) {
      registrar("tieneCredenciales", id);
      return usuario(id).credenciales;
    },
    async actualizarNombres(id, nombres, apellidos) {
      registrar("actualizarNombres", id);
      Object.assign(usuario(id), { nombres, apellidos });
    },
    async establecerRolUnico(id, rol: RolPersonal) {
      registrar("establecerRolUnico", id);
      usuario(id).roles = [rol];
    },
    async habilitar(id) {
      registrar("habilitar", id);
      usuario(id).habilitado = true;
    },
    async deshabilitar(id) {
      registrar("deshabilitar", id);
      usuario(id).habilitado = false;
    },
    async cerrarSesiones(id) {
      registrar("cerrarSesiones", id);
      usuario(id).sesiones = 0;
    },
    async enviarEnlaceDefinirContrasena(id) {
      registrar("enviarEnlaceDefinirContrasena", id);
      usuario(id).enlaces++;
    },
    async eliminarUsuario(id) {
      registrar("eliminarUsuario", id);
      usuarios.delete(id);
    },
  };

  return {
    identidad,
    usuarios,
    llamadas,
    fallarEn: (...m: Metodo[]) => m.forEach((x) => fallas.set(x, Infinity)),
    fallarUnaVez: (m: Metodo) => fallas.set(m, 1),
    reparar: () => fallas.clear(),
    porCorreo: (correo: string) => [...usuarios.values()].filter((u) => u.correo === correo),
    // Usuario que ya existía en Keycloak antes del alta (p. ej. huérfano de un alta anterior o de una familia).
    sembrar(datos: Partial<UsuarioFalso> & { correo: string }): UsuarioFalso {
      const u: UsuarioFalso = {
        id: randomUUID(), nombres: "Previo", apellidos: "Ficticio", habilitado: false, origen: ORIGEN_PERSONAL,
        roles: [], credenciales: false, sesiones: 0, enlaces: 0, ...datos,
      };
      usuarios.set(u.id, u);
      return u;
    },
  };
}
