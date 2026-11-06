<!-- G07 · Adjudicación de vacantes (Directora, HU0012). Implementa docs/ui/G07-Vacantes.dc.html: «Postulantes aptos por
     decidir» con su acción según el cupo del grado, los avisos y el inventario por nivel. El resultado que se muestra es el
     que devuelve la API (R14): si otra adjudicación tomó el último cupo, «Aprobar y asignar vacante» termina en lista de
     espera y la pantalla lo dice con la posición.
     Desvío: el mockup no dibuja el panel de «Ver dictamen»; sigue la estructura de los paneles de G05. Abrirlo registra
     atencion_inicio en la API (§4.7). La lista de espera no tiene acciones: su salida no tiene HU (C61). -->
<script setup lang="ts">
import { computed, onMounted, ref, shallowRef } from "vue";
import {
  adjudicar,
  descargarInforme,
  leerDictamen,
  leerPanelAdjudicacion,
  type AptoPorDecidir,
  type DictamenDireccion,
  type PanelAdjudicacion,
} from "../../api/adjudicacion";
import { mensajeDe } from "../../api/respuesta";
import { accionDe, gradosDelNivel, gradosSinVacantes, mensajeResultado, NIVELES } from "../../gestion/adjudicacion";
import { abrirArchivo, fechaRelativa, nombreCompleto } from "../../gestion/validacion";
import { fechaCorta } from "../../portal/formato";

const panel = ref<PanelAdjudicacion | null>(null);
const error = shallowRef("");
const errorAccion = shallowRef("");
const resultado = ref<ReturnType<typeof mensajeResultado> | null>(null);
const ocupado = shallowRef<number | null>(null);
const dictamen = ref<DictamenDireccion | null>(null);
const errorDictamen = shallowRef("");
const nivel = shallowRef<string>("inicial");
const ahora = shallowRef(new Date());

const grados = computed(() => gradosDelNivel(panel.value?.inventario ?? [], nivel.value));
const sinVacantes = computed(() => gradosSinVacantes(panel.value?.pendientes ?? []));

async function cargar() {
  error.value = "";
  try {
    panel.value = await leerPanelAdjudicacion();
    ahora.value = new Date();
  } catch (e) {
    error.value = mensajeDe(e);
  }
}

async function verDictamen(p: AptoPorDecidir) {
  errorDictamen.value = "";
  dictamen.value = null;
  try {
    dictamen.value = await leerDictamen(p.id_expediente);
  } catch (e) {
    errorDictamen.value = mensajeDe(e);
  }
}

async function verInforme() {
  errorDictamen.value = "";
  const id = dictamen.value!.id_expediente;
  try {
    await abrirArchivo(() => descargarInforme(id));
  } catch (e) {
    errorDictamen.value = mensajeDe(e);
  }
}

async function decidir(p: AptoPorDecidir) {
  errorAccion.value = "";
  resultado.value = null;
  ocupado.value = p.id_expediente;
  try {
    resultado.value = mensajeResultado(await adjudicar(p.id_expediente), p);
    if (dictamen.value?.id_expediente === p.id_expediente) dictamen.value = null;
  } catch (e) {
    errorAccion.value = mensajeDe(e);
  } finally {
    ocupado.value = null;
    await cargar();
  }
}

onMounted(cargar);
</script>

