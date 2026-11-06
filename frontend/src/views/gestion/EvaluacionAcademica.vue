<!-- G11 · Registro de la evaluación académica (HU0025). Implementa docs/ui/G11-EvalAcademica.dc.html: la tabla del día (Hora,
     Postulante, Grado, Estado) y el formulario de la cita elegida con «Marcar “No asistió”» y «Guardar resultado», y la nota
     de R3 («No tienes acceso al informe psicológico ni a la documentación financiera»).
     Desvíos del mockup: el selector de día anterior y siguiente; sin «Adjunta la evaluación corregida» (S5, C57); la nota
     «Solo se agendan evaluaciones académicas desde 2.° de primaria» no se fija en el código (C25 4: las exigidas salen del
     grado configurado en G09); el estado «No asistió», que el mockup no dibuja. -->
<script setup lang="ts">
import { etiquetaCita, horaLarga } from "../../gestion/dictamen";
import { nombreCompleto } from "../../gestion/validacion";
import FormularioResultado from "./evaluacion/FormularioResultado.vue";
import SelectorDia from "./evaluacion/SelectorDia.vue";
import { useAgendaDia } from "./evaluacion/useAgendaDia";

const a = useAgendaDia("evaluacion-academica");
const { fecha, agenda, error, cita, errorCita } = a;
</script>

<template>
  <div class="g11">
    <div class="agenda">
      <SelectorDia :fecha="fecha" @mover="a.moverDia" />
      <p v-if="error" class="mensaje" role="alert" data-testid="error-agenda">{{ error }}</p>
      <p v-else-if="agenda && agenda.citas.length === 0" class="suave" role="status" data-testid="agenda-vacia">No tienes evaluaciones este día.</p>
      <div v-else-if="agenda" class="tabla-envoltura">
        <table class="tabla" aria-label="Evaluaciones académicas del día">
          <thead>
            <tr>
              <th scope="col">Hora</th>
              <th scope="col">Postulante</th>
              <th scope="col">Grado</th>
              <th scope="col">Estado</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="c in agenda.citas" :key="c.id_cita" :class="{ seleccionada: cita?.id_cita === c.id_cita }" :data-testid="`fila-${c.id_cita}`">
              <td>{{ horaLarga(c.hora_inicio) }}</td>
              <td>
                <button type="button" class="enlace celda-doble" :data-testid="`cita-${c.id_cita}`" @click="a.abrir(c.id_cita)">
                  <span class="nombre">{{ nombreCompleto(c.postulante) }}</span>
                  <span class="detalle">{{ c.codigo }}</span>
                </button>
              </td>
              <td>{{ c.grado }}</td>
              <td>
                <span class="chip" :class="etiquetaCita(c).tono">{{ etiquetaCita(c).texto }}</span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <div class="lateral">
      <p v-if="errorCita" class="mensaje" role="alert">{{ errorCita }}</p>
      <FormularioResultado v-if="cita" :key="cita.id_cita" area="evaluacion-academica" :cita="cita" permite-inasistencia @registrado="a.refrescar">
        <template #nota>
          <p class="nota" data-testid="nota-r3">
            El resultado queda disponible para la Psicóloga, que emite el dictamen de admisión. No tienes acceso al informe psicológico ni a la
            documentación financiera.
          </p>
        </template>
      </FormularioResultado>
      <p v-else-if="!errorCita" class="suave">Elige una evaluación de la tabla para registrar su resultado.</p>
    </div>
  </div>
</template>

<style scoped src="./validacion/validacion.css"></style>

<style scoped>
.g11 {
  display: flex;
  gap: 24px;
  align-items: flex-start;
}

.agenda {
  flex: 0 0 520px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.lateral {
  flex: 1 1 auto;
  min-width: 0;
}

.enlace {
  padding: 0;
  border: none;
  background: none;
  font-family: var(--fuente-texto);
  text-align: left;
  cursor: pointer;
  min-height: 44px;
}

.enlace .nombre {
  color: var(--cil-azul);
  text-decoration: underline;
}

.enlace:focus-visible {
  outline: 3px solid var(--cil-dorado);
  outline-offset: 2px;
}

.nota {
  margin: 0;
  padding: 14px 16px;
  border-radius: 12px;
  background: var(--chip-fondo);
  color: var(--cil-azul);
  font-size: 14px;
}

@media (max-width: 1024px) {
  .g11 {
    flex-direction: column;
  }

  .agenda {
    flex-basis: auto;
    width: 100%;
  }

  .lateral {
    width: 100%;
  }
}
</style>
