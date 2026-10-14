<!-- G10 · Usuarios y roles (Directora): alta (HU0021-1.0), modificación (3.0) y desactivación (4.0) de las cuentas
     del personal, y la matriz «Permisos por rol». Sin «Último acceso» (brecha del backlog, C20) ni «Reactivar»
     (C21). Los textos de edición y del diálogo de confirmación los aprobó el equipo (plan HU0021, Q3). -->
<script setup lang="ts">
import { computed, nextTick, onMounted, reactive, ref } from "vue";
import {
  crearCuenta,
  desactivarCuenta,
  ErrorApi,
  listarCuentas,
  modificarCuenta,
  obtenerPolitica,
  type CuentaPersonal,
} from "../../api/personal";
import {
  COLUMNAS_PERMISOS,
  ETIQUETA_ROL,
  matrizPermisos,
  ROLES_PERSONAL,
  type PoliticaRestringida,
  type RolPersonal,
} from "../../gestion/menu";

type Campo = "nombres" | "apellidos" | "correo" | "rol";

const cuentas = ref<CuentaPersonal[]>([]);
const politica = ref<PoliticaRestringida | null>(null);
const errorCarga = ref("");

const formulario = reactive<{ nombres: string; apellidos: string; correo: string; rol: RolPersonal | "" }>({
  nombres: "",
  apellidos: "",
  correo: "",
  rol: "",
});
const errores = ref<Partial<Record<Campo, string>>>({});
const enEdicion = ref<CuentaPersonal | null>(null);
const enviando = ref(false);
const aviso = ref("");
const errorEnvio = ref("");

const porDesactivar = ref<CuentaPersonal | null>(null);
const desactivando = ref(false);
const botonCancelarDialogo = ref<HTMLButtonElement | null>(null);

const matriz = computed(() => (politica.value ? matrizPermisos(politica.value) : []));
const nombreCompleto = (c: CuentaPersonal) => `${c.nombres} ${c.apellidos}`;

function mensajeDe(e: unknown): string {
  return e instanceof ErrorApi ? e.message : "No se pudo conectar con el servidor. Vuelve a intentarlo.";
}

onMounted(async () => {
  try {
    const [lista, permisos] = await Promise.all([listarCuentas(), obtenerPolitica()]);
    cuentas.value = lista;
    politica.value = permisos;
  } catch (e) {
    errorCarga.value = mensajeDe(e);
  }
});

const CORREO_VALIDO = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function validar(): boolean {
  const e: Partial<Record<Campo, string>> = {};
  if (!formulario.nombres.trim()) e.nombres = "Este campo es obligatorio.";
  if (!formulario.apellidos.trim()) e.apellidos = "Este campo es obligatorio.";
  if (!enEdicion.value) {
    if (!formulario.correo.trim()) e.correo = "Este campo es obligatorio.";
    else if (!CORREO_VALIDO.test(formulario.correo.trim())) e.correo = "Ingresa un correo válido.";
  }
  if (!formulario.rol) e.rol = "Selecciona un rol.";
  errores.value = e;
  return Object.keys(e).length === 0;
}

function limpiarFormulario() {
  Object.assign(formulario, { nombres: "", apellidos: "", correo: "", rol: "" });
  errores.value = {};
}

function reemplazar(cuenta: CuentaPersonal) {
  cuentas.value = cuentas.value.map((c) => (c.id_personal === cuenta.id_personal ? cuenta : c));
}

function editar(cuenta: CuentaPersonal) {
  enEdicion.value = cuenta;
  Object.assign(formulario, { nombres: cuenta.nombres, apellidos: cuenta.apellidos, correo: cuenta.correo, rol: cuenta.rol });
  errores.value = {};
  aviso.value = "";
  errorEnvio.value = "";
}

function cancelarEdicion() {
  enEdicion.value = null;
  limpiarFormulario();
}

async function enviar() {
  aviso.value = "";
  errorEnvio.value = "";
  if (!validar() || !formulario.rol) return;
  enviando.value = true;
  try {
    if (enEdicion.value) {
      // HU0021-3.0: nombres, apellidos y rol; el correo no se modifica.
      const actualizada = await modificarCuenta(enEdicion.value.id_personal, {
        nombres: formulario.nombres.trim(),
        apellidos: formulario.apellidos.trim(),
        rol: formulario.rol,
      });
      reemplazar(actualizada);
      cancelarEdicion();
      aviso.value = "Cambios guardados.";
    } else {
      // HU0021-1.0: Keycloak envía el enlace para definir la contraseña.
      const nueva = await crearCuenta({
        nombres: formulario.nombres.trim(),
        apellidos: formulario.apellidos.trim(),
        correo: formulario.correo.trim(),
        rol: formulario.rol,
      });
      cuentas.value = [...cuentas.value, nueva];
      limpiarFormulario();
      aviso.value = `Usuario creado. Se envió el enlace para definir la contraseña a ${nueva.correo}.`;
    }
  } catch (e) {
    errorEnvio.value = mensajeDe(e);
  } finally {
    enviando.value = false;
  }
}

