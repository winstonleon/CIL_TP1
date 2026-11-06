<!-- P07 · Registro de comprobantes de pago (HU0013, HU0014 y HU0015-2.0). Implementa docs/ui/P07-Pagos.dc.html: la tarjeta del
     derecho de admisión y la de la cuota de ingreso, con la modalidad y el comprobante. El monto, el máximo de fracciones,
     los bancos y la cuenta los entrega la API (configuración de G09, C48): no se fijan aquí.
     Desvíos del mockup:
     - La modalidad se confirma antes de la carga, porque HU0013-1.0 la registra y entonces habilita el comprobante; el
       mockup dibuja las dos cosas juntas. Se puede cambiar mientras no haya un pago de cuota registrado.
     - Con el grado sin fracciones (max_fracciones = 1), «Pago fraccionado» se ve deshabilitado.
     - La 2.ª fracción y las siguientes no tienen HU (C64): se muestra su monto, pero no se registran.
     - La línea «Pago único para alumnos ingresantes…» del mockup no se muestra: ninguna fuente define esa condición. -->
<script setup lang="ts">
import { computed, onMounted, reactive, ref } from "vue";
import { elegirModalidad, leerCuota, regularizarCuota, registrarCuota, type CuotaIngreso, type Modalidad } from "../../api/cuotaIngreso";
import { ErrorApi, mensajeDe } from "../../api/respuesta";
import { errorFracciones, errorMonto, estadoCuota, etiquetaPago, NIVEL_VISIBLE, soles } from "../../portal/cuotaIngreso";
import { fechaCorta, fechaDeDia, hoyEnLima } from "../../portal/formato";
import { MENSAJE_ARCHIVO, validarArchivo } from "../../portal/validarArchivo";
import { useExpedienteStore } from "../../stores/expediente";
import CampoFicha from "./CampoFicha.vue";

const expedientes = useExpedienteStore();
const idExpediente = expedientes.expediente!.id_expediente;

const cuota = ref<CuotaIngreso | null>(null);
const carga = ref<"cargando" | "listo" | "error">("cargando");
const errorCarga = ref("");

const modalidad = ref<Modalidad>("unico");
const fracciones = ref("2");
const errorModalidad = ref("");
const cambiando = ref(false);
const guardando = ref(false);

const form = reactive({ banco: "", numero_operacion: "", fecha_pago: "", monto: "" });
const archivo = ref<File | null>(null);
const errores = reactive<Record<string, string>>({});
const errorEnvio = ref("");
const duplicado = ref(false);
const enviando = ref(false);
const regularizando = ref(false);

const bancos = computed(() => (cuota.value?.bancos ?? []).map((b) => ({ valor: b, etiqueta: b })));
const estado = computed(() => (cuota.value ? estadoCuota(cuota.value) : null));
const conFracciones = computed(() => (cuota.value?.max_fracciones ?? 1) > 1);
const eligiendo = computed(() => !!cuota.value?.modalidad_editable && (!cuota.value.modalidad || cambiando.value));
const verFormulario = computed(() => !eligiendo.value && (!!cuota.value?.registrable || regularizando.value));

function aplicar(c: CuotaIngreso) {
  cuota.value = c;
  modalidad.value = c.modalidad ?? "unico";
  if (c.numero_fracciones && c.numero_fracciones > 1) fracciones.value = String(c.numero_fracciones);
  form.monto = c.montos[0] !== undefined ? c.montos[0].toFixed(2) : "";
}

async function cargar() {
  carga.value = "cargando";
  try {
    aplicar(await leerCuota(idExpediente));
    carga.value = "listo";
  } catch (e) {
    errorCarga.value = mensajeDe(e);
    carga.value = "error";
  }
}

async function confirmarModalidad() {
  errorModalidad.value = modalidad.value === "fraccionado" ? errorFracciones(fracciones.value) : "";
  if (errorModalidad.value) return;
  guardando.value = true;
  try {
    aplicar(await elegirModalidad(idExpediente, modalidad.value === "unico" ? { modalidad: "unico" } : { modalidad: "fraccionado", numero_fracciones: Number(fracciones.value) }));
    cambiando.value = false;
  } catch (e) {
    errorModalidad.value = mensajeDe(e); // HU0013-2.0: la API informa el máximo de fracciones
  } finally {
    guardando.value = false;
  }
}

