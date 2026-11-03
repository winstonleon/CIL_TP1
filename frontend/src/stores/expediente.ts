import { defineStore } from "pinia";
import { ref } from "vue";
import { listarExpedientes, type ResumenExpediente } from "../api/ficha";
import { mensajeDe } from "../api/respuesta";

// Expediente de la familia que inició sesión en el portal (HU0005). La API solo entrega los de su cuenta; hoy la familia
// tiene uno. Lo comparten el encabezado, el menú lateral y la ficha.
export const useExpedienteStore = defineStore("expediente", () => {
  const expediente = ref<ResumenExpediente | null>(null);
  const estado = ref<"cargando" | "listo" | "error">("cargando");
  const error = ref("");

  async function cargar() {
    estado.value = "cargando";
    try {
      expediente.value = (await listarExpedientes())[0] ?? null;
      estado.value = "listo";
    } catch (e) {
      error.value = mensajeDe(e);
      estado.value = "error";
    }
  }

  function actualizar(cambios: Partial<ResumenExpediente>) {
    if (expediente.value) expediente.value = { ...expediente.value, ...cambios };
  }

  return { expediente, estado, error, cargar, actualizar };
});