async function pedirDesactivacion(cuenta: CuentaPersonal) {
  aviso.value = "";
  errorEnvio.value = "";
  porDesactivar.value = cuenta;
  await nextTick();
  botonCancelarDialogo.value?.focus();
}

async function confirmarDesactivacion() {
  const cuenta = porDesactivar.value;
  if (!cuenta) return;
  desactivando.value = true;
  try {
    // HU0021-4.0: la persona ya no puede iniciar sesión; la cuenta queda como «Desactivado».
    reemplazar(await desactivarCuenta(cuenta.id_personal));
    if (enEdicion.value?.id_personal === cuenta.id_personal) cancelarEdicion();
    aviso.value = "Cuenta desactivada.";
  } catch (e) {
    errorEnvio.value = mensajeDe(e);
  } finally {
    desactivando.value = false;
    porDesactivar.value = null;
  }
}
</script>

<template>
  <div class="g10">
    <div class="principal">
      <p v-if="errorCarga" class="error" role="alert">{{ errorCarga }}</p>

      <div class="tabla-envoltura">
        <table class="tabla" aria-label="Usuarios del personal">
          <thead>
            <tr>
              <th scope="col">Usuario</th>
              <th scope="col" class="col-rol">Rol</th>
              <th scope="col" class="col-estado">Estado</th>
              <th scope="col" class="col-acciones">Acciones</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="c in cuentas" :key="c.id_personal" :data-testid="`cuenta-${c.id_personal}`">
              <td>
                <div class="usuario">
                  <span class="usuario-nombre">{{ nombreCompleto(c) }}</span>
                  <span class="usuario-correo">{{ c.correo }}</span>
                </div>
              </td>
              <td><span class="chip">{{ ETIQUETA_ROL[c.rol] }}</span></td>
              <td>
                <span class="chip" :class="c.activo ? 'chip-activo' : 'chip-inactivo'">
                  {{ c.activo ? "Activo" : "Desactivado" }}
                </span>
              </td>
              <td>
                <div v-if="c.activo" class="acciones">
                  <button type="button" class="boton-icono" :aria-label="`Editar ${nombreCompleto(c)}`" @click="editar(c)">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"
                      stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                      <path d="M4 20h4L19 9l-4-4L4 16z" />
                      <path d="M13.5 6.5l4 4" />
                    </svg>
                  </button>
                  <button type="button" class="boton-icono boton-desactivar" :aria-label="`Desactivar ${nombreCompleto(c)}`"
                    @click="pedirDesactivacion(c)">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"
                      stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                      <circle cx="12" cy="12" r="8.5" />
                      <path d="M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <section class="tarjeta" aria-labelledby="g10-permisos">
        <h2 id="g10-permisos" class="tarjeta-titulo">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9"
            stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <rect x="5" y="11" width="14" height="9" rx="2" />
            <path d="M8 11V8a4 4 0 0 1 8 0v3" />
          </svg>
          Permisos por rol
        </h2>
        <div class="tabla-envoltura">
          <table class="tabla matriz" data-testid="matriz-permisos">
            <thead>
              <tr>
                <th scope="col">Rol</th>
                <th v-for="col in COLUMNAS_PERMISOS" :key="col.columna" scope="col">{{ col.etiqueta }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="fila in matriz" :key="fila.rol" :data-rol="fila.rol">
                <th scope="row" class="celda-rol">{{ ETIQUETA_ROL[fila.rol] }}</th>
                <td v-for="col in COLUMNAS_PERMISOS" :key="col.columna" :data-columna="col.columna">
                  <template v-if="fila.permisos[col.columna]">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--conforme)" stroke-width="2.4"
                      stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                      <path d="M5 12.5l4.2 4.2L19 7" />
                    </svg>
                    <span class="solo-lector">Sí</span>
                  </template>
                  <template v-else>
                    <span class="sin-permiso" aria-hidden="true">—</span>
                    <span class="solo-lector">No</span>
                  </template>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
    </div>

    <section class="tarjeta panel" aria-labelledby="g10-formulario">
      <h2 id="g10-formulario" class="tarjeta-titulo">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9"
          stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <template v-if="enEdicion">
            <path d="M4 20h4L19 9l-4-4L4 16z" />
            <path d="M13.5 6.5l4 4" />
          </template>
          <template v-else>
            <path d="M12 5v14" />
            <path d="M5 12h14" />
          </template>
        </svg>
        {{ enEdicion ? "Editar usuario" : "Nuevo usuario" }}
      </h2>

      <form class="formulario" novalidate @submit.prevent="enviar">
        <div class="campo">
          <label for="g10n">Nombres <span class="obligatorio" aria-hidden="true">*</span></label>
          <input id="g10n" v-model="formulario.nombres" type="text" placeholder="Ej.: Ana Lucía" maxlength="100"
            :aria-invalid="Boolean(errores.nombres)" :aria-describedby="errores.nombres ? 'g10n-error' : undefined" />
          <p v-if="errores.nombres" id="g10n-error" class="error-campo">{{ errores.nombres }}</p>
        </div>
        <div class="campo">
          <label for="g10a">Apellidos <span class="obligatorio" aria-hidden="true">*</span></label>
          <input id="g10a" v-model="formulario.apellidos" type="text" placeholder="Ej.: Pérez Ruiz" maxlength="100"
            :aria-invalid="Boolean(errores.apellidos)" :aria-describedby="errores.apellidos ? 'g10a-error' : undefined" />
          <p v-if="errores.apellidos" id="g10a-error" class="error-campo">{{ errores.apellidos }}</p>
        </div>
        <div class="campo">
          <label for="g10c">Correo institucional <span class="obligatorio" aria-hidden="true">*</span></label>
          <!-- El dominio del colegio es configuración pendiente ([dominio del colegio] en el mockup): sin placeholder. -->
          <input id="g10c" v-model="formulario.correo" type="email" maxlength="150" :disabled="Boolean(enEdicion)"
            :aria-invalid="Boolean(errores.correo)" :aria-describedby="errores.correo ? 'g10c-error' : undefined" />
          <p v-if="errores.correo" id="g10c-error" class="error-campo">{{ errores.correo }}</p>
        </div>
        <div class="campo">
          <label for="g10r">Rol <span class="obligatorio" aria-hidden="true">*</span></label>
          <select id="g10r" v-model="formulario.rol" :aria-invalid="Boolean(errores.rol)"
            :aria-describedby="errores.rol ? 'g10r-error' : undefined">
            <option value="" disabled>Seleccionar rol</option>
            <option v-for="r in ROLES_PERSONAL" :key="r" :value="r">{{ ETIQUETA_ROL[r] }}</option>
          </select>
          <p v-if="errores.rol" id="g10r-error" class="error-campo">{{ errores.rol }}</p>
        </div>

        <button type="submit" class="boton-principal" :disabled="enviando">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
            stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M5 12.5l4.2 4.2L19 7" />
          </svg>
          {{ enEdicion ? "Guardar cambios" : "Crear usuario" }}
        </button>
        <button v-if="enEdicion" type="button" class="boton-secundario" @click="cancelarEdicion">Cancelar</button>
      </form>

      <p class="aviso" role="status">{{ aviso }}</p>
      <p v-if="errorEnvio" class="error" role="alert">{{ errorEnvio }}</p>
      <span class="nota">El usuario recibe un enlace para definir su contraseña. Toda alta, cambio o baja queda en la bitácora de auditoría.</span>
    </section>

    <dialog v-if="porDesactivar" open class="dialogo" aria-modal="true" aria-labelledby="g10-dialogo-texto">
      <p id="g10-dialogo-texto">¿Desactivar la cuenta de {{ nombreCompleto(porDesactivar) }}? No podrá iniciar sesión.</p>
      <div class="dialogo-acciones">
        <button ref="botonCancelarDialogo" type="button" class="boton-secundario" @click="porDesactivar = null">Cancelar</button>
        <button type="button" class="boton-peligro" :disabled="desactivando" @click="confirmarDesactivacion">Desactivar</button>
      </div>
    </dialog>
  </div>
