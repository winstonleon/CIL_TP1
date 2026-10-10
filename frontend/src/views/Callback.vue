<!-- Retorno desde Keycloak: completa el intercambio del código (PKCE) y vuelve a la ruta pedida. -->
<script setup lang="ts">
import { onMounted, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { completarInicioSesion, type ClienteOidc } from "../auth/oidc";

const ruta = useRoute();
const enrutador = useRouter();
const error = ref(false);

onMounted(async () => {
  try {
    const destino = await completarInicioSesion(ruta.params.cliente as ClienteOidc);
    await enrutador.replace(destino);
  } catch {
    error.value = true;
  }
});
</script>

<template>
  <main class="contenedor">
    <p v-if="error" data-testid="error-login">No se pudo completar el inicio de sesión. Vuelve a intentarlo.</p>
    <p v-else>Iniciando sesión…</p>
  </main>
</template>
