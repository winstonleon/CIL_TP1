<!-- Tabla de G02 (bandeja de expedientes): código, postulante con su apoderado, grado, estado de la validación documental,
     última actividad, días en proceso y «Revisar». Un expediente que volvió a revisión tras una subsanación muestra
     «Subsanado» y el motivo de la observación como «Motivo anterior», nunca como observación vigente. -->
<script setup lang="ts">
import { RouterLink } from "vue-router";
import type { FilaBandeja } from "../../../api/validaciones";
import { diasEnProceso, etiquetaBandeja, fechaRelativa, nombreAbreviado, nombreCompleto } from "../../../gestion/validacion";

defineProps<{ filas: readonly FilaBandeja[]; ahora: Date }>();
</script>

<template>
  <div class="tabla-envoltura">
    <table class="tabla" aria-label="Expedientes">
      <thead>
        <tr>
          <th scope="col">Código</th>
          <th scope="col">Postulante</th>
          <th scope="col">Grado</th>
          <th scope="col">Estado</th>
          <th scope="col">Última actividad</th>
          <th scope="col">En proceso</th>
          <th scope="col"><span class="solo-lector">Acción</span></th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="f in filas" :key="f.id_expediente" :data-testid="`expediente-${f.id_expediente}`">
          <td>{{ f.codigo }}</td>
          <td>
            <div class="celda-doble">
              <span class="nombre">{{ nombreCompleto(f.postulante) }}</span>
              <span class="detalle">Apod.: {{ nombreAbreviado(f.apoderado) }}</span>
            </div>
          </td>
          <td>{{ f.grado.nombre_grado }}</td>
          <td>
            <div class="celda-doble">
              <span class="chip" :class="etiquetaBandeja(f).tono">{{ etiquetaBandeja(f).texto }}</span>
              <span
                v-for="(m, i) in f.estado_documental === 'pendiente' ? f.motivos_anteriores : []"
                :key="i"
                class="motivo-anterior"
                data-testid="motivo-anterior"
              >
                Motivo anterior: {{ m }}
              </span>
            </div>
          </td>
          <td>{{ fechaRelativa(f.ultima_actividad, ahora) }}</td>
          <td>{{ diasEnProceso(f.en_validacion_desde, ahora) }}</td>
          <td>
            <RouterLink :to="`/gestion/bandeja/${f.id_expediente}`" class="boton primario" :aria-label="`Revisar ${f.codigo}`">
              Revisar
            </RouterLink>
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>

<style scoped src="./validacion.css"></style>
