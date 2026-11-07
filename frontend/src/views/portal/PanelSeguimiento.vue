<!-- P04 · Panel de seguimiento (HU0020 y HU0016). Implementa docs/ui/P04-Panel.dc.html: el avance en seis etapas, las acciones
     pendientes y el historial. Todo lo decide la API: esta pantalla solo muestra (ADR-29).
     Desvíos del mockup:
     - La descarga de la Carta de Vacante no está dibujada: va en «Acciones pendientes» (HU0016-1.0).
     - Una línea con las tres validaciones de R9, porque HU0020-1.0 pide el estado de cada una y el mockup junta dos en una etapa.
     - Sin «Completaste la ficha y el cuestionario» en el historial: no hay evento ni fecha de eso (C77). -->
<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { descargarCarta, leerPanel, type EstadoEtapa, type EstadoValidacion, type PanelSeguimiento } from "../../api/panel";
import { mensajeDe } from "../../api/respuesta";
import { fechaHistorial } from "../../portal/formato";
import { useExpedienteStore } from "../../stores/expediente";
import { useSesionStore } from "../../stores/sesion";

const ETIQUETA_ETAPA: Record<EstadoEtapa, string> = { completado: "Completado", en_revision: "En revisión", observado: "Observado", pendiente: "Pendiente" };
const ETIQUETA_VALIDACION: Record<EstadoValidacion, string> = { conforme: "Conforme", en_revision: "En revisión", observado: "Observado", pendiente: "Pendiente" };

const sesion = useSesionStore();
const expedientes = useExpedienteStore();
const expediente = expedientes.expediente!;

const panel = ref<PanelSeguimiento | null>(null);
const carga = ref<"cargando" | "listo" | "error">("cargando");
const errorCarga = ref("");
const errorCarta = ref("");
const descargando = ref(false);

const primerNombre = (nombre: string | null | undefined) => nombre?.trim().split(/\s+/)[0] ?? "";
// «Hola, María Fernanda», como el mockup: el nombre de pila del token, con todos sus nombres.
const saludo = computed(() => sesion.usuario?.profile.given_name || primerNombre(sesion.nombre));
const postulante = computed(() => primerNombre(expediente.postulante) || "tu postulante");

const validaciones = computed(() => {
  const v = panel.value!.validaciones;
  return [
    { clave: "documental", titulo: "Documentos", estado: v.documental },
    { clave: "financiera", titulo: "Documentación financiera", estado: v.financiera },
    { clave: "derecho", titulo: "Derecho de admisión", estado: v.derecho },
  ];
});

async function cargar() {
  carga.value = "cargando";
  try {
    panel.value = await leerPanel(expediente.id_expediente);
    carga.value = "listo";
  } catch (e) {
    errorCarga.value = mensajeDe(e);
    carga.value = "error";
  }
}

async function descargar() {
  errorCarta.value = "";
  descargando.value = true;
  try {
    const url = URL.createObjectURL(await descargarCarta(expediente.id_expediente));
    const enlace = document.createElement("a");
    enlace.href = url;
    enlace.download = `carta-vacante-${expediente.codigo}.pdf`;
    enlace.click();
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  } catch (e) {
    errorCarta.value = mensajeDe(e);
  } finally {
    descargando.value = false;
  }
}

onMounted(cargar);
</script>

