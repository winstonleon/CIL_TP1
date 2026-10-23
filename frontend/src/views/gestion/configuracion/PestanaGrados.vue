<!-- G09 · pestaña «Grados, vacantes y evaluaciones» (mockup docs/ui/G09-Configuracion.dc.html; HU0022-1.0 y 2.0).
     Vacantes autorizadas y evaluaciones requeridas se editan aquí y se guardan juntas con un solo «Guardar». Cuota y
     máximo de fracciones se muestran tal como los devuelve la API (se editan en «Cuota de ingreso»).
     HU0022-2.0: el mínimo de vacantes lo calcula y lo exige la API. La pantalla no compara con las adjudicadas: el borde,
     «Ya hay N adjudicadas» y el aviso salen solo del 422. -->
<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from "vue";
import {
  guardarGrados,
  listarRequisitos,
  type GradoConfiguracion,
  type MinimoVacantes,
  type Requisito,
} from "../../../api/configuracion";
import { ErrorApi, mensajeDe } from "../../../api/respuesta";
import {
  ETIQUETA_CATEGORIA,
  ETIQUETA_CONDICION,
  EVALUACIONES,
  formatearSoles,
  type CampoEvaluacion,
} from "../../../gestion/configuracion";

const props = defineProps<{ grados: GradoConfiguracion[]; derechoAdmision: number; versionRequisitos: number }>();
const emit = defineEmits<{ guardado: [grados: GradoConfiguracion[]] }>();

type Borrador = { vacantes: number | string } & Record<CampoEvaluacion, boolean>;

const borrador = reactive<Record<number, Borrador>>({});
const erroresVacantes = ref<Record<number, string>>({});
const avisoRegla = ref("");
const aviso = ref("");
const guardando = ref(false);

const seleccionado = ref<number | null>(null);
const requisitos = ref<Requisito[]>([]);
const errorRequisitos = ref("");

const gradoSeleccionado = computed(() => props.grados.find((g) => g.id_grado === seleccionado.value) ?? null);

function cargarBorrador(grados: GradoConfiguracion[]) {
  for (const g of grados) {
    borrador[g.id_grado] = {
      vacantes: g.vacantes_autorizadas,
      requiere_jornada_observacion: g.requiere_jornada_observacion,
      requiere_evaluacion_psicologica: g.requiere_evaluacion_psicologica,
      requiere_evaluacion_academica: g.requiere_evaluacion_academica,
    };
  }
}

onMounted(() => {
  cargarBorrador(props.grados);
  seleccionado.value = props.grados[0]?.id_grado ?? null;
});

async function cargarRequisitos() {
  if (seleccionado.value === null) return;
  errorRequisitos.value = "";
  try {
    requisitos.value = await listarRequisitos(seleccionado.value);
  } catch (e) {
    requisitos.value = [];
    errorRequisitos.value = mensajeDe(e);
  }
}

watch([seleccionado, () => props.versionRequisitos], cargarRequisitos);

function alternar(idGrado: number, campo: CampoEvaluacion) {
  borrador[idGrado]![campo] = !borrador[idGrado]![campo];
}

function editarVacantes(idGrado: number) {
  const { [idGrado]: _, ...resto } = erroresVacantes.value;
  erroresVacantes.value = resto;
}

// Validación técnica del campo (número entero ≥ 0). La regla de las adjudicadas (HU0022-2.0) es de la API.
function validar(): boolean {
  const errores: Record<number, string> = {};
  for (const g of props.grados) {
    const valor = borrador[g.id_grado]!.vacantes;
    if (valor === "" || !Number.isInteger(Number(valor)) || Number(valor) < 0) {
      errores[g.id_grado] = "Ingresa un número entero mayor o igual a 0.";
    }
  }
  erroresVacantes.value = errores;
  return Object.keys(errores).length === 0;
}

async function guardar() {
  aviso.value = "";
  avisoRegla.value = "";
  if (!validar()) return;
  guardando.value = true;
  try {
    const guardados = await guardarGrados(
      props.grados.map((g) => {
        const b = borrador[g.id_grado]!;
        return {
          id_grado: g.id_grado,
          vacantes_autorizadas: Number(b.vacantes),
          requiere_jornada_observacion: b.requiere_jornada_observacion,
          requiere_evaluacion_psicologica: b.requiere_evaluacion_psicologica,
          requiere_evaluacion_academica: b.requiere_evaluacion_academica,
        };
      }),
    );
    cargarBorrador(guardados);
    emit("guardado", guardados);
    aviso.value = "Cambios guardados.";
  } catch (e) {
    if (e instanceof ErrorApi && e.codigo === "VACANTES_MENORES_QUE_ADJUDICADAS" && Array.isArray(e.detalle)) {
      // HU0022-2.0: la API informa el mínimo de cada grado rechazado; no se guardó ninguno.
      erroresVacantes.value = Object.fromEntries(
        (e.detalle as MinimoVacantes[]).map((d) => [d.id_grado, `Ya hay ${d.minimo} adjudicadas`]),
      );
    }
    avisoRegla.value = mensajeDe(e);
  } finally {
    guardando.value = false;
  }
}

