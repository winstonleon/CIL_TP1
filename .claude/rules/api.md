---
paths:
  - "api/**"
---

# Reglas de la API (Express)

- Estructura por capas: `routes/` (HTTP y validación con zod) → `services/` (reglas de negocio y transiciones) → `repositories/` (SQL con `pg`). Las rutas no ejecutan SQL.
- Autenticación: un middleware valida el `Bearer` token de Keycloak con `jose` (JWKS del realm, emisor, audiencia y expiración) y expone el usuario y los roles de `realm_access.roles`. No uses `keycloak-connect`, que está obsoleto. La API no guarda contraseñas ni emite sus propios tokens.
- Cada ruta declara el rol requerido con un middleware (`requireRol('tesoreria')`). Si no hay rol declarado, es un error de revisión.
- Las altas de usuarios (familia en HU0004, personal en HU0021) pasan por un único módulo `identidad/keycloakAdmin`, que usa el *service account* del cliente `api-admision`. Se guarda solo el `keycloak_user_id`.
- Respuestas de error uniformes: `{ "error": { "codigo": "EXPEDIENTE_INCOMPLETO", "mensaje": "..." } }`. Códigos HTTP: 400 validación, 401 sin sesión, 403 sin rol, 404, 409 conflicto (duplicado o estado inválido), 422 regla de negocio.
- Las columnas cifradas (`dni_cifrado`) se cifran y descifran solo en `repositories/`, con el módulo `crypto/columnas`. Nunca devuelvas un valor cifrado ni el `dni_hash` al cliente. Para buscar por DNI se usa `dni_hash`.
- Las pantallas de personal llaman a un endpoint que registra `atencion_inicio` al abrir un ítem. La acción de decisión registra `atencion_fin` en la misma transacción que el cambio (sección 4.7 del modelo de datos).
- Las rutas `/internal/*` son solo para n8n: exigen `INTERNAL_API_TOKEN` y NGINX no las publica.
- Los cambios de estado del expediente pasan por `transicionarExpediente()` (auditoría en la misma transacción).
- Sin `console.log` con datos personales. Los logs solo incluyen IDs.
