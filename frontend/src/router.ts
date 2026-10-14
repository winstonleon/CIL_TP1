import { createRouter, type RouterHistory } from "vue-router";
import { iniciarSesion, rolesDe, usuarioActual, type ClienteOidc } from "./auth/oidc";
import { useSesionStore } from "./stores/sesion";
import Callback from "./views/Callback.vue";
import Inicio from "./views/Inicio.vue";
import SesionIniciada from "./views/SesionIniciada.vue";
import LayoutGestion from "./views/gestion/LayoutGestion.vue";
import UsuariosRoles from "./views/gestion/UsuariosRoles.vue";

declare module "vue-router" {
  interface RouteMeta {
    cliente?: ClienteOidc; // área protegida y cliente OIDC con que se inicia sesión
    titulo?: string; // título de la pantalla en el encabezado de la gestión interna
    roles?: string[]; // roles de realm que ven la pantalla (la API vuelve a exigirlos)
  }
}

export function crearEnrutador(historial: RouterHistory) {
  const enrutador = createRouter({
    history: historial,
    routes: [
      { path: "/", component: Inicio },
      { path: "/portal", component: SesionIniciada, meta: { cliente: "portal" } },
      {
        path: "/gestion",
        component: LayoutGestion,
        meta: { cliente: "gestion" },
        children: [
          // Vista técnica del Sprint 0 hasta que lleguen las pantallas de cada rol.
          { path: "", component: SesionIniciada, meta: { titulo: "Gestión interna" } },
          // G10 (HU0021)
          { path: "usuarios", component: UsuariosRoles, meta: { titulo: "Usuarios y roles", roles: ["directora"] } },
        ],
      },
      { path: "/callback/:cliente(portal|gestion)", component: Callback },
    ],
  });

  // Sin sesión del cliente de la ruta, se redirige al login de Keycloak y se vuelve a la misma ruta.
  // Una pantalla de otro rol vuelve al inicio del área; la autorización real la hace la API (requireRol).
  enrutador.beforeEach(async (to) => {
    const cliente = to.meta.cliente;
    if (!cliente) return true;
    const usuario = await usuarioActual(cliente);
    if (!usuario) {
      await iniciarSesion(cliente, to.fullPath);
      return false;
    }
    useSesionStore().establecer(cliente, usuario);
    const requeridos = to.meta.roles;
    if (requeridos && !requeridos.some((r) => rolesDe(usuario).includes(r))) {
      return `/${cliente}`;
    }
    return true;
  });

  return enrutador;
}
