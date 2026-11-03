<!-- G04 · Tabla de visitas (HU0004), con las columnas del mockup: Hora · Familia · Teléfono · Asistencia · Acción. La
     usan la agenda del día y la sección «Sin registrar» (A5, con la fecha delante de la hora). Una visita por registrar
     ofrece «Asistió» y «No asistió»; las registradas muestran su resultado (S2): «Portal habilitado» o la invitación a
     reprogramar según su envío. -->
<script setup lang="ts">
import type { Visita } from "../../api/visitas";
import { telefonoVisible } from "../../gestion/telefono";
import { horaVisible } from "../../portal/calendarioVisita";

defineProps<{
  visitas: Visita[];
  etiquetadaPor: string; // id del título de la sección
  conFecha?: boolean;
  seleccionada?: number | null;
  ocupada?: boolean; // hay un registro en curso: los botones se deshabilitan
}>();
const emit = defineEmits<{ asistio: [visita: Visita]; noAsistio: [visita: Visita] }>();

const fechaCorta = (fecha: string) => fecha.split("-").reverse().join("/");

const INVITACION: Record<string, string> = {
  enviado: "Invitación a reprogramar enviada",
  fallido: "Invitación a reprogramar no entregada",
  pendiente: "Invitación a reprogramar pendiente",
};
const invitacion = (v: Visita) => INVITACION[v.aviso?.estado_envio ?? "pendiente"]!;
</script>

<template>
  <div class="tabla-envoltura">
    <table class="tabla" :aria-labelledby="etiquetadaPor">
      <thead>
        <tr>
          <th scope="col" class="col-hora">Hora</th>
          <th scope="col">Familia</th>
          <th scope="col" class="col-telefono">Teléfono</th>
          <th scope="col" class="col-asistencia">Asistencia</th>
          <th scope="col" class="col-accion">Acción</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="v in visitas" :key="v.id_cita" :data-testid="`visita-${v.id_cita}`" :class="{ resaltada: v.id_cita === seleccionada }">
          <td>{{ conFecha ? `${fechaCorta(v.fecha)} · ` : "" }}{{ horaVisible(v.hora_inicio) }}</td>
          <td>
            <div class="celda-doble">
              <span class="nombre">{{ v.apoderado.nombres }} {{ v.apoderado.apellidos }}</span>
              <span class="detalle">Interés: {{ v.grado.nombre_grado }}</span>
              <span v-if="v.asistentes" class="detalle">Asistentes: {{ v.asistentes }}</span>
            </div>
          </td>
          <td>{{ telefonoVisible(v.apoderado.telefono) }}</td>
          <td>
            <span v-if="v.estado_cita === 'asistio'" class="chip chip-conforme">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"
                stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.2 4.2L19 7" /></svg>
              Asistió
            </span>
            <span v-else-if="v.estado_cita === 'no_asistio'" class="chip chip-observado">No asistió</span>
            <span v-else class="chip chip-neutro">Por registrar</span>
          </td>
          <td>
            <div v-if="v.estado_cita === 'reservada'" class="acciones">
              <button type="button" class="boton boton-asistio" :disabled="ocupada" @click="emit('asistio', v)">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"
                  stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.2 4.2L19 7" /></svg>
                Asistió
              </button>
              <button type="button" class="boton boton-no-asistio" :disabled="ocupada" @click="emit('noAsistio', v)">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"
                  stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 6l12 12" /><path d="M18 6L6 18" /></svg>
                No asistió
              </button>
            </div>
            <span v-else-if="v.estado_cita === 'asistio'" class="chip chip-neutro">Portal habilitado</span>
            <span v-else-if="v.estado_cita === 'no_asistio'" class="chip chip-neutro">{{ invitacion(v) }}</span>
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>

<style scoped>
.tabla-envoltura {
  overflow-x: auto;
}

.tabla {
  width: 100%;
  border-collapse: collapse;
  background: var(--superficie);
  border: 1px solid var(--borde);
  border-radius: 12px;
  overflow: hidden;
}

.tabla th {
  text-align: left;
  padding: 12px 14px;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--texto-suave);
  border-bottom: 1px solid var(--borde);
  background: var(--superficie-tenue);
}

.tabla td {
  padding: 12px 14px;
  font-size: 14px;
  color: var(--texto);
  border-bottom: 1px solid var(--borde);
  vertical-align: middle;
}

.resaltada {
  background: var(--fila-aviso);
}

.col-hora {
  width: 120px;
}

.col-telefono {
  width: 130px;
}

.col-asistencia {
  width: 150px;
}

.col-accion {
  width: 260px;
}

/* Con el panel «Registrar visita» abierto, la tabla queda en unos 700 px: el teléfono no se parte y los botones y la
   etiqueta de la acción pueden bajar de línea, para que «Familia» conserve un ancho legible. */
.tabla td:nth-child(3) {
  white-space: nowrap;
}

.tabla td:last-child > .chip {
  white-space: normal;
}

.celda-doble {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 140px;
}

.nombre {
  font-weight: 700;
}

.detalle {
  font-size: 13px;
  color: var(--texto-suave);
}

.chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 10px;
  border-radius: 999px;
  font-size: 13px;
  font-weight: 600;
  white-space: nowrap;
}

.chip-neutro {
  background: var(--inactivo-fondo);
  color: var(--inactivo);
}

.chip-conforme {
  background: var(--conforme-fondo);
  color: var(--conforme);
}

.chip-observado {
  background: var(--aviso-fondo);
  color: var(--observado);
}

.acciones {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.boton {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 44px;
  padding: 0 14px;
  border-radius: 9px;
  font-family: var(--fuente-texto);
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  white-space: nowrap;
}

.boton:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.boton-asistio {
  border: 1px solid var(--conforme);
  background: var(--conforme);
  color: #ffffff;
}

.boton-no-asistio {
  border: 1px solid var(--observado);
  background: var(--superficie);
  color: var(--observado);
}
</style>
