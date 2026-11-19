<!-- Página de inicio (no tiene mockup en docs/ui). Separa a la familia nueva, que empieza en P01 y no necesita cuenta, de la
     que ya visitó el colegio y recibió credenciales: sin esa distinción, una familia nueva terminaría en un login sin usuario.
     Es pública (sin meta.cliente en el router) y no llama a la API: la campaña activa solo la leen los roles del personal (C23). -->
<script setup lang="ts">
import { RouterLink } from 'vue-router'

const rutas = {
  solicitud: '/solicitud-informacion',
  portal: '/portal',
  personal: '/gestion',
}

const pasos = [
  { titulo: 'Solicita información', texto: 'Recibes la carpeta informativa en tu correo.' },
  { titulo: 'Visita el colegio', texto: 'Agendas tu visita guiada en línea.' },
  { titulo: 'Postula en línea', texto: 'Completas la ficha, subes los documentos y registras el pago.' },
  { titulo: 'Recibe el resultado', texto: 'Sigues cada etapa desde el portal, sin llamar al colegio.' },
]
</script>

<template>
  <div class="inicio">
    <header class="cabecera">
      <div class="marca">
        <span class="sello" aria-hidden="true">CIL</span>
        <span class="nombre">Colegio Internacional de Lima</span>
      </div>
      <RouterLink :to="rutas.personal" class="enlace-personal">Ingreso del personal</RouterLink>
    </header>

    <main class="contenido">
      <section class="presentacion">
        <p class="antetitulo">Admisión</p>
        <h1>Postula en línea y sigue tu trámite sin llamar al colegio</h1>
        <p class="bajada">Elige por dónde empezar según la etapa en que te encuentras.</p>
      </section>

      <section class="opciones" aria-label="Por dónde empezar">
        <article class="opcion opcion--principal">
          <p class="etiqueta">¿Primera vez?</p>
          <h2>Solicita información</h2>
          <p class="descripcion">Te enviamos la carpeta informativa y podrás agendar tu visita guiada.</p>
          <RouterLink :to="rutas.solicitud" class="boton boton--primario">Solicitar información</RouterLink>
        </article>
        <article class="opcion">
          <p class="etiqueta">¿Ya visitaste el colegio?</p>
          <h2>Ingresa al portal de familias</h2>
          <p class="descripcion">Usa el usuario y la contraseña temporal que recibiste después de la visita.</p>
          <RouterLink :to="rutas.portal" class="boton boton--secundario">Ingresar al portal</RouterLink>
        </article>
      </section>

      <section class="pasos" aria-labelledby="titulo-pasos">
        <h2 id="titulo-pasos">Cómo funciona</h2>
        <ol>
          <li v-for="(paso, i) in pasos" :key="paso.titulo">
            <span class="numero" aria-hidden="true">{{ i + 1 }}</span>
            <h3>{{ paso.titulo }}</h3>
            <p>{{ paso.texto }}</p>
          </li>
        </ol>
      </section>
    </main>

    <footer class="pie">
      <p>Tus datos personales se tratan conforme a la Ley N.° 29733.</p>
    </footer>
  </div>
</template>

<style scoped>
.inicio {
  --azul: #10326e;
  --azul-oscuro: #0b2450;
  --azul-claro: #eef2f9;
  --dorado: #e9bd23;
  --amarillo: #fee05b;
  --fondo: #f6f4ef;
  --texto: #1c2433;
  --texto-suave: #4a5568;
  --borde: #e3ddd0;
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  background: var(--fondo);
  color: var(--texto);
  font-family: 'Public Sans', system-ui, sans-serif;
}

.cabecera {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 1rem;
  padding: 1rem clamp(1.25rem, 5vw, 4rem);
  background: var(--azul);
  color: #fff;
  border-bottom: 4px solid var(--dorado);
}

.marca {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}

