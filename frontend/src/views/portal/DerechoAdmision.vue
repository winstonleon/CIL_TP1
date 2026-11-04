<!-- P07b · Registro del derecho de admisión (HU0007). Implementa docs/ui/P07b-DerechoAdmision.dc.html en sus tres estados:
     formulario, error de comprobante duplicado (HU0007-2.0) y constancia tras el envío (HU0007-1.0).
     - El monto (S/ 300, R16), la lista de bancos y la cuenta del colegio los entrega la API (C26, C48): no se fijan aquí.
     - El archivo se revisa antes de enviarlo (formato por su firma y 10 MB); la API vuelve a validarlo.
     - El mockup cierra la constancia con «Volver a Pagos»: P07 (Pagos) llega con HU0013 y HU0014, así que ese botón no se
       muestra todavía. «Registrado el» solo se conoce al registrar (C49). -->
<script setup lang="ts">
import { computed, onMounted, reactive, ref } from "vue";
import { leerDerechoAdmision, registrarDerechoAdmision, type Constancia, type DerechoAdmision } from "../../api/derechoAdmision";
import { ErrorApi, mensajeDe } from "../../api/respuesta";
import { fechaDeDia, fechaHora, hoyEnLima } from "../../portal/formato";
import { MENSAJE_ARCHIVO, validarArchivo } from "../../portal/validarArchivo";
import { useExpedienteStore } from "../../stores/expediente";
import CampoFicha from "./CampoFicha.vue";

const ESTADOS = {
  pendiente: "Pendiente de validación",
  en_revision: "En revisión",
  conforme: "Conforme",
  observado: "Observado",
} as const;

const expedientes = useExpedienteStore();
const idExpediente = expedientes.expediente!.id_expediente;

const derecho = ref<DerechoAdmision | null>(null);
const constancia = ref<Constancia | null>(null);
const carga = ref<"cargando" | "listo" | "error">("cargando");
const errorCarga = ref("");
const enviando = ref(false);
const duplicado = ref(false);
const errorEnvio = ref("");
const errores = reactive<Record<string, string>>({});
const form = reactive({ banco: "", numero_operacion: "", fecha_pago: "" });
const archivo = ref<File | null>(null);

const bancos = computed(() => (derecho.value?.bancos ?? []).map((b) => ({ valor: b, etiqueta: b })));
const monto = computed(() => `S/ ${derecho.value?.monto ?? 0}`);

async function cargar() {
  carga.value = "cargando";
  try {
    derecho.value = await leerDerechoAdmision(idExpediente);
    constancia.value = derecho.value.pago;
    carga.value = "listo";
  } catch (e) {
    errorCarga.value = mensajeDe(e);
    carga.value = "error";
  }
}

async function alElegirArchivo(evento: Event) {
  const elegido = (evento.target as HTMLInputElement).files?.[0] ?? null;
  archivo.value = elegido;
  errores.archivo = elegido ? ((await validarArchivo(elegido)) ?? "") : "";
}

