<!-- G09 · pestaña «Cuota de ingreso» (HU0022-1.0). Sin mockup: diseño aprobado en el plan (P5), con la tabla y el pie
     de la primera pestaña. Cuota y máximo de fracciones vienen de la API: el «[por definir]» del mockup no se fija aquí.
     La cuota puede ser 0 (plan HU0022, P10). -->
<script setup lang="ts">
import { onMounted, reactive, ref } from "vue";
import { guardarGrados, type GradoConfiguracion } from "../../../api/configuracion";
import { mensajeDe } from "../../../api/respuesta";
import { formatearSoles } from "../../../gestion/configuracion";

const props = defineProps<{ grados: GradoConfiguracion[]; derechoAdmision: number }>();
const emit = defineEmits<{ guardado: [grados: GradoConfiguracion[]] }>();

type Borrador = { monto: number | string; fracciones: number | string };
type Campo = "monto" | "fracciones";

const borrador = reactive<Record<number, Borrador>>({});
const errores = ref<Record<string, string>>({});
const aviso = ref("");
const errorEnvio = ref("");
const guardando = ref(false);

function cargarBorrador(grados: GradoConfiguracion[]) {
  for (const g of grados) borrador[g.id_grado] = { monto: Number(g.monto_cuota_ingreso), fracciones: g.max_fracciones };
}

onMounted(() => cargarBorrador(props.grados));

const clave = (idGrado: number, campo: Campo) => `${idGrado}-${campo}`;

function editar(idGrado: number, campo: Campo) {
  const { [clave(idGrado, campo)]: _, ...resto } = errores.value;
  errores.value = resto;
}

// Validación técnica de los campos (numeric(10,2) ≥ 0 y entero ≥ 1, como la API y los CHECK).
function validar(): boolean {
  const e: Record<string, string> = {};
  for (const g of props.grados) {
    const { monto, fracciones } = borrador[g.id_grado]!;
    const m = Number(monto);
    if (monto === "" || !Number.isFinite(m) || m < 0 || Math.abs(m * 100 - Math.round(m * 100)) > 1e-6) {
      e[clave(g.id_grado, "monto")] = "Ingresa un monto mayor o igual a 0, con dos decimales como máximo.";
    }
    if (fracciones === "" || !Number.isInteger(Number(fracciones)) || Number(fracciones) < 1) {
      e[clave(g.id_grado, "fracciones")] = "Ingresa un número entero mayor o igual a 1.";
    }
  }
  errores.value = e;
  return Object.keys(e).length === 0;
}

async function guardar() {
  aviso.value = "";
  errorEnvio.value = "";
  if (!validar()) return;
  guardando.value = true;
  try {
    const guardados = await guardarGrados(
      props.grados.map((g) => ({
        id_grado: g.id_grado,
        monto_cuota_ingreso: Number(borrador[g.id_grado]!.monto),
        max_fracciones: Number(borrador[g.id_grado]!.fracciones),
      })),
    );
    cargarBorrador(guardados);
    emit("guardado", guardados);
    aviso.value = "Cambios guardados.";
  } catch (e) {
    errorEnvio.value = mensajeDe(e);
  } finally {
    guardando.value = false;
  }
}
</script>

<template>
  <div class="g09-columna">
    <div class="g09-tabla-envoltura">
      <table class="g09-tabla" aria-label="Cuota de ingreso por grado">
        <thead>
          <tr>
            <th scope="col">Grado</th>
            <th scope="col" style="width: 200px">Cuota de ingreso (S/)</th>
            <th scope="col" style="width: 200px">Máx. fracciones</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="g in grados" :key="g.id_grado" :data-testid="`cuota-${g.id_grado}`">
            <td>{{ g.nombre_grado }}</td>
            <td>
              <template v-if="borrador[g.id_grado]">
                <input
                  v-model="borrador[g.id_grado]!.monto"
                  class="g09-entrada g09-entrada-ancha"
                  type="number"
                  min="0"
                  step="0.01"
                  inputmode="decimal"
                  :aria-label="`Cuota de ingreso de ${g.nombre_grado}`"
                  :aria-invalid="Boolean(errores[clave(g.id_grado, 'monto')])"
                  :aria-describedby="errores[clave(g.id_grado, 'monto')] ? `g09-monto-${g.id_grado}-error` : undefined"
                  @input="editar(g.id_grado, 'monto')"
                />
                <span v-if="errores[clave(g.id_grado, 'monto')]" :id="`g09-monto-${g.id_grado}-error`" class="g09-error-celda">
                  {{ errores[clave(g.id_grado, "monto")] }}
                </span>
              </template>
            </td>
            <td>
              <template v-if="borrador[g.id_grado]">
                <input
                  v-model="borrador[g.id_grado]!.fracciones"
                  class="g09-entrada"
                  type="number"
                  min="1"
                  step="1"
                  inputmode="numeric"
                  :aria-label="`Máximo de fracciones de ${g.nombre_grado}`"
                  :aria-invalid="Boolean(errores[clave(g.id_grado, 'fracciones')])"
                  :aria-describedby="errores[clave(g.id_grado, 'fracciones')] ? `g09-fracciones-${g.id_grado}-error` : undefined"
                  @input="editar(g.id_grado, 'fracciones')"
                />
                <span v-if="errores[clave(g.id_grado, 'fracciones')]" :id="`g09-fracciones-${g.id_grado}-error`" class="g09-error-celda">
                  {{ errores[clave(g.id_grado, "fracciones")] }}
                </span>
              </template>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <p v-if="errorEnvio" class="g09-error" role="alert">{{ errorEnvio }}</p>

    <div class="g09-pie">
      <span class="g09-derecho">Derecho de admisión: <strong>{{ formatearSoles(derechoAdmision) }}</strong></span>
      <div class="g09-acciones">
        <p class="g09-aviso" role="status">{{ aviso }}</p>
        <button type="button" class="g09-boton" :disabled="guardando" @click="guardar">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
            stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M5 12.5l4.2 4.2L19 7" />
          </svg>
          Guardar
        </button>
      </div>
    </div>
  </div>
</template>