</template>

<style scoped>
.g10 {
  display: flex;
  gap: 24px;
  align-items: flex-start;
}

.principal {
  flex-grow: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.tabla-envoltura {
  overflow-x: auto;
}

.tabla {
  width: 100%;
  border-collapse: collapse;
  background: var(--superficie);
  border: 1px solid var(--borde);
}

.tabla th {
  text-align: left;
  padding: 12px 14px;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--texto-suave);
  border-bottom: 1px solid var(--borde);
  background: var(--superficie-tenue);
}

.tabla td,
.tabla .celda-rol {
  padding: 12px 14px;
  font-size: 14px;
  color: var(--texto);
  border-bottom: 1px solid var(--borde);
  vertical-align: middle;
  text-transform: none;
  letter-spacing: normal;
  font-weight: 400;
  background: var(--superficie);
}

/* Matriz de 8 columnas en la columna izquierda de G10 (≈660 px a 1440 px): menos relleno horizontal y
   encabezados que se cortan con guion, para que entren todas sin desplazamiento. */
.tabla.matriz th,
.tabla.matriz td,
.tabla.matriz .celda-rol {
  padding-left: 6px;
  padding-right: 6px;
}

.tabla.matriz thead th {
  hyphens: auto;
}

.col-rol {
  width: 200px;
}

