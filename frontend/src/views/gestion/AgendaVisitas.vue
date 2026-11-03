<!-- G04 · Agenda de visitas y registro de la asistencia (HU0004, Secretaría). Implementa docs/ui/G04-Visitas.dc.html:
     franja de la semana con el número de visitas por día (lunes a viernes, más sábado y domingo si tienen visitas, S3),
     tabla del día con «Conduce: Dirección» (ADR-15) y el panel «Registrar visita».
     - «Asistió» abre el panel; «Registrar y habilitar portal» registra «Asistió - Interesado en postular» (HU0004-1.0).
       El panel solo ofrece «Sí, desea postular»: «No desea postular por ahora» no tiene escenario (B3, C38).
     - «No asistió» registra la inasistencia (HU0004-2.0).
     - «Sin registrar» (A5) lista las visitas reservadas de semanas anteriores, con las mismas acciones.
     - ?fecha=AAAA-MM-DD elige la semana (S14); la pantalla no lo ofrece y por omisión muestra la semana actual.
     El contenido del slot (la sección de HU0002-2.0) va debajo de la tabla del día, como en el mockup. -->
<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useRoute } from "vue-router";
import { mensajeDe } from "../../api/respuesta";
import { listarVisitas, registrarAsistencia, type SemanaVisitas, type Visita } from "../../api/visitas";
import { DIAS_SEMANA, fechaLarga, horaVisible, numeroDia } from "../../portal/calendarioVisita";
import TablaVisitas from "./TablaVisitas.vue";

const route = useRoute();
const fechaPedida = typeof route.query.fecha === "string" && /^\d{4}-\d{2}-\d{2}$/.test(route.query.fecha) ? route.query.fecha : undefined;

const semana = ref<SemanaVisitas | null>(null);
const errorCarga = ref("");
const errorAccion = ref("");
const diaElegido = ref<string | null>(null);
const seleccionada = ref<Visita | null>(null);
const registrando = ref(false);

