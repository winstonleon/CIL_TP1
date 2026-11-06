<!-- P08 · Agendamiento de evaluaciones según el grado (HU0009). Implementa docs/ui/P08-Evaluaciones.dc.html:
     - Las evaluaciones y sus horarios los entrega la API según la configuración del grado (C25 4). El texto fijo del mockup
       por grado («Inicial tiene…», «Corresponde desde 2.°…», «Programada después de…») no se muestra, y la duración
       («[por confirmar]») la entrega el colegio (C55).
     - «Confirmar citas» se habilita con un turno disponible por evaluación; la API reserva todo o nada.
     - Reprogramación (HU0009-2.0): el mockup no la dibuja (solo dice «Puedes reprogramar cada cita hasta 24 horas
       antes»). Cada cita agendada muestra «Reprogramar», que abre el mismo selector de días y horas y termina en
       «Confirmar cambio» (plan del bloque 6).
     - Sin las tres validaciones conformes se muestra el aviso de P04 («Tus evaluaciones se podrán agendar…»).
     - Inasistencia a la evaluación académica (HU0025-2.0, D2-A): la cita muestra «No asististe…» y «Elegir nuevo horario»,
       sin la regla de las 24 horas (la API la reprograma igual que HU0009-2.0).
     - Es de la familia: no registra tiempo de atención (ADR-05). -->
<script setup lang="ts">
import { computed, onMounted, reactive, ref } from "vue";
import {
  confirmarCitas,
  leerEvaluaciones,
  reprogramarCita,
  type AgendaEvaluaciones,
  type Evaluacion,
  type TipoEvaluacion,
} from "../../api/evaluaciones";
import { ErrorApi, mensajeDe } from "../../api/respuesta";
import { horaVisible } from "../../portal/calendarioVisita";
import {
  A_CARGO,
  cuandoEs,
  diaInicial,
  diasDe,
  NOMBRE_EVALUACION,
  pedidoDe,
  resumen,
  seleccionCompleta,
  textoCitas,
  type Seleccion,
} from "../../portal/agendaEvaluaciones";
import { useExpedienteStore } from "../../stores/expediente";

const TEXTO = {
  bloqueado: "Tus evaluaciones se podrán agendar cuando se validen los documentos, el derecho de admisión y la documentación financiera.",
  habilitado: "Documentos, derecho de admisión y documentación financiera validados: ya puedes agendar.",
  confirmadas: "Citas confirmadas. Te enviamos la confirmación con las pautas previas por correo.",
  reprogramada: "Cita reprogramada. Te enviamos la confirmación actualizada por correo.",
};

const expedientes = useExpedienteStore();
const idExpediente = expedientes.expediente!.id_expediente;

const agenda = ref<AgendaEvaluaciones | null>(null);
const carga = ref<"cargando" | "listo" | "error">("cargando");
const errorCarga = ref("");
const seleccion = reactive<Seleccion>({});
const diaVisto = reactive<Partial<Record<TipoEvaluacion, string | null>>>({});
const aviso = ref("");
const confirmacion = ref("");
const enviando = ref(false);
const reprogramando = ref<TipoEvaluacion | null>(null);
const nuevoHorario = ref<number | null>(null);

const evaluaciones = computed(() => agenda.value?.evaluaciones ?? []);
const completa = computed(() => seleccionCompleta(evaluaciones.value, seleccion));
const filasResumen = computed(() => resumen(evaluaciones.value, seleccion));
const minHoras = computed(() => agenda.value?.min_horas_reprogramacion ?? 24);

async function cargar() {
  try {
    agenda.value = await leerEvaluaciones(idExpediente);
    for (const e of agenda.value.evaluaciones) {
      if (!diaVisto[e.tipo_cita] || !e.horarios.some((h) => h.fecha === diaVisto[e.tipo_cita])) diaVisto[e.tipo_cita] = diaInicial(e.horarios);
      // Un turno elegido que dejó de estar disponible se suelta.
      const elegido = seleccion[e.tipo_cita];
      if (elegido !== undefined && !e.horarios.some((h) => h.id_horario === elegido && h.disponible)) delete seleccion[e.tipo_cita];
    }
    carga.value = "listo";
  } catch (e) {
    errorCarga.value = mensajeDe(e);
    carga.value = "error";
  }
}

onMounted(cargar);