// HU0014-2.0: el rechazo pide un archivo legible, lo detecte la pantalla o la API.
const conPedido = (mensaje: string | null) => (mensaje ? `${mensaje} Carga un PDF o JPG legible.` : "");

async function alElegirArchivo(evento: Event) {
  const elegido = (evento.target as HTMLInputElement).files?.[0] ?? null;
  archivo.value = elegido;
  errores.archivo = elegido ? conPedido(await validarArchivo(elegido)) : "";
}

async function enviar() {
  errorEnvio.value = "";
  duplicado.value = false;
  for (const k of ["banco", "numero_operacion", "fecha_pago", "monto", "archivo"]) errores[k] = "";
  if (!form.banco) errores.banco = "Selecciona el banco.";
  if (!form.numero_operacion.trim()) errores.numero_operacion = "Escribe el N.° de operación.";
  if (!form.fecha_pago) errores.fecha_pago = "Escribe la fecha de pago.";
  else if (form.fecha_pago > hoyEnLima()) errores.fecha_pago = "La fecha de pago no puede ser futura.";
  errores.monto = errorMonto(form.monto);
  if (!archivo.value) errores.archivo = "Adjunta el comprobante de pago.";
  else errores.archivo = conPedido(await validarArchivo(archivo.value));
  if (Object.values(errores).some(Boolean)) return;

  enviando.value = true;
  try {
    const datos = { banco: form.banco, numero_operacion: form.numero_operacion.trim(), fecha_pago: form.fecha_pago, monto: form.monto.trim() };
    aplicar(regularizando.value ? await regularizarCuota(idExpediente, datos, archivo.value!) : await registrarCuota(idExpediente, datos, archivo.value!));
    regularizando.value = false;
  } catch (e) {
    if (e instanceof ErrorApi && e.codigo === "COMPROBANTE_DUPLICADO") {
      duplicado.value = true;
      errores.numero_operacion = "Este N.° de operación ya está registrado.";
    } else if (e instanceof ErrorApi && e.codigo === "CUOTA_YA_REGISTRADA") {
      await cargar();
    } else if (e instanceof ErrorApi && (e.status === 413 || e.status === 415)) {
      errores.archivo = conPedido(MENSAJE_ARCHIVO);
    } else {
      errorEnvio.value = mensajeDe(e);
    }
  } finally {
    enviando.value = false;
  }
}

onMounted(cargar);
</script>

