<!-- Lista de documentos de una rama agrupada por categoría (G03: «Documentos del postulante y los padres», «Colegio de
     procedencia», etc.; G05: la documentación financiera). Solo presenta: las decisiones suben como eventos. -->
<script setup lang="ts">
import { computed } from "vue";
import type { DocumentoRevision } from "../../../api/validaciones";
import FilaDocumento from "./FilaDocumento.vue";

const SECCIONES: Record<string, string> = {
  postulante_y_padres: "Documentos del postulante y los padres",
  colegio_procedencia: "Colegio de procedencia",
  condicion_especial: "Condición especial",
  financiero: "Documentación financiera",
};

const props = defineProps<{
  documentos: readonly DocumentoRevision[];
  decidible: boolean;
  ocupado: boolean;
  seleccionado: number | null;
  conTitulos: boolean;
}>();
const emit = defineEmits<{ ver: [DocumentoRevision]; conforme: [DocumentoRevision]; observar: [DocumentoRevision] }>();

const secciones = computed(() =>
  Object.entries(SECCIONES)
    .map(([categoria, titulo]) => ({ categoria, titulo, documentos: props.documentos.filter((d) => d.categoria === categoria) }))
    .filter((s) => s.documentos.length > 0),
);
</script>

<template>
  <div class="lista">
    <p v-if="documentos.length === 0" class="suave" data-testid="sin-documentos">No hay documentos que revisar en esta validación.</p>
    <section v-for="s in secciones" :key="s.categoria" :data-testid="`seccion-${s.categoria}`">
      <h2 v-if="conTitulos" class="titulo-seccion">{{ s.titulo }}</h2>
      <ul class="documentos">
        <FilaDocumento
          v-for="d in s.documentos"
          :key="d.id_documento"
          :documento="d"
          :decidible="decidible"
          :ocupado="ocupado"
          :seleccionado="seleccionado === d.id_documento"
          @ver="emit('ver', d)"
          @conforme="emit('conforme', d)"
          @observar="emit('observar', d)"
        />
      </ul>
    </section>
  </div>
</template>

<style scoped src="./validacion.css"></style>

<style scoped>
.lista {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.titulo-seccion {
  margin: 0;
  font-size: 22px;
  font-weight: 600;
  color: var(--cil-azul);
}

.documentos {
  list-style: none;
  margin: 0;
  padding: 0;
}
</style>
