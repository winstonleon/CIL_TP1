<!-- Contraste con la línea base del OE3 en G08 (D2-A, ajuste 1 de John). Sin valores dice que está por definir; con valores
     muestra actual, base, % de optimización y la meta. No está en el mockup. -->
<script setup lang="ts">
import { computed } from "vue";
import type { Indicadores } from "../../../api/indicadores";
import { conVacio, filasLineaBase, SIN_LINEA_BASE, textoCumple, textoPct } from "../../../gestion/indicadores";

const props = defineProps<{ indicadores: Indicadores }>();

const base = computed(() => props.indicadores.linea_base);
const filas = computed(() => filasLineaBase(props.indicadores));
</script>

<template>
  <section class="tarjeta" aria-labelledby="g08-base">
    <h2 id="g08-base">Contraste con la línea base</h2>
    <p v-if="!base.definida" class="suave" data-testid="sin-linea-base">{{ SIN_LINEA_BASE }}</p>
    <template v-else>
      <p class="suave" data-testid="meta">Meta de optimización: ≥ {{ base.meta_pct }} % · Fuente: {{ base.fuente ?? SIN_LINEA_BASE }}</p>
      <div class="tabla-envoltura">
        <table class="tabla" aria-label="Contraste con la línea base">
          <thead>
            <tr>
              <th scope="col">Indicador</th>
              <th scope="col">Línea base</th>
              <th scope="col">Actual</th>
              <th scope="col">Optimización</th>
              <th scope="col">Meta</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="f in filas" :key="f.indicador" data-testid="fila-base">
              <td>{{ f.indicador }}</td>
              <td>{{ conVacio(f.comparacion.base) }}</td>
              <td>{{ f.actual }}</td>
              <td>{{ textoPct(f.comparacion.optimizacion_pct) }}</td>
              <td>{{ textoCumple(f.comparacion) }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </template>
  </section>
</template>

<style scoped src="../validacion/validacion.css"></style>
