<!-- Panel «Observar documento» de G03 y su equivalente en G05: el ítem observado, el motivo obligatorio con el texto de
     ayuda (el motivo viaja en el correo a la familia, C11) y el botón «Solicitar subsanación» u «Observar comprobante».
     La nota del pie es la del mockup sin WhatsApp: el canal aún no está disponible (C30). -->
<script setup lang="ts">
import { computed, ref, shallowRef } from "vue";
import { AYUDA_MOTIVO, errorMotivo, LARGO_MAXIMO_MOTIVO } from "../../../gestion/validacion";

const props = defineProps<{ id: string; titulo: string; item: string; boton: string; nota: string; ocupado: boolean }>();
const emit = defineEmits<{ enviar: [motivo: string]; cancelar: [] }>();

const motivo = ref("");
const intentado = shallowRef(false);
const error = computed(() => (intentado.value ? errorMotivo(motivo.value) : ""));

function enviar() {
  intentado.value = true;
  if (!errorMotivo(motivo.value)) emit("enviar", motivo.value.trim());
}
</script>

<template>
  <section class="tarjeta panel" :aria-labelledby="`${props.id}-titulo`" data-testid="panel-observacion">
    <h2 :id="`${props.id}-titulo`">{{ titulo }}</h2>
    <span class="item">{{ item }}</span>
    <div class="campo">
      <label :for="`${props.id}-motivo`">Motivo de la observación <span class="requerido" aria-hidden="true">*</span></label>
      <textarea
        :id="`${props.id}-motivo`"
        v-model="motivo"
        :maxlength="LARGO_MAXIMO_MOTIVO"
        :aria-invalid="!!error"
        :aria-describedby="`${props.id}-ayuda`"
        required
      />
      <p :id="`${props.id}-ayuda`" :class="error ? 'mensaje' : 'suave'" :role="error ? 'alert' : undefined" data-testid="ayuda-motivo">
        {{ error || AYUDA_MOTIVO }}
      </p>
    </div>
    <button type="button" class="boton primario grande" :disabled="ocupado" @click="enviar">{{ boton }}</button>
    <button type="button" class="boton grande" :disabled="ocupado" @click="emit('cancelar')">Cancelar</button>
    <span class="suave">{{ nota }}</span>
  </section>
</template>

<style scoped src="./validacion.css"></style>

<style scoped>
.panel {
  width: 100%;
}

.item {
  font-size: 15px;
  font-weight: 600;
}
</style>
