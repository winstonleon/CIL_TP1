<!-- P05 · Ficha de inscripción y cuestionario (HU0005), con P05b como paso 2. Implementa docs/ui/P05-Ficha.dc.html y
     P05b-DatosPadres.dc.html. El paso 3 (colegio de procedencia) y el paso 4 (cuestionario) no tienen mockup propio: usan el
     estilo de P05 y las preguntas que entrega la API (ADR-20, C42).
     - «Guardar y continuar» en los pasos 1 a 3 guarda el borrador y avanza; en el paso 4 completa la ficha (HU0005-1.0) y
       muestra la lista de documentos que corresponde.
     - El borrador se guarda solo, 2 s después del último cambio, al salir de la pantalla y al ocultar la pestaña (HU0005-2.0).
     - Del titular, nombres, apellidos, teléfono y correo vienen de P01 y son de solo lectura. El segundo padre es opcional. -->
<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from "vue";
import { onBeforeRouteLeave } from "vue-router";
import {
  guardarFicha,
  leerFicha,
  listaRequisitos,
  type CuerpoFicha,
  type Ficha,
  type Pendiente,
  type Pregunta,
  type Requisito,
} from "../../api/ficha";
import { ErrorApi, mensajeDe } from "../../api/respuesta";
import {
  crearGuardadoAutomatico,
  segundoApoderadoSinGuardar,
  TEXTO_SEGUNDO_PARCIAL,
  textoGuardado,
} from "../../portal/guardadoAutomatico";
import { useExpedienteStore } from "../../stores/expediente";
import CampoFicha from "./CampoFicha.vue";
import GrupoOpciones from "./GrupoOpciones.vue";

const PASOS = ["Datos del postulante", "Datos de los padres", "Colegio de procedencia", "Cuestionario de expectativas"];
const PARENTESCOS = [
  { valor: "madre", etiqueta: "Madre" },
  { valor: "padre", etiqueta: "Padre" },
  { valor: "apoderado", etiqueta: "Apoderado" },
  { valor: "otro", etiqueta: "Otro" },
];
const SI_NO = [
  { valor: true, etiqueta: "Sí" },
  { valor: false, etiqueta: "No" },
];
const CONDICIONES = [
  { valor: "dependiente", etiqueta: "Dependiente (boletas de pago de los últimos 3 meses)" },
  { valor: "independiente", etiqueta: "Independiente (recibos por honorarios y declaración jurada anual)" },
];
const MENSAJES: Record<string, string> = {
  OBLIGATORIO: "Este campo es obligatorio.",
  FORMATO: "El formato no es válido.",
  DNI_FORMATO: "Escribe un DNI de 8 dígitos o un carné de extranjería de 9 a 12 caracteres.",
  DNI_YA_REGISTRADO: "Este DNI ya figura en otra postulación. Si es un error, comunícate con Secretaría de Admisión.",
  DNI_REPETIDO_EN_FICHA: "Este DNI ya se usó para otra persona de la ficha.",
};
// En un borrador solo se marcan los conflictos que no se arreglan escribiendo más: lo que falta no es un error todavía.
const CONFLICTOS = ["DNI_YA_REGISTRADO", "DNI_REPETIDO_EN_FICHA"];

const expedientes = useExpedienteStore();
const idExpediente = expedientes.expediente!.id_expediente;

const ficha = ref<Ficha | null>(null);
const carga = ref<"cargando" | "listo" | "error">("cargando");
const errorCarga = ref("");
const paso = ref(1);
const soloLectura = ref(false);
const requisitos = ref<Requisito[]>([]);
const preguntas = ref<Pregunta[]>([]);
const errores = ref<Record<string, string>>({});
const aviso = ref("");
const guardadoEn = ref<string | null>(null);
const guardando = ref(false);
const segundoSinGuardar = ref(false);
const falloGuardado = ref("");
const ahora = ref(new Date());

const form = reactive({
  postulante: {
    nombres: "",
    apellido_paterno: "",
    apellido_materno: "",
    dni: "",
    fecha_nacimiento: "",
    estudio: null as boolean | null,
    colegio_procedencia: "",
    condicion: null as boolean | null,
  },
  titular: { parentesco: "", dni: "", condicion_laboral: "" },
  segundo: { parentesco: "", nombres: "", apellidos: "", dni: "", telefono: "", correo: "", condicion_laboral: "" },
  respuestas: {} as Record<string, string>,
});

