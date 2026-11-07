<!-- Sección «Vacantes otorgadas» de G07 (HU0016-2.0; ADR-28). El mockup no dibuja «Generar Carta de Vacante»: va aquí porque la
     directora autoriza la carta (§4.6). Con la cuota sin conciliar el botón se ve deshabilitado, con la alerta del escenario. Si
     R18 se cumple, la carta sale sola; el botón queda como respaldo si n8n está caído. La API vuelve a decidir con los datos. -->
<script setup lang="ts">
import { onMounted, ref, shallowRef } from "vue";
import { generarCarta, listarVacantesOtorgadas, type EstadoCuotaCarta, type VacanteOtorgada } from "../../api/cartaVacante";
import { mensajeDe } from "../../api/respuesta";
import { nombreCompleto } from "../../gestion/validacion";

const ETIQUETA_CUOTA: Record<EstadoCuotaCarta, { texto: string; tono: string }> = {
  pendiente: { texto: "Cuota en conciliación", tono: "revision" },
  observado: { texto: "Cuota observada", tono: "observado" },
  conforme: { texto: "Cuota acreditada", tono: "conforme" },
  sin_registrar: { texto: "Sin comprobante", tono: "inactivo" },
  no_aplica: { texto: "Sin cuota de ingreso", tono: "conforme" },
};

const items = ref<VacanteOtorgada[] | null>(null);
const error = shallowRef("");
const errorAccion = shallowRef("");
const aviso = shallowRef("");
const ocupado = shallowRef<number | null>(null);

async function cargar() {
  error.value = "";
  try {
    items.value = (await listarVacantesOtorgadas()).items;
  } catch (e) {
    error.value = mensajeDe(e);
  }
}

async function generar(v: VacanteOtorgada) {
  errorAccion.value = "";
  aviso.value = "";
  ocupado.value = v.id_expediente;
  try {
    await generarCarta(v.id_expediente);
    aviso.value = `Carta de Vacante emitida: ${v.codigo}.`;
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
  <section class="tarjeta" aria-labelledby="g07-otorgadas" data-testid="vacantes-otorgadas">
    <h2 id="g07-otorgadas">Vacantes otorgadas</h2>
    <p v-if="error" class="mensaje" role="alert" data-testid="error-otorgadas">{{ error }}</p>
    <p v-if="aviso" class="resultado" role="status" data-testid="carta-emitida">{{ aviso }}</p>
    <p v-if="errorAccion" class="mensaje" role="alert" data-testid="error-carta">{{ errorAccion }}</p>
    <p v-if="items?.length === 0" class="suave" role="status" data-testid="sin-otorgadas">No hay vacantes otorgadas por formalizar.</p>
    <div v-else-if="items" class="tabla-envoltura">
      <table class="tabla" aria-label="Vacantes otorgadas">
        <thead>
          <tr>
            <th scope="col">Postulante</th>
            <th scope="col">Grado</th>
            <th scope="col">Cuota de ingreso</th>
            <th scope="col">Carta de Vacante</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="v in items" :key="v.id_expediente" :data-testid="`otorgada-${v.id_expediente}`">
            <td>
              <div class="celda-doble">
                <span class="nombre">{{ nombreCompleto(v.postulante) }}</span>
                <span class="detalle">{{ v.codigo }}</span>
              </div>
            </td>
            <td>{{ v.grado }}</td>
            <td><span class="chip" :class="ETIQUETA_CUOTA[v.cuota].tono" data-testid="estado-cuota">{{ ETIQUETA_CUOTA[v.cuota].texto }}</span></td>
            <td>
              <div class="carta">
                <button type="button" class="boton" :class="{ primario: v.emitible }" :disabled="!v.emitible || ocupado !== null" data-testid="generar-carta" @click="generar(v)">
                  Generar Carta de Vacante
                </button>
                <span v-if="!v.emitible" class="alerta" role="alert" data-testid="cuota-no-conciliada">La cuota de ingreso no está conciliada</span>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>
</template>

<style scoped src="./validacion/validacion.css"></style>

<style scoped>
.carta {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 6px;
}

.alerta {
  font-size: 13px;
  font-weight: 600;
  color: var(--observado);
}

.resultado {
  margin: 0;
  padding: 12px 14px;
  border-radius: 10px;
  background: var(--conforme-fondo);
  color: var(--conforme);
  font-weight: 600;
}
</style>
