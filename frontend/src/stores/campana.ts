// Campaña activa de la gestión interna (C23): la pide una vez por sesión a GET /campana-activa.
// Si la API no responde, queda en null y la pantalla muestra solo «CIL»; el siguiente intento vuelve a pedirla.
import { defineStore } from "pinia";
import { ref } from "vue";
import { obtenerCampanaActiva } from "../api/configuracion";

export const useCampanaStore = defineStore("campana", () => {
  const campana = ref<string | null>(null);
  let pedido: Promise<void> | null = null;

  function cargar(): Promise<void> {
    pedido ??= obtenerCampanaActiva()
      .then((c) => {
        campana.value = c;
      })
      .catch(() => {
        pedido = null;
      });
    return pedido;
  }

  return { campana, cargar };
});