async function enviar() {
  errorEnvio.value = "";
  duplicado.value = false;
  for (const k of ["banco", "numero_operacion", "fecha_pago", "archivo"]) errores[k] = "";
  if (!form.banco) errores.banco = "Selecciona el banco.";
  if (!form.numero_operacion.trim()) errores.numero_operacion = "Escribe el N.° de operación.";
  if (!form.fecha_pago) errores.fecha_pago = "Escribe la fecha de pago.";
  else if (form.fecha_pago > hoyEnLima()) errores.fecha_pago = "La fecha de pago no puede ser futura.";
  if (!archivo.value) errores.archivo = "Adjunta el comprobante de pago.";
  else errores.archivo = (await validarArchivo(archivo.value)) ?? "";
  if (Object.values(errores).some(Boolean)) return;

  enviando.value = true;
  try {
    constancia.value = await registrarDerechoAdmision(
      idExpediente,
      { banco: form.banco, numero_operacion: form.numero_operacion.trim(), fecha_pago: form.fecha_pago },
      archivo.value!,
    );
  } catch (e) {
    if (e instanceof ErrorApi && e.codigo === "COMPROBANTE_DUPLICADO") {
      duplicado.value = true;
      errores.numero_operacion = "Este N.° de operación ya está registrado.";
    } else if (e instanceof ErrorApi && e.codigo === "DERECHO_YA_REGISTRADO") {
      await cargar(); // ya tiene comprobante: se muestra su constancia
    } else if (e instanceof ErrorApi && (e.status === 413 || e.status === 415)) {
      errores.archivo = MENSAJE_ARCHIVO;
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
  <section class="derecho">
    <header class="titulo">
      <h1>Registrar el derecho de admisión</h1>
      <p>Registra el comprobante de tu pago. Tesorería lo validará contra el estado de cuenta del colegio.</p>
    </header>

    <p v-if="carga === 'cargando'" class="suave" role="status">Cargando…</p>
    <div v-else-if="carga === 'error'" class="aviso" role="alert" data-testid="error-carga">
      <p>{{ errorCarga }}</p>
      <button type="button" class="boton secundario" @click="cargar">Reintentar</button>
    </div>

    <!-- Estado: constancia tras el envío (HU0007-1.0) -->
    <article v-else-if="constancia" class="tarjeta constancia" data-testid="constancia" aria-labelledby="constancia-titulo">
      <h2 id="constancia-titulo">Constancia de registro del comprobante</h2>
      <p class="recibido">Recibimos tu comprobante. Tesorería lo validará y te avisaremos por correo.</p>
      <dl>
        <div><dt>Expediente</dt><dd>{{ constancia.expediente }}</dd></div>
        <div><dt>Postulante</dt><dd>{{ constancia.postulante ?? "—" }}</dd></div>
        <div><dt>Concepto</dt><dd>{{ constancia.concepto }}</dd></div>
        <div><dt>Monto</dt><dd>S/ {{ constancia.monto }}</dd></div>
        <div><dt>Banco</dt><dd>{{ constancia.banco }}</dd></div>
        <div><dt>N.° de operación</dt><dd>{{ constancia.numero_operacion }}</dd></div>
        <div><dt>Fecha de pago</dt><dd>{{ fechaDeDia(constancia.fecha_pago) }}</dd></div>
        <div v-if="constancia.registrado_en"><dt>Registrado el</dt><dd>{{ fechaHora(constancia.registrado_en) }}</dd></div>
        <div><dt>Código de constancia</dt><dd data-testid="codigo-constancia">{{ constancia.codigo }}</dd></div>
        <div><dt>Estado</dt><dd>{{ ESTADOS[constancia.estado] }}</dd></div>
      </dl>
    </article>

    <p v-else-if="derecho && !derecho.registrable" class="aviso" role="status" data-testid="no-registrable">
      El derecho de admisión no se puede registrar en el estado actual de tu expediente.
    </p>

    <!-- Estados: formulario y error de comprobante duplicado (HU0007-2.0) -->
    <form v-else class="tarjeta" novalidate @submit.prevent="enviar">
      <h2>Derecho de admisión</h2>
      <p>
        Deposita o transfiere <strong>{{ monto }}</strong> a <strong>{{ derecho?.cuenta_colegio }}</strong> y registra aquí tu comprobante.
      </p>

      <div v-if="duplicado" class="alerta" role="alert" data-testid="alerta-duplicado">
        <strong>Este comprobante ya fue registrado.</strong>
        <span>Revisa el N.° de operación. Si crees que es un error, comunícate con la Secretaría de Admisión.</span>
      </div>
      <p v-if="errorEnvio" class="mensaje" role="alert">{{ errorEnvio }}</p>

      <div class="rejilla">
        <CampoFicha id="p07b-banco" v-model="form.banco" etiqueta="Banco" :opciones="bancos" requerido :error="errores.banco" />
        <CampoFicha id="p07b-operacion" v-model="form.numero_operacion" etiqueta="N.° de operación" :maximo="40" requerido :error="errores.numero_operacion" />
        <CampoFicha id="p07b-fecha" v-model="form.fecha_pago" etiqueta="Fecha de pago" tipo="date" requerido :error="errores.fecha_pago" />
        <div class="monto">
          <span class="rotulo">Monto</span>
          <span class="monto-valor">{{ monto }} (no reembolsable)</span>
        </div>
      </div>

      <div class="campo-archivo" :class="{ invalido: errores.archivo }">
        <label for="p07b-comprobante">Comprobante de pago <span class="requerido" aria-hidden="true">*</span></label>
        <input
          id="p07b-comprobante"
          type="file"
          accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png"
          :aria-invalid="!!errores.archivo"
          aria-describedby="p07b-comprobante-ayuda"
          @change="alElegirArchivo"
        />
        <p id="p07b-comprobante-ayuda" :class="errores.archivo ? 'mensaje' : 'suave'" :role="errores.archivo ? 'alert' : undefined" data-testid="ayuda-archivo">
          {{ errores.archivo || "PDF, JPG o PNG de hasta 10 MB." }}
        </p>
      </div>

      <div class="acciones">
        <button type="submit" class="boton primario" :disabled="enviando">Enviar comprobante</button>
      </div>
    </form>
  </section>
</template>

<style scoped>
.derecho {
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

.tarjeta {
  display: flex;
  flex-direction: column;
  gap: 18px;
  padding: 28px;
  background: var(--superficie);
  border: 1px solid var(--borde);
  border-radius: 16px;
}

.tarjeta h2 {
  margin: 0;
  font-size: 22px;
  color: var(--cil-azul);
}

.tarjeta p {
  margin: 0;
  line-height: 1.5;
}

.rejilla {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 18px;
}

.monto {
  display: flex;
  flex-direction: column;
  gap: 6px;
  justify-content: flex-end;
}

.rotulo {
  font-size: 14px;
  font-weight: 600;
}

.monto-valor {
  display: flex;
  align-items: center;
  height: 46px;
  padding: 0 14px;
  border-radius: 10px;
  background: var(--superficie-tenue);
  border: 1px solid var(--borde);
  font-weight: 600;
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

.requerido {
  color: var(--observado);
}

.mensaje {
  color: var(--observado);
  font-size: 14px;
}

.alerta {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 14px 16px;
  border-radius: 12px;
  background: var(--aviso-fondo);
  border: 1px solid var(--observado);
  color: var(--observado);
}

.aviso {
  display: flex;
  align-items: center;
  gap: 16px;
  margin: 0;
  padding: 12px 16px;
  border-radius: 12px;
  background: var(--aviso-fondo);
  color: var(--observado);
}

.aviso p {
  margin: 0;
}

.acciones {
  display: flex;
  justify-content: flex-end;
}

.boton {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  height: 46px;
  padding: 0 22px;
  border-radius: 10px;
  font: inherit;
  font-size: 15px;
  font-weight: 600;
  cursor: pointer;
}

.boton.primario {
  background: var(--cil-azul);
  color: #ffffff;
  border: 1px solid var(--cil-azul);
}

.boton.secundario {
  background: var(--superficie);
  color: var(--cil-azul);
  border: 1px solid var(--borde);
}

.boton:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.boton:focus-visible {
  outline: 3px solid var(--cil-dorado);
  outline-offset: 2px;
}

.recibido {
  color: var(--conforme);
  font-weight: 600;
}

dl {
  display: flex;
  flex-direction: column;
  margin: 0;
}

dl div {
  display: flex;
  justify-content: space-between;
  gap: 16px;
  padding: 12px 0;
  border-top: 1px solid var(--borde);
}

dt {
  color: var(--texto-suave);
}

dd {
  margin: 0;
  font-weight: 600;
  text-align: right;
}

@media (max-width: 900px) {
  .rejilla {
    grid-template-columns: minmax(0, 1fr);
  }

  .tarjeta {
    padding: 20px;
  }

  .titulo h1 {
    font-size: 28px;
  }
}
</style>
