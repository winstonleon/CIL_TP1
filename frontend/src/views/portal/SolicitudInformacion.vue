<!-- P01 · Solicitud de información y consentimiento (HU0001), pública: la familia llega desde Facebook o Instagram sin
     sesión. Implementa docs/ui/Main.dc.html. Los estados que el mockup no muestra (errores, confirmación, carga, 429 y
     sin conexión) usan los textos aprobados en el plan HU0001 (S1) y el patrón de error de P07b.
     Sin el logo del colegio: el repo todavía no tiene el archivo (plan HU0001, S6). -->
<script setup lang="ts">
import { computed, nextTick, onMounted, reactive, ref } from "vue";
import { useRoute } from "vue-router";
import { ErrorApi, mensajeDe } from "../../api/respuesta";
import { enviarSolicitud, obtenerFormulario, type FormularioSolicitud } from "../../api/solicitud";
import {
  canalDeOrigen,
  etiquetaGrado,
  LARGO_MAXIMO,
  normalizarTelefono,
  validarSolicitud,
  type CampoSolicitud,
  type ErroresSolicitud,
} from "../../portal/reglasSolicitud";

const TEXTO = {
  errorCarga: "No se pudo cargar el formulario. Vuelve a intentarlo.",
  revisar: "Revisa los campos marcados.",
  demasiadas: "Recibimos varias solicitudes desde tu conexión. Vuelve a intentarlo en unos minutos.",
};

// Textos fijos del panel azul del mockup.
const NIVELES = [
  { nombre: "Inicial", detalle: "3 y 4 años, y Kindergarten (5 años)" },
  { nombre: "Primaria", detalle: "1.° a 6.° grado" },
  { nombre: "Secundaria", detalle: "1.° a 5.° grado" },
];
const PASOS = [
  "Solicita información y recibe la carpeta informativa",
  "Agenda tu visita guiada al colegio",
  "Completa tu postulación en línea",
];

// Orden de los campos en la pantalla: el foco va al primero con error.
const ID_CAMPO: Record<CampoSolicitud, string> = {
  nombres: "p01n",
  apellidos: "p01a",
  telefono: "p01t",
  correo: "p01c",
  id_grado: "p01g",
  acepta_politica: "p01ok",
};

const route = useRoute();
const datos = ref<FormularioSolicitud | null>(null);
const errorCarga = ref(false);

// Las dos casillas empiezan desmarcadas: el consentimiento es explícito (HU0001-3.0).
const formulario = reactive({
  nombres: "",
  apellidos: "",
  telefono: "",
  correo: "",
  id_grado: null as number | null,
  autoriza_whatsapp: false,
  acepta_politica: false,
});
const errores = ref<ErroresSolicitud>({});
const errorEnvio = ref("");
const enviando = ref(false);
const registrada = ref(false);
const politicaAbierta = ref(false);

const formularioEl = ref<HTMLFormElement | null>(null);
const campoTrampa = ref<HTMLInputElement | null>(null);
const enlacePolitica = ref<HTMLAnchorElement | null>(null);
const botonCerrarPolitica = ref<HTMLButtonElement | null>(null);
const confirmacion = ref<HTMLElement | null>(null);

const campana = computed(() => datos.value?.campana ?? null);
const conCampana = (texto: string) => (campana.value ? `${texto} ${campana.value}` : texto);
const sinGrados = computed(() => datos.value !== null && datos.value.grados.length === 0);
const puedeEnviar = computed(() => datos.value !== null && datos.value.grados.length > 0 && !enviando.value);
const hayErrores = computed(() => Object.keys(errores.value).length > 0);
const mensajeAlerta = computed(() => (hayErrores.value ? TEXTO.revisar : errorEnvio.value || (errorCarga.value ? TEXTO.errorCarga : "")));

// aria-describedby del campo: su mensaje de error, si lo tiene.
const descripcion = (campo: CampoSolicitud) => (errores.value[campo] ? `${ID_CAMPO[campo]}-error` : undefined);

onMounted(async () => {
  try {
    datos.value = await obtenerFormulario();
  } catch {
    errorCarga.value = true;
  }
});

