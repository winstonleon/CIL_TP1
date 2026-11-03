<!-- Campo de texto, lista o área de texto de P05 y P05b (HU0005), con el estilo del mockup: etiqueta con «*» en el color
     «observado», altura de 46 px y el error bajo el campo en el mismo color (#8A4B08, HU0001-2.0). -->
<script setup lang="ts">
import { computed } from "vue";

const props = defineProps<{
  id: string;
  etiqueta: string;
  tipo?: "text" | "tel" | "email" | "date" | "textarea";
  opciones?: { valor: string; etiqueta: string }[]; // con opciones es una lista desplegable
  requerido?: boolean;
  error?: string;
  deshabilitado?: boolean;
  maximo?: number;
}>();
const modelo = defineModel<string>({ default: "" });
const idError = computed(() => `${props.id}-error`);
</script>

<template>
  <div class="campo">
    <label :for="id">{{ etiqueta }} <span v-if="requerido" class="requerido" aria-hidden="true">*</span></label>
    <select
      v-if="opciones"
      :id="id"
      v-model="modelo"
      :class="{ invalido: error }"
      :disabled="deshabilitado"
      :aria-invalid="!!error"
      :aria-describedby="error ? idError : undefined"
    >
      <option value="">Selecciona</option>
      <option v-for="o in opciones" :key="o.valor" :value="o.valor">{{ o.etiqueta }}</option>
    </select>
    <textarea
      v-else-if="tipo === 'textarea'"
      :id="id"
      v-model="modelo"
      rows="5"
      :maxlength="maximo"
      :class="{ invalido: error }"
      :disabled="deshabilitado"
      :aria-invalid="!!error"
      :aria-describedby="error ? idError : undefined"
    />
    <input
      v-else
      :id="id"
      v-model="modelo"
      :type="tipo ?? 'text'"
      :maxlength="maximo"
      :class="{ invalido: error }"
      :disabled="deshabilitado"
      :aria-invalid="!!error"
      :aria-describedby="error ? idError : undefined"
    />
    <p v-if="error" :id="idError" class="mensaje">{{ error }}</p>
  </div>
</template>

<style scoped>
.campo {
  display: flex;
  flex-direction: column;
  gap: 6px;
  width: 100%;
}

label {
  font-size: 14px;
  font-weight: 600;
  color: var(--texto);
}

.requerido {
  color: var(--observado);
}

input,
select,
textarea {
  box-sizing: border-box;
  width: 100%;
  padding: 0 14px;
  border: 1px solid var(--borde-campo);
  border-radius: 10px;
  background: var(--superficie);
  font: inherit;
  font-size: 15px;
  color: var(--texto);
}

input,
select {
  height: 46px;
}

textarea {
  padding: 12px 14px;
  resize: vertical;
  line-height: 1.5;
}

input:disabled,
select:disabled,
textarea:disabled {
  background: var(--superficie-tenue);
  color: var(--texto-suave);
}

.invalido {
  border-color: var(--observado);
}

.mensaje {
  margin: 0;
  font-size: 13px;
  color: var(--observado);
}
</style>
