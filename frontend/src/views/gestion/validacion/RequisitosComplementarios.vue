<!-- Sección de G03 con los requisitos complementarios de un dictamen «En observación» (HU0010-2.0, R13, decisión D4b-B):
     Secretaría los coordina con la familia antes del nuevo dictamen. Solo lectura; nunca muestra las conclusiones ni el
     informe psicológico (R3), que la API tampoco envía. El mockup de G03 no la dibuja (ADR-25). -->
<script setup lang="ts">
import { computed } from "vue";
import type { RequisitosComplementarios } from "../../../api/dictamen";
import { nombreCompleto } from "../../../gestion/validacion";
import { fechaHora } from "../../../portal/formato";

const props = defineProps<{ requisitos: RequisitosComplementarios }>();

const subtitulo = computed(() => `${props.requisitos.codigo} · ${props.requisitos.grado}`);
</script>

<template>
  <section class="tarjeta requisitos" data-testid="requisitos-complementarios">
    <div class="identidad">
      <h1 class="postulante">{{ nombreCompleto(requisitos.postulante) }}</h1>
      <span class="datos">{{ subtitulo }}</span>
    </div>
    <span class="chip observado">En observación</span>
    <h2>Requisitos complementarios del dictamen</h2>
    <p class="texto" data-testid="texto-requisitos">{{ requisitos.requisitos_complementarios }}</p>
    <p class="suave">Registrado por Psicología el {{ fechaHora(requisitos.fecha_emision) }}. Coordina con la familia antes del nuevo dictamen.</p>
  </section>
</template>

<style scoped src="./validacion.css"></style>

<style scoped>
.requisitos {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 12px;
}

.identidad {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.postulante {
  margin: 0;
  font-family: var(--fuente-titulos);
  font-size: 24px;
  color: var(--cil-azul);
}

.datos {
  font-size: 14px;
  color: var(--texto-suave);
}

.texto {
  margin: 0;
  white-space: pre-wrap;
}
</style>
