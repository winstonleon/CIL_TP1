<!-- Título del día de la agenda («Martes 27 de octubre», G06 y G11) con el día anterior y el siguiente. Los mockups solo
     muestran el día: los botones permiten llegar a una cita de otro día (p. ej. la entrevista, para el dictamen). -->
<script setup lang="ts">
import { computed } from "vue";
import { tituloDia } from "../../../gestion/dictamen";

const props = defineProps<{ fecha: string }>();
const emit = defineEmits<{ mover: [dias: number] }>();

const titulo = computed(() => tituloDia(props.fecha));
</script>

<template>
  <div class="selector-dia">
    <button type="button" class="flecha" aria-label="Día anterior" data-testid="dia-anterior" @click="emit('mover', -1)">‹</button>
    <h2 class="dia" data-testid="titulo-dia">{{ titulo }}</h2>
    <button type="button" class="flecha" aria-label="Día siguiente" data-testid="dia-siguiente" @click="emit('mover', 1)">›</button>
  </div>
</template>

<style scoped>
.selector-dia {
  display: flex;
  align-items: center;
  gap: 10px;
}

.dia {
  margin: 0;
  flex-grow: 1;
  font-family: var(--fuente-titulos);
  font-size: 22px;
  font-weight: 600;
  color: var(--cil-azul);
}

.flecha {
  width: 44px;
  height: 44px;
  border: 1px solid var(--borde);
  border-radius: 10px;
  background: var(--superficie);
  color: var(--cil-azul);
  font-size: 20px;
  cursor: pointer;
}

.flecha:focus-visible {
  outline: 3px solid var(--cil-dorado);
  outline-offset: 2px;
}
</style>
