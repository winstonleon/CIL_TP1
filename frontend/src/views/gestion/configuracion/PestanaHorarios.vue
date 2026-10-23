<!-- G09 · pestaña «Horarios» (HU0022-1.0). Sin mockup: diseño aprobado en el plan (P5) con el estilo de G09 y G10.
     Los horarios son de la campaña activa. Se registran y se quitan; no se editan. El responsable se elige entre las
     cuentas activas del rol que atiende ese tipo de cita (P2), y la API rechaza los horarios que se cruzan con otro
     del mismo responsable (P1). Los horarios del mockup P02 ([horarios]) son configuración: nada se fija aquí. -->
<script setup lang="ts">
import { computed, nextTick, onMounted, reactive, ref, watch } from "vue";
import { crearHorario, listarHorarios, listarResponsables, quitarHorario, type Horario, type Responsable } from "../../../api/configuracion";
import { ErrorApi, mensajeDe } from "../../../api/respuesta";
import { ETIQUETA_TIPO_CITA, formatearFecha, ROL_RESPONSABLE, TIPOS_CITA, type TipoCita } from "../../../gestion/configuracion";

type Campo = "tipo_cita" | "id_personal" | "fecha" | "hora_inicio" | "hora_fin" | "cupos";

const horarios = ref<Horario[]>([]);
const responsables = ref<Responsable[]>([]);
const errorCarga = ref("");
const filtro = ref<TipoCita | "">("");

const formulario = reactive<{
  tipo_cita: TipoCita | "";
  id_personal: number | "";
  fecha: string;
  hora_inicio: string;
  hora_fin: string;
  cupos: number | string;
}>({ tipo_cita: "", id_personal: "", fecha: "", hora_inicio: "", hora_fin: "", cupos: 1 });
const errores = ref<Partial<Record<Campo, string>>>({});
const enviando = ref(false);
const aviso = ref("");
const errorEnvio = ref("");

const confirmacion = ref<Horario | null>(null);
const confirmando = ref(false);
const botonCancelarDialogo = ref<HTMLButtonElement | null>(null);

const visibles = computed(() => (filtro.value ? horarios.value.filter((h) => h.tipo_cita === filtro.value) : horarios.value));
const responsablesDelTipo = computed(() =>
  formulario.tipo_cita ? responsables.value.filter((r) => r.rol === ROL_RESPONSABLE[formulario.tipo_cita as TipoCita]) : [],
);
const rangoHorario = (h: Pick<Horario, "hora_inicio" | "hora_fin">) => `${h.hora_inicio} – ${h.hora_fin}`;

// Al cambiar el tipo de cita, el responsable elegido deja de valer si no tiene el rol de ese tipo.
watch(
  () => formulario.tipo_cita,
  () => {
    if (!responsablesDelTipo.value.some((r) => r.id_personal === formulario.id_personal)) formulario.id_personal = "";
  },
);

// El estado vacío se muestra solo después de recibir los horarios (no mientras llegan).
const cargado = ref(false);
const mensajeVacio = computed(() =>
  filtro.value ? "Aún no hay horarios registrados para este tipo de cita." : "Aún no hay horarios registrados.",
);

onMounted(async () => {
  try {
    [horarios.value, responsables.value] = await Promise.all([listarHorarios(), listarResponsables()]);
    cargado.value = true;
  } catch (e) {
    errorCarga.value = mensajeDe(e);
  }
});

function ordenar(lista: Horario[]): Horario[] {
  return [...lista].sort((a, b) => `${a.fecha} ${a.hora_inicio}`.localeCompare(`${b.fecha} ${b.hora_inicio}`) || a.id_horario - b.id_horario);
}

function validar(): boolean {
  const e: Partial<Record<Campo, string>> = {};
  if (!formulario.tipo_cita) e.tipo_cita = "Selecciona un tipo de cita.";
  if (formulario.id_personal === "") e.id_personal = "Selecciona un responsable.";
  if (!formulario.fecha) e.fecha = "Este campo es obligatorio.";
  if (!formulario.hora_inicio) e.hora_inicio = "Este campo es obligatorio.";
  if (!formulario.hora_fin) e.hora_fin = "Este campo es obligatorio.";
  else if (formulario.hora_inicio && formulario.hora_fin <= formulario.hora_inicio) e.hora_fin = "La hora de fin debe ser posterior a la de inicio.";
  if (formulario.cupos === "" || !Number.isInteger(Number(formulario.cupos)) || Number(formulario.cupos) < 0) {
    e.cupos = "Ingresa un número entero mayor o igual a 0.";
  }
  errores.value = e;
  return Object.keys(e).length === 0;
}