const chipCondicion = (r: Requisito) => (r.condicion_aplicacion === "todos" ? "g09-chip g09-chip-todos" : "g09-chip");
</script>

<template>
  <div class="g09-fila">
    <div class="g09-columna">
      <div class="g09-tabla-envoltura">
        <table class="g09-tabla">
          <thead>
            <tr>
              <th scope="col" style="width: 150px">Grado</th>
              <th scope="col" style="width: 110px">Vacantes autorizadas</th>
              <th scope="col" style="width: 100px">Adjudicadas</th>
              <th scope="col">Evaluaciones</th>
              <th scope="col" style="width: 100px">Cuota de ingreso</th>
              <th scope="col" style="width: 104px">Máx. fracciones</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="g in grados"
              :key="g.id_grado"
              :class="{ 'g09-fila-aviso': erroresVacantes[g.id_grado] }"
              :data-testid="`grado-${g.id_grado}`"
            >
              <td>
                <button
                  type="button"
                  class="g09-grado"
                  :aria-current="seleccionado === g.id_grado ? 'true' : undefined"
                  :aria-label="`Ver requisitos de ${g.nombre_grado}`"
                  @click="seleccionado = g.id_grado"
                >
                  {{ g.nombre_grado }}
                </button>
              </td>
              <td>
                <template v-if="borrador[g.id_grado]">
                  <input
                    v-model="borrador[g.id_grado]!.vacantes"
                    class="g09-entrada"
                    type="number"
                    min="0"
                    step="1"
                    inputmode="numeric"
                    :aria-label="`Vacantes autorizadas de ${g.nombre_grado}`"
                    :aria-invalid="Boolean(erroresVacantes[g.id_grado])"
                    :aria-describedby="erroresVacantes[g.id_grado] ? `g09-vacantes-${g.id_grado}-error` : undefined"
                    @input="editarVacantes(g.id_grado)"
                  />
                  <span v-if="erroresVacantes[g.id_grado]" :id="`g09-vacantes-${g.id_grado}-error`" class="g09-error-celda">
                    {{ erroresVacantes[g.id_grado] }}
                  </span>
                </template>
              </td>
              <td>
                <span v-if="g.vacantes_adjudicadas === 0" role="img" aria-label="0 adjudicadas">—</span>
                <template v-else>{{ g.vacantes_adjudicadas }}</template>
              </td>
              <td>
                <div v-if="borrador[g.id_grado]" class="g09-chips">
                  <button
                    v-for="ev in EVALUACIONES"
                    :key="ev.campo"
                    type="button"
                    class="g09-chip"
                    :aria-pressed="borrador[g.id_grado]![ev.campo]"
                    :aria-label="`${ev.etiqueta} · ${g.nombre_grado}`"
                    @click="alternar(g.id_grado, ev.campo)"
                  >
                    {{ ev.etiqueta }}
                  </button>
                  <!-- La entrevista a los padres aplica a todos los grados (R11): no se configura. -->
                  <span class="g09-chip">Entrevista</span>
                </div>
              </td>
              <td>{{ formatearSoles(g.monto_cuota_ingreso) }}</td>
              <td class="g09-tenue">{{ g.max_fracciones }}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div v-if="avisoRegla" class="g09-aviso-regla" role="alert">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
          stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M12 8v5" />
          <path d="M12 16.5v.5" />
          <path d="M10.3 3.9L2.6 17.5A2 2 0 0 0 4.3 20.5h15.4a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" />
        </svg>
        <div>{{ avisoRegla }}</div>
      </div>

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

    <section class="g09-tarjeta" aria-labelledby="g09-requisitos-panel" data-testid="panel-requisitos">
      <h2 id="g09-requisitos-panel" class="g09-tarjeta-titulo">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9"
          stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M3.5 7a2 2 0 0 1 2-2h4l2 2.5h7a2 2 0 0 1 2 2V17a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z" />
        </svg>
        Requisitos documentales
      </h2>
      <p v-if="gradoSeleccionado" class="g09-tarjeta-subtitulo">{{ gradoSeleccionado.nombre_grado }}</p>
      <p v-if="errorRequisitos" class="g09-error" role="alert">{{ errorRequisitos }}</p>
      <ul class="g09-lista">
        <li v-for="r in requisitos" :key="r.id_requisito">
          <span class="g09-lista-nombre">{{ r.tipo_documento }}</span>
          <div v-if="r.categoria === 'financiero'" class="g09-chips">
            <span class="g09-chip g09-chip-financiero">{{ ETIQUETA_CATEGORIA.financiero }}</span>
            <span :class="chipCondicion(r)">{{ ETIQUETA_CONDICION[r.condicion_aplicacion] }}</span>
          </div>
          <span v-else :class="chipCondicion(r)">{{ ETIQUETA_CONDICION[r.condicion_aplicacion] }}</span>
        </li>
      </ul>
      <span class="g09-nota">La ficha y el cuestionario se completan en línea.</span>
    </section>
  </div>
</template>
