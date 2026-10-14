// Único módulo que usa la Admin API de Keycloak (rules/api.md, ADR-02). Se autentica con la service
// account del cliente confidencial api-admision (client credentials). La API no maneja contraseñas:
// el personal define la suya con el enlace que envía Keycloak (execute actions email).
// Los errores y logs solo incluyen el método, la ruta sin consulta y el estado HTTP (nunca tokens ni correos).
import { obtenerConfig } from "../config";
import { ErrorApi } from "../errores";

export const ROLES_PERSONAL = ["secretaria", "tesoreria", "psicologa", "evaluador_academico", "directora"] as const;
export type RolPersonal = (typeof ROLES_PERSONAL)[number];

// Roles de realm de la aplicación (ADR-02). Al fijar el rol de una cuenta se quitan los demás.
const ROLES_APP: readonly string[] = ["familia", ...ROLES_PERSONAL];

// Marca de las cuentas creadas por esta API, declarada en el perfil de usuario del realm (solo admin).
// Permite adoptar un usuario huérfano que dejó un alta fallida (plan HU0021, Q4).
export const ORIGEN_PERSONAL = "api-personal";

// ADR-02: el enlace para definir la contraseña vence en 72 h.
export const VIGENCIA_ENLACE_S = 72 * 3600;

// Cliente público de las pantallas G* (ADR-02): el enlace vuelve a la gestión interna.
const CLIENTE_GESTION = "gestion-interna";

export interface UsuarioIdentidad {
  id: string;
  habilitado: boolean;
  origen: string | null;
}

export interface DatosUsuario {
  correo: string;
  nombres: string;
  apellidos: string;
}

export interface IdentidadAdmin {
  /** Crea el usuario deshabilitado y con origen=api-personal. Devuelve su id, o null si el usuario ya existe. */
  crearUsuario(datos: DatosUsuario): Promise<string | null>;
  buscarPorCorreo(correo: string): Promise<UsuarioIdentidad | null>;
  tieneCredenciales(id: string): Promise<boolean>;
  actualizarNombres(id: string, nombres: string, apellidos: string): Promise<void>;
  /** Deja `rol` como único rol de la aplicación: primero quita los demás y después agrega el nuevo (falla cerrado). */
  establecerRolUnico(id: string, rol: RolPersonal): Promise<void>;
  habilitar(id: string): Promise<void>;
  deshabilitar(id: string): Promise<void>;
  cerrarSesiones(id: string): Promise<void>;
  enviarEnlaceDefinirContrasena(id: string): Promise<void>;
  eliminarUsuario(id: string): Promise<void>;
}

export interface OpcionesKeycloakAdmin {
  urlInterna: string;
  realm: string;
  clienteId: string;
  secreto: string;
  urlFrontend: string;
}

interface RolRepresentacion {
  id: string;
  name: string;
}

const sinBarraFinal = (url: string) => url.replace(/\/$/, "");

function noDisponible(): ErrorApi {
  return new ErrorApi(502, "IDENTIDAD_NO_DISPONIBLE", "El servicio de identidad no respondió; no se guardó ningún cambio");
}

