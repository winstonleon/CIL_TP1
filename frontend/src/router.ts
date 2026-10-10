import { createRouter, type RouterHistory } from "vue-router";
import { iniciarSesion, usuarioActual, type ClienteOidc } from "./auth/oidc";
import { useSesionStore } from "./stores/sesion";
import Callback from "./views/Callback.vue";
import Inicio from "./views/Inicio.vue";
import SesionIniciada from "./views/SesionIniciada.vue";

declare module "vue-router" {
  interface RouteMeta {
    cliente?: ClienteOidc; // área protegida y cliente OIDC con que se inicia sesión
  }
}

export function crearEnrutador(historial: RouterHistory) {
  const enrutador = createRouter({
    history: historial,
    routes: [
      { path: "/", component: Inicio },
      { path: "/portal", component: SesionIniciada, meta: { cliente: "portal" } },
      { path: "/gestion", component: SesionIniciada, meta: { cliente: "gestion" } },
      { path: "/callback/:cliente(portal|gestion)", component: Callback },
    ],
  });

  // Sin sesión del cliente de la ruta, se redirige al login de Keycloak y se vuelve a la misma ruta.
  enrutador.beforeEach(async (to) => {
    const cliente = to.meta.cliente;
    if (!cliente) return true;
    const usuario = await usuarioActual(cliente);
    if (!usuario) {
      await iniciarSesion(cliente, to.fullPath);
      return false;
    }
    useSesionStore().establecer(cliente, usuario);
    return true;
  });

  return enrutador;
}
