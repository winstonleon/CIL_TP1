<!-- G02 · Bandeja de expedientes (Secretaría, HU0008; cierra C51 de HU0017-1.0). Implementa docs/ui/G02-Bandeja.dc.html:
     pestañas con conteo, búsqueda por postulante, apoderado o código, filtro de grado, orden y la tabla. Solo aparecen los
     expedientes que la verificación de completitud encontró completos (en_validacion).
     Desvíos del mockup: «En evaluación» y «Con vacante» llegan con HU0009 y HU0012: se ven deshabilitadas y no hacen
     nada; no hay paginación
     (la campaña cabe en una página): el pie muestra el total. -->
<script setup lang="ts">
import { onMounted, ref, shallowRef, watch } from "vue";
import { obtenerConfiguracion, type GradoConfiguracion } from "../../api/configuracion";
import { mensajeDe } from "../../api/respuesta";
import { listarBandeja, type Bandeja, type FiltrosBandeja, type VistaBandeja } from "../../api/validaciones";
import TablaBandeja from "./validacion/TablaBandeja.vue";

const PESTANAS: { vista: VistaBandeja | null; texto: string; disponible?: string }[] = [
  { vista: "por_revisar", texto: "Por revisar" },
  { vista: "observados", texto: "Observados" },
  { vista: null, texto: "En evaluación", disponible: "Disponible con HU0009" },
  { vista: null, texto: "Con vacante", disponible: "Disponible con HU0012" },
  { vista: "todos", texto: "Todos" },
];

const filtros = ref<FiltrosBandeja>({ vista: "por_revisar", orden: "antiguos", q: "", grado: undefined });
const bandeja = ref<Bandeja | null>(null);
const grados = ref<GradoConfiguracion[]>([]);
const error = shallowRef("");
const ahora = shallowRef(new Date());
let espera: ReturnType<typeof setTimeout> | undefined;

async function cargar() {
  error.value = "";
  try {
    bandeja.value = await listarBandeja(filtros.value);
    ahora.value = new Date();
  } catch (e) {
    error.value = mensajeDe(e);
  }
}

// La búsqueda espera a que se deje de escribir; las pestañas, el grado y el orden recargan enseguida.
watch(
  () => filtros.value.q,
  () => {
    clearTimeout(espera);
    espera = setTimeout(cargar, 300);
  },
);
watch(() => [filtros.value.vista, filtros.value.grado, filtros.value.orden], cargar);

onMounted(async () => {
  await cargar();
  try {
    grados.value = (await obtenerConfiguracion()).grados;
  } catch {
    // Sin la lista de grados solo queda «Todos los grados».
  }
});
</script>

<template>
  <div class="g02">
    <div class="pestanas-pildora" role="tablist" aria-label="Expedientes">
      <button
        v-for="p in PESTANAS"
        :key="p.texto"
        type="button"
        role="tab"
        class="pildora"
        :class="{ deshabilitada: p.disponible }"
        :aria-selected="p.vista !== null && filtros.vista === p.vista"
        :aria-disabled="p.disponible ? 'true' : undefined"
        :title="p.disponible"
        :data-testid="`pestana-${p.vista ?? 'no-disponible'}`"
        @click="p.vista && (filtros.vista = p.vista)"
      >
        {{ p.texto }}
        <span v-if="p.vista && bandeja" class="conteo">{{ bandeja.conteos[p.vista] }}</span>
      </button>
    </div>

    <div class="filtros">
      <div class="campo busqueda">
        <label for="g02-buscar">Buscar por postulante, apoderado o código</label>
        <input id="g02-buscar" v-model="filtros.q" type="search" maxlength="100" placeholder="Ej.: Quispe o ADM-2027-0142" />
      </div>
      <div class="campo">
        <label for="g02-grado">Grado</label>
        <select id="g02-grado" v-model="filtros.grado">
          <option :value="undefined">Todos los grados</option>
          <option v-for="g in grados" :key="g.id_grado" :value="g.id_grado">{{ g.nombre_grado }}</option>
        </select>
      </div>
      <div class="campo">
        <label for="g02-orden">Orden</label>
        <select id="g02-orden" v-model="filtros.orden">
          <option value="antiguos">Más antiguos primero</option>
          <option value="recientes">Más recientes primero</option>
        </select>
      </div>
    </div>

    <p v-if="error" class="mensaje" role="alert" data-testid="error-carga">{{ error }}</p>
    <template v-else-if="bandeja">
      <p v-if="bandeja.expedientes.length === 0" class="suave" role="status" data-testid="vacio">No hay expedientes en esta vista.</p>
      <TablaBandeja v-else :filas="bandeja.expedientes" :ahora="ahora" />
      <div class="pie">
        <span>Solo aparecen expedientes que el sistema ya verificó como completos. Los incompletos se notifican automáticamente a la familia.</span>
        <span data-testid="total">{{ bandeja.expedientes.length }} de {{ bandeja.expedientes.length }}</span>
      </div>
    </template>
  </div>
</template>

<style scoped src="./validacion/validacion.css"></style>

<style scoped>
.g02 {
  display: flex;
  flex-direction: column;
  gap: 24px;
}

.pestanas-pildora {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
}

.pildora {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  min-height: 44px;
  padding: 0 16px;
  border-radius: 999px;
  border: 1px solid var(--borde);
  background: var(--superficie);
  color: var(--texto);
  font-family: var(--fuente-texto);
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
}

.pildora[aria-selected="true"] {
  border-color: var(--cil-azul);
  background: var(--cil-azul);
  color: #ffffff;
}

.pildora.deshabilitada {
  border-color: var(--borde);
  background: var(--inactivo-fondo);
  color: var(--reservado-texto);
  cursor: not-allowed;
}

.pildora:focus-visible {
  outline: 3px solid var(--cil-dorado);
  outline-offset: 2px;
}

.conteo {
  padding: 1px 8px;
  border-radius: 999px;
  background: var(--inactivo-fondo);
  color: var(--cil-azul);
  font-size: 12px;
  font-weight: 700;
}

.pildora[aria-selected="true"] .conteo {
  background: var(--cil-dorado);
}

.filtros {
  display: flex;
  gap: 14px;
  align-items: flex-end;
  flex-wrap: wrap;
}

.filtros .campo {
  width: 240px;
}

.filtros .busqueda {
  flex: 1 1 280px;
  width: auto;
}

.filtros input,
.filtros select {
  height: 46px;
  padding: 0 14px;
}

.pie {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
  font-size: 14px;
  color: var(--texto-suave);
}
</style>
