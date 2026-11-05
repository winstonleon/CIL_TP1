// Estado y acciones de la revisión de una rama de documentos: la documental en G03 (Secretaría, HU0008) y la financiera en
// G05 (Tesorería, HU0011). Abrir el detalle registra atencion_inicio en la API (§4.7); después de cada decisión se vuelve
// a pedir, así la pantalla muestra lo que otra persona del mismo rol haya decidido (409 DOCUMENTO_YA_REVISADO).
import { computed, readonly, ref, shallowRef, type Ref } from "vue";
import { mensajeDe } from "../../../api/respuesta";
import {
  darConformidad,
  decidirDocumento,
  descargarDocumento,
  leerDetalle,
  type DetalleRama,
  type DocumentoRevision,
  type Rama,
} from "../../../api/validaciones";
import { abrirArchivo } from "../../../gestion/validacion";

export function useRevisionRama(rama: Rama, idExpediente: Ref<number | null>) {
  const detalle = ref<DetalleRama | null>(null);
  const carga = shallowRef<"inicio" | "cargando" | "listo" | "error">("inicio");
  const errorCarga = shallowRef("");
  const errorAccion = shallowRef("");
  const ocupado = shallowRef(false);
  const observando = ref<DocumentoRevision | null>(null);
  const aviso = shallowRef("");

  const estadoRama = computed(() => (detalle.value ? detalle.value.ramas[rama] : null));
  const decidible = computed(() => estadoRama.value !== null && estadoRama.value !== "conforme");
  // «Dar conformidad» / «Marcar conforme» solo con todos los documentos de la rama conformes (G03 y G05).
  const puedeDarConformidad = computed(
    () => decidible.value && (detalle.value?.documentos ?? []).every((d) => d.estado_verificacion === "conforme"),
  );

  async function cargar() {
    if (idExpediente.value === null) return;
    carga.value = detalle.value ? carga.value : "cargando";
    try {
      detalle.value = await leerDetalle(rama, idExpediente.value);
      carga.value = "listo";
    } catch (e) {
      errorCarga.value = mensajeDe(e);
      carga.value = "error";
    }
  }

  async function accion(fn: () => Promise<void>) {
    errorAccion.value = "";
    aviso.value = "";
    ocupado.value = true;
    try {
      await fn();
    } catch (e) {
      errorAccion.value = mensajeDe(e);
    } finally {
      ocupado.value = false;
      await cargar();
    }
  }

  const id = () => idExpediente.value!;
  const marcarConforme = (d: DocumentoRevision) => accion(() => decidirDocumento(rama, id(), d.id_documento, { decision: "conforme" }));
  const observar = (motivo: string) =>
    accion(async () => {
      const d = observando.value!;
      await decidirDocumento(rama, id(), d.id_documento, { decision: "observado", motivo });
      observando.value = null;
      aviso.value = "Se solicitó la subsanación. La familia recibirá un correo con el motivo.";
    });
  const confirmar = () =>
    accion(async () => {
      const r = await darConformidad(rama, id());
      aviso.value = r.agendamiento_habilitado
        ? "Validación registrada. Las tres validaciones están conformes: el agendamiento de evaluaciones quedó habilitado."
        : "Validación registrada como conforme.";
    });

  async function ver(d: DocumentoRevision) {
    errorAccion.value = "";
    try {
      await abrirArchivo(() => descargarDocumento(rama, id(), d.id_documento));
    } catch (e) {
      errorAccion.value = mensajeDe(e);
    }
  }

  function limpiar() {
    detalle.value = null;
    observando.value = null;
    errorAccion.value = "";
    aviso.value = "";
    carga.value = "inicio";
  }

  return {
    detalle: computed(() => detalle.value),
    carga: readonly(carga),
    errorCarga: readonly(errorCarga),
    errorAccion: readonly(errorAccion),
    aviso: readonly(aviso),
    ocupado: readonly(ocupado),
    observando,
    decidible,
    puedeDarConformidad,
    cargar,
    limpiar,
    marcarConforme,
    observar,
    confirmar,
    ver,
  };
}
