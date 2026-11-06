<!-- Panel del comprobante en G05 (Tesorería): banco, N.° de operación, monto y fecha de pago para contrastarlos con el estado
     de cuenta, «Ver comprobante» y la decisión. Del derecho de admisión (HU0024): «Marcar conforme» y «Observar comprobante».
     De la cuota de ingreso (HU0015): el abono junto al monto que corresponde, «Conciliar y aprobar pago» y «Rechazar
     comprobante». Abrirlo registra atencion_inicio en la API (§4.7).
     Desvío: el mockup de G05 solo dibuja el panel de la documentación financiera; este sigue su misma estructura. -->
<script setup lang="ts">
import { computed, onMounted, ref, shallowRef } from "vue";
import { mensajeDe } from "../../../api/respuesta";
import { decidirPago, descargarComprobante, leerPago, type DetallePago } from "../../../api/validaciones";
import { abrirArchivo, etiquetaDocumento, nombreCompleto } from "../../../gestion/validacion";
import { fechaDeDia } from "../../../portal/formato";
import PanelObservacion from "./PanelObservacion.vue";

const props = defineProps<{ idPago: number }>();
const emit = defineEmits<{ actualizado: [] }>();

const pago = ref<DetallePago | null>(null);
const error = shallowRef("");
const errorAccion = shallowRef("");
const aviso = shallowRef("");
const ocupado = shallowRef(false);
const observando = shallowRef(false);

const esCuota = computed(() => pago.value?.concepto === "cuota_ingreso");
const titulo = computed(() => (esCuota.value ? "Cuota de ingreso" : "Derecho de admisión"));
const botonObservar = computed(() => (esCuota.value ? "Rechazar comprobante" : "Observar comprobante"));

async function cargar() {
  try {
    pago.value = await leerPago(props.idPago);
  } catch (e) {
    error.value = mensajeDe(e);
  }
}

async function decidir(motivo?: string) {
  errorAccion.value = "";
  ocupado.value = true;
  try {
    const r = await decidirPago(props.idPago, motivo === undefined ? { decision: "conforme" } : { decision: "observado", motivo });
    observando.value = false;
    aviso.value =
      motivo !== undefined
        ? "Se observó el comprobante. La familia recibirá un correo con el motivo."
        : esCuota.value
          ? "Pago conciliado. La cuota de ingreso quedó acreditada."
          : r.agendamiento_habilitado
          ? "Comprobante conforme. Las tres validaciones están conformes: el agendamiento de evaluaciones quedó habilitado."
          : "Comprobante conforme.";
    emit("actualizado");
  } catch (e) {
    errorAccion.value = mensajeDe(e);
  } finally {
    ocupado.value = false;
    await cargar();
  }
}

async function ver() {
  errorAccion.value = "";
  try {
    await abrirArchivo(() => descargarComprobante(props.idPago));
  } catch (e) {
    errorAccion.value = mensajeDe(e);
  }
}

onMounted(cargar);
</script>

<template>
  <section class="tarjeta panel" aria-labelledby="g05-derecho-titulo" data-testid="panel-comprobante">
    <h2 id="g05-derecho-titulo">{{ titulo }}</h2>
    <p v-if="error" class="mensaje" role="alert">{{ error }}</p>
    <template v-else-if="pago">
      <span class="nombre">{{ nombreCompleto(pago.postulante) }} · {{ pago.codigo }}</span>
      <dl class="datos">
        <div><dt>Banco</dt><dd>{{ pago.banco }}</dd></div>
        <div><dt>N.° de operación</dt><dd data-testid="numero-operacion">{{ pago.numero_operacion }}</dd></div>
        <div><dt>{{ esCuota ? "Monto abonado" : "Monto" }}</dt><dd data-testid="monto">S/ {{ pago.monto }}</dd></div>
        <div v-if="esCuota"><dt>Monto que corresponde</dt><dd data-testid="monto-corresponde">S/ {{ pago.monto_corresponde }}</dd></div>
        <div><dt>Fecha de pago</dt><dd>{{ fechaDeDia(pago.fecha_pago) }}</dd></div>
        <div>
          <dt>Estado</dt>
          <dd><span class="chip" :class="etiquetaDocumento(pago.estado_validacion).tono">{{ etiquetaDocumento(pago.estado_validacion).texto }}</span></dd>
        </div>
      </dl>
      <p v-if="pago.motivo_observacion" class="motivo-vigente" data-testid="motivo-vigente">Motivo: {{ pago.motivo_observacion }}</p>
      <p v-if="pago.motivo_anterior" class="motivo-anterior" data-testid="motivo-anterior">Motivo anterior: {{ pago.motivo_anterior }}</p>
      <p v-if="aviso" class="exito" role="status" data-testid="aviso">{{ aviso }}</p>
      <p v-if="errorAccion" class="mensaje" role="alert" data-testid="error-accion">{{ errorAccion }}</p>
      <button type="button" class="boton" @click="ver">Ver comprobante</button>
      <template v-if="pago.estado_validacion === 'pendiente'">
        <PanelObservacion
          v-if="observando"
          id="g05-comprobante"
          :titulo="botonObservar"
          :item="`${titulo} · S/ ${pago.monto}`"
          :boton="botonObservar"
          nota="La familia recibe un correo con el motivo y el enlace para regularizar el pago."
          :ocupado="ocupado"
          @enviar="decidir"
          @cancelar="observando = false"
        />
        <div v-else class="acciones">
          <button type="button" class="boton observar grande" :disabled="ocupado" @click="observando = true">{{ botonObservar }}</button>
          <button type="button" class="boton conforme grande" :disabled="ocupado" data-testid="comprobante-conforme" @click="decidir()">
            {{ esCuota ? "Conciliar y aprobar pago" : "Marcar conforme" }}
          </button>
        </div>
      </template>
      <span class="suave">Verifica el abono en el estado de cuenta del colegio antes de decidir.</span>
    </template>
  </section>
</template>

<style scoped src="./validacion.css"></style>

<style scoped>
.nombre {
  font-weight: 700;
}

.datos {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px 16px;
  margin: 0;
}

.datos dt {
  font-size: 13px;
  color: var(--texto-suave);
}

.datos dd {
  margin: 2px 0 0;
  font-weight: 600;
}

.acciones {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
}

.exito {
  margin: 0;
  color: var(--conforme);
  font-weight: 600;
}
</style>