const grado = computed(() => ficha.value?.grado.nombre_grado ?? "");
const titular = computed(() => ficha.value?.titular);
const nombrePila = computed(() => form.postulante.nombres.trim().split(/\s+/)[0] || "el postulante");
const nombreCompleto = () =>
  [form.postulante.nombres, form.postulante.apellido_paterno, form.postulante.apellido_materno]
    .map((p) => p.trim())
    .filter(Boolean)
    .join(" ");
const haySegundo = () => Object.values(form.segundo).some((v) => v.trim() !== "");
const error = (campo: string) => errores.value[campo];

const textoEstado = computed(() => {
  if (guardando.value) return "Guardando…";
  if (falloGuardado.value) return falloGuardado.value;
  if (segundoSinGuardar.value) return TEXTO_SEGUNDO_PARCIAL;
  return textoGuardado(guardadoEn.value, ahora.value);
});

function desdeFicha(f: Ficha) {
  const p = f.postulante;
  Object.assign(form.postulante, {
    nombres: p.nombres ?? "",
    apellido_paterno: p.apellido_paterno ?? "",
    apellido_materno: p.apellido_materno ?? "",
    dni: p.dni ?? "",
    fecha_nacimiento: p.fecha_nacimiento ?? "",
    estudio: p.estudio_en_colegio_peruano, // null = sin responder: no se marca ninguna opción
    colegio_procedencia: p.colegio_procedencia ?? "",
    condicion: p.tiene_condicion_especial,
  });
  Object.assign(form.titular, { parentesco: f.titular.parentesco ?? "", dni: f.titular.dni ?? "", condicion_laboral: f.titular.condicion_laboral ?? "" });
  const s = f.segundo_apoderado;
  Object.assign(form.segundo, {
    parentesco: s?.parentesco ?? "",
    nombres: s?.nombres ?? "",
    apellidos: s?.apellidos ?? "",
    dni: s?.dni ?? "",
    telefono: s?.telefono ?? "",
    correo: s?.correo ?? "",
    condicion_laboral: s?.condicion_laboral ?? "",
  });
  form.respuestas = Object.fromEntries(f.cuestionario.preguntas.map((q) => [q.id, f.cuestionario.respuestas[q.id] ?? ""]));
}

function cuerpo(modo: CuerpoFicha["modo"]): CuerpoFicha {
  const p = form.postulante;
  return {
    modo,
    postulante: {
      nombres: p.nombres,
      apellido_paterno: p.apellido_paterno,
      apellido_materno: p.apellido_materno,
      dni: p.dni,
      fecha_nacimiento: p.fecha_nacimiento,
      estudio_en_colegio_peruano: p.estudio,
      colegio_procedencia: p.colegio_procedencia,
      tiene_condicion_especial: p.condicion,
    },
    titular: { ...form.titular },
    segundo_apoderado: haySegundo() ? { ...form.segundo } : null,
    respuestas: { ...form.respuestas },
  };
}

function marcar(pendientes: Pendiente[], soloConflictos: boolean) {
  errores.value = {};
  for (const p of pendientes) {
    if (soloConflictos && !CONFLICTOS.includes(p.codigo)) continue;
    errores.value[p.campo] = MENSAJES[p.codigo] ?? MENSAJES.FORMATO!;
  }
}

function alGuardar(guardado: string, nombre: string) {
  guardadoEn.value = guardado;
  ahora.value = new Date();
  expedientes.actualizar({ estado: "en_postulacion", postulante: nombre || null });
}

// Guarda el borrador (botón, guardado automático, avance de paso y salida). Devuelve false si falló.
async function guardarBorrador(keepalive = false): Promise<boolean> {
  guardando.value = true;
  falloGuardado.value = "";
  try {
    const r = await guardarFicha(idExpediente, cuerpo("borrador"), keepalive);
    if (!r.ficha_completa) {
      marcar(r.pendientes, true);
      segundoSinGuardar.value = segundoApoderadoSinGuardar(r.pendientes);
    }
    alGuardar(r.guardado_en, nombreCompleto());
    return true;
  } catch (e) {
    falloGuardado.value = `No se pudo guardar el borrador. ${mensajeDe(e)}`;
    return false;
  } finally {
    guardando.value = false;
  }
}

