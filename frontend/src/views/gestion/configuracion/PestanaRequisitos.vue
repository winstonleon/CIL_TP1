<!-- G09 · pestaña «Requisitos documentales» (HU0022-1.0). Sin mockup: diseño aprobado en el plan (P5) con el estilo de
     G09 y G10. Registra, edita (sin cambiar el grado) y quita requisitos con su condición de aplicación (P4). -->
<script setup lang="ts">
import { computed, nextTick, onMounted, reactive, ref, watch } from "vue";
import {
  crearRequisito,
  listarRequisitos,
  modificarRequisito,
  quitarRequisito,
  type GradoConfiguracion,
  type Requisito,
} from "../../../api/configuracion";
import { ErrorApi, mensajeDe } from "../../../api/respuesta";
import {
  CATEGORIAS,
  CONDICIONES,
  CONDICIONES_POR_APODERADO,
  ETIQUETA_CATEGORIA,
  ETIQUETA_CONDICION,
  type CategoriaRequisito,
  type CondicionAplicacion,
} from "../../../gestion/configuracion";

const props = defineProps<{ grados: GradoConfiguracion[] }>();
const emit = defineEmits<{ cambio: [] }>();

type Campo = "tipo_documento" | "categoria";

const idGrado = ref<number | null>(null);
const requisitos = ref<Requisito[]>([]);
const errorCarga = ref("");

const formulario = reactive<{
  tipo_documento: string;
  categoria: CategoriaRequisito | "";
  condicion_aplicacion: CondicionAplicacion;
  obligatorio: boolean;
  por_apoderado: boolean;
}>({ tipo_documento: "", categoria: "", condicion_aplicacion: "todos", obligatorio: true, por_apoderado: false });
const errores = ref<Partial<Record<Campo, string>>>({});
const enEdicion = ref<Requisito | null>(null);
const enviando = ref(false);
const aviso = ref("");
const errorEnvio = ref("");

const confirmacion = ref<Requisito | null>(null);
const confirmando = ref(false);
const botonCancelarDialogo = ref<HTMLButtonElement | null>(null);

const nombreGrado = computed(() => props.grados.find((g) => g.id_grado === idGrado.value)?.nombre_grado ?? "");
// CHECK ck_requisito_por_apoderado: «Si es dependiente» o «Si es independiente» se exigen a cada apoderado.
const porApoderadoObligado = computed(() => CONDICIONES_POR_APODERADO.includes(formulario.condicion_aplicacion));

watch(porApoderadoObligado, (obligado) => {
  if (obligado) formulario.por_apoderado = true;
});

onMounted(() => {
  idGrado.value = props.grados[0]?.id_grado ?? null;
});

// El estado vacío se muestra solo después de recibir la lista del grado elegido (no mientras llega).
const cargado = ref(false);

watch(idGrado, async (id) => {
  if (id === null) return;
  errorCarga.value = "";
  cargado.value = false;
  try {
    requisitos.value = await listarRequisitos(id);
    cargado.value = true;
  } catch (e) {
    requisitos.value = [];
    errorCarga.value = mensajeDe(e);
  }
});

function limpiarFormulario() {
  Object.assign(formulario, { tipo_documento: "", categoria: "", condicion_aplicacion: "todos", obligatorio: true, por_apoderado: false });
  errores.value = {};
}

function editar(r: Requisito) {
  enEdicion.value = r;
  Object.assign(formulario, {
    tipo_documento: r.tipo_documento,
    categoria: r.categoria,
    condicion_aplicacion: r.condicion_aplicacion,
    obligatorio: r.obligatorio,
    por_apoderado: r.por_apoderado,
  });
  errores.value = {};
  aviso.value = "";
  errorEnvio.value = "";
}

function cancelarEdicion() {
  enEdicion.value = null;
  limpiarFormulario();
}

function validar(): boolean {
  const e: Partial<Record<Campo, string>> = {};
  if (!formulario.tipo_documento.trim()) e.tipo_documento = "Este campo es obligatorio.";
  if (!formulario.categoria) e.categoria = "Selecciona una categoría.";
  errores.value = e;
  return Object.keys(e).length === 0;
}

