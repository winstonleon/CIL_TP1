<!-- Filtros y exportación de G08 (HU0019). Desvíos del mockup (ADR-27): «Grado» en vez de «Nivel», y fechas `desde` y `hasta`
     en vez de un select de periodo. El rango filtra por la fecha de registro del expediente. -->
<script setup lang="ts">
import { computed } from "vue";
import type { Filtros, OpcionesFiltro } from "../../../api/indicadores";

const props = defineProps<{ opciones: OpcionesFiltro; ocupado: boolean }>();
const filtros = defineModel<Filtros>({ required: true });
const emit = defineEmits<{ actualizar: []; exportar: [] }>();

const grados = computed(() => props.opciones.grados.filter((g) => g.campana === filtros.value.campana));

function cambiarCampana(evento: Event) {
  filtros.value = { ...filtros.value, campana: (evento.target as HTMLSelectElement).value, id_grado: null };
}

function cambiarGrado(evento: Event) {
  const valor = (evento.target as HTMLSelectElement).value;
  filtros.value = { ...filtros.value, id_grado: valor ? Number(valor) : null };
}

function cambiarFecha(campo: "desde" | "hasta", evento: Event) {
  filtros.value = { ...filtros.value, [campo]: (evento.target as HTMLInputElement).value };
}
</script>

<template>
  <div class="filtros">
    <div class="campo">
      <label for="g08c">Campaña</label>
      <select id="g08c" :value="filtros.campana" data-testid="filtro-campana" @change="cambiarCampana">
        <option v-for="c in opciones.campanas" :key="c" :value="c">Admisión {{ c }}</option>
      </select>
    </div>
    <div class="campo">
      <label for="g08g">Grado</label>
      <select id="g08g" :value="filtros.id_grado ?? ''" data-testid="filtro-grado" @change="cambiarGrado">
        <option value="">Todos los grados</option>
        <option v-for="g in grados" :key="g.id_grado" :value="g.id_grado">{{ g.grado }}</option>
      </select>
    </div>
    <div class="campo">
      <label for="g08d">Desde</label>
      <input id="g08d" type="date" :value="filtros.desde" data-testid="filtro-desde" @change="cambiarFecha('desde', $event)" />
    </div>
    <div class="campo">
      <label for="g08h">Hasta</label>
      <input id="g08h" type="date" :value="filtros.hasta" data-testid="filtro-hasta" @change="cambiarFecha('hasta', $event)" />
    </div>
    <button type="button" class="boton" :disabled="ocupado" data-testid="actualizar" @click="emit('actualizar')">Actualizar métricas</button>
    <div class="exportar">
      <button type="button" class="boton" :disabled="ocupado" data-testid="exportar" @click="emit('exportar')">Exportar reporte ejecutivo</button>
      <span class="suave">Excel · No incluye datos personales de los postulantes.</span>
    </div>
  </div>
</template>

<style scoped src="../validacion/validacion.css"></style>

<style scoped>
.filtros {
  display: flex;
  flex-wrap: wrap;
  gap: 14px;
  align-items: flex-end;
}

.filtros .campo {
  width: 190px;
}

.exportar {
  margin-left: auto;
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 6px;
}

@media (max-width: 600px) {
  .filtros .campo {
    width: 100%;
  }

  .exportar {
    margin-left: 0;
    align-items: flex-start;
  }
}
</style>
