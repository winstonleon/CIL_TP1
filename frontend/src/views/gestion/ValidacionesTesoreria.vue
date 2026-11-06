<!-- G05 · Validaciones de Tesorería (HU0011, HU0015 y HU0024). Implementa docs/ui/G05-Tesoreria.dc.html: pestañas con conteo
     de lo pendiente, la tabla de lo recibido y, al elegir una fila, el panel de la documentación financiera o el del
     comprobante (del derecho de admisión o de la cuota de ingreso).
     Desvío del mockup: el panel del comprobante no está dibujado (PanelComprobante). -->
<script setup lang="ts">
import { onMounted, ref, shallowRef, watch } from "vue";
import { mensajeDe } from "../../api/respuesta";
import { listarTesoreria, type ItemTesoreria, type ListaTesoreria, type VistaTesoreria } from "../../api/validaciones";
import { conceptoTesoreria, etiquetaTesoreria, fechaRelativa, nombreCompleto } from "../../gestion/validacion";
import PanelComprobante from "./validacion/PanelComprobante.vue";
import PanelFinanciera from "./validacion/PanelFinanciera.vue";

const PESTANAS: { vista: VistaTesoreria | null; texto: string; disponible?: string }[] = [
  { vista: "todo", texto: "Todo pendiente" },
  { vista: "derecho", texto: "Derecho de admisión" },
  { vista: "financiera", texto: "Documentación financiera" },
  { vista: "cuota", texto: "Cuota de ingreso" },
];

const vista = shallowRef<VistaTesoreria>("todo");
const lista = ref<ListaTesoreria | null>(null);
const error = shallowRef("");
const elegido = ref<ItemTesoreria | null>(null);
const ahora = shallowRef(new Date());

const claveDe = (i: ItemTesoreria) => `${i.concepto}-${i.id_pago ?? i.id_expediente}`;

async function cargar() {
  error.value = "";
  try {
    lista.value = await listarTesoreria(vista.value);
    ahora.value = new Date();
  } catch (e) {
    error.value = mensajeDe(e);
  }
}

watch(vista, cargar);
onMounted(cargar);
</script>

<template>
  <div class="g05">
    <div class="pestanas" role="tablist" aria-label="Validaciones de Tesorería">
      <button
        v-for="p in PESTANAS"
        :key="p.texto"
        type="button"
        role="tab"
        class="pestana"
        :class="{ deshabilitada: p.disponible }"
        :aria-selected="p.vista !== null && vista === p.vista"
        :aria-disabled="p.disponible ? 'true' : undefined"
        :title="p.disponible"
        :data-testid="`pestana-${p.vista ?? 'no-disponible'}`"
        @click="p.vista && (vista = p.vista)"
      >
        {{ p.texto }}<template v-if="p.vista && lista"> ({{ lista.conteos[p.vista] }})</template>
      </button>
    </div>

    <p v-if="error" class="mensaje" role="alert" data-testid="error-carga">{{ error }}</p>
    <div v-else-if="lista" class="columnas">
      <div class="principal">
        <p v-if="lista.items.length === 0" class="suave" role="status" data-testid="vacio">No hay validaciones pendientes.</p>
        <div v-else class="tabla-envoltura">
          <table class="tabla" aria-label="Validaciones pendientes">
            <thead>
              <tr>
                <th scope="col">Código</th>
                <th scope="col">Postulante</th>
                <th scope="col">Concepto</th>
                <th scope="col">Estado</th>
                <th scope="col">Recibido</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="i in lista.items"
                :key="claveDe(i)"
                :class="{ seleccionada: elegido && claveDe(elegido) === claveDe(i) }"
                :data-testid="`item-${claveDe(i)}`"
              >
                <td>{{ i.codigo }}</td>
                <td>
                  <div class="celda-doble">
                    <span class="nombre">{{ nombreCompleto(i.postulante) }}</span>
                    <span class="detalle">{{ i.grado }}</span>
                  </div>
                </td>
                <td>
                  <button type="button" class="enlace" @click="elegido = i">{{ conceptoTesoreria(i) }}</button>
                </td>
                <td>
                  <div class="celda-doble">
                    <span class="chip" :class="etiquetaTesoreria(i).tono">{{ etiquetaTesoreria(i).texto }}</span>
                    <span
                      v-for="(m, n) in i.estado === 'pendiente' ? i.motivos_anteriores : []"
                      :key="n"
                      class="motivo-anterior"
                      data-testid="motivo-anterior"
                    >
                      Motivo anterior: {{ m }}
                    </span>
                  </div>
                </td>
                <td>{{ fechaRelativa(i.recibido, ahora) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p class="aviso-carta" data-testid="aviso-carta">Al conciliar un pago único o una primera fracción de la cuota de ingreso, el sistema emite automáticamente la Carta de Vacante.</p>
      </div>

      <div v-if="elegido" class="lateral">
        <PanelFinanciera
          v-if="elegido.concepto === 'documentacion_financiera'"
          :key="claveDe(elegido)"
          :id-expediente="elegido.id_expediente"
          @actualizado="cargar"
        />
        <PanelComprobante v-else :key="claveDe(elegido)" :id-pago="elegido.id_pago!" @actualizado="cargar" />
      </div>
    </div>
  </div>
</template>

<style scoped src="./validacion/validacion.css"></style>

<style scoped>
.g05 {
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
  flex: 0 0 440px;
}

.aviso-carta {
  margin: 16px 0 0;
  color: var(--texto-suave);
  line-height: 1.5;
}

.enlace {
  padding: 0;
  border: none;
  background: none;
  font-family: var(--fuente-texto);
  font-size: 14px;
  font-weight: 600;
  color: var(--cil-azul);
  text-decoration: underline;
  cursor: pointer;
  min-height: 44px;
}

.enlace:focus-visible {
  outline: 3px solid var(--cil-dorado);
  outline-offset: 2px;
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
