<!-- P06 · Documentos del expediente (HU0006). Implementa docs/ui/P06-Documentos.dc.html: los requisitos del grado (R7) en
     secciones, cada uno con sus archivos, el estado de revisión con los nombres del mockup y «Confirmar documentos».
     - Cada archivo se sube asociado a su requisito (y a su apoderado, si el requisito es por apoderado). Un requisito admite
       varios archivos; «Reemplazar» deja el anterior como historial (vigente = false).
     - HU0006-2.0: un archivo que no es PDF, JPG o PNG, o que pasa de 10 MB, se rechaza resaltando el requisito con el aviso.
       La comprobación previa es una comodidad: la API vuelve a validar (413 y 415).
     - «Confirmar documentos» solicita la verificación de completitud (HU0017); no cambia el estado del expediente.
     - El mockup muestra «Condición laboral declarada en la ficha» y «Editar en la ficha»: la ficha completa queda en solo
       lectura (ADR-20) y reabrirla no lo define ninguna HU del bloque, así que esa franja no se muestra. -->
<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import {
  confirmarDocumentos,
  descargarDocumento,
  listarDocumentos,
  subirDocumento,
  type DocumentoCargado,
  type ListaDocumentos,
  type RequisitoConDocumentos,
} from "../../api/documentos";
import { ErrorApi, mensajeDe } from "../../api/respuesta";
import { fechaCorta, fechaHora, tamano } from "../../portal/formato";
import { MENSAJE_ARCHIVO, validarArchivo } from "../../portal/validarArchivo";
import { useExpedienteStore } from "../../stores/expediente";

const SECCIONES = [
  { categoria: "postulante_y_padres", titulo: "Postulante y padres" },
  { categoria: "colegio_procedencia", titulo: "Colegio de procedencia" },
  { categoria: "condicion_especial", titulo: "Condición especial" },
  { categoria: "financiero", titulo: "Documentación financiera de los padres" },
];
const ESTADOS = {
  pendiente: { texto: "En revisión", clase: "revision" },
  en_revision: { texto: "En revisión", clase: "revision" },
  conforme: { texto: "Conforme", clase: "conforme" },
  observado: { texto: "Observado", clase: "observado" },
} as const;

const expedientes = useExpedienteStore();
const idExpediente = expedientes.expediente!.id_expediente;

const lista = ref<ListaDocumentos | null>(null);
const carga = ref<"cargando" | "listo" | "error">("cargando");
const errorCarga = ref("");
const fichaIncompleta = ref(false);
const errores = ref<Record<string, string>>({});
const ocupados = ref<Record<string, boolean>>({});
const confirmando = ref(false);
const errorConfirmacion = ref("");

const claveDe = (r: RequisitoConDocumentos) => `${r.id_requisito}-${r.id_apoderado ?? 0}`;
const etiqueta = (r: RequisitoConDocumentos) => (r.por_apoderado && r.apoderado ? `${r.tipo_documento} — ${r.apoderado}` : r.tipo_documento);

function estadoDe(r: RequisitoConDocumentos) {
  const estados = r.documentos.map((d) => d.estado_verificacion);
  if (estados.length === 0) return { texto: "Pendiente", clase: "pendiente" };
  if (estados.includes("observado")) return ESTADOS.observado;
  return estados.every((e) => e === "conforme") ? ESTADOS.conforme : ESTADOS.pendiente;
}

const secciones = computed(() =>
  SECCIONES.map((s) => {
    const requisitos = (lista.value?.requisitos ?? []).filter((r) => r.categoria === s.categoria);
    const conformes = requisitos.filter((r) => estadoDe(r).clase === "conforme").length;
    return { ...s, requisitos, conformes };
  }).filter((s) => s.requisitos.length > 0),
);
const editable = computed(() => lista.value?.editable ?? false);

async function cargar() {
  carga.value = "cargando";
  try {
    lista.value = await listarDocumentos(idExpediente);
    carga.value = "listo";
  } catch (e) {
    fichaIncompleta.value = e instanceof ErrorApi && e.codigo === "FICHA_INCOMPLETA";
    errorCarga.value = mensajeDe(e);
    carga.value = "error";
  }
}

async function recargar() {
  try {
    lista.value = await listarDocumentos(idExpediente);
  } catch {
    // La lista anterior sigue en pantalla; el error de la carga ya se mostró.
  }
}

// Sube los archivos elegidos (o soltados) de un requisito, de uno en uno. El primero que falla detiene el resto.
async function subir(r: RequisitoConDocumentos, archivos: File[], reemplaza?: number) {
  const clave = claveDe(r);
  errores.value = { ...errores.value, [clave]: "" };
  ocupados.value = { ...ocupados.value, [clave]: true };
  try {
    for (const archivo of archivos) {
      const problema = await validarArchivo(archivo);
      if (problema) {
        errores.value = { ...errores.value, [clave]: problema };
        return;
      }
      try {
        await subirDocumento(idExpediente, { id_requisito: r.id_requisito, id_apoderado: r.id_apoderado, reemplaza }, archivo);
      } catch (e) {
        const rechazado = e instanceof ErrorApi && (e.status === 413 || e.status === 415);
        errores.value = { ...errores.value, [clave]: rechazado ? MENSAJE_ARCHIVO : mensajeDe(e) };
        return;
      }
      await recargar();
    }
  } finally {
    ocupados.value = { ...ocupados.value, [clave]: false };
  }
}

