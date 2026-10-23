<!-- G09 · Configuración de la campaña (Secretaría, HU0022). Cuatro pestañas como en el mockup: la primera reproduce
     docs/ui/G09-Configuracion.dc.html; Requisitos, Cuota y Horarios no tienen mockup y siguen el diseño aprobado en
     el plan (P5). La configuración es la de la campaña activa (CAMPANA_ACTIVA): la API no ofrece otras. -->
<script setup lang="ts">
import { nextTick, onMounted, ref } from "vue";
import { obtenerConfiguracion, type Configuracion, type GradoConfiguracion } from "../../api/configuracion";
import { mensajeDe } from "../../api/respuesta";
import PestanaCuota from "./configuracion/PestanaCuota.vue";
import PestanaGrados from "./configuracion/PestanaGrados.vue";
import PestanaHorarios from "./configuracion/PestanaHorarios.vue";
import PestanaRequisitos from "./configuracion/PestanaRequisitos.vue";

const PESTANAS = [
  { id: "grados", etiqueta: "Grados, vacantes y evaluaciones" },
  { id: "requisitos", etiqueta: "Requisitos documentales" },
  { id: "cuota", etiqueta: "Cuota de ingreso" },
  { id: "horarios", etiqueta: "Horarios" },
] as const;
type IdPestana = (typeof PESTANAS)[number]["id"];

const activa = ref<IdPestana>("grados");
const configuracion = ref<Configuracion | null>(null);
const errorCarga = ref("");
// Cambia cuando la pestaña Requisitos agrega, edita o quita uno: el panel de la primera pestaña se actualiza.
const versionRequisitos = ref(0);
const botones = ref<HTMLButtonElement[]>([]);

onMounted(async () => {
  try {
    configuracion.value = await obtenerConfiguracion();
  } catch (e) {
    errorCarga.value = mensajeDe(e);
  }
});

// Las pestañas devuelven los grados que guardó la API; el resto queda igual.
function actualizarGrados(guardados: GradoConfiguracion[]) {
  if (!configuracion.value) return;
  const porId = new Map(guardados.map((g) => [g.id_grado, g]));
  configuracion.value.grados = configuracion.value.grados.map((g) => porId.get(g.id_grado) ?? g);
}

// Teclado de la lista de pestañas (patrón WAI-ARIA): flechas, Inicio y Fin.
async function moverFoco(evento: KeyboardEvent) {
  const actual = PESTANAS.findIndex((p) => p.id === activa.value);
  const destino = { ArrowRight: actual + 1, ArrowLeft: actual - 1, Home: 0, End: PESTANAS.length - 1 }[evento.key];
  if (destino === undefined) return;
  evento.preventDefault();
  const indice = (destino + PESTANAS.length) % PESTANAS.length;
  activa.value = PESTANAS[indice]!.id;
  await nextTick();
  botones.value[indice]?.focus();
}
</script>

<template>
  <div class="g09">
    <div class="g09-pestanas" role="tablist" aria-label="Configuración de la campaña" @keydown="moverFoco">
      <button
        v-for="p in PESTANAS"
        :id="`g09-pestana-${p.id}`"
        :key="p.id"
        ref="botones"
        type="button"
        role="tab"
        class="g09-pestana"
        :aria-selected="activa === p.id"
        :aria-controls="`g09-panel-${p.id}`"
        :tabindex="activa === p.id ? 0 : -1"
        @click="activa = p.id"
      >
        {{ p.etiqueta }}
      </button>
    </div>

    <p v-if="errorCarga" class="g09-error" role="alert">{{ errorCarga }}</p>

    <template v-if="configuracion">
      <!-- v-show: cada pestaña conserva lo que se estaba editando al cambiar de pestaña. -->
      <div v-show="activa === 'grados'" id="g09-panel-grados" role="tabpanel" aria-labelledby="g09-pestana-grados">
        <PestanaGrados
          :grados="configuracion.grados"
          :derecho-admision="configuracion.derecho_admision"
          :version-requisitos="versionRequisitos"
          @guardado="actualizarGrados"
        />
      </div>
      <div v-show="activa === 'requisitos'" id="g09-panel-requisitos" role="tabpanel" aria-labelledby="g09-pestana-requisitos">
        <PestanaRequisitos :grados="configuracion.grados" @cambio="versionRequisitos++" />
      </div>
      <div v-show="activa === 'cuota'" id="g09-panel-cuota" role="tabpanel" aria-labelledby="g09-pestana-cuota">
        <PestanaCuota :grados="configuracion.grados" :derecho-admision="configuracion.derecho_admision" @guardado="actualizarGrados" />
      </div>
      <div v-show="activa === 'horarios'" id="g09-panel-horarios" role="tabpanel" aria-labelledby="g09-pestana-horarios">
        <PestanaHorarios />
      </div>
    </template>
  </div>
</template>

<style src="./configuracion/g09.css"></style>
