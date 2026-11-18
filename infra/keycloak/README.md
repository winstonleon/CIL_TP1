# Keycloak — realm `cil-admision`

`realm-cil-admision.json` es la configuración versionada del realm (ADR-02). Keycloak lo importa al arrancar
(`--import-realm`) **solo si el realm no existe**; si el realm ya está creado, la importación se salta.

## Contenido

- **Roles de realm:** `familia`, `secretaria`, `tesoreria`, `psicologa`, `evaluador_academico`, `directora`.
- **Clientes públicos** `portal-familias` y `gestion-interna`: Authorization Code + PKCE (S256), sin *direct grant*.
  Redirección a `${FRONTEND_PUBLIC_URL}/*`. Cada uno tiene un *audience mapper* para que el token de acceso
  incluya `api-admision` en `aud`; la API valida esa audiencia.
- **Cliente confidencial** `api-admision`: *service account* con `manage-users` y `view-users` de
  `realm-management`. El secreto sale de `${KEYCLOAK_API_CLIENT_SECRET}`.
- **Sin usuarios** (salvo el usuario técnico de la *service account*, que Keycloak necesita) **ni secretos** en el
  archivo: los valores `${...}` se reemplazan con variables de entorno del contenedor al importar.
  Los usuarios de prueba los crea `npm run kc:usuarios-prueba` con datos ficticios (`@ejemplo.test`).
- **Idioma:** español (`defaultLocale: es`) para todo el realm: correos y páginas de Keycloak, también las del
  portal de familias (P03).
- **SMTP del realm (HU0021, C12):** Keycloak envía el enlace para definir la contraseña del personal (*execute actions
  email*; excepción de ADR-07 y R22: no pasa por n8n ni se registra en `notificacion`) y el de recuperación de contraseña.
  Toma `SMTP_HOST`, `SMTP_PORT`, `SMTP_AUTH`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_SSL`, `SMTP_STARTTLS` y
  `KEYCLOAK_SMTP_FROM` del entorno; sin las de autenticación y TLS rige Mailpit (dev: `http://localhost:8025`). Como el
  realm de producción se importa una sola vez, un cambio posterior en `.env` no llega a un realm que ya existe:
  `GUIA-INSTALACION.md` (sección 10) explica cómo aplicarlo con `kcadm.sh`.
- **Perfil de usuario:** además de los atributos por defecto, declara `origen` (solo lo ven y editan los
  administradores). La API crea las cuentas del personal con `origen=api-personal`: así reconoce un usuario
  huérfano de un alta fallida y lo adopta en el siguiente intento con el mismo correo (plan HU0021, Q4).

## Tema de login `cil` (`themes/cil/`)

- **Un solo tema que distingue el cliente (ADR-02, HU0023):** los dos clientes tienen `login_theme = cil`.
  - `login.ftl` incluye `p03.ftl` (P03 y P03c) para `portal-familias` y `g01.ftl` (G01, HU0021) para cualquier otro.
  - `login-update-password.ftl` incluye `p03b.ftl` (P03b, HU0023-1.0) para `portal-familias`; el personal ve la página
    de `keycloak.v2` sin cambios, copiada literal en `login-update-password-padre.ftl`. **Al subir la versión de
    Keycloak hay que volver a copiarla** (FreeMarker no puede incluir la plantilla del padre con el mismo nombre).
  - El panel azul de P03, P03b y P03c está en `p03-panel.ftl`; el CSS propio, en `resources/css/p03.css` (comparte
    `g01.css`).
- **P03c (HU0023-2.0, D6-A):** Keycloak responde a una cuenta bloqueada con la clave
  `accountTemporarilyDisabledMessage`, cuyo texto por omisión es igual al de credenciales incorrectas.
  `messages/messages_es.properties` le da un texto propio para que `p03.ftl` muestre P03c; `g01.ftl` lo vuelve a
  traducir al mensaje genérico, así G01 no revela nada. **Riesgo aceptado (John, 07/11/2026):** quien falle seis veces
  con un correo sabe que tiene cuenta. P03c aparece en el intento siguiente al quinto fallo.
- **Recuperación de contraseña (HU0023, D7-A):** `resetPasswordAllowed = true`. El correo con el enlace lo envía
  Keycloak por su SMTP (segunda excepción de ADR-07: no pasa por n8n ni deja fila en `notificacion`). Vale para
  familias y personal: el enlace aparece en P03, P03c y G01. Las páginas de la recuperación son las del tema padre,
  salvo P03b, que en ese flujo no dice que es el primer ingreso.
- Hereda de `keycloak.v2`: las demás páginas (enlace vencido, errores, recuperación) son las del tema padre, en español.
- Conserva los ids que esperan Keycloak y las pruebas: `kc-form-login`, `username`, `password` y `kc-login`.
- Las fuentes (Fraunces y Public Sans, OFL) están en `themes/cil/login/resources/fonts/`: la página no pide nada
  fuera del servidor.
- «¿Olvidaste tu contraseña?» solo aparece si el realm habilita la recuperación (`resetPasswordAllowed`, activa desde HU0023).
- «Aún no visito el colegio» (P03) lleva a P01 (`/solicitud-informacion`): `theme.properties` expone
  `portalPublico=${env.FRONTEND_PUBLIC_URL:}`.