.col-estado,
.col-acciones {
  width: 130px;
}

.usuario {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.usuario-nombre {
  font-weight: 700;
}

.usuario-correo {
  font-size: 13px;
  color: var(--texto-suave);
}

.chip {
  display: inline-flex;
  align-items: center;
  padding: 4px 10px;
  border-radius: 999px;
  background: var(--chip-fondo);
  color: var(--cil-azul);
  font-size: 13px;
  font-weight: 600;
  white-space: nowrap;
}

.chip-activo {
  background: var(--conforme-fondo);
  color: var(--conforme);
}

.chip-inactivo {
  background: var(--inactivo-fondo);
  color: var(--inactivo);
}

.acciones {
  display: flex;
  gap: 8px;
}

.boton-icono {
  display: inline-flex;
  align-items: center;
  height: 44px;
  padding: 0 14px;
  border-radius: 9px;
  border: 1px solid var(--cil-azul);
  background: var(--superficie);
  color: var(--cil-azul);
  cursor: pointer;
}

.boton-desactivar {
  border-color: var(--observado);
  color: var(--observado);
}

.tarjeta {
  background: var(--superficie);
  border: 1px solid var(--borde);
  border-radius: 16px;
  padding: 22px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.tarjeta-titulo {
  margin: 0;
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 22px;
  font-weight: 600;
  color: var(--cil-azul);
}

.sin-permiso {
  color: var(--texto-suave);
}

.panel {
  width: 360px;
  box-sizing: border-box;
  flex-shrink: 0;
  padding: 24px;
  gap: 16px;
}

.formulario {
  display: flex;
  flex-direction: column;
  gap: 16px;
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

.obligatorio {
  color: var(--observado);
}

.campo input,
.campo select {
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

.campo input:disabled {
  background: var(--superficie-tenue);
  color: var(--texto-suave);
}

.campo [aria-invalid="true"] {
  border-color: var(--observado);
}

.error-campo,
.error {
  margin: 0;
  font-size: 13px;
  color: var(--observado);
}

.boton-principal,
.boton-secundario,
.boton-peligro {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  height: 46px;
  padding: 0 22px;
  border-radius: 10px;
  font-family: var(--fuente-texto);
  font-size: 15px;
  font-weight: 600;
  cursor: pointer;
}

.boton-principal {
  width: 100%;
  background: var(--cil-azul);
  color: #ffffff;
  border: 1px solid var(--cil-azul);
}

.boton-principal:disabled,
.boton-peligro:disabled {
  opacity: 0.7;
  cursor: progress;
}

.boton-secundario {
  background: var(--superficie);
  color: var(--cil-azul);
  border: 1px solid var(--cil-azul);
}

.boton-peligro {
  background: var(--observado);
  color: #ffffff;
  border: 1px solid var(--observado);
}

.aviso {
  margin: 0;
  font-size: 14px;
  color: var(--conforme);
}

.aviso:empty {
  display: none;
}

.nota {
  font-size: 13px;
  line-height: 1.5;
  color: var(--texto-suave);
}

.dialogo {
  position: fixed;
  inset: 0;
  margin: auto;
  width: min(440px, calc(100% - 32px));
  height: fit-content;
  box-sizing: border-box;
  padding: 24px;
  border: 1px solid var(--borde);
  border-radius: 16px;
  background: var(--superficie);
  box-shadow: 0 12px 40px rgb(16 50 110 / 0.25);
  color: var(--texto);
}

.dialogo p {
  margin: 0 0 20px;
  font-size: 15px;
  line-height: 1.5;
}

.dialogo-acciones {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
}

@media (max-width: 1100px) {
  .g10 {
    flex-direction: column-reverse;
  }

  .panel {
    width: 100%;
  }
}
</style>