<template>
  <div class="p04">
    <div class="titulo">
      <h1 data-testid="saludo">Hola, {{ saludo }}</h1>
      <p>Aquí ves en qué etapa está la postulación de {{ postulante }} y qué necesitas hacer.</p>
    </div>

    <p v-if="carga === 'cargando'" class="suave" role="status">Cargando tu postulación…</p>
    <template v-else-if="carga === 'error'">
      <p class="error" role="alert" data-testid="error-panel">{{ errorCarga }}</p>
      <button type="button" class="boton secundario" @click="cargar">Reintentar</button>
    </template>

    <template v-else-if="panel">
      <section class="tarjeta" aria-labelledby="p04-avance">
        <div class="cabecera">
          <h2 id="p04-avance">Avance de la postulación</h2>
          <span class="chip acento">Expediente {{ expediente.codigo }}</span>
        </div>
        <ol class="etapas">
          <li v-for="(e, i) in panel.etapas" :key="e.clave" class="etapa" :data-testid="`etapa-${e.clave}`">
            <span class="punto" :class="e.estado">
              <svg v-if="e.estado === 'completado'" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.2 4.2L19 7" /></svg>
              <svg v-else-if="e.estado === 'en_revision'" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="8.5" /><path d="M12 7.5V12l3 2" /></svg>
              <svg v-else-if="e.estado === 'observado'" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 8v5" /><path d="M12 16.5v.5" /><path d="M10.3 3.9L2.6 17.5A2 2 0 0 0 4.3 20.5h15.4a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" /></svg>
              <template v-else>{{ i + 1 }}</template>
            </span>
            <span class="etapa-titulo">{{ e.titulo }}</span>
            <span class="chip" :class="e.estado" data-testid="estado-etapa">{{ ETIQUETA_ETAPA[e.estado] }}</span>
          </li>
        </ol>
        <dl class="validaciones" data-testid="validaciones">
          <div v-for="v in validaciones" :key="v.clave" :data-testid="`validacion-${v.clave}`">
            <dt>{{ v.titulo }}</dt>
            <dd class="chip" :class="v.estado">{{ ETIQUETA_VALIDACION[v.estado] }}</dd>
          </div>
        </dl>
      </section>

      <div class="columnas">
        <section class="tarjeta acciones" aria-labelledby="p04-acciones">
          <h2 id="p04-acciones" class="con-icono"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 8v5" /><path d="M12 16.5v.5" /><path d="M10.3 3.9L2.6 17.5A2 2 0 0 0 4.3 20.5h15.4a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" /></svg>Acciones pendientes</h2>
          <div v-if="panel.carta.disponible" class="accion conforme" data-testid="carta">
            <div class="accion-texto"><strong>Tu Carta de Vacante está emitida.</strong></div>
            <button type="button" class="boton primario" :disabled="descargando" data-testid="descargar-carta" @click="descargar">Descargar Carta de Vacante</button>
          </div>
          <p v-if="errorCarta" class="error" role="alert" data-testid="error-carta">{{ errorCarta }}</p>
          <div
            v-for="(a, i) in panel.acciones"
            :key="i"
            class="accion"
            :class="a.tipo === 'subsanar' ? 'observado' : 'informacion'"
            :role="a.tipo === 'subsanar' ? 'alert' : undefined"
            data-testid="accion"
          >
            <svg v-if="a.tipo === 'subsanar'" class="accion-icono" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 8v5" /><path d="M12 16.5v.5" /><path d="M10.3 3.9L2.6 17.5A2 2 0 0 0 4.3 20.5h15.4a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" /></svg>
            <svg v-else class="accion-icono" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3.5" y="5" width="17" height="15" rx="2" /><path d="M3.5 10h17" /><path d="M8 3v4" /><path d="M16 3v4" /></svg>
            <div class="accion-texto">
              <strong v-if="a.tipo !== 'informacion'">{{ a.titulo }}</strong>
              <template v-else>{{ a.titulo }}</template>
              <span v-if="a.motivo" data-testid="motivo">Motivo: {{ a.motivo }}</span>
            </div>
            <RouterLink v-if="a.destino" :to="a.destino" class="boton primario" data-testid="ir-accion">{{ a.tipo === "subsanar" ? "Subsanar" : "Continuar" }}</RouterLink>
          </div>
          <p v-if="!panel.carta.disponible && panel.acciones.length === 0" class="suave" role="status" data-testid="sin-acciones">No tienes acciones pendientes.</p>
        </section>

        <section class="tarjeta historial" aria-labelledby="p04-historial">
          <h2 id="p04-historial">Historial</h2>
          <ul v-if="panel.historial.length" data-testid="historial">
            <li v-for="(h, i) in panel.historial" :key="i">
              <span class="fecha">{{ fechaHistorial(h.fecha) }}</span>
              <span>{{ h.texto }}</span>
            </li>
          </ul>
          <p v-else class="suave" role="status">Todavía no hay movimientos en tu expediente.</p>
        </section>
      </div>
    </template>
  </div>
</template>

<style scoped>
.p04 {
  display: flex;
  flex-direction: column;
  gap: 28px;
  max-width: 1112px;
}

