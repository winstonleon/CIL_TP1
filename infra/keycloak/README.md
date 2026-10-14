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
- **SMTP del realm (HU0021):** Keycloak envía el enlace para definir la contraseña del personal (*execute actions
  email*; excepción de ADR-07 y R22: no pasa por n8n ni se registra en `notificacion`). Toma `SMTP_HOST`,
  `SMTP_PORT` y `KEYCLOAK_SMTP_FROM` del entorno; en dev el correo va a Mailpit (`http://localhost:8025`).
  `auth`, `ssl` y `starttls` están fijos en `false`: antes del primer despliegue hay que volverlos placeholders y
  agregar usuario y contraseña SMTP (compromiso C12), porque el realm de producción se importa una sola vez.
- **Perfil de usuario:** además de los atributos por defecto, declara `origen` (solo lo ven y editan los
  administradores). La API crea las cuentas del personal con `origen=api-personal`: así reconoce un usuario
  huérfano de un alta fallida y lo adopta en el siguiente intento con el mismo correo (plan HU0021, Q4).

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
| Política de contraseñas | ninguna | **Provisional**: pendiente con el colegio (P03b) |

Fuera de este realm por ahora: tema de login (`themes/cil/`, HU0023 y HU0021) y recuperación de contraseña
(HU0023).

## Reimportar después de cambiar el JSON

Como la importación se salta si el realm existe, para aplicar cambios en dev hay que borrar el realm y reiniciar:

```bash
# 1. Borrar el realm desde la consola de administración (http://localhost:8080) o por Admin API.
# 2. Reiniciar Keycloak para que lo vuelva a importar:
docker compose -f docker-compose.yml -f docker-compose.dev.yml restart keycloak
npm run kc:usuarios-prueba
npm run db:seed   # vuelve a vincular personal con los nuevos keycloak_user_id de los usuarios de prueba
```

Las cuentas del personal creadas en dev desde la API o el E2E no se recrean: sus filas en `personal` quedan sin
usuario en Keycloak (solo dev, datos ficticios; compromiso C16).