async function enviar() {
  aviso.value = "";
  errorEnvio.value = "";
  if (!validar() || !formulario.tipo_cita || formulario.id_personal === "") return;
  const datos = {
    id_personal: formulario.id_personal,
    tipo_cita: formulario.tipo_cita,
    fecha: formulario.fecha,
    hora_inicio: formulario.hora_inicio,
    hora_fin: formulario.hora_fin,
    cupos: Number(formulario.cupos),
  };
  enviando.value = true;
  try {
    horarios.value = ordenar([...horarios.value, await crearHorario(datos)]);
    Object.assign(formulario, { tipo_cita: "", id_personal: "", fecha: "", hora_inicio: "", hora_fin: "", cupos: 1 });
    errores.value = {};
    aviso.value = "Horario agregado.";
  } catch (e) {
    if (e instanceof ErrorApi && e.codigo === "HORARIO_SUPERPUESTO") {
      const nombre = responsables.value.find((r) => r.id_personal === datos.id_personal)?.nombre ?? "El responsable";
      errores.value = { hora_inicio: `${nombre} ya tiene un horario que se cruza con este el ${formatearFecha(datos.fecha)}.` };
    } else if (e instanceof ErrorApi && e.codigo === "RESPONSABLE_NO_VALIDO") {
      errores.value = { id_personal: e.message };
    } else {
      errorEnvio.value = mensajeDe(e);
    }
  } finally {
    enviando.value = false;
  }
}

async function pedirQuitar(h: Horario) {
  aviso.value = "";
  errorEnvio.value = "";
  confirmacion.value = h;
  await nextTick();
  botonCancelarDialogo.value?.focus();
}

async function confirmarQuitar() {
  if (!confirmacion.value) return;
  const h = confirmacion.value;
  confirmando.value = true;
  try {
    await quitarHorario(h.id_horario);
    horarios.value = horarios.value.filter((x) => x.id_horario !== h.id_horario);
    aviso.value = "Horario quitado.";
  } catch (e) {
    errorEnvio.value = e instanceof ErrorApi && e.codigo === "EN_USO" ? "No se puede quitar: el horario ya tiene citas." : mensajeDe(e);
  } finally {
    confirmando.value = false;
    confirmacion.value = null;
  }
}

// El cruce de horarios se informa junto a las dos horas.
const errorHoras = computed(() => errores.value.hora_inicio);
</script>

