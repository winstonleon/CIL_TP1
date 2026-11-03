<!-- G04 · Visitas guiadas (Secretaría), sección «Prospectos con contacto no entregado» (HU0002-2.0, rechazo síncrono):
     los prospectos cuyo correo con la carpeta informativa rebotó. Sin la columna «Acciones» («Corregir datos» y
     «Reenviar carpeta» no tienen HU, C32). La pantalla G04 (PantallaVisitas) la muestra bajo la agenda de HU0004. El
     mensaje vacío, el formato del teléfono y el de la fecha son los de S9 (plan HU0002). -->
<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { listarContactoNoEntregado, type ProspectoContactoNoEntregado } from "../../api/prospectos";
import { mensajeDe } from "../../api/respuesta";
import { telefonoVisible } from "../../gestion/telefono";

const prospectos = ref<ProspectoContactoNoEntregado[]>([]);
const cargado = ref(false);
const errorCarga = ref("");

const pendientes = computed(() => prospectos.value.length);
const insignia = computed(() => `${pendientes.value} ${pendientes.value === 1 ? "pendiente" : "pendientes"}`);
const insigniaLector = computed(() =>
  pendientes.value === 1 ? "1 prospecto pendiente" : `${pendientes.value} prospectos pendientes`,
);

// S9: la fecha del último rebote en dd/mm/aaaa, en la hora de Lima (la API la envía en UTC).
const FORMATO_FECHA = new Intl.DateTimeFormat("es-PE", {
  timeZone: "America/Lima",
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
});

function fechaVisible(iso: string | null): string {
  if (!iso) return "";
  const partes = Object.fromEntries(FORMATO_FECHA.formatToParts(new Date(iso)).map((p) => [p.type, p.value]));
  return `${partes.day}/${partes.month}/${partes.year}`;
}

onMounted(async () => {
  try {
    prospectos.value = await listarContactoNoEntregado();
  } catch (e) {
    errorCarga.value = mensajeDe(e);
  } finally {
    cargado.value = true;
  }
});
</script>

<template>
  <section class="g04-contacto" aria-labelledby="g04-contacto-titulo">
    <div class="encabezado-seccion">
      <h2 id="g04-contacto-titulo" class="titulo-seccion">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="var(--observado)" stroke-width="2"
          stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M12 8v5" />
          <path d="M12 16.5v.5" />
          <path d="M10.3 3.9L2.6 17.5A2 2 0 0 0 4.3 20.5h15.4a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" />
        </svg>
        Prospectos con contacto no entregado
      </h2>
      <span v-if="pendientes > 0" class="insignia" data-testid="insignia-pendientes">
        <span aria-hidden="true">{{ insignia }}</span>
        <span class="solo-lector">{{ insigniaLector }}</span>
      </span>
    </div>

    <p v-if="errorCarga" class="error" role="alert">{{ errorCarga }}</p>
    <template v-else-if="cargado">
      <p v-if="pendientes === 0" class="texto-seccion" role="status">No hay prospectos con contacto no entregado.</p>
      <template v-else>
        <p class="texto-seccion">El correo con la carpeta informativa rebotó. Corrige los datos de contacto y reenvía la carpeta.</p>
        <div class="tabla-envoltura">
          <table class="tabla" aria-labelledby="g04-contacto-titulo">
            <thead>
              <tr>
                <th scope="col">Prospecto</th>
                <th scope="col">Correo rebotado</th>
                <th scope="col" class="col-telefono">Teléfono</th>
                <th scope="col" class="col-fecha">Fecha</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="p in prospectos" :key="p.id_expediente" :data-testid="`prospecto-${p.id_expediente}`">
                <td>
                  <div class="celda-doble">
                    <span class="nombre">{{ p.nombres }} {{ p.apellidos }}</span>
                    <span class="detalle">Interés: {{ p.grado.nombre_grado }}</span>
                  </div>
                </td>
                <td>
                  <span class="celda-doble">
                    <span>{{ p.correo }}</span>
                    <span class="no-entregado">Contacto no entregado</span>
                  </span>
                </td>
                <td>{{ telefonoVisible(p.telefono) }}</td>
                <td>{{ fechaVisible(p.fecha_rebote) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </template>
    </template>
  </section>
</template>

<style scoped>
.g04-contacto {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.encabezado-seccion {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.titulo-seccion {
  margin: 0;
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 22px;
  font-weight: 600;
  color: var(--cil-azul);
}

.titulo-seccion svg {
  flex-shrink: 0;
}

.insignia {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 10px;
  border-radius: 999px;
  background: var(--aviso-fondo);
  color: var(--observado);
  font-size: 13px;
  font-weight: 600;
  white-space: nowrap;
}

.texto-seccion {
  margin: 0;
  font-size: 14px;
  color: var(--texto-suave);
}

.error {
  margin: 0;
  font-size: 13px;
  color: var(--observado);
}

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

.col-telefono {
  width: 130px;
}

.col-fecha {
  width: 120px;
}

.celda-doble {
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

.no-entregado {
  font-size: 13px;
  font-weight: 600;
  color: var(--observado);
}

@media (max-width: 900px) {
  .encabezado-seccion {
    flex-wrap: wrap;
  }
}
</style>