const guardado = crearGuardadoAutomatico(guardarBorrador);

// Paso de la pantalla donde está cada campo con error.
function pasoDe(campo: string): number {
  if (campo === "postulante.colegio_procedencia") return 3;
  if (campo.startsWith("postulante.")) return 1;
  if (campo.startsWith("respuestas.")) return 4;
  return 2;
}

async function guardarYContinuar() {
  guardado.cancelar(); // este guardado ya incluye los cambios pendientes
  if (paso.value < PASOS.length) {
    await guardarBorrador();
    paso.value += 1;
    return;
  }
  aviso.value = "";
  guardando.value = true;
  try {
    const r = await guardarFicha(idExpediente, cuerpo("completa"));
    if (r.ficha_completa) {
      errores.value = {};
      requisitos.value = r.requisitos;
      soloLectura.value = true;
      segundoSinGuardar.value = false;
      alGuardar(r.guardado_en, nombreCompleto());
      expedientes.actualizar({ ficha_completa: true });
    }
  } catch (e) {
    if (e instanceof ErrorApi && Array.isArray(e.detalle) && (e.codigo === "VALIDACION" || e.codigo === "DNI_YA_REGISTRADO")) {
      marcar(e.detalle as Pendiente[], false);
      const primero = (e.detalle as Pendiente[])[0];
      if (primero) paso.value = pasoDe(primero.campo);
      aviso.value = "Revisa los campos marcados para completar la ficha.";
    } else {
      aviso.value = mensajeDe(e);
    }
  } finally {
    guardando.value = false;
  }
}

async function guardarBorradorBoton() {
  guardado.cancelar();
  await guardarBorrador();
}

// Antes de salir de la pantalla se guarda lo pendiente (HU0005-2.0); si falla, igual se puede salir.
onBeforeRouteLeave(async () => {
  await guardado.ahora();
});

// Al ocultar o cerrar la pestaña: keepalive para que la petición termine aunque la página se descargue.
function alCambiarVisibilidad() {
  if (document.visibilityState === "hidden") void guardado.ahora(true);
}

let reloj: ReturnType<typeof setInterval> | undefined;
let inicializado = false;

watch(
  form,
  () => {
    if (inicializado && !soloLectura.value) guardado.cambio();
  },
  { deep: true },
);

onMounted(async () => {
  document.addEventListener("visibilitychange", alCambiarVisibilidad);
  reloj = setInterval(() => (ahora.value = new Date()), 30_000);
  try {
    const f = await leerFicha(idExpediente);
    ficha.value = f;
    preguntas.value = f.cuestionario.preguntas;
    desdeFicha(f);
    guardadoEn.value = f.guardado_en;
    if (f.ficha_completa) {
      soloLectura.value = true;
      requisitos.value = await listaRequisitos(idExpediente);
    }
    carga.value = "listo";
  } catch (e) {
    errorCarga.value = mensajeDe(e);
    carga.value = "error";
  }
  await nextTick(); // el watcher ve la carga inicial antes de activarse
  inicializado = true;
});

onBeforeUnmount(() => {
  document.removeEventListener("visibilitychange", alCambiarVisibilidad);
  clearInterval(reloj);
});

const etiquetaApoderado = (r: Requisito) => (r.apoderado ? `${r.tipo_documento} — ${r.apoderado}` : r.tipo_documento);
</script>

