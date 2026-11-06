<!-- Dictamen de admisión de G06 (HU0010): «Componentes de la evaluación» con lo que exige el grado (C25 4) y sus resultados
     (el académico, a disposición de la psicóloga: HU0025-1.0), y el formulario «Dictamen de admisión»: Resultado (Apto, En
     observación o No apto), Conclusiones, el informe y «Guardar dictamen».
     Además del mockup: los requisitos complementarios, solo con «En observación» (HU0010-2.0), con su texto de ayuda; el
     dictamen ya emitido en solo lectura; y, en observación, el nuevo dictamen Apto o No apto (D4a-A). -->
<script setup lang="ts">
import { computed, onMounted, reactive, ref, shallowRef } from "vue";
import { descargarInforme, emitirDictamen, leerDictamen, type DetalleDictamen, type TipoDictamen } from "../../../api/dictamen";
import { mensajeDe } from "../../../api/respuesta";
import {
  AYUDA_REQUISITOS,
  erroresDictamen,
  etiquetaComponente,
  LARGO_MAXIMO_TEXTO,
  NOMBRE_DICTAMEN,
  nombreComponente,
} from "../../../gestion/dictamen";
import { abrirArchivo, nombreCompleto } from "../../../gestion/validacion";
import { NOMBRE_EVALUACION } from "../../../portal/agendaEvaluaciones";

const props = defineProps<{ idExpediente: number }>();
const emit = defineEmits<{ emitido: [] }>();

const detalle = ref<DetalleDictamen | null>(null);
const errorCarga = shallowRef("");
const datos = reactive<{ dictamen: TipoDictamen | null; conclusiones: string; requisitos: string }>({ dictamen: null, conclusiones: "", requisitos: "" });
const informe = shallowRef<File | null>(null);
const intentado = shallowRef(false);
const ocupado = shallowRef(false);
const error = shallowRef("");

const errores = computed(() => (intentado.value ? erroresDictamen(datos) : {}));
const componentes = computed(() =>
  (detalle.value?.exigidas ?? []).map((tipo) => {
    const c = detalle.value!.componentes.find((x) => x.tipo_cita === tipo);
    return { tipo, nombre: nombreComponente(tipo, c), etiqueta: etiquetaComponente(c), componente: c };
  }),
);
// «ADM-2027-0142 · 3.° de primaria · 8 años»
const datosPostulante = computed(() => {
  const d = detalle.value;
  return d ? [d.codigo, d.grado, ...(d.edad !== null ? [`${d.edad} años`] : [])].join(" · ") : "";
});
const faltan = computed(() => (detalle.value?.faltan ?? []).map((t) => NOMBRE_EVALUACION[t]).join(", "));

async function cargar(abrir = false) {
  errorCarga.value = "";
  try {
    detalle.value = await leerDictamen(props.idExpediente, abrir);
  } catch (e) {
    errorCarga.value = mensajeDe(e);
  }
}

function elegirInforme(ev: Event) {
  informe.value = (ev.target as HTMLInputElement).files?.[0] ?? null;
}

async function guardar() {
  intentado.value = true;
  if (Object.keys(erroresDictamen(datos)).length || !datos.dictamen) return;
  error.value = "";
  ocupado.value = true;
  try {
    await emitirDictamen(props.idExpediente, {
      dictamen: datos.dictamen,
      conclusiones: datos.conclusiones.trim(),
      ...(datos.dictamen === "en_observacion" ? { requisitos_complementarios: datos.requisitos.trim() } : {}),
      informe: informe.value,
    });
    Object.assign(datos, { dictamen: null, conclusiones: "", requisitos: "" });
    informe.value = null;
    intentado.value = false;
    await cargar();
    emit("emitido");
  } catch (e) {
    error.value = mensajeDe(e);
  } finally {
    ocupado.value = false;
  }
}

const verInforme = () => abrirArchivo(() => descargarInforme(props.idExpediente)).catch((e) => (error.value = mensajeDe(e)));

// Montar el panel es abrir el ítem (ADR-05): la recarga después de guardar no registra otro inicio.
onMounted(() => cargar(true));
</script>