- La campaña de «Colegio Internacional de Lima · Campaña 2027» es la activa (HU0022, C23): el contenedor recibe
  `CAMPANA_ACTIVA` y `theme.properties` la expone como `campanaActiva=${env.CAMPANA_ACTIVA:}`. Si cambia, hay que
  recrear `keycloak` (y `api`) para que la tomen; no hace falta reimportar el realm.
- El tema se monta de solo lectura en `/opt/keycloak/themes/cil` (`docker-compose.yml`). En dev (`start-dev`)
  Keycloak no guarda los temas en caché: un cambio en `login.ftl` o en el CSS se ve al recargar la página.

## Cuentas del personal (HU0021)

La API (`api/src/identidad/keycloakAdmin.ts`) gestiona las cuentas con la *service account* de `api-admision`:

- **Alta:** crea el usuario deshabilitado, le asigna el rol, lo habilita y pide a Keycloak el correo con el enlace
  para definir la contraseña (`UPDATE_PASSWORD`, cliente `gestion-interna`). El enlace **vence en 72 h**
  (ADR-02; parámetro `lifespan` del envío, no la configuración del realm, que sigue en 12 h).
- **Modificación:** nombres, apellidos y rol. El rol anterior se quita antes de agregar el nuevo.
- **Desactivación:** `enabled = false` y cierre de todas sus sesiones. No se borra el usuario.
- El token de acceso vive 5 min (`accessTokenLifespan` por defecto): tras desactivar o cambiar el rol, un token ya
  emitido sigue valiendo hasta que vence. Ventana aceptada en HU0021; se cierra con el compromiso C22.

### Si la única directora pierde el acceso

En HU0021 no hay protección contra que la directora se desactive o se quite el rol a sí misma, ni opción de
reactivar (brecha del backlog, C21). Para recuperar el acceso:

1. Entrar a la consola de administración de Keycloak (`KEYCLOAK_PUBLIC_URL`, realm `master`) con
   `KEYCLOAK_ADMIN`.
2. Cambiar al realm `cil-admision` → **Users** → buscar a la directora por su correo.
3. **Details:** activar **Enabled** y guardar.
4. **Role mapping:** si perdió el rol, **Assign role** → `directora` (y quitar el otro rol de la aplicación).
5. Si no recuerda su contraseña: **Credentials** → **Reset password** (temporal) o, desde **Details**,
   **Send email** con la acción *Update Password*.
6. Alinear `personal` en la base `admision`, porque la consola de Keycloak no la toca:

   ```bash
   docker compose -f docker-compose.yml -f docker-compose.dev.yml exec -T postgres \
     psql -U api_admision -d admision -c \
     "UPDATE personal SET activo = true, rol = 'directora' WHERE correo = '<correo de la directora>'"
   ```

   (En producción, con el usuario y la base de producción.)
7. Esta recuperación es manual y **no queda en `registro_auditoria`**: anotarla en el acta del equipo.

## Valores provisionales (ADR-02, PENDIENTE con el colegio)

| Parámetro | Valor | Origen |
|---|---|---|
| Intentos fallidos antes del bloqueo (`failureFactor`) | 5 | HU0023-2.0 |
| Tipo de bloqueo (`permanentLockout`) | temporal | HU0023-2.0 |
| Espera inicial y su incremento (`waitIncrementSeconds`) | 60 s | **Provisional**: valor por defecto de Keycloak |
| Espera máxima (`maxFailureWaitSeconds`) | 900 s | **Provisional**: valor por defecto de Keycloak |
| Reinicio del contador (`maxDeltaTimeSeconds`) | 12 h | **Provisional**: valor por defecto de Keycloak |
| Política de contraseñas | ninguna | **Provisional**: pendiente con el colegio (P03b muestra los requisitos entre corchetes, C6) |

P03c muestra «[tiempo de bloqueo por definir]» hasta que el colegio defina la espera (C6).

## Reimportar después de cambiar el JSON

Como la importación se salta si el realm existe, para aplicar cambios en dev hay que borrar el realm y reiniciar:

```bash
# 1. Borrar el realm desde la consola de administración (http://localhost:8080) o por Admin API.
# 2. Reiniciar Keycloak para que lo vuelva a importar:
docker compose -f docker-compose.yml -f docker-compose.dev.yml restart keycloak
npm run kc:usuarios-prueba
npm run db:seed   # vuelve a vincular personal con los nuevos keycloak_user_id de los usuarios de prueba
npm run dev:limpiar-personal-huerfano   # desactiva en personal las cuentas de dev que ya no existen en Keycloak
npm run dev:firma-ficticia   # sin firma no se emite ninguna carta (ADR-28)
```

Después, comprobar que la directora de prueba sigue activa y con firma (si no, la carta no se emite):

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml exec -T postgres psql -U api_admision -d admision -tAc   "SELECT correo, activo, rol, firma_url IS NOT NULL AS firma FROM personal WHERE correo = 'directora.prueba@ejemplo.test'"
# esperado: directora.prueba@ejemplo.test|t|directora|t
```

Las cuentas del personal creadas en dev desde G10, la API o el E2E no se recrean: sus filas en `personal` quedan
sin usuario en Keycloak (solo dev, datos ficticios; compromiso C16). `dev:limpiar-personal-huerfano` las marca como
inactivas y deja la baja en la bitácora; no borra filas.