.sello {
  display: grid;
  place-items: center;
  width: 2.5rem;
  height: 2.5rem;
  border-radius: 50%;
  background: var(--dorado);
  color: var(--azul);
  font-family: 'Fraunces', serif;
  font-weight: 700;
  font-size: 0.875rem;
}

.nombre {
  font-family: 'Fraunces', serif;
  font-size: 1.125rem;
  font-weight: 600;
}

.enlace-personal {
  color: #fff;
  font-size: 0.875rem;
  text-underline-offset: 3px;
  opacity: 0.85;
}

.enlace-personal:hover {
  opacity: 1;
}

.contenido {
  flex: 1;
  width: 100%;
  max-width: 68rem;
  margin: 0 auto;
  padding: clamp(2rem, 6vw, 4.5rem) clamp(1.25rem, 5vw, 4rem);
  box-sizing: border-box;
}

.antetitulo {
  margin: 0 0 0.5rem;
  font-size: 0.8125rem;
  font-weight: 600;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--azul);
}

h1 {
  margin: 0;
  max-width: 22ch;
  font-family: 'Fraunces', serif;
  font-size: clamp(2rem, 4.5vw, 3rem);
  line-height: 1.1;
  color: var(--azul);
}

.bajada {
  margin: 1rem 0 0;
  font-size: 1.125rem;
  color: var(--texto-suave);
}

.opciones {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(18rem, 1fr));
  gap: 1.5rem;
  margin-top: 2.5rem;
}

.opcion {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  padding: 2rem;
  background: #fff;
  border: 1px solid var(--borde);
  border-radius: 12px;
}

.opcion--principal {
  border-top: 4px solid var(--dorado);
}

.etiqueta {
  margin: 0;
  font-size: 0.875rem;
  font-weight: 600;
  color: var(--texto-suave);
}

.opcion h2 {
  margin: 0;
  font-family: 'Fraunces', serif;
  font-size: 1.5rem;
  color: var(--azul);
}

.descripcion {
  flex: 1;
  margin: 0 0 1rem;
  line-height: 1.5;
}

.boton {
  align-self: flex-start;
  padding: 0.75rem 1.25rem;
  border-radius: 8px;
  font-weight: 600;
  text-decoration: none;
  transition: background-color 0.15s;
}

.boton:focus-visible,
.enlace-personal:focus-visible {
  outline: 3px solid var(--dorado);
  outline-offset: 2px;
}

.boton--primario {
  background: var(--azul);
  color: #fff;
}

.boton--primario:hover {
  background: var(--azul-oscuro);
}

.boton--secundario {
  border: 2px solid var(--azul);
  color: var(--azul);
}

.boton--secundario:hover {
  background: var(--azul-claro);
}

.pasos {
  margin-top: 3.5rem;
}

.pasos h2 {
  margin: 0 0 1.25rem;
  font-family: 'Fraunces', serif;
  font-size: 1.25rem;
  color: var(--azul);
}

.pasos ol {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(13rem, 1fr));
  gap: 1.25rem;
  margin: 0;
  padding: 0;
  list-style: none;
}

.pasos li {
  padding-top: 1rem;
  border-top: 2px solid var(--borde);
}

.numero {
  display: inline-grid;
  place-items: center;
  width: 1.75rem;
  height: 1.75rem;
  border-radius: 50%;
  background: var(--amarillo);
  color: var(--azul);
  font-weight: 700;
  font-size: 0.875rem;
}

.pasos h3 {
  margin: 0.75rem 0 0.25rem;
  font-size: 1rem;
}

.pasos p {
  margin: 0;
  font-size: 0.9375rem;
  line-height: 1.5;
  color: var(--texto-suave);
}

.pie {
  padding: 1.5rem clamp(1.25rem, 5vw, 4rem);
  border-top: 1px solid var(--borde);
  font-size: 0.8125rem;
  color: var(--texto-suave);
}

.pie p {
  margin: 0;
}

@media (max-width: 40rem) {
  .nombre {
    font-size: 1rem;
  }

  .opcion {
    padding: 1.5rem;
  }
}
</style>