<template>
  <div class="ficha">
    <div class="titulo">
      <h1>Ficha de inscripción y cuestionario</h1>
      <p>Completa los cuatro pasos. Puedes guardar un borrador y continuar después.</p>
    </div>

    <p v-if="carga === 'cargando'">Cargando…</p>
    <p v-else-if="carga === 'error'" class="aviso" role="alert">{{ errorCarga }}</p>

    <section v-else class="tarjeta">
      <div class="pasos" role="tablist">
        <button
          v-for="(nombre, i) in PASOS"
          :key="nombre"
          type="button"
          role="tab"
          class="paso"
          :class="{ activo: paso === i + 1 }"
          :aria-selected="paso === i + 1"
          @click="paso = i + 1"
        >
          <span class="numero">{{ i + 1 }}</span>
          {{ nombre }}
        </button>
      </div>

      <p v-if="soloLectura" class="completa" role="status" data-testid="ficha-completa">
        Tu ficha está completa y guardada. Para corregir un dato, comunícate con Secretaría de Admisión.
      </p>
      <p v-if="aviso" class="aviso" role="alert" data-testid="aviso">{{ aviso }}</p>

      <fieldset class="sin-borde" :disabled="soloLectura">
        <!-- Paso 1 · P05 -->
        <template v-if="paso === 1">
          <h2>Paso 1 · Datos del postulante</h2>
          <div class="rejilla tres">
            <CampoFicha id="p05n" v-model="form.postulante.nombres" etiqueta="Nombres" requerido :maximo="100" :error="error('postulante.nombres')" />
            <CampoFicha id="p05ap" v-model="form.postulante.apellido_paterno" etiqueta="Apellido paterno" requerido :maximo="100" :error="error('postulante.apellido_paterno')" />
            <CampoFicha id="p05am" v-model="form.postulante.apellido_materno" etiqueta="Apellido materno" requerido :maximo="100" :error="error('postulante.apellido_materno')" />
            <CampoFicha id="p05d" v-model="form.postulante.dni" etiqueta="DNI del postulante" requerido :maximo="20" :error="error('postulante.dni')" />
            <CampoFicha id="p05f" v-model="form.postulante.fecha_nacimiento" etiqueta="Fecha de nacimiento" tipo="date" requerido :error="error('postulante.fecha_nacimiento')" />
            <CampoFicha id="p05g" :model-value="grado" etiqueta="Grado al que postula" requerido deshabilitado />
          </div>
          <div class="rejilla dos">
            <GrupoOpciones
              v-model="form.postulante.estudio"
              nombre="p05proc"
              leyenda="¿Estudió en otro colegio del Perú?"
              :opciones="SI_NO"
              requerido
              :error="error('postulante.estudio_en_colegio_peruano')"
            />
            <GrupoOpciones
              v-model="form.postulante.condicion"
              nombre="p05cond"
              leyenda="¿Presenta alguna condición que requiera acompañamiento especializado?"
              :opciones="SI_NO"
              requerido
              :error="error('postulante.tiene_condicion_especial')"
            />
          </div>
          <div v-if="form.postulante.estudio || form.postulante.condicion" class="nota" data-testid="nota-documentos">
            <p v-if="form.postulante.estudio">
              Como {{ nombrePila }} estudió en otro colegio del Perú, en <strong>Documentos</strong> te pediremos los documentos del colegio de procedencia.
            </p>
            <p v-if="form.postulante.condicion">
              Como {{ nombrePila }} requiere acompañamiento especializado, en <strong>Documentos</strong> te pediremos los informes correspondientes.
            </p>
          </div>
        </template>

        <!-- Paso 2 · P05b -->
        <template v-else-if="paso === 2">
          <h2>Paso 2 · Datos de los padres</h2>
          <h3>Titular de la solicitud</h3>
          <div class="rejilla tres">
            <CampoFicha id="p05bt-par" v-model="form.titular.parentesco" etiqueta="Parentesco" requerido :opciones="PARENTESCOS" :error="error('titular.parentesco')" />
            <CampoFicha id="p05bt-nom" :model-value="titular?.nombres" etiqueta="Nombres" requerido deshabilitado />
            <CampoFicha id="p05bt-ape" :model-value="titular?.apellidos" etiqueta="Apellidos" requerido deshabilitado />
            <CampoFicha id="p05bt-dni" v-model="form.titular.dni" etiqueta="DNI" requerido :maximo="20" :error="error('titular.dni')" />
            <CampoFicha id="p05bt-tel" :model-value="titular?.telefono" etiqueta="Teléfono" tipo="tel" requerido deshabilitado />
            <CampoFicha id="p05bt-cor" :model-value="titular?.correo" etiqueta="Correo" tipo="email" requerido deshabilitado />
          </div>
          <GrupoOpciones
            v-model="form.titular.condicion_laboral"
            nombre="p05btcl"
            leyenda="Condición laboral"
            :opciones="CONDICIONES"
            requerido
            :error="error('titular.condicion_laboral')"
          />

          <h3>Segundo padre o apoderado (opcional)</h3>
          <div class="rejilla tres">
            <CampoFicha id="p05bs-par" v-model="form.segundo.parentesco" etiqueta="Parentesco" :opciones="PARENTESCOS" :error="error('segundo_apoderado.parentesco')" />
            <CampoFicha id="p05bs-nom" v-model="form.segundo.nombres" etiqueta="Nombres" :maximo="100" :error="error('segundo_apoderado.nombres')" />
            <CampoFicha id="p05bs-ape" v-model="form.segundo.apellidos" etiqueta="Apellidos" :maximo="100" :error="error('segundo_apoderado.apellidos')" />
            <CampoFicha id="p05bs-dni" v-model="form.segundo.dni" etiqueta="DNI" :maximo="20" :error="error('segundo_apoderado.dni')" />
            <CampoFicha id="p05bs-tel" v-model="form.segundo.telefono" etiqueta="Teléfono" tipo="tel" :maximo="25" :error="error('segundo_apoderado.telefono')" />
            <CampoFicha id="p05bs-cor" v-model="form.segundo.correo" etiqueta="Correo" tipo="email" :maximo="150" :error="error('segundo_apoderado.correo')" />
          </div>
          <GrupoOpciones
            v-model="form.segundo.condicion_laboral"
            nombre="p05bscl"
            leyenda="Condición laboral"
            :opciones="CONDICIONES"
            :error="error('segundo_apoderado.condicion_laboral')"
          />
          <div class="nota">
            <p>
              La condición laboral determina qué documentos financieros te pediremos en <strong>Documentos</strong>: boletas de pago de los
              últimos 3 meses si es dependiente, o recibos por honorarios y declaración jurada anual si es independiente.
            </p>
          </div>
        </template>

        <!-- Paso 3 · colegio de procedencia -->
        <template v-else-if="paso === 3">
          <h2>Paso 3 · Colegio de procedencia</h2>
          <div v-if="form.postulante.estudio" class="rejilla dos">
            <CampoFicha id="p05c" v-model="form.postulante.colegio_procedencia" etiqueta="Colegio de procedencia" requerido :maximo="150" :error="error('postulante.colegio_procedencia')" />
          </div>
          <p v-else-if="form.postulante.estudio === false" class="suave">
            No hay datos que completar: indicaste que {{ nombrePila }} no estudió en otro colegio del Perú.
          </p>
          <p v-else class="suave">Responde en el paso 1 si {{ nombrePila }} estudió en otro colegio del Perú.</p>
        </template>

        <!-- Paso 4 · cuestionario de expectativas -->
        <template v-else>
          <h2>Paso 4 · Cuestionario de expectativas</h2>
          <div class="preguntas">
            <CampoFicha
              v-for="(pregunta, i) in preguntas"
              :id="`p05q-${pregunta.id}`"
              :key="pregunta.id"
              v-model="form.respuestas[pregunta.id]"
              :etiqueta="`${i + 1}. ${pregunta.texto}`"
              tipo="textarea"
              requerido
              :maximo="2000"
              :error="error(`respuestas.${pregunta.id}`)"
            />
          </div>
        </template>
      </fieldset>

      <div v-if="!soloLectura" class="acciones">
        <span class="estado" :class="{ fallo: falloGuardado, parcial: segundoSinGuardar }" role="status" data-testid="estado-guardado">{{ textoEstado }}</span>
        <div class="botones">
          <button type="button" class="boton secundario" :disabled="guardando" @click="guardarBorradorBoton">Guardar borrador</button>
          <button type="button" class="boton primario" :disabled="guardando" @click="guardarYContinuar">Guardar y continuar</button>
        </div>
      </div>

      <!-- HU0005-1.0: con la ficha completa se habilita la carga de documentos, con la lista que corresponde (R7). -->
      <div v-if="soloLectura" class="documentos" data-testid="paso-documentos">
        <h2>Paso siguiente: Documentos</h2>
        <p>Estos son los documentos que te pediremos según el grado y lo que declaraste en la ficha:</p>
        <ul v-if="requisitos.length" data-testid="lista-documentos">
          <li v-for="r in requisitos" :key="`${r.id_requisito}-${r.id_apoderado ?? 0}`">
            {{ etiquetaApoderado(r) }}<span v-if="!r.obligatorio" class="suave"> (opcional)</span>
          </li>
        </ul>
        <p v-else class="suave">Por ahora el colegio no ha configurado documentos para este grado.</p>
      </div>
    </section>
  </div>
