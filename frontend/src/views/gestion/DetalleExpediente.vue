<!-- G03 · Detalle del expediente y validación documental (Secretaría, HU0008). Implementa docs/ui/G03-Expediente.dc.html:
     encabezado con el estado de las tres ramas, los documentos no financieros por sección (R2: la API no envía los
     financieros, C17), «Conforme» / «Observar» por documento, «Dar conformidad al expediente» con todos conformes y el panel
     «Observar documento» con el motivo y «Solicitar subsanación» (HU0008-2.0).
     Desvíos del mockup: las pestañas Ficha y cuestionario, Pagos, Citas e Historial no tienen HU (C53): se ven
     deshabilitadas y no hacen nada; el panel no tiene vista previa del archivo (se abre con «Ver») y su nota no menciona WhatsApp (C30).
     Además del mockup: el aviso «Las tres validaciones están conformes…» muestra el resultado de HU0008-1.0 (B1). -->
<script setup lang="ts">
import { computed, onMounted, shallowRef } from "vue";
import { RouterLink, useRoute } from "vue-router";
import type { DocumentoRevision } from "../../api/validaciones";
import { chipsRamas, nombreCompleto } from "../../gestion/validacion";
import { telefonoVisible } from "../../gestion/telefono";
import ListaRevision from "./validacion/ListaRevision.vue";
import PanelObservacion from "./validacion/PanelObservacion.vue";
import { useRevisionRama } from "./validacion/useRevisionRama";

// Solo «Documentos» tiene HU en este bloque; las demás no tienen HU asignada en el backlog (C53).
const PESTANAS: { texto: string; disponible?: string }[] = [
  { texto: "Documentos" },
  { texto: "Ficha y cuestionario", disponible: "Disponible en una HU posterior" },
  { texto: "Pagos", disponible: "Disponible en una HU posterior" },
  { texto: "Citas", disponible: "Disponible en una HU posterior" },
  { texto: "Historial", disponible: "Disponible en una HU posterior" },
];

const ruta = useRoute();
const idExpediente = shallowRef<number | null>(Number(ruta.params.id) || null);
const r = useRevisionRama("documental", idExpediente);

const chips = computed(() => (r.detalle.value ? chipsRamas(r.detalle.value.ramas) : []));
const subtitulo = computed(() => {
  const d = r.detalle.value;
  if (!d) return "";
  const telefono = d.apoderado.telefono ? ` · ${telefonoVisible(d.apoderado.telefono)}` : "";
  return `${d.codigo} · ${d.grado} · Apoderado(a): ${nombreCompleto(d.apoderado)}${telefono}`;
});
const nombreObservado = computed(() => {
  const d = r.observando.value;
  return d ? (d.parentesco ? `${d.tipo_documento} (${d.parentesco})` : d.tipo_documento) : "";
});

const abrirObservacion = (d: DocumentoRevision) => (r.observando.value = d);

onMounted(r.cargar);
</script>

<template>
  <div class="g03">
    <RouterLink to="/gestion/bandeja" class="volver">‹ Bandeja de expedientes</RouterLink>

    <p v-if="r.carga.value === 'cargando'" class="suave" role="status">Cargando expediente…</p>
    <p v-else-if="r.carga.value === 'error'" class="mensaje" role="alert" data-testid="error-carga">{{ r.errorCarga.value }}</p>

    <template v-else-if="r.detalle.value">
      <section class="tarjeta encabezado">
        <div class="identidad">
          <h1 class="postulante">{{ nombreCompleto(r.detalle.value.postulante) }}</h1>
          <span class="datos">{{ subtitulo }}</span>
        </div>
        <div class="chips" data-testid="chips-ramas">
          <span v-for="c in chips" :key="c.texto" class="chip" :class="c.tono">{{ c.texto }}</span>
        </div>
        <div class="pestanas" role="tablist">
          <button
            v-for="(p, i) in PESTANAS"
            :key="p.texto"
            type="button"
            role="tab"
            class="pestana"
            :class="{ deshabilitada: p.disponible }"
            :aria-selected="i === 0"
            :aria-disabled="p.disponible ? 'true' : undefined"
            :title="p.disponible"
            :data-testid="`pestana-${i}`"
          >
            {{ p.texto }}
          </button>
        </div>
      </section>

      <p v-if="r.detalle.value.agendamiento_habilitado" class="habilitado" role="status" data-testid="agendamiento-habilitado">
        Las tres validaciones están conformes: el agendamiento de evaluaciones está habilitado.
      </p>
      <p v-if="r.aviso.value" class="exito" role="status" data-testid="aviso">{{ r.aviso.value }}</p>
      <p v-if="r.errorAccion.value" class="mensaje" role="alert" data-testid="error-accion">{{ r.errorAccion.value }}</p>

      <div class="columnas">
        <section class="tarjeta documentos">
          <ListaRevision
            :documentos="r.detalle.value.documentos"
            :decidible="r.decidible.value"
            :ocupado="r.ocupado.value"
            :seleccionado="r.observando.value?.id_documento ?? null"
            con-titulos
            @ver="r.ver"
            @conforme="r.marcarConforme"
            @observar="abrirObservacion"
          />
          <div class="restringido" data-testid="nota-restringida">
            La documentación financiera y el informe psicopedagógico no se muestran a Secretaría: los revisan Tesorería y
            Psicología (acceso restringido por rol).
          </div>
          <div class="pie">
            <button
              v-if="r.decidible.value"
              type="button"
              class="boton primario grande"
              :disabled="!r.puedeDarConformidad.value || r.ocupado.value"
              data-testid="dar-conformidad"
              @click="r.confirmar"
            >
              Dar conformidad al expediente
            </button>
          </div>
        </section>

        <PanelObservacion
          v-if="r.observando.value"
          id="g03-observar"
          :key="r.observando.value.id_documento"
          class="lateral"
          titulo="Observar documento"
          :item="nombreObservado"
          boton="Solicitar subsanación"
          nota="La familia recibe un correo con un enlace para corregir solo este documento."
          :ocupado="r.ocupado.value"
          @enviar="r.observar"
          @cancelar="r.observando.value = null"
        />
      </div>
    </template>
  </div>
</template>

<style scoped src="./validacion/validacion.css"></style>

<style scoped>
.g03 {
  display: flex;
  flex-direction: column;
  gap: 24px;
}

.volver {
  font-size: 14px;
  font-weight: 600;
}

.encabezado {
  gap: 18px;
}

.identidad {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.postulante {
  margin: 0;
  font-size: 26px;
  font-weight: 700;
  color: var(--cil-azul);
}

.datos {
  font-size: 15px;
  color: var(--texto-suave);
}

.chips {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.columnas {
  display: flex;
  gap: 24px;
  align-items: flex-start;
}

.documentos {
  flex: 1 1 auto;
  padding: 28px;
}

.lateral {
  flex: 0 0 380px;
}

.restringido {
  padding: 14px 16px;
  border-radius: 12px;
  background: var(--chip-fondo);
  color: var(--cil-azul);
  font-size: 15px;
  line-height: 1.5;
}

.pie {
  display: flex;
  justify-content: flex-end;
}

.habilitado,
.exito {
  margin: 0;
  padding: 12px 16px;
  border-radius: 12px;
  background: var(--conforme-fondo);
  color: var(--conforme);
  font-weight: 600;
}

@media (max-width: 1024px) {
  .columnas {
    flex-direction: column;
  }

  .lateral {
    flex-basis: auto;
    width: 100%;
  }
}
</style>
