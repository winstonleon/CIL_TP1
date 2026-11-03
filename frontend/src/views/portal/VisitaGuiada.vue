<!-- P02 · Agendamiento de la visita guiada (HU0003), pública: la familia llega con el enlace de la carpeta (ADR-18) sin
     sesión. Implementa docs/ui/P02-Visita.dc.html. El token del enlace sale de ?t= y viaja a la API en la cabecera
     X-Enlace-Visita (ADR-17). Los estados que el mockup no muestra (éxito, enlace no válido y visita ya agendada) usan
     los textos aprobados en el plan (S13); «Apoderada» pasa a «Apoderado/a» (S9). Ante un 409 (HU0003-2.0) muestra el
     aviso del mockup, recarga los horarios y pide elegir otro. -->
<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useRoute } from "vue-router";
import { ErrorApi, mensajeDe } from "../../api/respuesta";
import { obtenerVisita, reservarVisita, type DatosVisita, type HorarioVisita } from "../../api/visita";
import {
  celdasDelMes,
  DIAS_SEMANA,
  diaDisponible,
  diaYMes,
  fechaLarga,
  horariosPorDia,
  horaVisible,
  mesDe,
  nombreMes,
  numeroDia,
  primerDiaDisponible,
  sumarMeses,
  type Mes,
} from "../../portal/calendarioVisita";

const TEXTO = {
  enlaceNoValido: "Este enlace no es válido o ya no está vigente. Si deseas agendar tu visita, comunícate con Admisión.",
  yaAgendada: "Ya tienes una visita agendada. Revisa el correo de confirmación.",
  sinAsistentes: "Escribe los nombres de los asistentes.",
  sinHorario: "Elige un día y un horario disponible.",
  sinHorarios: "Por ahora no hay horarios disponibles para la visita guiada.",
};

const route = useRoute();
const token = typeof route.query.t === "string" ? route.query.t : "";

const datos = ref<DatosVisita | null>(null);
const estado = ref<"cargando" | "listo" | "enlace_no_valido" | "ya_agendada" | "error">("cargando");
const errorCarga = ref("");
const mes = ref<Mes>(mesDe(new Date().toISOString().slice(0, 10)));
const diaElegido = ref<string | null>(null);
const horarioElegido = ref<HorarioVisita | null>(null);
const asistentes = ref("");
const errorAsistentes = ref(false);
const aviso = ref("");
const enviando = ref(false);
const reservada = ref<{ fecha: string; hora_inicio: string } | null>(null);

const campana = computed(() => datos.value?.campana ?? null);
const porDia = computed(() => horariosPorDia(datos.value?.horarios ?? []));
const celdas = computed(() => celdasDelMes(mes.value));
const horariosDelDia = computed(() => (diaElegido.value ? (porDia.value.get(diaElegido.value) ?? []) : []));

// S13. La hora termina en «a. m.» o «p. m.»: su punto cierra también la oración.
const textoReservada = computed(() => {
  if (!reservada.value) return "";
  const hora = horaVisible(reservada.value.hora_inicio);
  return `Tu visita quedó agendada para el ${diaYMes(reservada.value.fecha)} a las ${hora.endsWith(".") ? hora : `${hora}.`} Te enviamos la confirmación a tu correo.`;
});

function etiquetaDia(fecha: string): string {
  const base = diaYMes(fecha).replace(/^\S+ /, ""); // «15 de octubre»
  if (fecha === diaElegido.value) return `${base} (seleccionado)`;
  return `${base} (${diaDisponible(porDia.value, fecha) ? "disponible" : "no disponible"})`;
}

// Interpreta los errores que P02 sabe mostrar como estado de la pantalla. Devuelve false si no es uno de ellos.
function estadoPorError(e: unknown): boolean {
  if (!(e instanceof ErrorApi)) return false;
  if (e.codigo === "ENLACE_NO_VALIDO") estado.value = "enlace_no_valido";
  else if (e.codigo === "VISITA_YA_AGENDADA") estado.value = "ya_agendada";
  else return false;
  return true;
}

async function cargar() {
  datos.value = await obtenerVisita(token);
  // Si el día elegido ya no tiene horarios, se queda elegido igual: el aviso pide elegir otro.
  if (!diaElegido.value) {
    diaElegido.value = primerDiaDisponible(datos.value.horarios);
    if (diaElegido.value) mes.value = mesDe(diaElegido.value);
  }
}

onMounted(async () => {
  if (!token) {
    estado.value = "enlace_no_valido";
    return;
  }
  try {
    await cargar();
    estado.value = "listo";
  } catch (e) {
    if (!estadoPorError(e)) {
      errorCarga.value = mensajeDe(e);
      estado.value = "error";
    }
  }
});

function elegirDia(fecha: string) {
  diaElegido.value = fecha;
  horarioElegido.value = null;
}

