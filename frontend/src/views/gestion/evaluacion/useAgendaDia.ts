// Agenda del día de G06 y G11: la fecha elegida (hoy en Lima al abrir), sus citas y la cita abierta. Abrir una cita la pide
// a la API, que registra atencion_inicio si espera el resultado (ADR-05).
import { readonly, ref, shallowRef, watch } from "vue";
import { leerAgenda, leerCita, type AgendaDia, type AreaEvaluacion, type DetalleCita } from "../../../api/dictamen";
import { mensajeDe } from "../../../api/respuesta";
import { sumarDias } from "../../../gestion/dictamen";
import { hoyEnLima } from "../../../portal/formato";

export function useAgendaDia(area: AreaEvaluacion) {
  const fecha = shallowRef(hoyEnLima());
  const agenda = ref<AgendaDia | null>(null);
  const error = shallowRef("");
  const cita = ref<DetalleCita | null>(null);
  const errorCita = shallowRef("");

  async function cargar() {
    error.value = "";
    try {
      agenda.value = await leerAgenda(area, fecha.value);
    } catch (e) {
      error.value = mensajeDe(e);
    }
  }

  async function abrir(idCita: number) {
    errorCita.value = "";
    try {
      cita.value = await leerCita(area, idCita);
    } catch (e) {
      cita.value = null;
      errorCita.value = mensajeDe(e);
    }
  }

  // Después de registrar: la agenda y la cita abierta muestran el estado nuevo.
  async function refrescar() {
    await cargar();
    if (cita.value) await abrir(cita.value.id_cita);
  }

  const moverDia = (n: number) => {
    fecha.value = sumarDias(fecha.value, n);
    cita.value = null;
  };

  watch(fecha, cargar, { immediate: true });

  return { fecha, agenda: readonly(agenda), error: readonly(error), cita: readonly(cita), errorCita: readonly(errorCita), abrir, cargar, refrescar, moverDia };
}