</template>

<style scoped>
.ficha {
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
  font-size: 34px;
  font-weight: 700;
  color: var(--cil-azul);
  letter-spacing: -0.01em;
}

.titulo p {
  margin: 0;
  font-size: 16px;
  color: var(--texto-suave);
  line-height: 1.5;
}

.tarjeta {
  display: flex;
  flex-direction: column;
  gap: 24px;
  padding: 32px;
  background: var(--superficie);
  border: 1px solid var(--borde);
  border-radius: 16px;
}

.pasos {
  display: flex;
  margin: -28px -32px 0;
  padding: 0 16px;
  border-bottom: 1px solid var(--borde);
}

.paso {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 56px;
  padding: 0 16px;
  border: none;
  border-bottom: 3px solid transparent;
  background: transparent;
  font: inherit;
  font-size: 15px;
  font-weight: 500;
  color: var(--texto-suave);
  text-align: left;
  cursor: pointer;
}

.paso.activo {
  border-bottom-color: var(--cil-dorado);
  font-weight: 700;
  color: var(--cil-azul);
}

.numero {
  width: 28px;
  height: 28px;
  flex-shrink: 0;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 13px;
  font-weight: 700;
  background: var(--inactivo-fondo);
  color: var(--texto-suave);
}

.paso.activo .numero {
  background: var(--cil-azul);
  color: #ffffff;
}

