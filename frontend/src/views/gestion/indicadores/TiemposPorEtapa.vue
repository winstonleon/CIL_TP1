<!-- Lead time y cycle time por etapa de G08 (D5-A, ADR-27). El mockup dibuja el «cycle time» en días y en seis etapas, pero el
     cycle time de ADR-05 son pares de atención, y dos etapas no tienen atención del personal. Por eso cada etapa muestra el
     tramo en días (la barra) y la atención en horas. -->
<script setup lang="ts">
import { computed } from "vue";
import type { EtapaTiempo } from "../../../api/indicadores";
import { proporcion, textoCycle, textoDias } from "../../../gestion/indicadores";

const props = defineProps<{ etapas: EtapaTiempo[] }>();

const maximo = computed(() => Math.max(0, ...props.etapas.map((e) => e.tramo_dias ?? 0)));
</script>

<template>
  <section class="tarjeta" aria-labelledby="g08-tiempos">
    <h2 id="g08-tiempos">Lead time y cycle time por etapa</h2>
    <div class="columnas">
      <div v-for="e in etapas" :key="e.etapa" class="columna" :data-testid="`etapa-${e.etapa}`">
        <span class="valor" data-testid="tramo">{{ textoDias(e.tramo_dias) }}</span>
        <span class="barra" :style="{ height: `${proporcion(e.tramo_dias ?? 0, maximo) * 2}px` }" aria-hidden="true"></span>
        <span class="titulo">{{ e.titulo }}</span>
        <span class="atencion" data-testid="cycle">{{ textoCycle(e) }}</span>
      </div>
    </div>
    <p class="suave">
      La barra es el tiempo promedio de cada tramo, según las transiciones del expediente. La atención se calcula con los registros de inicio y fin de
      atención del personal en el registro de auditoría.
    </p>
  </section>
</template>

<style scoped src="../validacion/validacion.css"></style>

<style scoped>
.columnas {
  display: flex;
  align-items: flex-end;
  gap: 10px;
  min-height: 280px;
}

.columna {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
}

.valor {
  font-size: 14px;
  font-weight: 700;
}

.barra {
  width: 56px;
  max-width: 100%;
  border-radius: 6px 6px 0 0;
  background: var(--cil-azul);
}

.titulo,
.atencion {
  font-size: 12px;
  text-align: center;
  line-height: 1.3;
  color: var(--texto-suave);
}

.atencion {
  min-height: 46px;
  color: var(--texto);
}

@media (max-width: 600px) {
  .columnas {
    overflow-x: auto;
  }

  .columna {
    flex: 0 0 96px;
  }
}
</style>
