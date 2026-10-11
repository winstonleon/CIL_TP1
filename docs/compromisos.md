# Compromisos pendientes aprobados

Trabajo ya acordado por el equipo que **no** se hizo en su momento y queda asignado a una HU o etapa
posterior. Se revisa al planificar cada HU: si la HU en curso aparece en la columna «Cuándo», su plan
debe incluir el compromiso. Al cumplirlo, se mueve a «Cumplidos» con la fecha y la referencia.

| # | Compromiso | Cuándo | Origen |
|---|---|---|---|
| C1 | Script que genera `docs/evidencias/matriz-trazabilidad.md` (HU → escenario → prueba → resultado) a partir de los nombres de las pruebas | **Antes de cerrar HU0021** | Sprint 0, plan (09/10/2026) |
| C2 | Proponer un *Error Workflow* de n8n compartido que registre los fallos en la API. Es un workflow técnico y **no** cuenta como uno de los 7 flujos del TI | **Plan de HU0002** (primer flujo de negocio) | Sprint 0, plan |
| C3 | El seed de desarrollo (`api/scripts/seed.ts`) deja de cifrar el DNI directamente y pasa a usar el repositorio de apoderados, como exige `.claude/rules/api.md` | **HU0001** (cuando exista el repositorio) | Sprint 0, S0-B9 |
| C4 | Al sacar un expediente de `lista_espera`, limpiar `posicion_lista_espera` antes de la transición o en la misma sentencia: el CHECK `ck_expediente_posicion_lista_espera` lo exige y no se puede diferir | **HU0012** | Sprint 0, S0-B9 |
| C5 | Pasar `N8N_DB_PASSWORD` y `N8N_ENCRYPTION_KEY` a variables `*_FILE` (secretos de Docker) en lugar de variables de entorno en claro | **Antes del despliegue al VPS** | Sprint 0, S0-B9 |
| C6 | Definir la política de contraseñas y el tiempo de bloqueo de Keycloak. Hoy rigen valores provisionales (ver `infra/keycloak/README.md`) | **Cuando el colegio los defina** (ADR-02, PENDIENTE) | ADR-02 |
| C7 | Keycloak debe validar sus conexiones a la base y no fallar la primera petición tras un reinicio de Postgres (configurar la validación del pool de conexiones de Keycloak, Agroal, y comprobarlo reiniciando Postgres) | **Antes del despliegue al VPS** | Sprint 0, S0-B9: el 09/10/2026, tras reiniciar Postgres, Keycloak registró «Closing connection in incorrect state VALIDATION» y falló el primer token de administración |
| C8 | El registro de notificaciones no es idempotente: si la API guarda la fila pero se pierde la respuesta, el reintento de n8n la duplica en `notificacion`. Revisar si alguna métrica cuenta notificaciones; si ninguna lo hace, se cierra sin cambios | **Plan de HU0019** (indicadores) | Sprint 0, C2 (riesgo del flujo `notificacion-multicanal`) |
| C9 | Todo flujo que llame a `notificacion-multicanal` debe manejar sus errores (400 entrada inválida, 502 contacto no disponible, 500 registro fallido), por ejemplo con `onError` en su nodo Execute Workflow, para que una notificación fallida no detenga el trámite | **HU0002** y cada flujo que la use después | Sprint 0, C2 |
| C10 | Limitar la retención de las ejecuciones de n8n, que guardan datos personales (correo, asunto, cuerpo): por ejemplo poda automática por antigüedad y no guardar las ejecuciones exitosas. Valores a definir | **Antes del despliegue al VPS** | Sprint 0, C2 |
| C11 | **Webhooks internos: aplica a TODOS los webhooks de n8n que llama la API, no solo a `notificacion-multicanal`.** n8n guarda en texto plano, en los datos de ejecución, las cabeceras de entrada del webhook, incluido el secreto `X-Webhook-Secret`. El nodo Webhook no tiene opción para excluirlas, y el enmascaramiento de n8n es solo Enterprise y solo de interfaz (la base no cambia). Medidas: (1) NGINX no publica `/webhook/*` internos: solo se alcanzan por la red interna de Docker; (2) no se guardan las ejecuciones exitosas; (3) poda automática de ejecuciones (ver C10); (4) rotación periódica del secreto con `npm run n8n:credenciales`. **Todo plan de HU que agregue o use un webhook debe citar C11** | **Antes del despliegue al VPS**, y en cada plan de HU con webhook | Sprint 0, C3: búsqueda por valor del 10/10/2026 (el secreto aparece en `execution_data`; `INTERNAL_API_TOKEN` no) |
| C12 | `npm run n8n:credenciales` debe tomar de `.env` el SMTP real de producción (host, puerto, usuario, contraseña y TLS). Hoy fija los valores de Mailpit, y en el VPS su PATCH reemplazaría el SMTP real por uno sin TLS | **Antes del despliegue al VPS** | Sprint 0, revisión de `guardian-alcance` |
| C13 | Dockerfile de la `api` con etapa de producción. Hoy solo existe la etapa `dev` (`tsx watch`, `NODE_ENV=development`), que es la que construye la base del compose | **Antes del despliegue al VPS** | Sprint 0, revisión de `guardian-alcance` |
| C14 | La base `admision_test` no se crea en producción (hoy la crea `infra/postgres/init/01-crear-bases.sh` en todo volumen nuevo) | **Antes del despliegue al VPS** | Sprint 0, revisión de `guardian-alcance` |
| C15 | Las trazas de Playwright (`test-results/`, con `trace: retain-on-failure`) guardan la cabecera `X-Webhook-Secret` y la contraseña de prueba cuando una prueba falla. `test-results/` no se sube (está en `.gitignore`); si se agrega CI, no publicar esas trazas como artefacto | **Antes del despliegue al VPS** (o al agregar CI) | Sprint 0, revisión de `guardian-alcance` |
| C16 | El E2E corre sobre la instancia de dev (n8n y base `admision` de dev; deja filas `notificacion` de tipo `e2e_*` y detiene la `api` en S0-C8). Aceptado para TP1. `e2e/playwright.config.ts` aborta si `FRONTEND_PUBLIC_URL` o `KEYCLOAK_PUBLIC_URL` no son locales. Revisar si hace falta una instancia de pruebas separada | **Al cerrar TP1** (o al agregar CI) | Sprint 0, revisión de `guardian-alcance` |

## Cumplidos

_(ninguno todavía)_
