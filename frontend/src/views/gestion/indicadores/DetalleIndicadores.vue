<!-- Tablas de G08 que el mockup no dibuja: ocupación por grado y lead time por expediente (las exige HU0019-1.0) y avisos (C8).
     Solo códigos de expediente y agregados, sin datos personales. -->
<script setup lang="ts">
import type { Aviso, ExpedienteIndicador, GradoVacantes } from "../../../api/indicadores";
import { etiquetaAviso, textoDias, textoHoras, textoPct } from "../../../gestion/indicadores";

defineProps<{ vacantes: GradoVacantes[]; avisos: Aviso[]; expedientes: ExpedienteIndicador[] }>();
</script>

<template>
  <section class="tarjeta" aria-labelledby="g08-vacantes">
    <h2 id="g08-vacantes">Ocupación de vacantes por grado</h2>
    <p v-if="vacantes.length === 0" class="suave">Esta campaña no tiene grados configurados.</p>
    <div v-else class="tabla-envoltura">
      <table class="tabla" aria-label="Ocupación de vacantes por grado">
        <thead>
          <tr>
            <th scope="col">Grado</th>
            <th scope="col">Autorizadas</th>
            <th scope="col">Adjudicadas</th>
            <th scope="col">Disponibles</th>
            <th scope="col">Lista de espera</th>
            <th scope="col">Ocupación</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="g in vacantes" :key="g.id_grado" :data-testid="`vacantes-${g.id_grado}`">
            <td>{{ g.grado }}</td>
            <td>{{ g.autorizadas }}</td>
            <td>{{ g.adjudicadas }}</td>
            <td>{{ g.disponibles }}</td>
            <td>{{ g.lista_espera }}</td>
            <td>{{ textoPct(g.ocupacion_pct) }}</td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>

  <section class="tarjeta" aria-labelledby="g08-expedientes">
    <h2 id="g08-expedientes">Lead time por expediente</h2>
    <p v-if="expedientes.length === 0" class="suave" data-testid="sin-expedientes">No hay expedientes con estos filtros.</p>
    <div v-else class="tabla-envoltura alta">
      <table class="tabla" aria-label="Lead time por expediente">
        <thead>
          <tr>
            <th scope="col">Expediente</th>
            <th scope="col">Grado</th>
            <th scope="col">Etapa alcanzada</th>
            <th scope="col">Lead time</th>
            <th scope="col">Atención</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="x in expedientes" :key="x.codigo" data-testid="fila-expediente">
            <td>{{ x.codigo }}</td>
            <td>{{ x.grado }}</td>
            <td>{{ x.etapa }}</td>
            <td>{{ textoDias(x.dias) }}{{ x.final ? "" : " (parcial)" }}</td>
            <td>{{ textoHoras(x.cycle_horas) }}</td>
          </tr>
        </tbody>
      </table>
    </div>
    <p class="suave">«Parcial»: días desde el registro hasta la última etapa alcanzada; el lead time termina con la carta emitida.</p>
  </section>

  <section class="tarjeta" aria-labelledby="g08-avisos">
    <h2 id="g08-avisos">Avisos enviados</h2>
    <p v-if="avisos.length === 0" class="suave">Todavía no hay avisos cerrados.</p>
    <div v-else class="tabla-envoltura">
      <table class="tabla" aria-label="Avisos enviados">
        <thead>
          <tr>
            <th scope="col">Tipo de aviso</th>
            <th scope="col">Enviados</th>
            <th scope="col">Fallidos</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="a in avisos" :key="a.tipo_evento" :data-testid="`aviso-${a.tipo_evento}`">
            <td>{{ etiquetaAviso(a.tipo_evento) }}</td>
            <td>{{ a.enviados }}</td>
            <td>{{ a.fallidos }}</td>
          </tr>
        </tbody>
      </table>
    </div>
    <p class="suave">Cada aviso cuenta una vez; los intentos sin resultado no cuentan como envíos.</p>
  </section>
</template>

<style scoped src="../validacion/validacion.css"></style>

<style scoped>
.alta {
  max-height: 420px;
  overflow-y: auto;
}
</style>