async function enfocarPrimerError() {
  await nextTick();
  const primero = (Object.keys(ID_CAMPO) as CampoSolicitud[]).find((campo) => errores.value[campo]);
  if (primero) formularioEl.value?.querySelector<HTMLElement>(`#${ID_CAMPO[primero]}`)?.focus();
}

async function enviar() {
  errorEnvio.value = "";
  errores.value = validarSolicitud(formulario);
  // HU0001-2.0 y 3.0: con errores o sin consentimiento no se llama a la API.
  if (hayErrores.value) {
    await enfocarPrimerError();
    return;
  }
  if (!puedeEnviar.value) return;
  enviando.value = true;
  try {
    await enviarSolicitud({
      nombres: formulario.nombres.trim(),
      apellidos: formulario.apellidos.trim(),
      telefono: normalizarTelefono(formulario.telefono)!,
      correo: formulario.correo.trim(),
      id_grado: formulario.id_grado!,
      autoriza_whatsapp: formulario.autoriza_whatsapp,
      acepta_politica: true,
      canal_origen: canalDeOrigen(route.query.origen),
      // Campo trampa (ADR-17): se lee del DOM para incluir también lo que un bot escriba sin eventos de teclado.
      comentario: campoTrampa.value?.value ?? "",
    });
    registrada.value = true;
    await nextTick();
    confirmacion.value?.focus();
  } catch (e) {
    errorEnvio.value = e instanceof ErrorApi && e.status === 429 ? TEXTO.demasiadas : mensajeDe(e);
  } finally {
    enviando.value = false;
  }
}

async function abrirPolitica() {
  if (!datos.value) return;
  politicaAbierta.value = true;
  await nextTick();
  botonCerrarPolitica.value?.focus();
}

async function cerrarPolitica() {
  politicaAbierta.value = false;
  await nextTick();
  enlacePolitica.value?.focus();
}
</script>