const horariosDelDia = (e: Evaluacion) => e.horarios.filter((h) => h.fecha === diaVisto[e.tipo_cita]);

function elegir(e: Evaluacion, idHorario: number) {
  aviso.value = "";
  if (reprogramando.value === e.tipo_cita) nuevoHorario.value = idHorario;
  else seleccion[e.tipo_cita] = idHorario;
}

const elegido = (e: Evaluacion, idHorario: number) =>
  reprogramando.value === e.tipo_cita ? nuevoHorario.value === idHorario : seleccion[e.tipo_cita] === idHorario;

// Errores de la reserva: el aviso de la API y, si un turno se agotó o dejó de estar disponible, se recargan los turnos.
async function alFallar(e: unknown) {
  aviso.value = mensajeDe(e);
  if (e instanceof ErrorApi && ["HORARIO_SIN_CUPO", "HORARIO_NO_DISPONIBLE", "AGENDAMIENTO_NO_HABILITADO", "EVALUACIONES_YA_AGENDADAS"].includes(e.codigo)) {
    await cargar();
  }
}

async function confirmar() {
  if (!completa.value || enviando.value) return;
  aviso.value = "";
  confirmacion.value = "";
  enviando.value = true;
  try {
    await confirmarCitas(idExpediente, pedidoDe(evaluaciones.value, seleccion));
    for (const k of Object.keys(seleccion)) delete seleccion[k as TipoEvaluacion];
    expedientes.actualizar({ estado: "en_evaluacion" });
    confirmacion.value = TEXTO.confirmadas;
    await cargar();
  } catch (e) {
    await alFallar(e);
  } finally {
    enviando.value = false;
  }
}

function abrirReprogramacion(e: Evaluacion) {
  aviso.value = "";
  confirmacion.value = "";
  reprogramando.value = e.tipo_cita;
  nuevoHorario.value = null;
}

function cancelarReprogramacion() {
  reprogramando.value = null;
  nuevoHorario.value = null;
}

async function confirmarCambio(e: Evaluacion) {
  if (!e.cita || nuevoHorario.value === null || enviando.value) return;
  aviso.value = "";
  enviando.value = true;
  try {
    await reprogramarCita(idExpediente, e.cita.id_cita, nuevoHorario.value);
    cancelarReprogramacion();
    confirmacion.value = TEXTO.reprogramada;
    await cargar();
  } catch (err) {
    await alFallar(err);
  } finally {
    enviando.value = false;
  }
}
</script>