function alElegir(r: RequisitoConDocumentos, evento: Event, reemplaza?: number) {
  const entrada = evento.target as HTMLInputElement;
  const archivos = Array.from(entrada.files ?? []);
  entrada.value = ""; // permite elegir el mismo archivo otra vez después de corregirlo
  if (archivos.length) void subir(r, archivos, reemplaza);
}

function alSoltar(r: RequisitoConDocumentos, evento: DragEvent) {
  if (editable.value) void subir(r, Array.from(evento.dataTransfer?.files ?? []));
}

async function ver(r: RequisitoConDocumentos, d: DocumentoCargado) {
  const clave = claveDe(r);
  // La ventana se abre en el gesto del clic: después de esperar la descarga, el navegador la bloquearía.
  const ventana = window.open("about:blank", "_blank");
  try {
    const contenido = await descargarDocumento(idExpediente, d.id_documento);
    const url = URL.createObjectURL(contenido);
    if (ventana) ventana.location.href = url;
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  } catch (e) {
    ventana?.close();
    errores.value = { ...errores.value, [clave]: mensajeDe(e) };
  }
}

async function confirmar() {
  errorConfirmacion.value = "";
  confirmando.value = true;
  try {
    const { confirmado_en } = await confirmarDocumentos(idExpediente);
    if (lista.value) lista.value = { ...lista.value, confirmado_en };
  } catch (e) {
    errorConfirmacion.value = mensajeDe(e);
  } finally {
    confirmando.value = false;
  }
}

onMounted(cargar);
</script>

<template>
  <section class="documentos">
    <header class="titulo">
      <h1>Documentos del expediente</h1>
      <p>La lista se ajusta al grado y a lo que declaraste en la ficha.</p>
    </header>

    <p v-if="carga === 'cargando'" class="suave" role="status">Cargando documentos…</p>
    <div v-else-if="carga === 'error'" class="aviso" role="alert" data-testid="error-carga">
      <p>{{ fichaIncompleta ? "Completa la ficha para cargar los documentos." : errorCarga }}</p>
      <RouterLink v-if="fichaIncompleta" to="/portal/ficha">Ir a la ficha</RouterLink>
      <button v-else type="button" class="boton secundario" @click="cargar">Reintentar</button>
    </div>

    <template v-else-if="lista">
      <p v-if="!editable" class="aviso" role="status" data-testid="no-editable">
        Los documentos no se pueden modificar en el estado actual de tu expediente.
      </p>
      <p v-if="lista.requisitos.length === 0" class="suave">Por ahora el colegio no ha configurado documentos para este grado.</p>

      <div class="rejilla">
        <section v-for="s in secciones" :key="s.categoria" class="tarjeta" :data-testid="`seccion-${s.categoria}`">
          <div class="tarjeta-cabecera">
            <h2>{{ s.titulo }}</h2>
            <span v-if="s.categoria === 'financiero'" class="chip inactivo">Solo la revisa Tesorería</span>
            <span v-else class="chip">{{ s.conformes }} de {{ s.requisitos.length }} conformes</span>
          </div>

          <ul class="requisitos">
            <li
              v-for="r in s.requisitos"
              :key="claveDe(r)"
              class="requisito"
              :class="{ invalido: errores[claveDe(r)] }"
              :data-testid="`requisito-${claveDe(r)}`"
              @dragover.prevent
              @drop.prevent="alSoltar(r, $event)"
            >
              <div class="requisito-cabecera">
                <div class="requisito-nombre">
                  <span class="nombre">{{ etiqueta(r) }}<span v-if="!r.obligatorio" class="suave"> (opcional)</span></span>
                </div>
                <span class="estado" :class="estadoDe(r).clase">{{ estadoDe(r).texto }}</span>
              </div>

              <ul v-if="r.documentos.length" class="archivos">
                <li v-for="(d, i) in r.documentos" :key="d.id_documento" class="archivo">
                  <span class="archivo-datos">
                    Archivo {{ i + 1 }} · {{ d.formato.toUpperCase() }} · {{ tamano(d.tamano_kb) }} · {{ fechaCorta(d.fecha_carga) }}
                  </span>
                  <span class="archivo-estado" :class="ESTADOS[d.estado_verificacion].clase">{{ ESTADOS[d.estado_verificacion].texto }}</span>
                  <button type="button" class="icono" :aria-label="`Ver ${etiqueta(r)}`" @click="ver(r, d)">Ver</button>
                  <label v-if="editable" class="boton secundario pequeno">
                    Reemplazar
                    <input
                      type="file"
                      class="solo-lector"
                      accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png"
                      :data-testid="`reemplazo-${d.id_documento}`"
                      :disabled="ocupados[claveDe(r)]"
                      @change="alElegir(r, $event, d.id_documento)"
                    />
                  </label>
                </li>
              </ul>

              <div v-if="editable" class="subida">
                <label class="boton primario pequeno">
                  {{ r.documentos.length ? "Agregar otro archivo" : "Subir archivo" }}
                  <input
                    type="file"
                    class="solo-lector"
                    accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png"
                    multiple
                    :data-testid="`archivo-${claveDe(r)}`"
                    :disabled="ocupados[claveDe(r)]"
                    @change="alElegir(r, $event)"
                  />
                </label>
                <span v-if="ocupados[claveDe(r)]" class="suave" role="status">Subiendo…</span>
              </div>
              <p v-if="errores[claveDe(r)]" class="mensaje" role="alert" :data-testid="`error-${claveDe(r)}`">{{ errores[claveDe(r)] }}</p>
            </li>
          </ul>
        </section>
      </div>

      <footer class="pie">
        <p class="suave">Arrastra tus archivos al documento que corresponde o selecciónalos. PDF, JPG o PNG de hasta 10 MB por archivo. La ficha y el cuestionario se completan en línea, no se suben.</p>
        <p v-if="lista.confirmado_en" class="confirmado" role="status" data-testid="confirmado">
          Confirmaste tus documentos el {{ fechaHora(lista.confirmado_en) }}. Se verificará que el expediente esté completo.
        </p>
        <p v-if="errorConfirmacion" class="mensaje" role="alert">{{ errorConfirmacion }}</p>
        <button v-if="editable" type="button" class="boton primario" :disabled="confirmando" @click="confirmar">Confirmar documentos</button>
      </footer>
    </template>
  </section>
