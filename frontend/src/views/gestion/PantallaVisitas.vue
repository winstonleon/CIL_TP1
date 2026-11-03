<!-- G04 · Visitas guiadas (Secretaría): la agenda con el registro de la asistencia (HU0004, AgendaVisitas) y, debajo
     de la tabla del día como en el mockup, la sección «Prospectos con contacto no entregado» (HU0002-2.0,
     VisitasGuiadas). Son dos componentes para que cada sección pida solo sus datos. -->
<script setup lang="ts">
import AgendaVisitas from "./AgendaVisitas.vue";
import VisitasGuiadas from "./VisitasGuiadas.vue";
</script>

<template>
  <AgendaVisitas>
    <VisitasGuiadas />
  </AgendaVisitas>
</template>