<template>
  <div class="p08">
    <div class="titulo">
      <h1>Agenda tus evaluaciones</h1>
      <p v-if="agenda && agenda.modo !== 'bloqueado'" class="bajada" data-testid="cantidad-citas">{{ textoCitas(agenda.grado, evaluaciones.length) }}</p>
    </div>

    <p v-if="carga === 'cargando'" class="nota" role="status">Cargando tus evaluaciones…</p>
    <p v-else-if="carga === 'error'" class="error" role="alert">{{ errorCarga }}</p>

    <template v-else-if="agenda">
      <p v-if="agenda.modo === 'bloqueado'" class="pendiente" role="status" data-testid="bloqueado">{{ TEXTO.bloqueado }}</p>

      <template v-else>
        <div v-if="agenda.modo === 'agendar'" class="habilitado" data-testid="habilitado">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.2 4.2L19 7" /></svg>
          <div>{{ TEXTO.habilitado }}</div>
        </div>
        <p v-if="confirmacion" class="habilitado" role="status" data-testid="confirmacion">{{ confirmacion }}</p>
        <div v-if="aviso" class="alerta" role="alert" data-testid="aviso">{{ aviso }}</div>

        <div class="columnas">
          <div class="secciones">
            <section v-for="e in evaluaciones" :key="e.tipo_cita" class="tarjeta" :data-testid="`evaluacion-${e.tipo_cita}`" :aria-labelledby="`p08-${e.tipo_cita}`">
              <div class="cabeza">
                <h2 :id="`p08-${e.tipo_cita}`">{{ NOMBRE_EVALUACION[e.tipo_cita] }}</h2>
                <span v-if="agenda.modo === 'agendar' && seleccion[e.tipo_cita] !== undefined" class="chip">Seleccionada</span>
                <span v-else-if="e.cita?.inasistencia" class="chip" data-testid="chip-inasistencia">No asististe</span>
                <span v-else-if="e.cita" class="chip">Agendada</span>
              </div>
              <span class="a-cargo">{{ A_CARGO[e.tipo_cita] }}</span>

              <div v-if="e.cita && reprogramando !== e.tipo_cita" class="cita-agendada">
                <span data-testid="cita">{{ cuandoEs(e.cita) }}</span>
                <span v-if="e.cita.inasistencia" class="nota" data-testid="nota-inasistencia">No registramos tu asistencia a esta cita. Elige un nuevo horario.</span>
                <button v-if="e.cita.reprogramable" type="button" class="secundario" :data-testid="`reprogramar-${e.tipo_cita}`" @click="abrirReprogramacion(e)">
                  {{ e.cita.inasistencia ? "Elegir nuevo horario" : "Reprogramar" }}
                </button>
                <span v-else-if="e.cita.plazo_vencido" class="nota" data-testid="no-reprogramable">Ya no se puede reprogramar: faltan menos de {{ minHoras }} horas.</span>
              </div>

              <template v-if="agenda.modo === 'agendar' || reprogramando === e.tipo_cita">
                <p v-if="!e.horarios.length" class="nota">Por ahora no hay turnos disponibles para esta evaluación.</p>
                <div v-else class="dias" role="group" :aria-label="`Días de ${NOMBRE_EVALUACION[e.tipo_cita]}`">
                  <button v-for="d in diasDe(e.horarios)" :key="d.fecha" type="button" class="dia" :class="{ visto: diaVisto[e.tipo_cita] === d.fecha }"
                    :disabled="!d.disponible" :aria-pressed="diaVisto[e.tipo_cita] === d.fecha" :data-fecha="d.fecha" @click="diaVisto[e.tipo_cita] = d.fecha">
                    <span class="dia-semana">{{ d.semana }}</span>
                    <span class="dia-numero">{{ d.numero }}</span>
                  </button>
                </div>
                <div class="horas" role="group" :aria-label="`Horarios de ${NOMBRE_EVALUACION[e.tipo_cita]}`">
                  <button v-for="h in horariosDelDia(e)" :key="h.id_horario" type="button" class="hora" :class="{ elegida: elegido(e, h.id_horario) }"
                    :disabled="!h.disponible" :aria-pressed="elegido(e, h.id_horario)" :data-testid="`horario-${h.id_horario}`" @click="elegir(e, h.id_horario)">
                    {{ horaVisible(h.hora_inicio) }}
                  </button>
                </div>
                <div v-if="reprogramando === e.tipo_cita" class="acciones">
                  <button type="button" class="principal" :disabled="nuevoHorario === null || enviando" data-testid="confirmar-cambio" @click="confirmarCambio(e)">Confirmar cambio</button>
                  <button type="button" class="secundario" @click="cancelarReprogramacion">Cancelar</button>
                </div>
              </template>
            </section>
          </div>

          <section class="tarjeta resumen" aria-labelledby="p08-resumen">
            <h2 id="p08-resumen">Resumen de citas</h2>
            <div v-for="f in agenda.modo === 'agendar' ? filasResumen : evaluaciones.map((e) => ({ tipo_cita: e.tipo_cita, texto: e.cita ? cuandoEs(e.cita) : 'Sin agendar' }))"
              :key="f.tipo_cita" class="fila-resumen" :data-testid="`resumen-${f.tipo_cita}`">
              <span class="fila-nombre">{{ NOMBRE_EVALUACION[f.tipo_cita] }}</span>
              <span class="fila-cuando">{{ f.texto }}</span>
            </div>
            <button v-if="agenda.modo === 'agendar'" type="button" class="principal ancho" :disabled="!completa || enviando" data-testid="confirmar-citas" @click="confirmar">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.2 4.2L19 7" /></svg>
              Confirmar citas
            </button>
            <span class="nota">Recibirás las pautas previas por correo. Puedes reprogramar cada cita hasta {{ minHoras }} horas antes.</span>
          </section>
        </div>
      </template>
    </template>
  </div>
</template>

<style scoped>
.p08 {
  display: flex;
  flex-direction: column;
  gap: 28px;
}