</template>

<style scoped>
.documentos {
  display: flex;
  flex-direction: column;
  gap: 24px;
  max-width: 1200px;
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

.rejilla {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 24px;
  align-items: start;
}

.tarjeta {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 28px;
  background: var(--superficie);
  border: 1px solid var(--borde);
  border-radius: 16px;
}

.tarjeta-cabecera {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.tarjeta-cabecera h2 {
  margin: 0;
  font-size: 22px;
  color: var(--cil-azul);
}

.chip {
  padding: 4px 10px;
  border-radius: 999px;
  background: var(--chip-fondo);
  color: var(--cil-azul);
  font-size: 13px;
  font-weight: 600;
  white-space: nowrap;
}

.chip.inactivo {
  background: var(--inactivo-fondo);
  color: var(--inactivo);
}

.requisitos,
.archivos {
  margin: 0;
  padding: 0;
  list-style: none;
}

.requisito {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 14px 0;
  border-top: 1px solid var(--borde);
}

.requisito.invalido {
  border-left: 3px solid var(--observado);
  padding-left: 12px;
}

.requisito-cabecera {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.nombre {
  font-size: 15px;
  font-weight: 600;
}

.estado,
.archivo-estado {
  padding: 4px 10px;
  border-radius: 999px;
  font-size: 13px;
  font-weight: 600;
  white-space: nowrap;
}

.estado.conforme,
.archivo-estado.conforme {
  background: var(--conforme-fondo);
  color: var(--conforme);
}

.estado.observado,
.archivo-estado.observado {
  background: var(--aviso-fondo);
  color: var(--observado);
}

.estado.revision,
.archivo-estado.revision {
  background: var(--chip-fondo);
  color: var(--cil-azul);
}

.estado.pendiente {
  background: var(--inactivo-fondo);
  color: var(--inactivo);
}

.archivos {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.archivo {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 10px;
}

.archivo-datos {
  flex-grow: 1;
  font-size: 13px;
  color: var(--texto-suave);
}

.subida {
  display: flex;
  align-items: center;
  gap: 12px;
}

.mensaje {
  margin: 0;
  font-size: 14px;
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

.boton,
.icono {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  box-sizing: border-box;
  height: 46px;
  padding: 0 22px;
  border-radius: 10px;
  font: inherit;
  font-size: 15px;
  font-weight: 600;
  cursor: pointer;
}

.boton.pequeno {
  height: 40px;
  padding: 0 16px;
  font-size: 14px;
}

.boton.primario {
  background: var(--cil-azul);
  color: #ffffff;
  border: 1px solid var(--cil-azul);
}

.boton.secundario,
.icono {
  background: var(--superficie);
  color: var(--cil-azul);
  border: 1px solid var(--borde);
}

.icono {
  height: 40px;
  padding: 0 14px;
  font-size: 14px;
}

.boton:has(input:focus-visible),
.boton:focus-visible,
.icono:focus-visible {
  outline: 3px solid var(--cil-dorado);
  outline-offset: 2px;
}

.boton:has(input:disabled),
.boton:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.pie {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 12px;
  padding: 20px 24px;
  border: 1px dashed var(--borde-campo);
  border-radius: 16px;
  background: var(--superficie-tenue);
}

.pie p {
  margin: 0;
}

.confirmado {
  color: var(--conforme);
  font-weight: 600;
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
