<!-- Panel «Documentación financiera» de G05 (Tesorería, HU0011): la condición laboral declarada, los documentos
     financieros con «Conforme» / «Observar» y «Marcar conforme» con todos conformes. Sin consulta a centrales de riesgo
     (R10). Solo Tesorería lo recibe de la API (R2).
     Desvío del mockup (supuesto 4 del plan, HU0011-2.0): el mockup marca cada documento «Presente»/«Falta» y tiene un solo
     motivo por rama; aquí cada documento se marca «Conforme» u «Observar», con su propio motivo, porque HU0011-2.0 dice
     «selecciona el documento, redacta el motivo». -->
<script setup lang="ts">
import { computed, onMounted, toRef } from "vue";
import type { DocumentoRevision } from "../../../api/validaciones";
import { nombreCompleto } from "../../../gestion/validacion";
import ListaRevision from "./ListaRevision.vue";
import PanelObservacion from "./PanelObservacion.vue";
import { useRevisionRama } from "./useRevisionRama";

const props = defineProps<{ idExpediente: number }>();
const emit = defineEmits<{ actualizado: [] }>();

const r = useRevisionRama("financiera", toRef(props, "idExpediente"));

const condicion = computed(() =>
  (r.detalle.value?.condiciones_laborales ?? [])
    .map((c) => `${c.parentesco.charAt(0).toUpperCase()}${c.parentesco.slice(1)} ${c.condicion_laboral ?? "sin declarar"}`)
    .join(" · "),
);
const nombreObservado = computed(() => {
  const d = r.observando.value;
  return d ? (d.parentesco ? `${d.tipo_documento} (${d.parentesco})` : d.tipo_documento) : "";
});

const avisar = async (fn: () => Promise<void>) => {
  await fn();
  emit("actualizado");
};
const conforme = (d: DocumentoRevision) => avisar(() => r.marcarConforme(d));
const observar = (motivo: string) => avisar(() => r.observar(motivo));
const marcarConforme = () => avisar(r.confirmar);

onMounted(r.cargar);
</script>

<template>
  <section class="tarjeta panel" aria-labelledby="g05-financiera-titulo" data-testid="panel-financiera">
    <div class="cabecera">
      <h2 id="g05-financiera-titulo">Documentación financiera</h2>
      <span class="chip inactivo">Solo Tesorería</span>
    </div>
    <p v-if="r.carga.value === 'cargando'" class="suave" role="status">Cargando…</p>
    <p v-else-if="r.carga.value === 'error'" class="mensaje" role="alert">{{ r.errorCarga.value }}</p>
    <template v-else-if="r.detalle.value">
      <div class="identidad">
        <span class="nombre">{{ nombreCompleto(r.detalle.value.postulante) }} · {{ r.detalle.value.codigo }}</span>
        <span class="suave">Condición laboral declarada en la ficha: {{ condicion || "—" }}</span>
      </div>
      <p v-if="r.aviso.value" class="exito" role="status" data-testid="aviso">{{ r.aviso.value }}</p>
      <p v-if="r.errorAccion.value" class="mensaje" role="alert" data-testid="error-accion">{{ r.errorAccion.value }}</p>
      <ListaRevision
        :documentos="r.detalle.value.documentos"
        :decidible="r.decidible.value"
        :ocupado="r.ocupado.value"
        :seleccionado="r.observando.value?.id_documento ?? null"
        :con-titulos="false"
        @ver="r.ver"
        @conforme="conforme"
        @observar="r.observando.value = $event"
      />
      <PanelObservacion
        v-if="r.observando.value"
        id="g05-observar"
        :key="r.observando.value.id_documento"
        titulo="Observar documento"
        :item="nombreObservado"
        boton="Solicitar subsanación"
        nota="La familia recibe un correo con el motivo y el enlace para reemplazar el documento."
        :ocupado="r.ocupado.value"
        @enviar="observar"
        @cancelar="r.observando.value = null"
      />
      <button
        v-if="r.decidible.value"
        type="button"
        class="boton primario grande"
        :disabled="!r.puedeDarConformidad.value || r.ocupado.value"
        data-testid="marcar-conforme"
        @click="marcarConforme"
      >
        Marcar conforme
      </button>
      <span class="suave">Sin consulta a centrales de riesgo. «Marcar conforme» se habilita cuando están todos los documentos exigidos.</span>
    </template>
  </section>
</template>

<style scoped src="./validacion.css"></style>

<style scoped>
.cabecera {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.identidad {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.nombre {
  font-weight: 700;
}

.exito {
  margin: 0;
  color: var(--conforme);
  font-weight: 600;
}
</style>