<template>
  <div class="p01">
    <header class="encabezado">
      <div class="marca">
        <span class="marca-nombre">Colegio Internacional de Lima</span>
        <span class="marca-proceso" data-testid="proceso">{{ conCampana("Proceso de Admisión") }}</span>
      </div>
      <RouterLink to="/portal" class="boton-portal">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
          stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <circle cx="12" cy="8" r="4" />
          <path d="M4 20c1.5-4 4.5-6 8-6s6.5 2 8 6" />
        </svg>
        Portal de postulación
      </RouterLink>
    </header>

    <main class="cuerpo">
      <div class="panel">
        <div class="panel-intro">
          <span class="panel-campana" data-testid="campana-panel">{{ conCampana("Admisión") }}</span>
          <h1>Postula al Colegio Internacional de Lima</h1>
          <p>Déjanos tus datos y te enviaremos la carpeta informativa por correo (y por WhatsApp, si lo autorizas), con el enlace para agendar tu visita.</p>
        </div>
        <ul class="niveles">
          <li v-for="n in NIVELES" :key="n.nombre">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9"
              stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="M3 9l9-5 9 5-9 5z" />
              <path d="M7 11.5V16c1.5 1.5 3 2 5 2s3.5-.5 5-2v-4.5" />
            </svg>
            <div class="nivel">
              <span class="nivel-nombre">{{ n.nombre }}</span>
              <span class="nivel-detalle">{{ n.detalle }}</span>
            </div>
          </li>
        </ul>
        <ol class="pasos">
          <li v-for="(paso, i) in PASOS" :key="paso">
            <span class="paso-numero" aria-hidden="true">{{ i + 1 }}</span>
            <span>{{ paso }}</span>
          </li>
        </ol>
      </div>

      <div class="contenido">
        <section class="tarjeta" :aria-labelledby="registrada ? undefined : 'p01-titulo'">
          <!-- Confirmación (HU0001-1.0): reemplaza el formulario. Recibe el foco para que el lector de pantalla la lea. -->
          <div v-if="registrada" ref="confirmacion" class="confirmacion" role="status" tabindex="-1">
            <span class="confirmacion-icono" aria-hidden="true">
              <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"
                stroke-linecap="round" stroke-linejoin="round">
                <path d="M5 12.5l4.2 4.2L19 7" />
              </svg>
            </span>
            <p><strong>Solicitud registrada.</strong> Te enviaremos la carpeta informativa al correo que indicaste, con el enlace para agendar tu visita guiada.</p>
          </div>

          <template v-else>
            <h2 id="p01-titulo">Solicita información</h2>
            <p class="nota-obligatorios">Los campos marcados con * son obligatorios.</p>

            <div v-if="mensajeAlerta" class="alerta" role="alert">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
                stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path d="M12 8v5" />
                <path d="M12 16.5v.5" />
                <path d="M10.3 3.9L2.6 17.5A2 2 0 0 0 4.3 20.5h15.4a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" />
              </svg>
              <p>{{ mensajeAlerta }}</p>
            </div>

            <form ref="formularioEl" class="formulario" novalidate @submit.prevent="enviar">
              <div class="rejilla">
                <div class="campo">
                  <label for="p01n">Nombres del apoderado <span class="obligatorio" aria-hidden="true">*</span></label>
                  <input id="p01n" v-model="formulario.nombres" type="text" autocomplete="given-name"
                    :maxlength="LARGO_MAXIMO.nombres" aria-required="true" :aria-invalid="Boolean(errores.nombres)"
                    :aria-describedby="descripcion('nombres')" />
                  <span v-if="errores.nombres" id="p01n-error" class="error-campo">{{ errores.nombres }}</span>
                </div>
                <div class="campo">
                  <label for="p01a">Apellidos del apoderado <span class="obligatorio" aria-hidden="true">*</span></label>
                  <input id="p01a" v-model="formulario.apellidos" type="text" autocomplete="family-name"
                    :maxlength="LARGO_MAXIMO.apellidos" aria-required="true" :aria-invalid="Boolean(errores.apellidos)"
                    :aria-describedby="descripcion('apellidos')" />
                  <span v-if="errores.apellidos" id="p01a-error" class="error-campo">{{ errores.apellidos }}</span>
                </div>
                <div class="campo">
                  <label for="p01t">Teléfono celular <span class="obligatorio" aria-hidden="true">*</span></label>
                  <input id="p01t" v-model="formulario.telefono" type="tel" inputmode="tel" autocomplete="tel"
                    :maxlength="LARGO_MAXIMO.telefono" aria-required="true" :aria-invalid="Boolean(errores.telefono)"
                    :aria-describedby="descripcion('telefono')" />
                  <span v-if="errores.telefono" id="p01t-error" class="error-campo">{{ errores.telefono }}</span>
                </div>
                <div class="campo">
                  <label for="p01c">Correo electrónico <span class="obligatorio" aria-hidden="true">*</span></label>
                  <input id="p01c" v-model="formulario.correo" type="email" autocomplete="email"
                    :maxlength="LARGO_MAXIMO.correo" aria-required="true" :aria-invalid="Boolean(errores.correo)"
                    :aria-describedby="descripcion('correo')" />
                  <span v-if="errores.correo" id="p01c-error" class="error-campo">{{ errores.correo }}</span>
                </div>
              </div>

              <div class="campo">
                <label for="p01g">Nivel y grado de interés <span class="obligatorio" aria-hidden="true">*</span></label>
                <select id="p01g" v-model="formulario.id_grado" :disabled="!datos || sinGrados" aria-required="true"
                  :aria-invalid="Boolean(errores.id_grado)" :aria-describedby="descripcion('id_grado')">
                  <option :value="null"></option>
                  <option v-for="g in datos?.grados ?? []" :key="g.id_grado" :value="g.id_grado">{{ etiquetaGrado(g) }}</option>
                </select>
                <span v-if="errores.id_grado" id="p01g-error" class="error-campo">{{ errores.id_grado }}</span>
                <span v-if="sinGrados" class="nota-grados" role="status">Por ahora no hay grados disponibles para la campaña {{ campana }}.</span>
              </div>

              <div class="casilla casilla-whatsapp">
                <input id="p01wa" v-model="formulario.autoriza_whatsapp" type="checkbox" />
                <label for="p01wa">Autorizo que me contacten por WhatsApp. <span class="opcional">(Opcional)</span></label>
              </div>

              <div class="casilla consentimiento" :class="{ 'con-error': errores.acepta_politica }">
                <input id="p01ok" v-model="formulario.acepta_politica" type="checkbox" aria-required="true"
                  :aria-invalid="Boolean(errores.acepta_politica)" :aria-describedby="descripcion('acepta_politica')" />
                <label for="p01ok">Autorizo al Colegio Internacional de Lima a tratar mis datos personales y los del menor para fines del proceso de admisión, conforme a la Ley N.° 29733. He leído la <a ref="enlacePolitica" href="#politica" class="enlace-politica" @click.prevent="abrirPolitica">Política de privacidad</a>. <span class="obligatorio" aria-hidden="true">*</span></label>
              </div>
              <span v-if="errores.acepta_politica" id="p01ok-error" class="error-campo">{{ errores.acepta_politica }}</span>

              <!-- Campo trampa (ADR-17): fuera de pantalla, fuera del orden de tabulación y oculto al lector de pantalla.
                   Una persona no lo ve ni lo llena; si llega con texto, la API responde lo mismo y no guarda nada. -->
              <div class="campo-trampa" aria-hidden="true">
                <label for="p01-comentario">Comentario</label>
                <input id="p01-comentario" ref="campoTrampa" name="comentario" type="text" tabindex="-1" autocomplete="off" />
              </div>

              <div class="envio">
                <button type="submit" class="boton-principal" :disabled="!puedeEnviar">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
                    stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                    <rect x="3" y="5.5" width="18" height="13" rx="2" />
                    <path d="M3.5 7l8.5 6 8.5-6" />
                  </svg>
                  Solicitar información
                </button>
                <span class="nota-consentimiento">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
                    stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                    <rect x="5" y="11" width="14" height="9" rx="2" />
                    <path d="M8 11V8a4 4 0 0 1 8 0v3" />
                  </svg>
                  Sin el consentimiento no se almacena ningún dato.
                </span>
              </div>
            </form>
          </template>
        </section>
      </div>
    </main>

    <!-- Política de privacidad (plan HU0001, S3): versión y texto de la API. El texto real lo entrega el colegio (C29). -->
    <dialog v-if="politicaAbierta && datos" id="politica" open class="dialogo" aria-modal="true"
      aria-labelledby="p01-politica-titulo" @keydown.esc.prevent="cerrarPolitica">
      <h2 id="p01-politica-titulo">Política de privacidad</h2>
      <p class="politica-version">Versión {{ datos.politica.version }}</p>
      <p class="politica-texto">{{ datos.politica.texto }}</p>
      <div class="dialogo-acciones">
        <button ref="botonCerrarPolitica" type="button" class="boton-secundario" @click="cerrarPolitica">Cerrar</button>
      </div>
    </dialog>
  </div>