async function enviar() {
  aviso.value = "";
  errorEnvio.value = "";
  if (!validar() || !formulario.categoria || idGrado.value === null) return;
  const datos = {
    tipo_documento: formulario.tipo_documento.trim(),
    categoria: formulario.categoria,
    condicion_aplicacion: formulario.condicion_aplicacion,
    obligatorio: formulario.obligatorio,
    por_apoderado: formulario.por_apoderado,
  };
  enviando.value = true;
  try {
    if (enEdicion.value) {
      // El grado no se cambia (plan HU0022, P4).
      const actualizado = await modificarRequisito(enEdicion.value.id_requisito, datos);
      requisitos.value = requisitos.value.map((r) => (r.id_requisito === actualizado.id_requisito ? actualizado : r));
      cancelarEdicion();
      aviso.value = "Cambios guardados.";
    } else {
      const nuevo = await crearRequisito(idGrado.value, datos);
      requisitos.value = [...requisitos.value, nuevo];
      limpiarFormulario();
      aviso.value = "Requisito agregado.";
    }
    emit("cambio");
  } catch (e) {
    if (e instanceof ErrorApi && e.codigo === "REQUISITO_DUPLICADO") errores.value = { tipo_documento: e.message };
    else errorEnvio.value = mensajeDe(e);
  } finally {
    enviando.value = false;
  }
}

async function pedirQuitar(r: Requisito) {
  aviso.value = "";
  errorEnvio.value = "";
  confirmacion.value = r;
  await nextTick();
  botonCancelarDialogo.value?.focus();
}

async function confirmarQuitar() {
  if (!confirmacion.value) return;
  const r = confirmacion.value;
  confirmando.value = true;
  try {
    await quitarRequisito(r.id_requisito);
    requisitos.value = requisitos.value.filter((x) => x.id_requisito !== r.id_requisito);
    if (enEdicion.value?.id_requisito === r.id_requisito) cancelarEdicion();
    aviso.value = "Requisito quitado.";
    emit("cambio");
  } catch (e) {
    errorEnvio.value =
      e instanceof ErrorApi && e.codigo === "EN_USO" ? "No se puede quitar: ya hay documentos cargados para este requisito." : mensajeDe(e);
  } finally {
    confirmando.value = false;
    confirmacion.value = null;
  }
}
</script>