export function crearKeycloakAdmin(o: OpcionesKeycloakAdmin): IdentidadAdmin {
  const base = sinBarraFinal(o.urlInterna);
  const admin = `${base}/admin/realms/${encodeURIComponent(o.realm)}`;
  let token: { valor: string; vence: number } | undefined;

  async function obtenerToken(): Promise<string> {
    if (token && Date.now() < token.vence) return token.valor;
    let res: Response;
    try {
      res = await fetch(`${base}/realms/${encodeURIComponent(o.realm)}/protocol/openid-connect/token`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ grant_type: "client_credentials", client_id: o.clienteId, client_secret: o.secreto }),
      });
    } catch {
      console.error("Keycloak: no responde al pedir el token de la service account");
      throw noDisponible();
    }
    if (!res.ok) {
      console.error(`Keycloak: token de la service account rechazado (HTTP ${res.status})`);
      throw noDisponible();
    }
    const cuerpo = (await res.json()) as { access_token: string; expires_in: number };
    // Se renueva 30 s antes de que venza.
    token = { valor: cuerpo.access_token, vence: Date.now() + Math.max(cuerpo.expires_in - 30, 0) * 1000 };
    return token.valor;
  }

  // Llama a la Admin API. `aceptar` lista estados no exitosos que el llamador maneja (p. ej. 409).
  async function llamar(metodo: string, ruta: string, cuerpo?: unknown, aceptar: number[] = []): Promise<Response> {
    const rutaLog = ruta.split("?")[0];
    let res: Response;
    try {
      res = await fetch(`${admin}${ruta}`, {
        method: metodo,
        headers: {
          Authorization: `Bearer ${await obtenerToken()}`,
          ...(cuerpo === undefined ? {} : { "Content-Type": "application/json" }),
        },
        body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
      });
    } catch (e) {
      if (e instanceof ErrorApi) throw e;
      console.error(`Keycloak: ${metodo} ${rutaLog} sin respuesta`);
      throw noDisponible();
    }
    if (!res.ok && !aceptar.includes(res.status)) {
      console.error(`Keycloak: ${metodo} ${rutaLog} → HTTP ${res.status}`);
      throw noDisponible();
    }
    return res;
  }

  async function representacion(id: string): Promise<Record<string, unknown>> {
    return (await (await llamar("GET", `/users/${encodeURIComponent(id)}`)).json()) as Record<string, unknown>;
  }

  // PUT con la representación completa: en Keycloak 24+ un PUT parcial puede borrar atributos del perfil.
  async function modificar(id: string, cambios: Record<string, unknown>): Promise<void> {
    await llamar("PUT", `/users/${encodeURIComponent(id)}`, { ...(await representacion(id)), ...cambios });
  }

  function aUsuario(u: Record<string, unknown>): UsuarioIdentidad {
    const atributos = (u.attributes ?? {}) as Record<string, unknown>;
    const origen = Array.isArray(atributos.origen) ? atributos.origen[0] : undefined;
    return { id: String(u.id), habilitado: u.enabled === true, origen: typeof origen === "string" ? origen : null };
  }

  async function buscarExacto(campo: "email" | "username", valor: string): Promise<UsuarioIdentidad | null> {
    const consulta = new URLSearchParams({ [campo]: valor, exact: "true", briefRepresentation: "false" });
    const lista = (await (await llamar("GET", `/users?${consulta}`)).json()) as Record<string, unknown>[];
    const encontrado = lista.find((u) => String(u[campo] ?? "").toLowerCase() === valor.toLowerCase());
    return encontrado ? aUsuario(encontrado) : null;
  }

  return {
    async crearUsuario({ correo, nombres, apellidos }) {
      const res = await llamar(
        "POST",
        "/users",
        {
          username: correo,
          email: correo,
          firstName: nombres,
          lastName: apellidos,
          enabled: false,
          attributes: { origen: [ORIGEN_PERSONAL] },
        },
        [409],
      );
      if (res.status === 409) return null;
      const id = res.headers.get("location")?.split("/").pop();
      if (!id) {
        console.error("Keycloak: POST /users sin cabecera Location");
        throw noDisponible();
      }
      return id;
    },

    async buscarPorCorreo(correo) {
      return (await buscarExacto("email", correo)) ?? (await buscarExacto("username", correo));
    },

    async tieneCredenciales(id) {
      const lista = (await (await llamar("GET", `/users/${encodeURIComponent(id)}/credentials`)).json()) as unknown[];
      return lista.length > 0;
    },

    async actualizarNombres(id, nombres, apellidos) {
      await modificar(id, { firstName: nombres, lastName: apellidos });
    },

    async establecerRolUnico(id, rol) {
      const ruta = `/users/${encodeURIComponent(id)}/role-mappings/realm`;
      const actuales = (await (await llamar("GET", ruta)).json()) as RolRepresentacion[];
      const sobrantes = actuales.filter((r) => ROLES_APP.includes(r.name) && r.name !== rol);
      if (sobrantes.length) await llamar("DELETE", ruta, sobrantes);
      if (actuales.some((r) => r.name === rol)) return;
      // Los roles asignables salen de /available: así no hace falta el permiso view-realm.
      const disponibles = (await (await llamar("GET", `${ruta}/available`)).json()) as RolRepresentacion[];
      const nuevo = disponibles.find((r) => r.name === rol);
      if (!nuevo) {
        console.error(`Keycloak: el rol de realm ${rol} no existe o no se puede asignar`);
        throw noDisponible();
      }
      await llamar("POST", ruta, [{ id: nuevo.id, name: nuevo.name }]);
    },

    async habilitar(id) {
      await modificar(id, { enabled: true });
    },

    async deshabilitar(id) {
      await modificar(id, { enabled: false });
    },

    async cerrarSesiones(id) {
      await llamar("POST", `/users/${encodeURIComponent(id)}/logout`);
    },

    async enviarEnlaceDefinirContrasena(id) {
      const consulta = new URLSearchParams({
        client_id: CLIENTE_GESTION,
        redirect_uri: `${sinBarraFinal(o.urlFrontend)}/gestion`,
        lifespan: String(VIGENCIA_ENLACE_S),
      });
      await llamar("PUT", `/users/${encodeURIComponent(id)}/execute-actions-email?${consulta}`, ["UPDATE_PASSWORD"]);
    },

    async eliminarUsuario(id) {
      await llamar("DELETE", `/users/${encodeURIComponent(id)}`);
    },
  };
}

export function crearKeycloakAdminDesdeConfig(): IdentidadAdmin {
  const c = obtenerConfig();
  return crearKeycloakAdmin({
    urlInterna: c.KEYCLOAK_INTERNAL_URL,
    realm: c.KEYCLOAK_REALM,
    clienteId: c.KEYCLOAK_API_CLIENT_ID,
    secreto: c.KEYCLOAK_API_CLIENT_SECRET,
    urlFrontend: c.FRONTEND_PUBLIC_URL,
  });
}
