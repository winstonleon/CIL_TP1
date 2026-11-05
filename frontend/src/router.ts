import { createRouter, type RouterHistory } from "vue-router";
import { iniciarSesion, rolesDe, usuarioActual, type ClienteOidc } from "./auth/oidc";
import { useSesionStore } from "./stores/sesion";
import Callback from "./views/Callback.vue";
import Inicio from "./views/Inicio.vue";
import SesionIniciada from "./views/SesionIniciada.vue";
import LayoutGestion from "./views/gestion/LayoutGestion.vue";
import BandejaExpedientes from "./views/gestion/BandejaExpedientes.vue";
import ConfiguracionCampana from "./views/gestion/ConfiguracionCampana.vue";
import DetalleExpediente from "./views/gestion/DetalleExpediente.vue";
import UsuariosRoles from "./views/gestion/UsuariosRoles.vue";
import ValidacionesTesoreria from "./views/gestion/ValidacionesTesoreria.vue";
import PantallaVisitas from "./views/gestion/PantallaVisitas.vue";
import DerechoAdmision from "./views/portal/DerechoAdmision.vue";
import DocumentosExpediente from "./views/portal/DocumentosExpediente.vue";
import FichaInscripcion from "./views/portal/FichaInscripcion.vue";
import LayoutPortal from "./views/portal/LayoutPortal.vue";
import SolicitudInformacion from "./views/portal/SolicitudInformacion.vue";
import VisitaGuiada from "./views/portal/VisitaGuiada.vue";

declare module "vue-router" {
  interface RouteMeta {
    cliente?: ClienteOidc; // área protegida y cliente OIDC con que se inicia sesión
    titulo?: string; // título de la pantalla en el encabezado de la gestión interna
    tituloConCampana?: boolean; // el título lleva la campaña activa al final (G09, C23)
    roles?: string[]; // roles de realm que ven la pantalla (la API vuelve a exigirlos)
  }
}

export function crearEnrutador(historial: RouterHistory) {
  const enrutador = createRouter({
    history: historial,
    routes: [
      { path: "/", component: Inicio },
      // P01 (HU0001): PÚBLICA, sin meta.cliente, así que no inicia sesión ni envía token (ADR-17). Los enlaces de las
      // redes del colegio llevan ?origen=facebook o ?origen=instagram.
      { path: "/solicitud-informacion", component: SolicitudInformacion },
      // P02 (HU0003): PÚBLICA, sin meta.cliente, como P01. El enlace de la carpeta lleva ?t=<token> (ADR-18).
      { path: "/visita-guiada", component: VisitaGuiada },
      { path: "/portal", component: SesionIniciada, meta: { cliente: "portal" } },
      // P05 y P05b (HU0005): ficha de inscripción y cuestionario, solo para el rol familia (la API vuelve a exigirlo).
      {
        path: "/portal/ficha",
        component: LayoutPortal,
        meta: { cliente: "portal", roles: ["familia"] },
        children: [{ path: "", component: FichaInscripcion }],
      },
      // P06 (HU0006): carga de documentos. P07b (HU0007): registro del derecho de admisión, dentro de «Pagos» (P07 llega con
      // HU0013 y HU0014). Solo para el rol familia (la API vuelve a exigirlo).
      {
        path: "/portal/documentos",
        component: LayoutPortal,
        meta: { cliente: "portal", roles: ["familia"] },
        children: [{ path: "", component: DocumentosExpediente }],
      },
      {
        path: "/portal/pagos/derecho-admision",
        component: LayoutPortal,
        meta: { cliente: "portal", roles: ["familia"] },
        children: [{ path: "", component: DerechoAdmision }],
      },
      {
        path: "/gestion",
        component: LayoutGestion,
        meta: { cliente: "gestion" },
        children: [
          // Vista técnica del Sprint 0 hasta que lleguen las pantallas de cada rol.
          { path: "", component: SesionIniciada, meta: { titulo: "Gestión interna" } },
          // G10 (HU0021)
          { path: "usuarios", component: UsuariosRoles, meta: { titulo: "Usuarios y roles", roles: ["directora"] } },
          // G09 (HU0022)
          {
            path: "configuracion",
            component: ConfiguracionCampana,
            meta: { titulo: "Configuración de la campaña", tituloConCampana: true, roles: ["secretaria"] },
          },
          // G04: agenda y registro de la asistencia (HU0004) y «Prospectos con contacto no entregado» (HU0002-2.0).
          { path: "visitas", component: PantallaVisitas, meta: { titulo: "Visitas guiadas", roles: ["secretaria"] } },
          // G02 y G03 (HU0008): bandeja de expedientes y validación documental. G05 (HU0011 y HU0024): validaciones de Tesorería.
          { path: "bandeja", component: BandejaExpedientes, meta: { titulo: "Bandeja de expedientes", roles: ["secretaria"] } },
          { path: "bandeja/:id(\\d+)", component: DetalleExpediente, meta: { titulo: "Detalle del expediente", roles: ["secretaria"] } },
          { path: "tesoreria", component: ValidacionesTesoreria, meta: { titulo: "Validaciones de Tesorería", roles: ["tesoreria"] } },
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
