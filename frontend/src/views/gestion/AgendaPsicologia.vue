<!-- G06 · Agenda de Psicología y dictamen de admisión (HU0010). Implementa docs/ui/G06-Psicologia.dc.html: la agenda del día
     a la izquierda y, al elegir una cita, el formulario de su resultado a la derecha. El dictamen del expediente se abre
     con «Abrir dictamen»: es la apertura del ítem que mide el cycle time (ADR-05, HU0019), así que abrir una cita no la
     registra. No es un botón de «Iniciar revisión»: sin él no se ve el panel.
     Desvíos del mockup: el selector de día anterior y siguiente; el formulario de resultado de la cita (S1 de ADR-25, el
     mismo de G11) arriba del dictamen; la nota de las evaluaciones por nivel no se fija en el código (C25 4: las exigidas
     salen del grado configurado en G09 y se ven en «Componentes de la evaluación»). -->
<script setup lang="ts">
import { shallowRef, watch } from "vue";
import { NOMBRE_EVALUACION } from "../../portal/agendaEvaluaciones";
import { horaCorta, etiquetaCita } from "../../gestion/dictamen";
import { nombreCompleto } from "../../gestion/validacion";
import FormularioResultado from "./evaluacion/FormularioResultado.vue";
import PanelDictamen from "./evaluacion/PanelDictamen.vue";
import SelectorDia from "./evaluacion/SelectorDia.vue";
import { useAgendaDia } from "./evaluacion/useAgendaDia";

const a = useAgendaDia("psicologia");
const { fecha, agenda, error, cita, errorCita } = a;

// Expediente con el panel del dictamen abierto. Otra cita, u otro resultado registrado, lo cierra: el dictamen se vuelve a
// abrir con sus datos al día, y cada apertura es una atención (ADR-05).
const dictamenAbierto = shallowRef<number | null>(null);
watch(
  () => cita.value?.id_cita,
  () => (dictamenAbierto.value = null),
);

function resultadoRegistrado() {
  dictamenAbierto.value = null;
  void a.refrescar();
}
</script>

<template>
  <div class="g06">
    <section class="tarjeta agenda">
      <SelectorDia :fecha="fecha" @mover="a.moverDia" />
      <p v-if="error" class="mensaje" role="alert" data-testid="error-agenda">{{ error }}</p>
      <p v-else-if="agenda && agenda.citas.length === 0" class="suave" role="status" data-testid="agenda-vacia">No tienes citas este día.</p>
      <ul v-else-if="agenda" class="citas" aria-label="Citas del día">
        <li v-for="c in agenda.citas" :key="c.id_cita">
          <button
            type="button"
            class="cita"
            :class="{ elegida: cita?.id_cita === c.id_cita }"
            :aria-pressed="cita?.id_cita === c.id_cita"
            :data-testid="`cita-${c.id_cita}`"
            @click="a.abrir(c.id_cita)"
          >
            <span class="hora">{{ horaCorta(c.hora_inicio) }}</span>
            <span class="datos">
              <span class="nombre">{{ nombreCompleto(c.postulante) }}</span>
              <span class="detalle">{{ NOMBRE_EVALUACION[c.tipo_cita] }} · {{ c.grado }}</span>
            </span>
            <span class="chip" :class="etiquetaCita(c).tono">{{ etiquetaCita(c).texto }}</span>
          </button>
        </li>
      </ul>
    </section>

    <div class="lateral">
      <p v-if="errorCita" class="mensaje" role="alert">{{ errorCita }}</p>
      <template v-if="cita">
        <FormularioResultado :key="`cita-${cita.id_cita}`" area="psicologia" :cita="cita" @registrado="resultadoRegistrado" />
        <PanelDictamen v-if="dictamenAbierto === cita.id_expediente" :key="`dictamen-${cita.id_expediente}`" :id-expediente="cita.id_expediente" @emitido="a.cargar" />
        <button v-else type="button" class="boton primario abrir-dictamen" data-testid="abrir-dictamen" @click="dictamenAbierto = cita.id_expediente">Abrir dictamen</button>
      </template>
      <p v-else-if="!errorCita" class="suave">Elige una cita de la agenda para registrar su resultado o el dictamen.</p>
    </div>
  </div>
</template>

<style scoped src="./validacion/validacion.css"></style>

<style scoped>
.g06 {
  display: flex;
  gap: 24px;
  align-items: flex-start;
}

.agenda {
  flex: 0 0 420px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.lateral {
  flex: 1 1 auto;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 24px;
}

.abrir-dictamen {
  align-self: flex-start;
}

.citas {
  margin: 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.cita {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px;
  border: 1px solid var(--borde);
  border-radius: 10px;
  background: var(--superficie);
  font-family: var(--fuente-texto);
  text-align: left;
  cursor: pointer;
}

.cita.elegida {
  background: var(--fila-aviso);
  border-color: var(--cil-dorado);
}

.cita:focus-visible {
  outline: 3px solid var(--cil-dorado);
  outline-offset: 2px;
}

.hora {
  width: 64px;
  flex-shrink: 0;
  font-size: 14px;
  font-weight: 700;
  color: var(--cil-azul);
}

.datos {
  flex-grow: 1;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.nombre {
  font-size: 14px;
  font-weight: 700;
  color: var(--texto);
}

.detalle {
  font-size: 13px;
  color: var(--texto-suave);
}

@media (max-width: 1024px) {
  .g06 {
    flex-direction: column;
  }

  .agenda {
    flex-basis: auto;
    width: 100%;
    box-sizing: border-box;
  }

  .lateral {
    width: 100%;
  }
}
</style>
