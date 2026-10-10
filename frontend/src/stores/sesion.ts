import type { User } from "oidc-client-ts";
import { defineStore } from "pinia";
import { computed, ref } from "vue";
import { rolesDe, type ClienteOidc } from "../auth/oidc";

// Roles de la aplicación (ADR-02). Keycloak agrega otros roles técnicos que no se muestran.
const ROLES_APP = ["familia", "secretaria", "tesoreria", "psicologa", "evaluador_academico", "directora"];

export const useSesionStore = defineStore("sesion", () => {
  const usuario = ref<User | null>(null);
  const cliente = ref<ClienteOidc | null>(null);

  const nombre = computed(() => {
    const p = usuario.value?.profile;
    return p ? (p.name ?? [p.given_name, p.family_name].filter(Boolean).join(" ")) : "";
  });
  const roles = computed(() => (usuario.value ? rolesDe(usuario.value).filter((r) => ROLES_APP.includes(r)) : []));

  function establecer(nuevoCliente: ClienteOidc, nuevoUsuario: User) {
    cliente.value = nuevoCliente;
    usuario.value = nuevoUsuario;
  }

  return { usuario, cliente, nombre, roles, establecer };
});