</template>

<style scoped>
.p01 {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  background: var(--fondo);
  color: var(--texto);
}

/* ---------------------------------------------------------------- encabezado */

.encabezado {
  min-height: 84px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 0 56px;
  box-sizing: border-box;
  background: var(--superficie);
  border-bottom: 1px solid var(--borde);
}

.marca {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.marca-nombre {
  font-family: var(--fuente-titulos);
  font-size: 20px;
  font-weight: 700;
  color: var(--cil-azul);
}

.marca-proceso {
  font-size: 13px;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--texto-suave);
}

.boton-portal {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  height: 44px;
  padding: 0 18px;
  box-sizing: border-box;
  border: 1px solid var(--cil-azul);
  border-radius: 10px;
  color: var(--cil-azul);
  font-weight: 600;
  font-size: 15px;
  text-decoration: none;
  white-space: nowrap;
}

.boton-portal:hover {
  color: var(--cil-azul-hover);
  border-color: var(--cil-azul-hover);
}

/* ---------------------------------------------------------------- panel azul */

.cuerpo {
  flex-grow: 1;
  display: flex;
}

.panel {
  flex: 0 1 560px;
  min-width: 0;
  box-sizing: border-box;
  padding: 56px;
  background: var(--cil-azul);
  display: flex;
  flex-direction: column;
  gap: 32px;
}

