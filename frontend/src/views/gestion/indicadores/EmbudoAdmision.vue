<!-- Embudo de admisión de G08: los expedientes que alcanzaron cada etapa y su tasa de conversión (HU0019-1.0). -->
<script setup lang="ts">
import { computed } from "vue";
import type { EtapaEmbudo } from "../../../api/indicadores";
import { proporcion, textoPct } from "../../../gestion/indicadores";

const props = defineProps<{ etapas: EtapaEmbudo[] }>();

const maximo = computed(() => Math.max(0, ...props.etapas.map((e) => e.total)));
</script>

<template>
  <section class="tarjeta" aria-labelledby="g08-embudo">
    <h2 id="g08-embudo">Embudo de admisión</h2>
    <ul class="embudo">
      <li v-for="(e, i) in etapas" :key="e.etapa" :data-testid="`embudo-${e.etapa}`">
        <span class="etiqueta">{{ e.titulo }}</span>
        <span class="pista" aria-hidden="true">
          <span class="barra" :class="{ dorada: i === etapas.length - 1 }" :style="{ width: `${proporcion(e.total, maximo)}%` }"></span>
        </span>
        <span class="total">{{ e.total }}</span>
        <span class="conversion" :data-testid="`conversion-${e.etapa}`">{{ i === 0 ? "" : textoPct(e.conversion_pct) }}</span>
      </li>
    </ul>
    <p class="suave">El porcentaje es la conversión desde la etapa anterior.</p>
  </section>
</template>

<style scoped src="../validacion/validacion.css"></style>

<style scoped>
.embudo {
  margin: 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.embudo li {
  display: flex;
  align-items: center;
  gap: 14px;
}

.etiqueta {
  width: 190px;
  flex-shrink: 0;
  font-size: 14px;
}

.pista {
  flex-grow: 1;
  height: 26px;
  border-radius: 6px;
  background: var(--inactivo-fondo);
  display: flex;
}

.barra {
  height: 26px;
  border-radius: 6px;
  background: var(--cil-azul);
}

.barra.dorada {
  background: var(--cil-dorado);
}

.total {
  width: 40px;
  text-align: right;
  font-size: 14px;
  font-weight: 700;
}

.conversion {
  width: 62px;
  text-align: right;
  font-size: 13px;
  color: var(--texto-suave);
}

@media (max-width: 600px) {
  .etiqueta {
    width: 120px;
  }
}
</style>