<template>
  <section class="tarjeta panel" data-testid="panel-dictamen">
    <p v-if="errorCarga" class="mensaje" role="alert" data-testid="error-dictamen">{{ errorCarga }}</p>
    <template v-else-if="detalle">
      <div class="cabecera">
        <div class="identidad">
          <span class="nombre">{{ nombreCompleto(detalle.postulante) }}</span>
          <span class="detalle" data-testid="datos-postulante">{{ datosPostulante }}</span>
        </div>
        <span class="chip inactivo">Confidencial · solo Psicología</span>
      </div>

      <h2>Componentes de la evaluación</h2>
      <ul class="componentes" data-testid="componentes">
        <li v-for="c in componentes" :key="c.tipo" :data-testid="`componente-${c.tipo}`">
          <div class="fila">
            <span class="componente">{{ c.nombre }}</span>
            <span class="chip" :class="c.etiqueta.tono">{{ c.etiqueta.texto }}</span>
          </div>
          <dl v-if="c.componente?.resultado && c.componente.resultado !== 'inasistencia'" class="resultado">
            <dt>Resultado</dt>
            <dd>{{ c.componente.resultado }}</dd>
            <template v-if="c.componente.observaciones">
              <dt>Observaciones</dt>
              <dd>{{ c.componente.observaciones }}</dd>
            </template>
          </dl>
        </li>
      </ul>

      <div v-if="detalle.dictamen" class="emitido" data-testid="dictamen-emitido">
        <h2>Dictamen {{ detalle.opciones.length ? "vigente" : "emitido" }}: {{ NOMBRE_DICTAMEN[detalle.dictamen.dictamen] }}</h2>
        <p class="texto">{{ detalle.dictamen.conclusiones }}</p>
        <template v-if="detalle.dictamen.requisitos_complementarios">
          <span class="etiqueta">Requisitos complementarios</span>
          <p class="texto">{{ detalle.dictamen.requisitos_complementarios }}</p>
        </template>
        <button v-if="detalle.dictamen.tiene_informe" type="button" class="boton" data-testid="ver-informe" @click="verInforme">Ver informe</button>
      </div>

      <p v-if="!detalle.habilitado && detalle.estado === 'en_evaluacion'" class="suave" role="status" data-testid="dictamen-no-habilitado">
        El dictamen se habilita cuando estén registrados los resultados de: {{ faltan }}.
      </p>

      <form v-if="detalle.habilitado" class="formulario" novalidate @submit.prevent="guardar">
        <h2>{{ detalle.dictamen ? "Nuevo dictamen" : "Dictamen de admisión" }}</h2>
        <fieldset class="opciones" :aria-invalid="errores.dictamen ? 'true' : undefined">
          <legend>Resultado <span class="requerido">*</span></legend>
          <label v-for="o in detalle.opciones" :key="o" class="opcion" :class="{ elegida: datos.dictamen === o }">
            <input v-model="datos.dictamen" type="radio" name="dictamen" :value="o" :data-testid="`opcion-${o}`" />
            {{ NOMBRE_DICTAMEN[o] }}
          </label>
        </fieldset>
        <span v-if="errores.dictamen" class="error-campo">{{ errores.dictamen }}</span>

        <div class="campo">
          <label for="conclusiones">Conclusiones <span class="requerido">*</span></label>
          <textarea
            id="conclusiones"
            v-model="datos.conclusiones"
            :maxlength="LARGO_MAXIMO_TEXTO"
            :aria-invalid="errores.conclusiones ? 'true' : undefined"
            data-testid="campo-conclusiones"
          ></textarea>
          <span v-if="errores.conclusiones" class="error-campo">{{ errores.conclusiones }}</span>
        </div>

        <div v-if="datos.dictamen === 'en_observacion'" class="campo" data-testid="bloque-requisitos">
          <label for="requisitos">Requisitos complementarios <span class="requerido">*</span></label>
          <span id="ayuda-requisitos" class="ayuda">{{ AYUDA_REQUISITOS }}</span>
          <textarea
            id="requisitos"
            v-model="datos.requisitos"
            :maxlength="LARGO_MAXIMO_TEXTO"
            aria-describedby="ayuda-requisitos"
            :aria-invalid="errores.requisitos ? 'true' : undefined"
            data-testid="campo-requisitos"
          ></textarea>
          <span v-if="errores.requisitos" class="error-campo">{{ errores.requisitos }}</span>
        </div>

        <div class="campo">
          <label for="informe">Informe psicopedagógico (PDF o imagen, hasta 10 MB)</label>
          <input id="informe" type="file" accept=".pdf,.jpg,.jpeg,.png" data-testid="campo-informe" @change="elegirInforme" />
        </div>

        <p v-if="error" class="mensaje" role="alert" data-testid="error-guardar">{{ error }}</p>
        <div class="acciones">
          <button type="submit" class="boton primario" :disabled="ocupado" data-testid="guardar-dictamen">Guardar dictamen</button>
        </div>
      </form>
    </template>
  </section>
</template>

<style scoped src="../validacion/validacion.css"></style>

<style scoped>
.panel,
.formulario,
.emitido {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.cabecera {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 12px;
}

.identidad {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.nombre {
  font-weight: 700;
}

.detalle,
.ayuda {
  font-size: 13px;
  color: var(--texto-suave);
}

.componentes {
  margin: 0;
  padding: 0;
  list-style: none;
}

.componentes li {
  padding: 12px 0;
  border-top: 1px solid var(--borde);
}

.fila {
  display: flex;
  align-items: center;
  gap: 12px;
}

.componente {
  flex-grow: 1;
  font-size: 15px;
}

.resultado {
  margin: 8px 0 0;
  display: grid;
  grid-template-columns: max-content 1fr;
  gap: 4px 12px;
  font-size: 14px;
}

.resultado dt,
.etiqueta {
  font-weight: 600;
}

.resultado dd {
  margin: 0;
  white-space: pre-wrap;
}

.texto {
  margin: 0;
  white-space: pre-wrap;
}

.opciones {
  margin: 0;
  padding: 0;
  border: none;
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
}

.opciones legend {
  font-size: 14px;
  font-weight: 600;
  margin-bottom: 6px;
}

.opcion {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  min-height: 44px;
  padding: 0 16px;
  border: 1px solid var(--borde-campo);
  border-radius: 10px;
  cursor: pointer;
}

.opcion.elegida {
  border-color: var(--cil-azul);
  background: var(--seleccion-fondo);
  font-weight: 600;
}

.error-campo {
  font-size: 13px;
  color: var(--observado);
}

.acciones {
  display: flex;
  justify-content: flex-end;
}
</style>
