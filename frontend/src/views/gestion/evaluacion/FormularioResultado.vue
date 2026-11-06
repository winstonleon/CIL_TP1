<!-- Formulario de la cita (G11, y el mismo en G06 por S1 de ADR-25, porque el mockup de G06 no lo dibuja): resultado,
     observaciones, «Guardar resultado» y, solo en G11, «Marcar “No asistió”» con confirmación (HU0025-2.0). Una cita ya
     registrada muestra su resultado en solo lectura. Desvío del mockup de G11: no tiene «Adjunta la evaluación corregida»
     (S5; compromiso C57). -->
<script setup lang="ts">
import { computed, reactive, shallowRef } from "vue";
import { registrarInasistencia, registrarResultado, type AreaEvaluacion, type DetalleCita } from "../../../api/dictamen";
import { mensajeDe } from "../../../api/respuesta";
import { erroresResultado, LARGO_MAXIMO_RESULTADO, LARGO_MAXIMO_TEXTO } from "../../../gestion/dictamen";
import { nombreCompleto } from "../../../gestion/validacion";
import { cuandoEs, NOMBRE_EVALUACION } from "../../../portal/agendaEvaluaciones";

const props = defineProps<{ area: AreaEvaluacion; cita: DetalleCita; permiteInasistencia?: boolean }>();
const emit = defineEmits<{ registrado: [] }>();

const datos = reactive({ resultado: "", observaciones: "" });
const intentado = shallowRef(false);
const ocupado = shallowRef(false);
const error = shallowRef("");
const confirmandoInasistencia = shallowRef(false);

const errores = computed(() => (intentado.value ? erroresResultado(datos) : {}));
const idCampo = (c: string) => `${c}-${props.cita.id_cita}`;

async function enviar(fn: () => Promise<void>) {
  error.value = "";
  ocupado.value = true;
  try {
    await fn();
    emit("registrado");
  } catch (e) {
    error.value = mensajeDe(e);
  } finally {
    ocupado.value = false;
  }
}

function guardar() {
  intentado.value = true;
  if (Object.keys(erroresResultado(datos)).length) return;
  void enviar(() => registrarResultado(props.area, props.cita.id_cita, { resultado: datos.resultado.trim(), observaciones: datos.observaciones.trim() }));
}

function marcarInasistencia() {
  confirmandoInasistencia.value = false;
  void enviar(() => registrarInasistencia(props.cita.id_cita));
}
</script>

<template>
  <section class="tarjeta formulario" data-testid="formulario-resultado">
    <div class="identidad">
      <span class="nombre">{{ nombreCompleto(cita.postulante) }}</span>
      <span class="detalle">{{ cita.codigo }} · Postula a {{ cita.grado }}</span>
      <span class="detalle">{{ NOMBRE_EVALUACION[cita.tipo_cita] }} · {{ cuandoEs(cita) }}</span>
    </div>

    <dl v-if="cita.resultado" class="registrado" data-testid="resultado-registrado">
      <dt>Resultado</dt>
      <dd>{{ cita.resultado.resultado === "inasistencia" ? "No asistió" : cita.resultado.resultado }}</dd>
      <template v-if="cita.resultado.observaciones">
        <dt>Observaciones</dt>
        <dd>{{ cita.resultado.observaciones }}</dd>
      </template>
    </dl>

    <template v-else-if="cita.registrable">
      <p v-if="!cita.iniciada" class="suave" role="status" data-testid="no-iniciada">El resultado se registra cuando la cita ya empezó.</p>
      <div class="campo">
        <label :for="idCampo('resultado')">Resultado <span class="requerido">*</span></label>
        <input
          :id="idCampo('resultado')"
          v-model="datos.resultado"
          type="text"
          :maxlength="LARGO_MAXIMO_RESULTADO"
          placeholder="[Escala de calificación por definir]"
          :aria-invalid="errores.resultado ? 'true' : undefined"
          data-testid="campo-resultado"
        />
        <span v-if="errores.resultado" class="error-campo">{{ errores.resultado }}</span>
      </div>
      <div class="campo">
        <label :for="idCampo('observaciones')">Observaciones <span class="requerido">*</span></label>
        <textarea
          :id="idCampo('observaciones')"
          v-model="datos.observaciones"
          :maxlength="LARGO_MAXIMO_TEXTO"
          :aria-invalid="errores.observaciones ? 'true' : undefined"
          data-testid="campo-observaciones"
        ></textarea>
        <span v-if="errores.observaciones" class="error-campo">{{ errores.observaciones }}</span>
      </div>
      <slot name="nota"></slot>
      <p v-if="error" class="mensaje" role="alert" data-testid="error-resultado">{{ error }}</p>

      <div v-if="confirmandoInasistencia" class="confirmacion" role="alertdialog" aria-label="Confirmar inasistencia" data-testid="confirmar-inasistencia">
        <span>¿El postulante no se presentó? La cita se libera y se avisa a la familia para que la reprograme.</span>
        <div class="acciones">
          <button type="button" class="boton" @click="confirmandoInasistencia = false">Cancelar</button>
          <button type="button" class="boton observar" :disabled="ocupado" data-testid="confirmar-no-asistio" @click="marcarInasistencia">Confirmar «No asistió»</button>
        </div>
      </div>
      <div v-else class="acciones">
        <button
          v-if="permiteInasistencia"
          type="button"
          class="boton observar"
          :disabled="ocupado || !cita.iniciada"
          data-testid="marcar-no-asistio"
          @click="confirmandoInasistencia = true"
        >
          Marcar “No asistió”
        </button>
        <button type="button" class="boton primario" :disabled="ocupado || !cita.iniciada" data-testid="guardar-resultado" @click="guardar">Guardar resultado</button>
      </div>
    </template>
  </section>
</template>

<style scoped src="../validacion/validacion.css"></style>

<style scoped>
.formulario {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.identidad {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.nombre {
  font-weight: 700;
}

.detalle {
  font-size: 13px;
  color: var(--texto-suave);
}

.registrado {
  margin: 0;
  display: grid;
  grid-template-columns: max-content 1fr;
  gap: 8px 16px;
}

.registrado dt {
  font-weight: 600;
}

.registrado dd {
  margin: 0;
  white-space: pre-wrap;
}

.error-campo {
  font-size: 13px;
  color: var(--observado);
}

.acciones {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
  flex-wrap: wrap;
}

.confirmacion {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 14px 16px;
  border-radius: 12px;
  background: var(--fila-aviso);
}
</style>