<template>
  <div class="g09-fila">
    <div class="g09-columna">
      <div class="g09-filtro">
        <label for="g09-req-grado">Grado</label>
        <!-- En edición el grado queda fijo: un requisito no cambia de grado (P4). -->
        <select id="g09-req-grado" v-model="idGrado" :disabled="Boolean(enEdicion)">
          <option v-for="g in grados" :key="g.id_grado" :value="g.id_grado">{{ g.nombre_grado }}</option>
        </select>
      </div>

      <p v-if="errorCarga" class="g09-error" role="alert">{{ errorCarga }}</p>

      <div class="g09-tabla-envoltura">
        <table class="g09-tabla g09-tabla-requisitos" :aria-label="`Requisitos documentales de ${nombreGrado}`">
          <thead>
            <tr>
              <th scope="col">Documento</th>
              <th scope="col">Categoría</th>
              <th scope="col">Condición</th>
              <th scope="col" style="width: 90px">Obligatorio</th>
              <th scope="col" style="width: 96px">Por apoderado</th>
              <th scope="col" style="width: 112px">Acciones</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="r in requisitos" :key="r.id_requisito" :data-testid="`requisito-${r.id_requisito}`">
              <td><strong>{{ r.tipo_documento }}</strong></td>
              <td>
                <span class="g09-chip" :class="r.categoria === 'financiero' ? 'g09-chip-financiero' : 'g09-chip-todos'">
                  {{ ETIQUETA_CATEGORIA[r.categoria] }}
                </span>
              </td>
              <td>
                <span class="g09-chip" :class="{ 'g09-chip-todos': r.condicion_aplicacion === 'todos' }">
                  {{ ETIQUETA_CONDICION[r.condicion_aplicacion] }}
                </span>
              </td>
              <td>{{ r.obligatorio ? "Sí" : "No" }}</td>
              <td>{{ r.por_apoderado ? "Sí" : "No" }}</td>
              <td>
                <div class="g09-acciones">
                  <button type="button" class="g09-boton-icono" :aria-label="`Editar ${r.tipo_documento}`" @click="editar(r)">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"
                      stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                      <path d="M4 20h4L19 9l-4-4L4 16z" />
                      <path d="M13.5 6.5l4 4" />
                    </svg>
                  </button>
                  <button type="button" class="g09-boton-icono g09-boton-quitar" :aria-label="`Quitar ${r.tipo_documento}`"
                    @click="pedirQuitar(r)">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"
                      stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                      <path d="M4 7h16" />
                      <path d="M9 7V4h6v3" />
                      <path d="M6 7l1 13h10l1-13" />
                    </svg>
                  </button>
                </div>
              </td>
            </tr>
            <tr v-if="cargado && !requisitos.length">
              <td colspan="6" class="g09-vacio">Aún no hay requisitos registrados para este grado.</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <section class="g09-tarjeta g09-tarjeta-ancha" aria-labelledby="g09-requisito-formulario">
      <h2 id="g09-requisito-formulario" class="g09-tarjeta-titulo">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9"
          stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <template v-if="enEdicion">
            <path d="M4 20h4L19 9l-4-4L4 16z" />
            <path d="M13.5 6.5l4 4" />
          </template>
          <template v-else>
            <path d="M12 5v14" />
            <path d="M5 12h14" />
          </template>
        </svg>
        {{ enEdicion ? "Editar requisito" : "Nuevo requisito" }}
      </h2>
      <p class="g09-tarjeta-subtitulo">{{ nombreGrado }}</p>

      <form class="g09-formulario" novalidate @submit.prevent="enviar">
        <div class="g09-campo">
          <label for="g09-req-documento">Documento <span class="g09-obligatorio" aria-hidden="true">*</span></label>
          <input id="g09-req-documento" v-model="formulario.tipo_documento" type="text" maxlength="80"
            :aria-invalid="Boolean(errores.tipo_documento)"
            :aria-describedby="errores.tipo_documento ? 'g09-req-documento-error' : undefined" />
          <p v-if="errores.tipo_documento" id="g09-req-documento-error" class="g09-error-campo">{{ errores.tipo_documento }}</p>
        </div>
        <div class="g09-campo">
          <label for="g09-req-categoria">Categoría <span class="g09-obligatorio" aria-hidden="true">*</span></label>
          <select id="g09-req-categoria" v-model="formulario.categoria" :aria-invalid="Boolean(errores.categoria)"
            :aria-describedby="errores.categoria ? 'g09-req-categoria-error' : undefined">
            <option value="" disabled>Seleccionar categoría</option>
            <option v-for="c in CATEGORIAS" :key="c" :value="c">{{ ETIQUETA_CATEGORIA[c] }}</option>
          </select>
          <p v-if="errores.categoria" id="g09-req-categoria-error" class="g09-error-campo">{{ errores.categoria }}</p>
        </div>
        <div class="g09-campo">
          <label for="g09-req-condicion">Condición de aplicación</label>
          <select id="g09-req-condicion" v-model="formulario.condicion_aplicacion">
            <option v-for="c in CONDICIONES" :key="c" :value="c">{{ ETIQUETA_CONDICION[c] }}</option>
          </select>
        </div>
        <label class="g09-casilla">
          <input v-model="formulario.obligatorio" type="checkbox" />
          Obligatorio
        </label>
        <label class="g09-casilla">
          <input v-model="formulario.por_apoderado" type="checkbox" :disabled="porApoderadoObligado" />
          Se exige a cada apoderado
        </label>

        <button type="submit" class="g09-boton" :disabled="enviando">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
            stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M5 12.5l4.2 4.2L19 7" />
          </svg>
          {{ enEdicion ? "Guardar cambios" : "Guardar" }}
        </button>
        <button v-if="enEdicion" type="button" class="g09-boton-secundario" @click="cancelarEdicion">Cancelar</button>
      </form>

      <p class="g09-aviso" role="status">{{ aviso }}</p>
      <p v-if="errorEnvio" class="g09-error" role="alert">{{ errorEnvio }}</p>
    </section>

    <dialog v-if="confirmacion" open class="g09-dialogo" aria-modal="true" aria-labelledby="g09-req-dialogo-texto">
      <p id="g09-req-dialogo-texto">¿Quitar el requisito {{ confirmacion.tipo_documento }} de {{ nombreGrado }}?</p>
      <div class="g09-dialogo-acciones">
        <button ref="botonCancelarDialogo" type="button" class="g09-boton-secundario" @click="confirmacion = null">Cancelar</button>
        <button type="button" class="g09-boton-peligro" :disabled="confirmando" @click="confirmarQuitar">Quitar</button>
      </div>
    </dialog>
  </div>
</template>