<template>
  <div class="g07">
    <p v-if="error" class="mensaje" role="alert" data-testid="error-carga">{{ error }}</p>
    <template v-else-if="panel">
      <div class="columnas">
        <section class="tarjeta principal" aria-labelledby="g07-aptos">
          <div class="cabecera">
            <h2 id="g07-aptos">Postulantes aptos por decidir</h2>
            <span class="chip revision" data-testid="conteo-pendientes">{{ panel.pendientes.length }} pendientes</span>
          </div>
          <p v-if="resultado" class="resultado" :class="resultado.tono" role="status" data-testid="resultado">{{ resultado.texto }}</p>
          <p v-if="errorAccion" class="mensaje" role="alert" data-testid="error-accion">{{ errorAccion }}</p>
          <p v-if="panel.pendientes.length === 0" class="suave" role="status" data-testid="vacio">No hay postulantes aptos por decidir.</p>
          <div v-else class="tabla-envoltura">
            <table class="tabla" aria-label="Postulantes aptos por decidir">
              <thead>
                <tr>
                  <th scope="col">Postulante</th>
                  <th scope="col">Grado</th>
                  <th scope="col">Dictamen</th>
                  <th scope="col">Recibido</th>
                  <th scope="col">Acción</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="p in panel.pendientes" :key="p.id_expediente" :class="{ seleccionada: dictamen?.id_expediente === p.id_expediente }" :data-testid="`apto-${p.id_expediente}`">
                  <td>
                    <div class="celda-doble">
                      <span class="nombre">{{ nombreCompleto(p.postulante) || "—" }}</span>
                      <span class="detalle">{{ p.codigo }}</span>
                    </div>
                  </td>
                  <td>{{ p.grado }}</td>
                  <td><span class="chip conforme">Apto</span></td>
                  <td>{{ fechaRelativa(p.recibido, ahora) }}</td>
                  <td>
                    <div class="acciones">
                      <button type="button" class="boton" @click="verDictamen(p)">Ver dictamen</button>
                      <button
                        type="button"
                        class="boton"
                        :class="p.sin_vacantes ? 'observar' : 'primario'"
                        :disabled="ocupado !== null"
                        data-testid="adjudicar"
                        @click="decidir(p)"
                      >
                        {{ accionDe(p) }}
                      </button>
                    </div>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <p v-for="g in sinVacantes" :key="g" class="aviso" data-testid="aviso-sin-vacantes">
            {{ g }} no tiene vacantes disponibles. La asignación está bloqueada; puedes derivar al postulante a la lista de espera.
          </p>
          <p class="suave">
            Al asignar, el sistema descuenta el cupo y notifica a la familia el resultado, la cuota de ingreso de su nivel y las opciones de pago único o
            fraccionado.
          </p>
        </section>

        <section v-if="dictamen || errorDictamen" class="tarjeta lateral" aria-labelledby="g07-dictamen" data-testid="panel-dictamen">
          <h2 id="g07-dictamen">Dictamen</h2>
          <p v-if="errorDictamen" class="mensaje" role="alert">{{ errorDictamen }}</p>
          <template v-if="dictamen">
            <span class="nombre">{{ nombreCompleto(dictamen.postulante) || "—" }} · {{ dictamen.codigo }}</span>
            <span class="suave">{{ dictamen.grado }} · Emitido el {{ fechaCorta(dictamen.fecha_emision) }}</span>
            <span class="chip conforme ajustado">Apto</span>
            <p class="conclusiones" data-testid="conclusiones">{{ dictamen.conclusiones }}</p>
            <button v-if="dictamen.tiene_informe" type="button" class="boton" data-testid="ver-informe" @click="verInforme">Ver informe psicológico</button>
          </template>
        </section>
      </div>

      <section class="tarjeta" aria-labelledby="g07-inventario">
        <h2 id="g07-inventario">Inventario de vacantes</h2>
        <div class="pestanas" role="tablist" aria-label="Nivel">
          <button
            v-for="n in NIVELES"
            :key="n.valor"
            type="button"
            role="tab"
            class="pestana"
            :aria-selected="nivel === n.valor"
            :data-testid="`nivel-${n.valor}`"
            @click="nivel = n.valor"
          >
            {{ n.texto }}
          </button>
        </div>
        <div class="tabla-envoltura">
          <table class="tabla" aria-label="Inventario de vacantes">
            <thead>
              <tr>
                <th scope="col">Grado</th>
                <th scope="col">Autorizadas</th>
                <th scope="col">Adjudicadas</th>
                <th scope="col">Disponibles</th>
                <th scope="col">Lista de espera</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="g in grados" :key="g.id_grado" :data-testid="`grado-${g.id_grado}`">
                <td>{{ g.grado }}</td>
                <td>{{ g.autorizadas }}</td>
                <td>{{ g.adjudicadas }}</td>
                <td>{{ g.disponibles }}</td>
                <td>{{ g.lista_espera }}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p class="suave">Las vacantes autorizadas se configuran por campaña (Secretaría).</p>
      </section>
    </template>
  </div>
</template>

<style scoped src="./validacion/validacion.css"></style>

<style scoped>
.g07 {
  display: flex;
  flex-direction: column;
  gap: 24px;
}

.columnas {
  display: flex;
  gap: 24px;
  align-items: flex-start;
}

.principal {
  flex: 1 1 auto;
  min-width: 0;
}

.lateral {
  flex: 0 0 380px;
}

.cabecera {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.acciones {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.resultado,
.aviso {
  margin: 0;
  padding: 12px 14px;
  border-radius: 10px;
  line-height: 1.5;
}

.resultado.conforme {
  background: var(--conforme-fondo);
  color: var(--conforme);
  font-weight: 600;
}

.resultado.observado,
.aviso {
  background: var(--aviso-fondo);
  color: var(--observado);
  font-weight: 600;
}

.nombre {
  font-weight: 700;
}

.ajustado {
  align-self: flex-start;
}

.conclusiones {
  margin: 0;
  line-height: 1.5;
  white-space: pre-wrap;
}

@media (max-width: 1024px) {
  .columnas {
    flex-direction: column;
  }

  .lateral {
    flex-basis: auto;
    width: 100%;
  }
}
</style>
