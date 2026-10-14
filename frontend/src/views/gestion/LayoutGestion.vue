<!-- Estructura común de las pantallas G* (mockup G10): barra lateral con solo las opciones del rol de la sesión,
     encabezado con el área, el título de la pantalla, la persona y «Cerrar sesión». Sin logo hasta que el colegio
     entregue el archivo (plan HU0021, P5). -->
<script setup lang="ts">
import { computed } from "vue";
import { useRoute } from "vue-router";
import { cerrarSesion } from "../../auth/oidc";
import { AREA_ROL, MENU, rolPersonalDe } from "../../gestion/menu";
import { useSesionStore } from "../../stores/sesion";

const sesion = useSesionStore();
const ruta = useRoute();

const rol = computed(() => rolPersonalDe(sesion.roles));
const area = computed(() => (rol.value ? AREA_ROL[rol.value] : "Gestión interna"));
const opciones = computed(() => (rol.value ? MENU[rol.value] : []));
const titulo = computed(() => ruta.meta.titulo ?? "");
const iniciales = computed(() =>
  sesion.nombre
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((parte) => parte[0]!.toUpperCase())
    .join(""),
);

function salir() {
  void cerrarSesion("gestion");
}
</script>

<template>
  <div class="gestion">
    <nav class="barra" :aria-label="`Menú de ${area}`">
      <div class="marca">
        <span class="marca-nombre">Gestión de Admisión</span>
        <span class="marca-campana">CIL · Campaña 2027</span>
      </div>

      <div class="opciones" data-testid="menu-rol">
        <span class="seccion">{{ area }}</span>
        <template v-for="opcion in opciones" :key="opcion.etiqueta">
          <RouterLink v-if="opcion.ruta" :to="opcion.ruta" class="opcion" exact-active-class="activa">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9"
              stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" v-html="opcion.icono" />
            {{ opcion.etiqueta }}
          </RouterLink>
          <!-- Pantalla todavía no implementada (llega con su HU): visible pero no navegable. -->
          <span v-else class="opcion" aria-disabled="true">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9"
              stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" v-html="opcion.icono" />
            {{ opcion.etiqueta }}
          </span>
        </template>
      </div>

      <div class="pie">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--cil-dorado)" stroke-width="2"
          stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <rect x="5" y="11" width="14" height="9" rx="2" />
          <path d="M8 11V8a4 4 0 0 1 8 0v3" />
        </svg>
        <span>Solo ves las opciones de tu rol.</span>
      </div>
    </nav>

    <div class="cuerpo">
      <header class="encabezado">
        <div class="titulos">
          <span class="area">{{ area }}</span>
          <span class="titulo" data-testid="titulo-pantalla">{{ titulo }}</span>
        </div>
        <div class="persona">
          <div class="persona-datos">
            <span class="persona-nombre" data-testid="nombre-sesion">{{ sesion.nombre }}</span>
            <span class="persona-rol">{{ area }}</span>
          </div>
          <span class="avatar" aria-hidden="true">{{ iniciales }}</span>
          <button type="button" class="salir" aria-label="Cerrar sesión" @click="salir">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--cil-azul)" stroke-width="1.8"
              stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3" />
              <path d="M10 16l-4-4 4-4" />
              <path d="M6 12h10" />
            </svg>
          </button>
        </div>
      </header>

      <main class="contenido">
        <RouterView />
      </main>
    </div>
  </div>
</template>

<style scoped>
.gestion {
  display: flex;
  min-height: 100vh;
  background: var(--fondo);
}

.barra {
  width: 272px;
  flex-shrink: 0;
  box-sizing: border-box;
  padding: 24px 18px;
  background: var(--cil-azul);
  display: flex;
  flex-direction: column;
  gap: 28px;
}

.marca {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.marca-nombre {
  font-family: var(--fuente-titulos);
  font-size: 17px;
  font-weight: 700;
  color: #ffffff;
}

.marca-campana {
  font-size: 13px;
  font-weight: 600;
  color: var(--cil-dorado);
}

.opciones {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.seccion {
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--nav-seccion);
  padding: 0 14px 6px;
}

.opcion {
  display: flex;
  align-items: center;
  gap: 12px;
  min-height: 48px;
  padding: 0 14px;
  border-radius: 10px;
  text-decoration: none;
  font-size: 15px;
  font-weight: 500;
  color: var(--nav-texto);
}

.opcion svg {
  color: var(--nav-icono);
  flex-shrink: 0;
}

a.opcion:hover {
  color: #ffffff;
  background: var(--nav-pie-fondo);
}

.opcion[aria-disabled="true"] {
  cursor: default;
}

.opcion.activa {
  font-weight: 700;
  color: var(--cil-azul);
  background: var(--cil-dorado);
}

.opcion.activa svg {
  color: var(--cil-azul);
}

.pie {
  margin-top: auto;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 14px;
  border-radius: 12px;
  background: var(--nav-pie-fondo);
  font-size: 13px;
  line-height: 1.5;
  color: var(--nav-pie-texto);
}

.cuerpo {
  flex-grow: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.encabezado {
  min-height: 76px;
  box-sizing: border-box;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 0 40px;
  background: var(--superficie);
  border-bottom: 1px solid var(--borde);
}

.titulos {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.area,
.persona-rol {
  font-size: 13px;
  color: var(--texto-suave);
}

.titulo {
  font-family: var(--fuente-titulos);
  font-size: 22px;
  font-weight: 700;
  color: var(--cil-azul);
}

.persona {
  display: flex;
  align-items: center;
  gap: 16px;
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
}

.avatar {
  width: 44px;
  height: 44px;
  border-radius: 50%;
  background: var(--avatar-fondo);
  color: var(--cil-azul);
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: 700;
}

.salir {
  width: 44px;
  height: 44px;
  border: 1px solid var(--borde);
  border-radius: 10px;
  background: var(--superficie);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
}

.contenido {
  flex-grow: 1;
  box-sizing: border-box;
  padding: 32px 40px;
}

@media (max-width: 900px) {
  .gestion {
    flex-direction: column;
  }

  .barra {
    width: auto;
    gap: 16px;
  }

  .pie {
    margin-top: 0;
  }

  .encabezado,
  .contenido {
    padding-left: 16px;
    padding-right: 16px;
  }

  .persona-datos {
    display: none;
  }
}
</style>