<template>
  <div class="g09-fila">
    <div class="g09-columna">
      <div class="g09-filtro">
        <label for="g09-hor-filtro">Tipo de cita</label>
        <select id="g09-hor-filtro" v-model="filtro">
          <option value="">Todos los tipos</option>
          <option v-for="t in TIPOS_CITA" :key="t" :value="t">{{ ETIQUETA_TIPO_CITA[t] }}</option>
        </select>
      </div>

      <p v-if="errorCarga" class="g09-error" role="alert">{{ errorCarga }}</p>

      <div class="g09-tabla-envoltura">
        <table class="g09-tabla" aria-label="Horarios disponibles de la campaña">
          <thead>
            <tr>
              <th scope="col" style="width: 120px">Fecha</th>
              <th scope="col" style="width: 140px">Horario</th>
              <th scope="col">Tipo</th>
              <th scope="col">Responsable</th>
              <th scope="col" style="width: 80px">Cupos</th>
              <th scope="col" style="width: 90px">Acciones</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="h in visibles" :key="h.id_horario" :data-testid="`horario-${h.id_horario}`">
              <td>{{ formatearFecha(h.fecha) }}</td>
              <td>{{ rangoHorario(h) }}</td>
              <td>{{ ETIQUETA_TIPO_CITA[h.tipo_cita] }}</td>
              <td>{{ h.responsable }}</td>
              <td>{{ h.cupos }}</td>
              <td>
                <button type="button" class="g09-boton-icono g09-boton-quitar"
                  :aria-label="`Quitar el horario del ${formatearFecha(h.fecha)}, ${rangoHorario(h)}`" @click="pedirQuitar(h)">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"
                    stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                    <path d="M4 7h16" />
                    <path d="M9 7V4h6v3" />
                    <path d="M6 7l1 13h10l1-13" />
                  </svg>
                </button>
              </td>
            </tr>
            <tr v-if="cargado && !visibles.length">
              <td colspan="6" class="g09-vacio">{{ mensajeVacio }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <section class="g09-tarjeta g09-tarjeta-ancha" aria-labelledby="g09-horario-formulario">
      <h2 id="g09-horario-formulario" class="g09-tarjeta-titulo">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9"
          stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M12 5v14" />
          <path d="M5 12h14" />
        </svg>
        Nuevo horario
      </h2>

      <form class="g09-formulario" novalidate @submit.prevent="enviar">
        <div class="g09-campo">
          <label for="g09-hor-tipo">Tipo de cita <span class="g09-obligatorio" aria-hidden="true">*</span></label>
          <select id="g09-hor-tipo" v-model="formulario.tipo_cita" :aria-invalid="Boolean(errores.tipo_cita)"
            :aria-describedby="errores.tipo_cita ? 'g09-hor-tipo-error' : undefined">
            <option value="" disabled>Seleccionar tipo</option>
            <option v-for="t in TIPOS_CITA" :key="t" :value="t">{{ ETIQUETA_TIPO_CITA[t] }}</option>
          </select>
          <p v-if="errores.tipo_cita" id="g09-hor-tipo-error" class="g09-error-campo">{{ errores.tipo_cita }}</p>
        </div>
        <div class="g09-campo">
          <label for="g09-hor-responsable">Responsable <span class="g09-obligatorio" aria-hidden="true">*</span></label>
          <select id="g09-hor-responsable" v-model="formulario.id_personal" :disabled="!formulario.tipo_cita"
            :aria-invalid="Boolean(errores.id_personal)"
            :aria-describedby="errores.id_personal ? 'g09-hor-responsable-error' : undefined">
            <option value="" disabled>Seleccionar responsable</option>
            <option v-for="r in responsablesDelTipo" :key="r.id_personal" :value="r.id_personal">{{ r.nombre }}</option>
          </select>
          <p v-if="errores.id_personal" id="g09-hor-responsable-error" class="g09-error-campo">{{ errores.id_personal }}</p>
        </div>
        <div class="g09-campo">
          <label for="g09-hor-fecha">Fecha <span class="g09-obligatorio" aria-hidden="true">*</span></label>
          <input id="g09-hor-fecha" v-model="formulario.fecha" type="date" :aria-invalid="Boolean(errores.fecha)"
            :aria-describedby="errores.fecha ? 'g09-hor-fecha-error' : undefined" />
          <p v-if="errores.fecha" id="g09-hor-fecha-error" class="g09-error-campo">{{ errores.fecha }}</p>
        </div>
        <div class="g09-horas">
          <div class="g09-campo">
            <label for="g09-hor-inicio">Hora de inicio <span class="g09-obligatorio" aria-hidden="true">*</span></label>
            <input id="g09-hor-inicio" v-model="formulario.hora_inicio" type="time" :aria-invalid="Boolean(errorHoras)"
              :aria-describedby="errorHoras ? 'g09-hor-inicio-error' : undefined" />
          </div>
          <div class="g09-campo">
            <label for="g09-hor-fin">Hora de fin <span class="g09-obligatorio" aria-hidden="true">*</span></label>
            <input id="g09-hor-fin" v-model="formulario.hora_fin" type="time"
              :aria-invalid="Boolean(errores.hora_fin || errorHoras)"
              :aria-describedby="[errores.hora_fin ? 'g09-hor-fin-error' : '', errorHoras ? 'g09-hor-inicio-error' : ''].filter(Boolean).join(' ') || undefined" />
          </div>
        </div>
        <p v-if="errorHoras" id="g09-hor-inicio-error" class="g09-error-campo">{{ errorHoras }}</p>
        <p v-if="errores.hora_fin" id="g09-hor-fin-error" class="g09-error-campo">{{ errores.hora_fin }}</p>
        <div class="g09-campo">
          <label for="g09-hor-cupos">Cupos</label>
          <input id="g09-hor-cupos" v-model="formulario.cupos" type="number" min="0" step="1" inputmode="numeric"
            :aria-invalid="Boolean(errores.cupos)" :aria-describedby="errores.cupos ? 'g09-hor-cupos-error' : undefined" />
          <p v-if="errores.cupos" id="g09-hor-cupos-error" class="g09-error-campo">{{ errores.cupos }}</p>
        </div>

        <button type="submit" class="g09-boton" :disabled="enviando">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
            stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M5 12.5l4.2 4.2L19 7" />
          </svg>
          Guardar
        </button>
      </form>

      <p class="g09-aviso" role="status">{{ aviso }}</p>
      <p v-if="errorEnvio" class="g09-error" role="alert">{{ errorEnvio }}</p>
    </section>

    <dialog v-if="confirmacion" open class="g09-dialogo" aria-modal="true" aria-labelledby="g09-hor-dialogo-texto">
      <p id="g09-hor-dialogo-texto">
        ¿Quitar el horario del {{ formatearFecha(confirmacion.fecha) }}, de {{ confirmacion.hora_inicio }} a {{ confirmacion.hora_fin }}?
      </p>
      <div class="g09-dialogo-acciones">
        <button ref="botonCancelarDialogo" type="button" class="g09-boton-secundario" @click="confirmacion = null">Cancelar</button>
        <button type="button" class="g09-boton-peligro" :disabled="confirmando" @click="confirmarQuitar">Quitar</button>
      </div>
    </dialog>
  </div>
</template>
