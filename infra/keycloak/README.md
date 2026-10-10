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

## Valores provisionales (ADR-02, PENDIENTE con el colegio)

| Parámetro | Valor | Origen |
|---|---|---|
| Intentos fallidos antes del bloqueo (`failureFactor`) | 5 | HU0023-2.0 |
| Tipo de bloqueo (`permanentLockout`) | temporal | HU0023-2.0 |
| Espera inicial y su incremento (`waitIncrementSeconds`) | 60 s | **Provisional**: valor por defecto de Keycloak |
| Espera máxima (`maxFailureWaitSeconds`) | 900 s | **Provisional**: valor por defecto de Keycloak |
| Reinicio del contador (`maxDeltaTimeSeconds`) | 12 h | **Provisional**: valor por defecto de Keycloak |
| Política de contraseñas | ninguna | **Provisional**: pendiente con el colegio (P03b) |

Fuera de este realm por ahora: tema de login (`themes/cil/`, HU0023 y HU0021), SMTP del realm y recuperación de
contraseña (HU0023).

## Reimportar después de cambiar el JSON

Como la importación se salta si el realm existe, para aplicar cambios en dev hay que borrar el realm y reiniciar:

```bash
# 1. Borrar el realm desde la consola de administración (http://localhost:8080) o por Admin API.
# 2. Reiniciar Keycloak para que lo vuelva a importar:
docker compose -f docker-compose.yml -f docker-compose.dev.yml restart keycloak
npm run kc:usuarios-prueba
```
