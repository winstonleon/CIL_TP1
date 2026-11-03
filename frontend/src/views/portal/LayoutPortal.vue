<!-- Estructura común de las pantallas P* con sesión (mockups P05 y P05b): encabezado con la persona, el expediente y
     «Cerrar sesión», y menú lateral con el postulante. Solo muestra lo que HU0005 necesita: «Ficha y cuestionario» y
     «Documentos» (se habilita al completar la ficha; su pantalla llega con HU0006). «Mi postulación», «Pagos» y
     «Evaluaciones» llegan con sus HU. Sin logo hasta que el colegio entregue el archivo (como G10). -->
<script setup lang="ts">
import { computed, onMounted } from "vue";
import { cerrarSesion } from "../../auth/oidc";
import { useExpedienteStore } from "../../stores/expediente";
import { useSesionStore } from "../../stores/sesion";

// Valores que entrega el colegio (mockup: «[Teléfono y correo de admisión]»).
const CONTACTO = "[Teléfono y correo de admisión]";

const sesion = useSesionStore();
const expedientes = useExpedienteStore();

const detalle = computed(() => {
  const e = expedientes.expediente;
  return e ? `Apoderado/a · Expediente ${e.codigo}` : "Apoderado/a";
});

onMounted(() => {
  void expedientes.cargar();
});

function salir() {
  void cerrarSesion("portal");
}
</script>

<template>
  <div class="portal">
    <header class="cabecera">
      <div class="marca">
        <span class="marca-nombre">Colegio Internacional de Lima</span>
        <span class="marca-area">Portal de Postulación</span>
      </div>
      <div class="persona">
        <div class="persona-datos">
          <span class="persona-nombre" data-testid="persona">{{ sesion.nombre }}</span>
          <span class="persona-detalle" data-testid="expediente-codigo">{{ detalle }}</span>
        </div>
        <button type="button" class="salir" @click="salir">Cerrar sesión</button>
      </div>
    </header>

    <div class="cuerpo">
      <nav class="menu" aria-label="Secciones de la postulación">
        <div class="postulante">
          <span class="rotulo">Postulante</span>
          <span class="postulante-nombre" data-testid="postulante-nombre">
            {{ expedientes.expediente?.postulante ?? "Aún sin registrar" }}
          </span>
          <span class="postulante-grado">{{ expedientes.expediente?.grado }}</span>
        </div>

        <div class="opciones">
          <RouterLink to="/portal/ficha" class="opcion" exact-active-class="activa">Ficha y cuestionario</RouterLink>
          <!-- Se habilita al completar la ficha (HU0005-1.0). La pantalla de carga la crea HU0006. -->
          <button
            type="button"
            class="opcion"
            data-testid="menu-documentos"
            :disabled="!expedientes.expediente?.ficha_completa"
            :aria-disabled="!expedientes.expediente?.ficha_completa"
          >
            Documentos
          </button>
        </div>

        <div class="ayuda">
          <strong>¿Necesitas ayuda?</strong>
          <span>Secretaría de Admisión</span>
          <span>{{ CONTACTO }}</span>
        </div>
      </nav>

      <main class="contenido">
        <p v-if="expedientes.estado === 'error'" class="error" role="alert">{{ expedientes.error }}</p>
        <p v-else-if="expedientes.estado === 'listo' && !expedientes.expediente" class="error" role="alert">
          No encontramos un expediente de postulación para tu cuenta. Comunícate con Secretaría de Admisión.
        </p>
        <RouterView v-else-if="expedientes.estado === 'listo'" />
      </main>
    </div>
  </div>
</template>

<style scoped>
.portal {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  background: var(--fondo);
  color: var(--texto);
}

.cabecera {
  min-height: 76px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 0 40px;
  background: var(--cil-azul);
}

.marca {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.marca-nombre {
  font-family: var(--fuente-titulos);
  font-size: 19px;
  font-weight: 700;
  color: #ffffff;
}

.marca-area {
  font-size: 13px;
  font-weight: 600;
  color: var(--cil-dorado);
}

.persona {
  display: flex;
  align-items: center;
  gap: 20px;
}

.persona-datos {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 2px;
}

.persona-nombre {
  font-size: 15px;
  font-weight: 600;
  color: #ffffff;
}

.persona-detalle {
  font-size: 13px;
  color: var(--panel-detalle);
}

.salir {
  height: 44px;
  padding: 0 16px;
  border: 1px solid #5a74a8;
  border-radius: 10px;
  background: transparent;
  color: #ffffff;
  font: inherit;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
}

.cuerpo {
  flex-grow: 1;
  display: flex;
  min-height: 0;
}

.menu {
  width: 280px;
  flex-shrink: 0;
  box-sizing: border-box;
  padding: 28px 20px;
  background: var(--superficie);
  border-right: 1px solid var(--borde);
  display: flex;
  flex-direction: column;
  gap: 24px;
}

.postulante {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 16px;
  border-radius: 12px;
  background: var(--superficie-tenue);
  border: 1px solid var(--borde);
}

.rotulo {
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--texto-suave);
}

.postulante-nombre {
  font-size: 16px;
  font-weight: 700;
}

.postulante-grado {
  font-size: 14px;
  color: var(--texto-suave);
}

.opciones {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.opcion {
  display: flex;
  align-items: center;
  height: 48px;
  padding: 0 16px;
  border: none;
  border-radius: 10px;
  background: transparent;
  font: inherit;
  font-size: 15px;
  font-weight: 500;
  color: var(--texto);
  text-align: left;
  text-decoration: none;
  cursor: pointer;
}

.opcion.activa {
  font-weight: 700;
  color: var(--cil-azul);
  background: var(--avatar-fondo);
}

.opcion:disabled {
  color: var(--texto-suave);
  cursor: not-allowed;
  opacity: 0.7;
}

.ayuda {
  margin-top: auto;
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 16px;
  border-radius: 12px;
  background: var(--chip-fondo);
  color: var(--cil-azul);
  font-size: 14px;
}

.contenido {
  flex-grow: 1;
  min-width: 0;
  box-sizing: border-box;
  padding: 32px 40px;
}

.error {
  color: var(--observado);
}

@media (max-width: 900px) {
  .cabecera {
    padding: 12px 16px;
    flex-wrap: wrap;
  }

  .cuerpo {
    flex-direction: column;
  }

  .menu {
    width: auto;
    border-right: none;
    border-bottom: 1px solid var(--borde);
  }

  .contenido {
    padding: 20px 16px;
  }
}
</style>