<template>
  <section class="pagos">
    <header class="titulo">
      <h1>Pagos</h1>
      <p>Registra aquí tus comprobantes. Tesorería los valida contra el estado de cuenta del colegio.</p>
    </header>

    <p v-if="carga === 'cargando'" class="suave" role="status">Cargando…</p>
    <div v-else-if="carga === 'error'" class="aviso" role="alert" data-testid="error-carga">
      <p>{{ errorCarga }}</p>
      <button type="button" class="boton secundario" @click="cargar">Reintentar</button>
    </div>

    <template v-else-if="cuota">
      <!-- Derecho de admisión (HU0007): solo lectura; su registro y su regularización siguen en P07b. -->
      <article class="tarjeta" aria-labelledby="p07-derecho" data-testid="tarjeta-derecho">
        <div class="cabecera">
          <h2 id="p07-derecho">Derecho de admisión</h2>
          <span v-if="cuota.derecho?.estado === 'conforme'" class="chip conforme">Validado por Tesorería</span>
          <span v-else-if="cuota.derecho?.estado === 'observado'" class="chip observado">Observado</span>
          <span v-else-if="cuota.derecho" class="chip revision">Pendiente de validación</span>
        </div>
        <dl v-if="cuota.derecho">
          <div><dt>Monto</dt><dd>{{ soles(cuota.derecho.monto) }} (no reembolsable)</dd></div>
          <div><dt>N.° de operación</dt><dd>{{ cuota.derecho.numero_operacion }}</dd></div>
          <div><dt>Fecha de pago</dt><dd>{{ fechaDeDia(cuota.derecho.fecha_pago) }}</dd></div>
          <div v-if="cuota.derecho.fecha_validacion"><dt>Validado</dt><dd data-testid="derecho-validado">{{ fechaCorta(cuota.derecho.fecha_validacion) }}</dd></div>
        </dl>
        <RouterLink v-if="!cuota.derecho || cuota.derecho.estado === 'observado'" to="/portal/pagos/derecho-admision" class="boton secundario ajustado" data-testid="ir-derecho">
          {{ cuota.derecho ? "Regularizar el pago" : "Registrar el derecho de admisión" }}
        </RouterLink>
      </article>

      <!-- Cuota de ingreso (HU0013 a HU0015) -->
      <article class="tarjeta" aria-labelledby="p07-cuota" data-testid="tarjeta-cuota">
        <div class="cabecera">
          <h2 id="p07-cuota">Cuota de ingreso · {{ NIVEL_VISIBLE[cuota.nivel] ?? cuota.nivel }}</h2>
          <span v-if="estado" class="chip" :class="estado.tono" data-testid="estado-cuota">{{ estado.texto }}</span>
        </div>

        <p v-if="!cuota.disponible" class="suave" data-testid="cuota-no-disponible">La cuota de ingreso se habilita cuando se te otorgue la vacante.</p>
        <p v-else-if="!cuota.aplica" class="suave" data-testid="cuota-no-aplica">Este grado no tiene cuota de ingreso.</p>

        <template v-else>
          <p class="monto" data-testid="monto-cuota">{{ soles(cuota.monto) }}</p>

          <!-- HU0013-1.0: elegir o cambiar la modalidad -->
          <form v-if="eligiendo" class="bloque" novalidate data-testid="form-modalidad" @submit.prevent="confirmarModalidad">
            <fieldset>
              <legend>Modalidad de pago <span class="requerido" aria-hidden="true">*</span></legend>
              <label class="opcion">
                <input v-model="modalidad" type="radio" name="p07-modalidad" value="unico" data-testid="modalidad-unico" />
                <span><strong>Pago único</strong><small>{{ soles(cuota.monto) }} en un solo abono</small></span>
              </label>
              <label class="opcion" :class="{ inactiva: !conFracciones }">
                <input v-model="modalidad" type="radio" name="p07-modalidad" value="fraccionado" :disabled="!conFracciones" data-testid="modalidad-fraccionado" />
                <span><strong>Pago fraccionado</strong><small>{{ conFracciones ? `Hasta ${cuota.max_fracciones} fracciones` : "No disponible en este grado" }}</small></span>
              </label>
            </fieldset>
            <div v-if="modalidad === 'fraccionado'" class="medio">
              <CampoFicha id="p07-fracciones" v-model="fracciones" etiqueta="Número de fracciones" requerido :maximo="3" />
            </div>
            <p v-if="errorModalidad" class="mensaje" role="alert" data-testid="error-modalidad">{{ errorModalidad }}</p>
            <div class="acciones">
              <button v-if="cuota.modalidad" type="button" class="boton secundario" :disabled="guardando" @click="(cambiando = false), aplicar(cuota!)">Cancelar</button>
              <button type="submit" class="boton primario" :disabled="guardando" data-testid="confirmar-modalidad">Confirmar modalidad</button>
            </div>
          </form>

          <!-- Lo elegido y el monto de cada pago -->
          <div v-else-if="cuota.modalidad" class="bloque" data-testid="modalidad-elegida">
            <ul class="montos">
              <li v-for="(m, i) in cuota.montos" :key="i">
                <span>{{ etiquetaPago(i, cuota.montos.length) }}</span>
                <strong>{{ soles(m) }}</strong>
              </li>
            </ul>
            <button v-if="cuota.modalidad_editable" type="button" class="boton secundario ajustado" data-testid="cambiar-modalidad" @click="cambiando = true">Cambiar modalidad</button>
          </div>

          <!-- El comprobante ya registrado -->
          <template v-if="cuota.pago && !regularizando">
            <div v-if="cuota.pago.motivo_observacion" class="alerta" role="alert" data-testid="observacion">
              <strong>Tesorería observó tu comprobante.</strong>
              <span>Motivo: {{ cuota.pago.motivo_observacion }}</span>
            </div>
            <p v-if="cuota.pago.motivo_anterior" class="suave" data-testid="motivo-anterior">Motivo anterior: {{ cuota.pago.motivo_anterior }}</p>
            <dl data-testid="comprobante-cuota">
              <div><dt>Banco</dt><dd>{{ cuota.pago.banco }}</dd></div>
              <div><dt>N.° de operación</dt><dd>{{ cuota.pago.numero_operacion }}</dd></div>
              <div><dt>Fecha de pago</dt><dd>{{ fechaDeDia(cuota.pago.fecha_pago) }}</dd></div>
              <div><dt>Monto abonado</dt><dd>{{ soles(cuota.pago.monto) }}</dd></div>
              <div v-if="cuota.pago.fecha_validacion"><dt>Validado</dt><dd>{{ fechaCorta(cuota.pago.fecha_validacion) }}</dd></div>
            </dl>
            <div v-if="cuota.pago.subsanable" class="acciones">
              <button type="button" class="boton primario" data-testid="regularizar-cuota" @click="regularizando = true">Regularizar el pago</button>
            </div>
          </template>

          <!-- HU0014-1.0: el comprobante del pago único o de la primera fracción -->
          <form v-if="verFormulario" class="bloque" novalidate data-testid="form-comprobante" @submit.prevent="enviar">
            <p v-if="regularizando && cuota.pago?.motivo_observacion" class="mensaje" data-testid="motivo-regularizar">Motivo de la observación: {{ cuota.pago.motivo_observacion }}</p>
            <p class="deposito">
              Deposita o transfiere a <strong>{{ cuota.cuenta_colegio }}</strong>. La Carta de Vacante se emite automáticamente cuando Tesorería concilia el pago único o la
              primera fracción.
            </p>
            <div v-if="duplicado" class="alerta" role="alert" data-testid="alerta-duplicado">
              <strong>Este comprobante ya fue registrado.</strong>
              <span>Revisa el N.° de operación. Si crees que es un error, comunícate con la Secretaría de Admisión.</span>
            </div>
            <p v-if="errorEnvio" class="mensaje" role="alert" data-testid="error-envio">{{ errorEnvio }}</p>
            <div class="rejilla">
              <CampoFicha id="p07-banco" v-model="form.banco" etiqueta="Banco" :opciones="bancos" requerido :error="errores.banco" />
              <CampoFicha id="p07-operacion" v-model="form.numero_operacion" etiqueta="N.° de operación" :maximo="40" requerido :error="errores.numero_operacion" />
              <CampoFicha id="p07-fecha" v-model="form.fecha_pago" etiqueta="Fecha de pago" tipo="date" requerido :error="errores.fecha_pago" />
              <CampoFicha id="p07-monto" v-model="form.monto" etiqueta="Monto abonado" :maximo="11" requerido :error="errores.monto" />
            </div>
            <div class="campo-archivo" :class="{ invalido: errores.archivo }">
              <label for="p07-comprobante">Comprobante de pago <span class="requerido" aria-hidden="true">*</span></label>
              <input
                id="p07-comprobante"
                type="file"
                accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png"
                :aria-invalid="!!errores.archivo"
                aria-describedby="p07-comprobante-ayuda"
                @change="alElegirArchivo"
              />
              <p id="p07-comprobante-ayuda" :class="errores.archivo ? 'mensaje' : 'suave'" :role="errores.archivo ? 'alert' : undefined" data-testid="ayuda-archivo">
                {{ errores.archivo || "PDF, JPG o PNG legible, de hasta 10 MB." }}
              </p>
            </div>
            <div class="acciones">
              <button v-if="regularizando" type="button" class="boton secundario" :disabled="enviando" @click="regularizando = false">Cancelar</button>
              <button type="submit" class="boton primario" :disabled="enviando" data-testid="confirmar-pago">Confirmar pago de cuota</button>
            </div>
          </form>
        </template>
      </article>
    </template>
  </section>