.titulo {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.titulo h1 {
  margin: 0;
  font-family: var(--fuente-titulos);
  font-size: 34px;
  font-weight: 700;
  letter-spacing: -0.01em;
  color: var(--cil-azul);
}

.titulo p {
  margin: 0;
  font-size: 16px;
  line-height: 1.5;
  color: var(--texto-suave);
}

.tarjeta {
  display: flex;
  flex-direction: column;
  gap: 24px;
  padding: 28px;
  box-sizing: border-box;
  background: var(--superficie);
  border: 1px solid var(--borde);
  border-radius: 16px;
}

.tarjeta h2.con-icono {
  display: flex;
  align-items: center;
  gap: 10px;
}

.tarjeta h2 {
  margin: 0;
  font-family: var(--fuente-titulos);
  font-size: 22px;
  font-weight: 600;
  color: var(--cil-azul);
}

.cabecera {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
}

.chip {
  display: inline-flex;
  align-items: center;
  margin: 0;
  padding: 4px 10px;
  border-radius: 999px;
  font-size: 13px;
  font-weight: 600;
  white-space: nowrap;
}

.chip.acento {
  background: var(--chip-acento);
  color: var(--cil-azul);
}

.chip.completado,
.chip.conforme {
  background: var(--conforme-fondo);
  color: var(--conforme);
}

.chip.en_revision {
  background: var(--chip-fondo);
  color: var(--cil-azul);
}

.chip.observado {
  background: var(--aviso-fondo);
  color: var(--observado);
}

.chip.pendiente {
  background: var(--inactivo-fondo);
  color: var(--inactivo);
}

.etapas {
  margin: 0;
  padding: 0;
  list-style: none;
  display: flex;
  gap: 8px;
}

.etapa {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  text-align: center;
}

.punto {
  width: 40px;
  height: 40px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--etapa-pendiente);
  color: #ffffff;
  font-size: 15px;
  font-weight: 700;
}

.punto.completado {
  background: var(--conforme);
}

.punto.en_revision {
  background: var(--cil-azul);
}

.punto.observado {
  background: var(--observado);
}

.etapa-titulo {
  font-size: 14px;
  font-weight: 700;
}

.validaciones {
  margin: 0;
  padding-top: 16px;
  border-top: 1px solid var(--borde);
  display: flex;
  gap: 24px;
  flex-wrap: wrap;
}

.validaciones div {
  display: flex;
  align-items: center;
  gap: 8px;
}

.validaciones dt {
  font-size: 14px;
  color: var(--texto-suave);
}

.columnas {
  display: flex;
  gap: 28px;
  align-items: flex-start;
}

.acciones {
  flex: 1 1 auto;
  min-width: 0;
  gap: 16px;
}

.historial {
  flex: 0 1 520px;
  min-width: 360px;
  gap: 8px;
}

.accion {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 14px;
  padding: 16px 18px;
  border-radius: 12px;
  font-size: 15px;
  line-height: 1.5;
}

.accion.observado {
  background: var(--aviso-fondo);
  color: var(--observado);
}

.accion.informacion {
  background: var(--chip-fondo);
  color: var(--cil-azul);
}

.accion.conforme {
  background: var(--conforme-fondo);
  color: var(--conforme);
}

.accion-icono {
  flex-shrink: 0;
}

.accion-texto {
  flex: 1 1 220px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.boton {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 44px;
  padding: 0 18px;
  box-sizing: border-box;
  border-radius: 10px;
  border: 1px solid transparent;
  font: inherit;
  font-size: 14px;
  font-weight: 600;
  text-decoration: none;
  white-space: nowrap;
  cursor: pointer;
}

.boton.primario {
  background: var(--cil-azul);
  color: #ffffff;
}

.boton.secundario {
  align-self: flex-start;
  background: var(--superficie);
  border-color: var(--cil-azul);
  color: var(--cil-azul);
}

.boton:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.historial ul {
  margin: 0;
  padding: 0;
  list-style: none;
}

.historial li {
  display: flex;
  gap: 14px;
  padding: 12px 0;
  border-top: 1px solid var(--borde);
  font-size: 14px;
}

.fecha {
  flex-shrink: 0;
  width: 150px;
  font-size: 13px;
  color: var(--texto-suave);
}

.suave {
  margin: 0;
  color: var(--texto-suave);
}

.error {
  margin: 0;
  color: var(--observado);
}

@media (max-width: 1100px) {
  .columnas {
    flex-direction: column;
    align-items: stretch;
  }

  .historial {
    flex: 1 1 auto;
    min-width: 0;
  }
}

@media (max-width: 700px) {
  .etapas {
    flex-direction: column;
  }

  .etapa {
    flex-direction: row;
    text-align: left;
  }

  .etapa-titulo {
    flex-grow: 1;
  }

  .accion {
    flex-direction: column;
    align-items: stretch;
  }

  .historial li {
    flex-direction: column;
    gap: 4px;
  }

  .fecha {
    width: auto;
  }
}
</style>