.titulo {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

h1 {
  margin: 0;
  font-family: var(--fuente-titulos);
  font-size: 34px;
  font-weight: 700;
  color: var(--cil-azul);
  letter-spacing: -0.01em;
}

.bajada {
  margin: 0;
  font-size: 16px;
  color: var(--texto-suave);
  line-height: 1.5;
}

.habilitado {
  display: flex;
  align-items: center;
  gap: 14px;
  margin: 0;
  padding: 16px 18px;
  border-radius: 12px;
  background: var(--conforme-fondo);
  color: var(--conforme);
  font-size: 15px;
  line-height: 1.5;
}

.pendiente {
  margin: 0;
  padding: 16px 18px;
  border-radius: 12px;
  background: var(--superficie-tenue);
  border: 1px solid var(--borde);
  font-size: 15px;
  line-height: 1.5;
}

.alerta,
.error {
  margin: 0;
  padding: 14px 18px;
  border-radius: 12px;
  background: var(--aviso-fondo);
  color: var(--observado);
  font-size: 15px;
  line-height: 1.5;
}

.columnas {
  display: flex;
  gap: 28px;
  align-items: flex-start;
}

.secciones {
  flex-grow: 1;
  display: flex;
  flex-direction: column;
  gap: 20px;
  min-width: 0;
}

.tarjeta {
  background: var(--superficie);
  border: 1px solid var(--borde);
  border-radius: 16px;
  padding: 24px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.cabeza {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

h2 {
  margin: 0;
  font-family: var(--fuente-titulos);
  font-size: 22px;
  font-weight: 600;
  color: var(--cil-azul);
}

.chip {
  padding: 4px 10px;
  border-radius: 999px;
  background: var(--conforme-fondo);
  color: var(--conforme);
  font-size: 13px;
  font-weight: 600;
  white-space: nowrap;
}

.a-cargo,
.nota {
  font-size: 14px;
  color: var(--texto-suave);
  line-height: 1.5;
}

.cita-agendada {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 14px;
  font-size: 15px;
  font-weight: 600;
}

.dias {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.dia {
  flex: 1;
  min-width: 64px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  padding: 10px 0;
  border-radius: 10px;
  border: 1px solid var(--borde);
  background: var(--superficie);
  font-family: var(--fuente-texto);
  cursor: pointer;
}

.dia.visto {
  border: 2px solid var(--cil-azul);
  background: var(--seleccion-fondo);
}

.dia:disabled {
  cursor: not-allowed;
  opacity: 0.55;
}

.dia-semana {
  font-size: 12px;
  font-weight: 700;
  color: var(--texto-suave);
}

.dia-numero {
  font-size: 17px;
  font-weight: 700;
  color: var(--cil-azul);
}

.horas {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
}

.hora {
  height: 44px;
  padding: 0 16px;
  border-radius: 10px;
  border: 1px solid var(--borde);
  background: var(--superficie);
  color: var(--cil-azul);
  font-family: var(--fuente-texto);
  font-size: 15px;
  font-weight: 600;
  cursor: pointer;
}

.hora.elegida {
  border: 2px solid var(--cil-azul);
  background: var(--cil-azul);
  color: #ffffff;
}

.hora:disabled {
  cursor: not-allowed;
  background: var(--reservado-fondo);
  color: var(--reservado-texto);
}

.acciones {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
}

.principal,
.secundario {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  height: 46px;
  padding: 0 22px;
  border-radius: 10px;
  font-family: var(--fuente-texto);
  font-size: 15px;
  font-weight: 600;
  cursor: pointer;
}

.principal {
  background: var(--cil-azul);
  color: #ffffff;
  border: 1px solid var(--cil-azul);
}

.principal:hover:not(:disabled) {
  background: var(--cil-azul-hover);
}

.principal:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.secundario {
  background: var(--superficie);
  color: var(--cil-azul);
  border: 1px solid var(--borde-campo);
}

.ancho {
  width: 100%;
}

.resumen {
  width: 380px;
  flex-shrink: 0;
  box-sizing: border-box;
  padding: 28px;
  gap: 12px;
}

.fila-resumen {
  display: flex;
  flex-direction: column;
  gap: 3px;
  padding: 14px 0;
  border-top: 1px solid var(--borde);
}

.fila-nombre {
  font-size: 15px;
  font-weight: 700;
}

.fila-cuando {
  font-size: 14px;
  color: var(--texto-suave);
}

@media (max-width: 1100px) {
  .columnas {
    flex-direction: column;
  }

  .resumen {
    width: 100%;
  }
}
</style>
