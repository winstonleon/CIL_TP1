<!-- Grupo de opciones con botones de radio de P05 y P05b (HU0005): «Sí / No» y la condición laboral. Con el valor `null`
     (sin responder, HU0005-2.0) no se marca ninguna opción. -->
<script setup lang="ts" generic="T extends string | boolean">
defineProps<{
  nombre: string;
  leyenda: string;
  opciones: { valor: T; etiqueta: string }[];
  requerido?: boolean;
  error?: string;
}>();
const modelo = defineModel<T | null>({ default: null });
</script>

<template>
  <fieldset class="grupo">
    <legend>{{ leyenda }} <span v-if="requerido" class="requerido" aria-hidden="true">*</span></legend>
    <div class="opciones">
      <label v-for="o in opciones" :key="String(o.valor)" class="opcion" :class="{ elegida: modelo === o.valor }">
        <input type="radio" :name="nombre" :checked="modelo === o.valor" @change="modelo = o.valor" />
        {{ o.etiqueta }}
      </label>
    </div>
    <p v-if="error" class="mensaje">{{ error }}</p>
  </fieldset>
</template>

<style scoped>
.grupo {
  margin: 0;
  padding: 0;
  border: none;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

legend {
  padding: 0;
  margin-bottom: 10px;
  font-size: 14px;
  font-weight: 600;
  color: var(--texto);
}

.requerido {
  color: var(--observado);
}

.opciones {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
}

.opcion {
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 46px;
  padding: 0 18px;
  border-radius: 10px;
  border: 1px solid var(--borde-campo);
  background: var(--superficie);
  font-size: 15px;
  font-weight: 600;
  color: var(--texto);
  cursor: pointer;
}

.opcion.elegida {
  border-color: var(--cil-azul);
  background: var(--seleccion-fondo);
}

input {
  width: 18px;
  height: 18px;
  margin: 0;
  accent-color: var(--cil-azul);
}

.mensaje {
  margin: 0;
  font-size: 13px;
  color: var(--observado);
}
</style>