const sumarDias = (fecha: string, dias: number) => {
  const d = new Date(`${fecha}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
};
const hoyEnLima = () =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "America/Lima", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());

const visitasDe = (fecha: string) => semana.value?.visitas.filter((v) => v.fecha === fecha) ?? [];

// S3: de lunes a viernes, más sábado y domingo solo si tienen visitas.
const dias = computed(() => {
  if (!semana.value) return [];
  return Array.from({ length: 7 }, (_, i) => sumarDias(semana.value!.desde, i)).filter((f, i) => i < 5 || visitasDe(f).length > 0);
});
const delDia = computed(() => (diaElegido.value ? visitasDe(diaElegido.value) : []));
const conteo = (n: number) => `${n} ${n === 1 ? "visita" : "visitas"}`;
// «Lun» … «Dom», como la franja del mockup.
const nombreDia = (fecha: string) => DIAS_SEMANA[(new Date(`${fecha}T00:00:00Z`).getUTCDay() + 6) % 7];

async function cargar() {
  errorCarga.value = "";
  try {
    semana.value = await listarVisitas(fechaPedida);
  } catch (e) {
    errorCarga.value = mensajeDe(e);
    return;
  }
  if (!diaElegido.value || !dias.value.includes(diaElegido.value)) {
    const preferida = fechaPedida ?? hoyEnLima();
    diaElegido.value = dias.value.includes(preferida) ? preferida : (dias.value.find((f) => visitasDe(f).length > 0) ?? dias.value[0] ?? null);
  }
}

onMounted(cargar);

async function registrar(v: Visita, resultado: "asistio_interesado" | "no_asistio") {
  errorAccion.value = "";
  registrando.value = true;
  try {
    await registrarAsistencia(v.id_cita, resultado);
    seleccionada.value = null;
    await cargar();
  } catch (e) {
    errorAccion.value = mensajeDe(e);
  } finally {
    registrando.value = false;
  }
}

function abrirRegistro(v: Visita) {
  errorAccion.value = "";
  seleccionada.value = v;
}
</script>

<template>
  <div class="g04">
    <p v-if="errorCarga" class="error" role="alert">{{ errorCarga }}</p>

    <div v-if="semana" class="franja" role="group" aria-label="Días de la semana">
      <button v-for="f in dias" :key="f" type="button" class="dia" :class="{ elegido: f === diaElegido }"
        :aria-pressed="f === diaElegido" :data-testid="`dia-${f}`" @click="diaElegido = f">
        <span class="dia-nombre">{{ nombreDia(f) }}</span>
        <span class="dia-numero">{{ numeroDia(f) }}</span>
        <span class="dia-conteo">{{ conteo(visitasDe(f).length) }}</span>
      </button>
    </div>

    <div class="contenido">
      <div class="principal">
        <template v-if="semana && diaElegido">
          <div class="encabezado-seccion">
            <h2 id="g04-dia-titulo" class="titulo-seccion">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9"
                stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <rect x="3.5" y="5" width="17" height="15" rx="2" />
                <path d="M3.5 10h17" />
                <path d="M8 3v4" />
                <path d="M16 3v4" />
              </svg>
              {{ fechaLarga(diaElegido) }}
            </h2>
            <span class="insignia">Conduce: Dirección</span>
          </div>
          <p v-if="errorAccion && !seleccionada" class="error" role="alert">{{ errorAccion }}</p>
          <TablaVisitas v-if="delDia.length" :visitas="delDia" etiquetada-por="g04-dia-titulo"
            :seleccionada="seleccionada?.id_cita ?? null" :ocupada="registrando" @asistio="abrirRegistro"
            @no-asistio="(v) => registrar(v, 'no_asistio')" />
          <p v-else class="texto-seccion" role="status">No hay visitas este día.</p>

          <section v-if="semana.sin_registrar.length" class="sin-registrar" aria-labelledby="g04-sin-registrar">
            <h2 id="g04-sin-registrar" class="titulo-seccion">Sin registrar</h2>
            <TablaVisitas :visitas="semana.sin_registrar" etiquetada-por="g04-sin-registrar" con-fecha
              :seleccionada="seleccionada?.id_cita ?? null" :ocupada="registrando" @asistio="abrirRegistro"
              @no-asistio="(v) => registrar(v, 'no_asistio')" />
          </section>
        </template>

        <slot />
      </div>

      <section v-if="seleccionada" class="panel" aria-labelledby="g04-registrar-titulo" data-testid="registrar-visita">
        <h2 id="g04-registrar-titulo" class="titulo-seccion">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9"
            stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M9 7h6" />
            <rect x="5" y="4" width="14" height="17" rx="2" />
            <path d="M9 12l2 2 4-4" />
          </svg>
          Registrar visita
        </h2>
        <div class="celda-doble">
          <span class="nombre">{{ seleccionada.apoderado.nombres }} {{ seleccionada.apoderado.apellidos }}</span>
          <span class="detalle">{{ horaVisible(seleccionada.hora_inicio) }} · {{ seleccionada.grado.nombre_grado }}</span>
        </div>
        <fieldset class="opciones">
          <legend>¿La familia desea postular?</legend>
          <label class="opcion">
            <input type="radio" name="g04-interes" checked />
            Sí, desea postular
          </label>
        </fieldset>
        <p v-if="errorAccion" class="error" role="alert">{{ errorAccion }}</p>
        <button type="button" class="boton-principal" :disabled="registrando" @click="registrar(seleccionada, 'asistio_interesado')">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
            stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.2 4.2L19 7" /></svg>
          Registrar y habilitar portal
        </button>
        <span class="nota">El sistema crea la cuenta de la familia y le envía las credenciales temporales por correo.</span>
      </section>
    </div>
  </div>
</template>

<style scoped>
.g04 {
  display: flex;
  flex-direction: column;
  gap: 24px;
}

.franja {
  display: flex;
  gap: 10px;
}

.dia {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  padding: 12px 0;
  border-radius: 10px;
  border: 1px solid var(--borde);
  background: var(--superficie);
  font-family: var(--fuente-texto);
  cursor: pointer;
}

.dia.elegido {
  border: 2px solid var(--cil-azul);
  background: var(--seleccion-fondo);
}

.dia-nombre,
.dia-conteo {
  font-size: 12px;
  color: var(--texto-suave);
}

.dia-nombre {
  font-weight: 700;
}

.dia-numero {
  font-size: 20px;
  font-weight: 700;
  color: var(--cil-azul);
}

.contenido {
  display: flex;
  gap: 24px;
  align-items: flex-start;
}

.principal {
  flex-grow: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.sin-registrar {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin-top: 10px;
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

.insignia {
  display: inline-flex;
  align-items: center;
  padding: 4px 10px;
  border-radius: 999px;
  background: var(--avatar-fondo);
  color: var(--cil-azul);
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
  font-weight: 600;
  color: var(--observado);
}

.panel {
  width: 360px;
  flex-shrink: 0;
  box-sizing: border-box;
  padding: 24px;
  display: flex;
  flex-direction: column;
  gap: 16px;
  background: var(--superficie);
  border: 1px solid var(--borde);
  border-radius: 16px;
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

.opciones {
  margin: 0;
  padding: 0;
  border: none;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.opciones legend {
  font-size: 14px;
  font-weight: 600;
  margin-bottom: 10px;
}

.opcion {
  display: flex;
  align-items: center;
  gap: 10px;
  height: 46px;
  padding: 0 14px;
  border-radius: 10px;
  border: 2px solid var(--cil-azul);
  background: var(--seleccion-fondo);
  font-size: 15px;
  font-weight: 600;
}

.opcion input {
  width: 18px;
  height: 18px;
  margin: 0;
  accent-color: var(--cil-azul);
}

.boton-principal {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  height: 46px;
  padding: 0 22px;
  width: 100%;
  box-sizing: border-box;
  border-radius: 10px;
  border: 1px solid var(--cil-azul);
  background: var(--cil-azul);
  color: #ffffff;
  font-family: var(--fuente-texto);
  font-size: 15px;
  font-weight: 600;
  cursor: pointer;
}

.boton-principal:disabled {
  opacity: 0.7;
  cursor: not-allowed;
}

.nota {
  font-size: 13px;
  line-height: 1.5;
  color: var(--texto-suave);
}

@media (max-width: 1100px) {
  .contenido {
    flex-direction: column;
  }

  .panel {
    width: 100%;
  }
}

@media (max-width: 640px) {
  .franja {
    flex-wrap: wrap;
  }

  .dia {
    flex: 1 1 60px;
  }
}
</style>
