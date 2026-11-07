<!-- G08 · Tablero de indicadores (Directora, HU0019). Implementa docs/ui/G08-Indicadores.dc.html: filtros, cuatro tarjetas, embudo
     y tiempos por etapa, más lo que el mockup no dibuja y exige la HU (ADR-27). La pantalla no calcula nada: consulta la API al
     abrir, con la campaña activa, y cada vez que se pulsa «Actualizar métricas». El lead time no se muestra hasta que exista
     una carta emitida (HU0016): antes de eso, la tarjeta lo dice. -->
<script setup lang="ts">
import { onMounted, ref, shallowRef } from "vue";
import { exportarReporte, leerIndicadores, leerOpcionesFiltro, type Filtros, type Indicadores, type OpcionesFiltro } from "../../api/indicadores";
import { mensajeDe } from "../../api/respuesta";
import { AVISO_DEMO, guardarArchivo, textoDias, textoPct } from "../../gestion/indicadores";
import ComparacionLineaBase from "./indicadores/ComparacionLineaBase.vue";
import DetalleIndicadores from "./indicadores/DetalleIndicadores.vue";
import EmbudoAdmision from "./indicadores/EmbudoAdmision.vue";
import FiltrosIndicadores from "./indicadores/FiltrosIndicadores.vue";
import TiemposPorEtapa from "./indicadores/TiemposPorEtapa.vue";

const opciones = ref<OpcionesFiltro | null>(null);
const filtros = ref<Filtros>({ campana: "", id_grado: null, desde: "", hasta: "" });
const indicadores = ref<Indicadores | null>(null);
const error = shallowRef("");
const ocupado = shallowRef(false);

async function ejecutar(accion: () => Promise<void>) {
  error.value = "";
  ocupado.value = true;
  try {
    await accion();
  } catch (e) {
    error.value = mensajeDe(e);
  } finally {
    ocupado.value = false;
  }
}

const actualizar = () =>
  ejecutar(async () => {
    indicadores.value = await leerIndicadores(filtros.value);
  });

const exportar = () =>
  ejecutar(async () => {
    const { contenido, nombre } = await exportarReporte(filtros.value);
    guardarArchivo(contenido, nombre);
  });

onMounted(() =>
  ejecutar(async () => {
    opciones.value = await leerOpcionesFiltro();
    filtros.value = { ...filtros.value, campana: opciones.value.campana_activa };
    indicadores.value = await leerIndicadores(filtros.value);
  }),
);
</script>

<template>
  <div class="g08">
    <FiltrosIndicadores v-if="opciones" v-model="filtros" :opciones="opciones" :ocupado="ocupado" @actualizar="actualizar" @exportar="exportar" />
    <p v-if="error" class="mensaje" role="alert" data-testid="error">{{ error }}</p>
    <template v-if="indicadores">
      <p v-if="indicadores.es_demo" class="demo" role="status" data-testid="aviso-demo">{{ AVISO_DEMO }}</p>
      <div class="tarjetas">
        <section class="tarjeta dato">
          <span class="rotulo">Postulaciones en curso</span>
          <span class="cifra" data-testid="en-curso">{{ indicadores.tarjetas.en_curso }}</span>
          <span class="chip revision">Campaña {{ indicadores.filtros.campana }}</span>
        </section>
        <section class="tarjeta dato">
          <span class="rotulo">Lead time promedio</span>
          <span v-if="indicadores.tarjetas.cartas > 0" class="cifra" data-testid="lead-time">{{ textoDias(indicadores.tarjetas.lead_time_dias) }}</span>
          <span v-else class="sin-dato" data-testid="lead-time">Sin cartas emitidas</span>
          <span class="chip dorado">De la solicitud a la carta</span>
        </section>
        <section class="tarjeta dato">
          <span class="rotulo">Vacantes ocupadas</span>
          <span class="cifra" data-testid="ocupacion">{{ textoPct(indicadores.tarjetas.ocupacion_pct) }}</span>
          <span class="chip revision">Sobre las autorizadas</span>
        </section>
        <section class="tarjeta dato">
          <span class="rotulo">Expedientes observados</span>
          <span class="cifra" data-testid="observados">{{ textoPct(indicadores.tarjetas.observados_pct) }}</span>
          <span class="chip observado">Requirieron subsanación</span>
        </section>
      </div>
      <div class="columnas">
        <EmbudoAdmision :etapas="indicadores.embudo" />
        <TiemposPorEtapa :etapas="indicadores.etapas" />
      </div>
      <ComparacionLineaBase :indicadores="indicadores" />
      <DetalleIndicadores :vacantes="indicadores.vacantes" :avisos="indicadores.avisos" :expedientes="indicadores.expedientes" />
    </template>
  </div>
</template>

<style scoped src="./validacion/validacion.css"></style>

<style scoped>
.g08 {
  display: flex;
  flex-direction: column;
  gap: 24px;
}

.tarjetas {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 20px;
}

.columnas {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 20px;
}

.dato {
  gap: 12px;
}

.rotulo {
  font-size: 13px;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--texto-suave);
}

.cifra {
  font-family: var(--fuente-titulos);
  font-size: 38px;
  font-weight: 700;
  line-height: 1;
  color: var(--cil-azul);
}

.sin-dato {
  font-family: var(--fuente-titulos);
  font-size: 22px;
  font-weight: 700;
  line-height: 38px;
  color: var(--cil-azul);
}

.chip {
  align-self: flex-start;
}

.chip.dorado {
  background: var(--avatar-fondo);
  color: var(--cil-azul);
}

.demo {
  margin: 0;
  padding: 16px 18px;
  border-radius: 12px;
  background: var(--aviso-fondo);
  color: var(--observado);
  font-weight: 700;
}

/* Por debajo del ancho de referencia, los seis títulos de las etapas no caben en media pantalla. */
@media (max-width: 1360px) {
  .columnas {
    grid-template-columns: minmax(0, 1fr);
  }
}

@media (max-width: 1024px) {
  .tarjetas {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 600px) {
  .tarjetas {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