.sin-borde {
  margin: 0;
  padding: 0;
  border: none;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 24px;
}

h2 {
  margin: 0;
  font-size: 22px;
  font-weight: 600;
  color: var(--cil-azul);
}

h3 {
  margin: 8px 0 0;
  font-size: 17px;
  color: var(--texto);
}

.rejilla {
  display: grid;
  gap: 20px;
}

.rejilla.tres {
  grid-template-columns: repeat(3, minmax(0, 1fr));
}

.rejilla.dos {
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 24px;
}

.preguntas {
  display: flex;
  flex-direction: column;
  gap: 20px;
  max-width: 880px;
}

.nota {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 16px 18px;
  border-radius: 12px;
  background: var(--chip-fondo);
  color: var(--cil-azul);
  font-size: 15px;
  line-height: 1.5;
}

.nota p {
  margin: 0;
}

.completa {
  margin: 0;
  padding: 14px 18px;
  border-radius: 12px;
  background: var(--conforme-fondo);
  color: var(--conforme);
  font-weight: 600;
}

.aviso {
  margin: 0;
  padding: 14px 18px;
  border-radius: 12px;
  background: var(--aviso-fondo);
  color: var(--observado);
  font-weight: 600;
}

.suave {
  color: var(--texto-suave);
}

.acciones {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding-top: 20px;
  border-top: 1px solid var(--borde);
}

.estado {
  font-size: 14px;
  font-weight: 600;
  color: var(--conforme);
}

.estado.fallo,
.estado.parcial {
  color: var(--observado);
}

.botones {
  display: flex;
  gap: 12px;
}

.boton {
  height: 46px;
  padding: 0 22px;
  border-radius: 10px;
  border: 1px solid var(--cil-azul);
  font: inherit;
  font-size: 15px;
  font-weight: 600;
  cursor: pointer;
}

.boton.secundario {
  background: var(--superficie);
  color: var(--cil-azul);
}

.boton.primario {
  background: var(--cil-azul);
  color: #ffffff;
}

.boton:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.documentos {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding-top: 20px;
  border-top: 1px solid var(--borde);
}

.documentos p,
.documentos ul {
  margin: 0;
}

.documentos li {
  margin-left: 20px;
  line-height: 1.7;
}

@media (max-width: 900px) {
  .rejilla.tres,
  .rejilla.dos {
    grid-template-columns: minmax(0, 1fr);
  }

  .pasos {
    flex-direction: column;
    margin: -28px -32px 0;
  }

  .acciones {
    flex-direction: column;
    align-items: stretch;
  }

  .tarjeta {
    padding: 20px;
  }
}
</style>