.panel-intro {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.panel-campana {
  font-size: 13px;
  font-weight: 700;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--cil-dorado);
}

.panel h1 {
  margin: 0;
  font-family: var(--fuente-titulos);
  font-size: 44px;
  line-height: 1.1;
  font-weight: 700;
  color: #ffffff;
}

.panel-intro p {
  margin: 0;
  font-size: 17px;
  line-height: 1.6;
  color: var(--panel-texto);
}

.niveles,
.pasos {
  margin: 0;
  padding: 0;
  list-style: none;
}

.niveles li {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 14px 0;
  border-top: 1px solid var(--panel-linea);
  color: var(--cil-dorado);
}

.nivel {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.nivel-nombre {
  font-size: 16px;
  font-weight: 700;
  color: #ffffff;
}

.nivel-detalle {
  font-size: 14px;
  color: var(--panel-detalle);
}

.pasos {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.pasos li {
  display: flex;
  align-items: center;
  gap: 12px;
  font-size: 15px;
  color: #ffffff;
}

.paso-numero {
  width: 30px;
  height: 30px;
  flex-shrink: 0;
  border-radius: 50%;
  background: var(--cil-dorado);
  color: var(--cil-azul);
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: 700;
  font-size: 14px;
}

/* ---------------------------------------------------------------- tarjeta del formulario */

.contenido {
  flex: 1 1 700px;
  min-width: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 40px;
  box-sizing: border-box;
}

.tarjeta {
  width: 100%;
  max-width: 620px;
  box-sizing: border-box;
  padding: 40px;
  display: flex;
  flex-direction: column;
  gap: 22px;
  background: var(--superficie);
  border: 1px solid var(--borde);
  border-radius: 16px;
}

.tarjeta h2 {
  margin: 0;
  font-family: var(--fuente-titulos);
  font-size: 22px;
  font-weight: 600;
  color: var(--cil-azul);
}

.nota-obligatorios {
  margin: 0;
  font-size: 15px;
  color: var(--texto-suave);
}

/* Patrón de error de P07b: aviso, borde de 2 px y mensaje bajo el campo, en #8A4B08. */
.alerta {
  display: flex;
  align-items: flex-start;
  gap: 14px;
  padding: 16px 18px;
  border-radius: 12px;
  background: var(--aviso-fondo);
  color: var(--observado);
  font-size: 15px;
  line-height: 1.5;
}

.alerta svg {
  flex-shrink: 0;
}

.alerta p {
  margin: 0;
  flex-grow: 1;
}

.formulario {
  display: flex;
  flex-direction: column;
  gap: 22px;
}

.rejilla {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 18px;
}

.campo {
  display: flex;
  flex-direction: column;
  gap: 6px;
  width: 100%;
}

.campo label {
  font-size: 14px;
  font-weight: 600;
  color: var(--texto);
}

.obligatorio {
  color: var(--observado);
}

.campo input,
.campo select {
  height: 46px;
  padding: 0 14px;
  border: 1px solid var(--borde-campo);
  border-radius: 10px;
  background: var(--superficie);
  font-family: var(--fuente-texto);
  font-size: 15px;
  color: var(--texto);
  width: 100%;
  box-sizing: border-box;
}

.campo select:disabled {
  background: var(--superficie-tenue);
}

.campo [aria-invalid="true"] {
  border: 2px solid var(--observado);
}

.error-campo {
  font-size: 13px;
  font-weight: 600;
  color: var(--observado);
}

.nota-grados {
  font-size: 13px;
  color: var(--texto-suave);
}

.casilla {
  display: flex;
  gap: 14px;
  align-items: flex-start;
}

.casilla input {
  width: 22px;
  height: 22px;
  margin: 0;
  accent-color: var(--cil-azul);
  flex-shrink: 0;
}

.casilla label {
  font-size: 14px;
  line-height: 1.6;
  color: var(--texto);
}

.casilla-whatsapp {
  padding: 0 18px;
}

.opcional {
  color: var(--texto-suave);
}

.consentimiento {
  padding: 18px;
  border-radius: 12px;
  background: var(--superficie-tenue);
  border: 1px solid var(--borde);
}

.consentimiento input {
  margin-top: 2px;
}

.consentimiento.con-error {
  border: 2px solid var(--observado);
}

.consentimiento + .error-campo {
  margin-top: -14px;
}

.enlace-politica {
  font-weight: 700;
}

/* Campo trampa: fuera de pantalla (no display: none, que algunos bots detectan y saltan). */
.campo-trampa {
  position: absolute;
  left: -10000px;
  top: auto;
  width: 1px;
  height: 1px;
  overflow: hidden;
}

.envio {
  display: flex;
  flex-direction: column;
  gap: 12px;
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

.boton-principal:hover:not(:disabled) {
  background: var(--cil-azul-hover);
}

.boton-principal:disabled {
  opacity: 0.7;
  cursor: not-allowed;
}

.nota-consentimiento {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  color: var(--texto-suave);
}

/* Confirmación con el patrón de éxito de P07b (círculo #E2F2E9 y marca #1E6B47). */
.confirmacion {
  display: flex;
  align-items: center;
  gap: 16px;
  outline: none;
}

.confirmacion-icono {
  width: 60px;
  height: 60px;
  flex-shrink: 0;
  border-radius: 50%;
  background: var(--conforme-fondo);
  color: var(--conforme);
  display: flex;
  align-items: center;
  justify-content: center;
}

.confirmacion p {
  margin: 0;
  font-size: 16px;
  line-height: 1.6;
  color: var(--texto);
}

.confirmacion strong {
  font-family: var(--fuente-titulos);
  font-size: 22px;
  font-weight: 700;
  color: var(--cil-azul);
  display: block;
}

/* ---------------------------------------------------------------- diálogo de la política (como el de G10) */

.dialogo {
  position: fixed;
  inset: 0;
  margin: auto;
  width: min(560px, calc(100% - 32px));
  height: fit-content;
  max-height: calc(100% - 32px);
  overflow-y: auto;
  box-sizing: border-box;
  padding: 24px;
  border: 1px solid var(--borde);
  border-radius: 16px;
  background: var(--superficie);
  box-shadow: 0 12px 40px rgb(16 50 110 / 0.25);
  color: var(--texto);
}

.dialogo h2 {
  margin: 0 0 8px;
  font-family: var(--fuente-titulos);
  font-size: 22px;
  font-weight: 600;
  color: var(--cil-azul);
}

.politica-version {
  margin: 0 0 16px;
  font-size: 13px;
  font-weight: 600;
  color: var(--texto-suave);
}

.politica-texto {
  margin: 0 0 20px;
  font-size: 15px;
  line-height: 1.6;
}

.dialogo-acciones {
  display: flex;
  justify-content: flex-end;
}

.boton-secundario {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  height: 46px;
  padding: 0 22px;
  border-radius: 10px;
  border: 1px solid var(--cil-azul);
  background: var(--superficie);
  color: var(--cil-azul);
  font-family: var(--fuente-texto);
  font-size: 15px;
  font-weight: 600;
  cursor: pointer;
}

/* ---------------------------------------------------------------- responsivo: se apila por debajo de 960 px */

@media (max-width: 959px) {
  .encabezado {
    padding: 12px 16px;
    flex-wrap: wrap;
  }

  .cuerpo {
    flex-direction: column;
  }

  .panel {
    flex: none;
    padding: 32px 16px;
    gap: 24px;
  }

  .panel h1 {
    font-size: 32px;
  }

  .contenido {
    flex: none;
    padding: 24px 16px;
  }

  .tarjeta {
    max-width: none;
    padding: 24px 20px;
  }
}

@media (max-width: 640px) {
  .rejilla {
    grid-template-columns: minmax(0, 1fr);
  }

  .casilla-whatsapp {
    padding: 0;
  }

  .marca-nombre {
    font-size: 18px;
  }
}
</style>
