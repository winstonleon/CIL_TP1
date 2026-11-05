<!-- Una fila de documento en G03 (validación documental) y G05 (documentación financiera): nombre del requisito con el
     parentesco, formato y tamaño, el estado con el nombre del mockup y las acciones «Ver», «Conforme» y «Observar» (solo
     mientras espera revisión). El motivo vigente se muestra si está observado; el de una observación ya subsanada, como
     «Motivo anterior» (pedido de John, tramo 2). El nombre original del archivo no existe en el modelo (C49). -->
<script setup lang="ts">
import { computed } from "vue";
import type { DocumentoRevision } from "../../../api/validaciones";
import { etiquetaDocumento } from "../../../gestion/validacion";
import { tamano } from "../../../portal/formato";

const props = defineProps<{ documento: DocumentoRevision; decidible: boolean; ocupado: boolean; seleccionado: boolean }>();
const emit = defineEmits<{ ver: []; conforme: []; observar: [] }>();

const nombre = computed(() =>
  props.documento.parentesco ? `${props.documento.tipo_documento} (${props.documento.parentesco})` : props.documento.tipo_documento,
);
const estado = computed(() => etiquetaDocumento(props.documento.estado_verificacion));
const pendiente = computed(() => props.documento.estado_verificacion === "pendiente");
</script>

<template>
  <li class="fila" :class="{ seleccionada: seleccionado }" :data-testid="`documento-${documento.id_documento}`">
    <div class="datos">
      <span class="nombre">{{ nombre }}</span>
      <span class="suave">{{ documento.formato.toUpperCase() }} · {{ tamano(documento.tamano_kb) }}</span>
      <p v-if="documento.motivo_observacion" class="motivo-vigente" data-testid="motivo-vigente">Motivo: {{ documento.motivo_observacion }}</p>
      <p v-if="documento.motivo_anterior" class="motivo-anterior" data-testid="motivo-anterior">
        Motivo anterior: {{ documento.motivo_anterior }}
      </p>
    </div>
    <span class="chip" :class="estado.tono">{{ estado.texto }}</span>
    <div class="acciones">
      <button type="button" class="boton" :aria-label="`Ver ${nombre}`" @click="emit('ver')">Ver</button>
      <template v-if="decidible && pendiente">
        <button type="button" class="boton conforme" :disabled="ocupado" @click="emit('conforme')">Conforme</button>
        <button type="button" class="boton observar" :disabled="ocupado" @click="emit('observar')">Observar</button>
      </template>
    </div>
  </li>
</template>

<style scoped src="./validacion.css"></style>

<style scoped>
.fila {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 14px 0;
  border-bottom: 1px solid var(--borde);
  flex-wrap: wrap;
}

.fila.seleccionada {
  background: var(--fila-aviso);
}

.datos {
  flex: 1 1 220px;
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.nombre {
  font-size: 15px;
  font-weight: 600;
}

.acciones {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}
</style>