function elegirHorario(h: HorarioVisita) {
  if (!h.disponible) return;
  horarioElegido.value = h;
  aviso.value = "";
}

async function confirmar() {
  aviso.value = "";
  errorAsistentes.value = asistentes.value.trim() === "";
  if (!horarioElegido.value) {
    aviso.value = TEXTO.sinHorario;
    return;
  }
  if (errorAsistentes.value) return;
  const elegido = horarioElegido.value;
  enviando.value = true;
  try {
    const r = await reservarVisita(token, { id_horario: elegido.id_horario, asistentes: asistentes.value.trim() });
    reservada.value = { fecha: r.fecha, hora_inicio: r.hora_inicio };
  } catch (e) {
    if (estadoPorError(e)) return;
    // HU0003-2.0: el horario se tomó mientras tanto. Se avisa con el texto del mockup y se recargan los horarios.
    aviso.value =
      e instanceof ErrorApi && e.codigo === "HORARIO_SIN_CUPO"
        ? `El horario de las ${horaVisible(elegido.hora_inicio)} acaba de reservarse. Elige otro horario o día.`
        : mensajeDe(e);
    if (e instanceof ErrorApi && e.codigo.startsWith("HORARIO_")) {
      horarioElegido.value = null;
      try {
        await cargar();
      } catch (otro) {
        estadoPorError(otro);
      }
    }
  } finally {
    enviando.value = false;
  }
}
</script>