</template>

<style scoped>
.pagos {
  display: flex;
  flex-direction: column;
  gap: 24px;
  max-width: 820px;
}

.titulo {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.titulo h1 {
  margin: 0;
  font-size: 34px;
  color: var(--cil-azul);
  letter-spacing: -0.01em;
}

.titulo p,
.suave {
  margin: 0;
  color: var(--texto-suave);
  line-height: 1.5;
}

.tarjeta,
.bloque {
  display: flex;
  flex-direction: column;
  gap: 18px;
}

.tarjeta {
  padding: 28px;
  background: var(--superficie);
  border: 1px solid var(--borde);
  border-radius: 16px;
}

.cabecera {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
}

.tarjeta h2 {
  margin: 0;
  font-size: 22px;
  color: var(--cil-azul);
}

.chip {
  display: inline-flex;
  padding: 4px 10px;
  border-radius: 999px;
  font-size: 13px;
  font-weight: 600;
}

.chip.revision {
  background: var(--chip-fondo);
  color: var(--cil-azul);
}

.chip.conforme {
  background: var(--conforme-fondo);
  color: var(--conforme);
}

.chip.observado {
  background: var(--aviso-fondo);
  color: var(--observado);
}

.monto {
  margin: 0;
  font-size: 32px;
  font-weight: 700;
  color: var(--cil-azul);
}

dl {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px 18px;
  margin: 0;
}

dt {
  font-size: 13px;
  color: var(--texto-suave);
}

dd {
  margin: 2px 0 0;
  font-weight: 600;
}

fieldset {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin: 0;
  padding: 0;
  border: none;
}

legend {
  margin-bottom: 8px;
  font-size: 14px;
  font-weight: 600;
}

.opcion {
  display: flex;
  align-items: center;
  gap: 12px;
  min-height: 44px;
  padding: 12px 14px;
  border: 1px solid var(--borde);
  border-radius: 10px;
  cursor: pointer;
}

.opcion.inactiva {
  cursor: not-allowed;
  opacity: 0.65;
}

.opcion span {
  display: flex;
  flex-direction: column;
}

.opcion small {
  color: var(--texto-suave);
  font-size: 13px;
}

.medio {
  max-width: 240px;
}

.montos {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.montos li {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 14px;
  border-radius: 10px;
  background: var(--superficie-tenue);
}

.deposito {
  margin: 0;
  line-height: 1.5;
}

.rejilla {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 18px;
}

.campo-archivo {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.campo-archivo label {
  font-size: 14px;
  font-weight: 600;
}

.campo-archivo.invalido input {
  outline: 2px solid var(--observado);
  outline-offset: 2px;
}

.requerido,
.mensaje {
  color: var(--observado);
}

.mensaje {
  margin: 0;
  font-weight: 600;
  line-height: 1.5;
}

.alerta,
.aviso {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 14px;
  border-radius: 10px;
  background: var(--aviso-fondo);
  color: var(--observado);
}

.aviso p {
  margin: 0;
}

.acciones {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  flex-wrap: wrap;
}

.ajustado {
  align-self: flex-start;
}

.boton {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 46px;
  padding: 0 20px;
  border: 1px solid transparent;
  border-radius: 10px;
  font-family: var(--fuente-texto);
  font-size: 15px;
  font-weight: 600;
  text-decoration: none;
  cursor: pointer;
}

.boton.primario {
  background: var(--cil-azul);
  color: #fff;
}

.boton.secundario {
  background: var(--superficie);
  border-color: var(--borde);
  color: var(--cil-azul);
}

.boton:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.boton:focus-visible {
  outline: 3px solid var(--cil-dorado);
  outline-offset: 2px;
}

@media (max-width: 640px) {
  .rejilla,
  dl {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
