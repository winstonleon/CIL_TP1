<!-- Vista técnica del Sprint 0 (no es una pantalla de los mockups): confirma que el login con Keycloak
     funciona y muestra el nombre y los roles del token. Las pantallas de las HU la reemplazan. -->
<script setup lang="ts">
import { computed } from "vue";
import { useSesionStore } from "../stores/sesion";

const sesion = useSesionStore();
const area = computed(() => (sesion.cliente === "portal" ? "Portal de familias" : "Gestión interna"));
</script>

<template>
  <main class="contenedor">
    <h1 data-testid="estado-sesion">Sesión iniciada</h1>
    <p data-testid="area">{{ area }}</p>
    <p data-testid="nombre">{{ sesion.nombre }}</p>
    <ul data-testid="roles">
      <li v-for="rol in sesion.roles" :key="rol">{{ rol }}</li>
    </ul>
  </main>
</template>