<template>
  <div class="p02">
    <header class="encabezado">
      <div class="marca">
        <span class="marca-nombre">Colegio Internacional de Lima</span>
        <span class="marca-proceso" data-testid="proceso">{{ campana ? `Proceso de Admisión ${campana}` : "Proceso de Admisión" }}</span>
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
      <div class="intro">
        <h1>Agenda tu visita guiada</h1>
        <p>Conoce nuestras instalaciones y el proyecto educativo junto a la Dirección. Elige un día resaltado y un horario disponible.</p>
      </div>

      <p v-if="estado === 'cargando'" class="estado" role="status">Cargando los horarios…</p>
      <p v-else-if="estado === 'enlace_no_valido'" class="estado estado-aviso" role="alert" data-testid="enlace-no-valido">{{ TEXTO.enlaceNoValido }}</p>
      <p v-else-if="estado === 'ya_agendada'" class="estado" role="status" data-testid="ya-agendada">{{ TEXTO.yaAgendada }}</p>
      <p v-else-if="estado === 'error'" class="estado estado-aviso" role="alert">{{ errorCarga }}</p>

      <section v-else-if="reservada" class="tarjeta confirmacion" role="status" data-testid="visita-reservada">
        <span class="confirmacion-icono" aria-hidden="true">
          <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"
            stroke-linecap="round" stroke-linejoin="round">
            <path d="M5 12.5l4.2 4.2L19 7" />
          </svg>
        </span>
        <p>{{ textoReservada }}</p>
      </section>

      <div v-else-if="datos" class="columnas">
        <!-- Calendario del mes -->
        <section class="tarjeta calendario" aria-labelledby="p02-mes">
          <div class="mes">
            <button type="button" class="boton-mes" aria-label="Mes anterior" @click="mes = sumarMeses(mes, -1)">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"
                stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 6l-6 6 6 6" /></svg>
            </button>
            <span id="p02-mes" class="mes-nombre" data-testid="mes">{{ nombreMes(mes) }}</span>
            <button type="button" class="boton-mes" aria-label="Mes siguiente" @click="mes = sumarMeses(mes, 1)">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"
                stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 6l6 6-6 6" /></svg>
            </button>
          </div>
          <div class="rejilla-dias">
            <span v-for="d in DIAS_SEMANA" :key="d" class="dia-semana">{{ d }}</span>
            <template v-for="(fecha, i) in celdas" :key="fecha ?? `hueco-${i}`">
              <span v-if="!fecha"></span>
              <button v-else type="button" class="dia" :data-fecha="fecha"
                :class="{ disponible: diaDisponible(porDia, fecha), seleccionado: fecha === diaElegido }"
                :disabled="!diaDisponible(porDia, fecha) && fecha !== diaElegido" :aria-label="etiquetaDia(fecha)"
                :aria-pressed="fecha === diaElegido" @click="elegirDia(fecha)">{{ numeroDia(fecha) }}</button>
            </template>
          </div>
          <div class="leyenda">
            <span><span class="muestra muestra-disponible"></span>Con horarios disponibles</span>
            <span><span class="muestra muestra-seleccionado"></span>Día seleccionado</span>
          </div>
          <p v-if="!datos.horarios.some((h) => h.disponible)" class="nota" role="status">{{ TEXTO.sinHorarios }}</p>
        </section>

        <!-- Horarios del día -->
        <section class="tarjeta horarios" aria-labelledby="p02-horarios">
          <h2 id="p02-horarios">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9"
              stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <circle cx="12" cy="12" r="8.5" />
              <path d="M12 7.5V12l3 2" />
            </svg>
            {{ diaElegido ? `Horarios del ${diaYMes(diaElegido)}` : "Horarios" }}
          </h2>
          <div class="lista-horarios">
            <button v-for="h in horariosDelDia" :key="h.id_horario" type="button" class="horario"
              :class="{ reservado: !h.disponible, elegido: horarioElegido?.id_horario === h.id_horario }"
              :disabled="!h.disponible" :aria-pressed="horarioElegido?.id_horario === h.id_horario"
              :data-testid="`horario-${h.id_horario}`" @click="elegirHorario(h)">
              <span class="horario-hora">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
                  stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                  <circle cx="12" cy="12" r="8.5" />
                  <path d="M12 7.5V12l3 2" />
                </svg>
                {{ horaVisible(h.hora_inicio) }}
              </span>
              <span class="chip" :class="h.disponible ? 'chip-disponible' : 'chip-reservado'">{{ h.disponible ? "Disponible" : "Reservado" }}</span>
            </button>
          </div>
          <div v-if="aviso" class="alerta" role="alert" data-testid="aviso">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
              stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="M12 8v5" />
              <path d="M12 16.5v.5" />
              <path d="M10.3 3.9L2.6 17.5A2 2 0 0 0 4.3 20.5h15.4a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" />
            </svg>
            <div>{{ aviso }}</div>
          </div>
        </section>

        <!-- Tu visita -->
        <section class="tarjeta resumen" aria-labelledby="p02-resumen">
          <h2 id="p02-resumen">Tu visita</h2>
          <dl class="datos">
            <div><dt>Apoderado/a</dt><dd data-testid="apoderado">{{ datos.apoderado.nombres }} {{ datos.apoderado.apellidos }}</dd></div>
            <div><dt>Grado de interés</dt><dd>{{ datos.grado.nombre_grado }}</dd></div>
            <div><dt>Fecha</dt><dd data-testid="fecha">{{ horarioElegido ? fechaLarga(horarioElegido.fecha) : "—" }}</dd></div>
            <div><dt>Hora</dt><dd data-testid="hora">{{ horarioElegido ? horaVisible(horarioElegido.hora_inicio) : "—" }}</dd></div>
            <div><dt>Lugar</dt><dd>{{ datos.lugar }}</dd></div>
          </dl>
          <form class="formulario" novalidate @submit.prevent="confirmar">
            <div class="campo">
              <label for="p02as">Nombres de los asistentes <span class="obligatorio" aria-hidden="true">*</span></label>
              <input id="p02as" v-model="asistentes" type="text" maxlength="300" aria-required="true"
                :aria-invalid="errorAsistentes" aria-describedby="p02as-ayuda" />
              <span v-if="errorAsistentes" class="error-campo" role="alert">{{ TEXTO.sinAsistentes }}</span>
              <span id="p02as-ayuda" class="ayuda">Escribe los nombres de quienes asistirán a la visita.</span>
            </div>
            <button type="submit" class="boton-principal" :disabled="enviando">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
                stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.2 4.2L19 7" /></svg>
              Confirmar visita
            </button>
          </form>
          <span class="nota">Te enviaremos la confirmación y un recordatorio por correo y, si lo autorizaste, por WhatsApp.</span>
        </section>
      </div>
    </main>
  </div>
</template>

<style scoped>
.p02 {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  background: var(--fondo);
  color: var(--texto);
}

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

.cuerpo {
  flex-grow: 1;
  box-sizing: border-box;
  padding: 44px 56px;
  display: flex;
  flex-direction: column;
  gap: 28px;
}

.intro {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.intro h1 {
  margin: 0;
  font-size: 34px;
  font-weight: 700;
  color: var(--cil-azul);
  letter-spacing: -0.01em;
}

.intro p {
  margin: 0;
  font-size: 16px;
  line-height: 1.5;
  color: var(--texto-suave);
}

.estado {
  margin: 0;
  padding: 16px 18px;
  border-radius: 12px;
  background: var(--superficie);
  border: 1px solid var(--borde);
  font-size: 15px;
  line-height: 1.5;
}

.estado-aviso {
  background: var(--aviso-fondo);
  border-color: var(--aviso-fondo);
  color: var(--observado);
}

.columnas {
  display: flex;
  gap: 32px;
  align-items: flex-start;
}

.tarjeta {
  background: var(--superficie);
  border: 1px solid var(--borde);
  border-radius: 16px;
  padding: 32px;
  display: flex;
  flex-direction: column;
  gap: 20px;
  box-sizing: border-box;
}

.tarjeta h2 {
  margin: 0;
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 22px;
  font-weight: 600;
  color: var(--cil-azul);
}

.calendario {
  flex: 0 1 560px;
  min-width: 0;
}

.horarios {
  flex: 0 1 440px;
  min-width: 0;
}

.resumen {
  flex: 1 1 280px;
  min-width: 0;
  padding: 28px;
  gap: 18px;
}

.mes {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.mes-nombre {
  font-family: var(--fuente-titulos);
  font-size: 22px;
  font-weight: 600;
  color: var(--cil-azul);
}

.boton-mes {
  width: 44px;
  height: 44px;
  border: 1px solid var(--borde);
  border-radius: 10px;
  background: var(--superficie);
  color: var(--cil-azul);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
}

.rejilla-dias {
  display: grid;
  grid-template-columns: repeat(7, minmax(0, 1fr));
  gap: 8px;
}

.dia-semana {
  text-align: center;
  font-size: 13px;
  font-weight: 700;
  color: var(--texto-suave);
}

.dia {
  height: 52px;
  border: none;
  border-radius: 10px;
  background: transparent;
  font-family: var(--fuente-texto);
  font-size: 16px;
  color: var(--dia-no-disponible);
  cursor: pointer;
}

.dia:disabled {
  cursor: default;
}

.dia.disponible {
  background: var(--avatar-fondo);
  color: var(--cil-azul);
  font-weight: 700;
}

.dia.seleccionado {
  background: var(--cil-azul);
  color: #ffffff;
  font-weight: 700;
}

.leyenda {
  display: flex;
  flex-wrap: wrap;
  gap: 20px;
  font-size: 13px;
  color: var(--texto-suave);
}

.leyenda > span {
  display: flex;
  align-items: center;
  gap: 8px;
}

.muestra {
  width: 14px;
  height: 14px;
  border-radius: 4px;
}

.muestra-disponible {
  background: var(--avatar-fondo);
}

.muestra-seleccionado {
  background: var(--cil-azul);
}

.lista-horarios {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.horario {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 60px;
  padding: 0 18px;
  border-radius: 12px;
  border: 1px solid var(--borde);
  background: var(--superficie);
  font-family: var(--fuente-texto);
  cursor: pointer;
}

.horario.elegido {
  border: 2px solid var(--cil-azul);
  background: var(--seleccion-fondo);
}

.horario.reservado {
  background: var(--reservado-fondo);
  cursor: default;
}

.horario-hora {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 16px;
  font-weight: 700;
  color: var(--cil-azul);
}

.horario.reservado .horario-hora {
  color: var(--reservado-texto);
}

.chip {
  display: inline-flex;
  align-items: center;
  padding: 4px 10px;
  border-radius: 999px;
  font-size: 13px;
  font-weight: 600;
  white-space: nowrap;
}

.chip-disponible {
  background: var(--chip-fondo);
  color: var(--cil-azul);
}

.chip-reservado {
  background: var(--inactivo-fondo);
  color: var(--inactivo);
}

.alerta {
  display: flex;
  align-items: center;
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

.datos {
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 14px;
  font-size: 15px;
}

.datos div {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.datos dt {
  font-size: 13px;
  font-weight: 700;
  color: var(--texto-suave);
  text-transform: uppercase;
  letter-spacing: 0.06em;
}

.datos dd {
  margin: 0;
  font-weight: 600;
}

.formulario {
  display: flex;
  flex-direction: column;
  gap: 18px;
}

.campo {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.campo label {
  font-size: 14px;
  font-weight: 600;
}

.obligatorio,
.error-campo {
  color: var(--observado);
}

.error-campo {
  font-size: 13px;
  font-weight: 600;
}

.campo input {
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

.campo [aria-invalid="true"] {
  border: 2px solid var(--observado);
}

.ayuda,
.nota {
  font-size: 13px;
  line-height: 1.5;
  color: var(--texto-suave);
}

.nota {
  margin: 0;
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

.boton-principal:disabled {
  opacity: 0.7;
  cursor: not-allowed;
}

.confirmacion {
  flex-direction: row;
  align-items: center;
  gap: 16px;
  max-width: 720px;
}

.confirmacion p {
  margin: 0;
  font-size: 16px;
  line-height: 1.6;
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

@media (max-width: 1100px) {
  .columnas {
    flex-wrap: wrap;
  }

  .calendario,
  .horarios,
  .resumen {
    flex: 1 1 100%;
  }
}

@media (max-width: 640px) {
  .encabezado {
    padding: 12px 16px;
    flex-wrap: wrap;
  }

  .cuerpo {
    padding: 24px 16px;
  }

  .tarjeta {
    padding: 20px;
  }

  .dia {
    height: 44px;
  }
}
</style>
