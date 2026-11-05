# Decisiones técnicas (ADR)

Cada decisión indica su origen:
- **[TI]**: viene del Trabajo de Investigación (`docs/tesis/diseno-TI.md`). No se cambia sin actualizar el TI.
- **[BENCHMARKING]**: viene del documento de Benchmarking del proyecto.
- **[EQUIPO]**: decidida por John y Brayan (08/10/2026).
- **[PROPUESTA]**: valor por defecto del kit. Se puede cambiar antes del Sprint 0. Después se trata como [EQUIPO].
- **[PENDIENTE]**: no está decidida. Claude Code debe preguntar antes de implementar cualquier cosa que dependa de ella.

Si un documento de la tesis contradice este archivo, **manda este archivo**, y se avisa del conflicto.

---

## ADR-01 Stack
- **[TI]** Vue (frontend), Node.js + Express.js (capa de servicios), n8n autoalojado (orquestación), PostgreSQL (datos), Docker + Docker Compose.
- **[PROPUESTA]** TypeScript en `frontend/` y `api/`. Vue 3 + Vite + Pinia + Vue Router. Node 22 LTS. PostgreSQL 16. Versión de n8n **fijada** en la imagen (nunca `latest`), según el riesgo R03 del ACP.
- **[PROPUESTA]** Acceso a datos con `pg` y repositorios escritos a mano, sin ORM, para que el cifrado de columnas sea explícito. Validación de entrada con `zod`. Migraciones en SQL puro en `db/migrations/`, ejecutadas con `dbmate`.

## ADR-02 Identidad con Keycloak; autorización y auditoría en la API
- **[BENCHMARKING + EQUIPO]** La identidad la gestiona **Keycloak** autoalojado (OpenID Connect). Es software libre (Apache 2.0), sin costo de licencia.
  - **TI actualizado (21/10/2026):** 6.2.3, 6.2.4, la Tabla 6 y las Figuras 8, 9 y 11 incluyen el servidor de identidad.
- **[EQUIPO]** La BD de admisión **no guarda contraseñas**. `Personal` y `Cuenta_Acceso` guardan solo el `keycloak_user_id` (modelo de datos v1.1).
- **[PROPUESTA]** Configuración de Keycloak:
  - **Realm:** `cil-admision`.
  - **Roles de realm:** `familia`, `secretaria`, `tesoreria`, `psicologa`, `evaluador_academico`, `directora`.
  - **Clientes públicos con Authorization Code + PKCE:** `portal-familias` (pantallas P*) y `gestion-interna` (pantallas G*).
  - **Cliente confidencial `api-admision`:** con *service account* y los permisos `manage-users` y `view-users` de `realm-management`, para que la API cree usuarios. La familia se crea en HU0004 y el personal en HU0021.
- **[HU0023]** Las familias reciben una contraseña temporal con la acción requerida `UPDATE_PASSWORD` (pantalla P03b).
- **[EQUIPO, HU0004, D3, 29/10/2026] Cuenta y contraseña temporal de la familia:**
  - **Cuenta:**
    - La API crea el usuario al registrar en G04 «Asistió - Interesado en postular»: rol `familia`, `origen=api-familia`, el correo como usuario y sin credenciales.
    - Si el correo ya existe en Keycloak, responde 409 `CORREO_CON_CUENTA` sin cambios (C28). Un huérfano `api-familia` de un alta fallida se adopta, como en HU0021.
  - **Contraseña:**
    - No existe hasta que `agendamiento` pide el aviso de credenciales (`POST /internal/citas/:id/aviso`).
    - En ese momento la API la genera (16 caracteres, sin `0`, `O`, `1`, `l` ni `I`), la fija en Keycloak como temporal y la devuelve solo en esa respuesta.
    - Cada intento nuevo genera otra, salvo que la familia ya la haya cambiado (ADR-07: una fila por intento, M2 y M4). El correo dice «Si recibes más de un correo, usa el más reciente».
  - **Dónde no queda:** no se guarda en la BD (tampoco en `notificacion`), en `registro_auditoria` ni en ningún log.
  - **Riesgo residual aceptado (John, 29/10/2026):** la contraseña pasa por n8n. `agendamiento` no guarda ejecuciones (`saveDataSuccessExecution` y `saveDataErrorExecution` en `none`), pero:
    - (R1) n8n la tiene en su base mientras la ejecución corre y algo más: n8n 2.42.5 no borra al terminar una ejecución que no se guarda.
      - La marca con `deletedAt` y la borra en el siguiente ciclo de borrado físico.
      - Con `EXECUTIONS_DATA_PRUNE_HARD_DELETE_INTERVAL=1` y `EXECUTIONS_DATA_HARD_DELETE_BUFFER=0` (`docker-compose.yml`), la ventana es de 1 min como máximo desde que la ejecución termina. Medida en dev el 01/11/2026: de 39 a 54 s, en 4 mediciones.
      - El búfer no alarga la ventana de las ejecuciones automáticas; en 0 cubre también las manuales (`saveManualExecutions: false`).
      - Durante la ventana, la fila se lee por SQL. Después queda como tupla muerta hasta el VACUUM, en el WAL y en un `pg_dump` que caiga en ella;
    - (R2) las ejecuciones con error de `notificacion-multicanal` la guardan, porque S0-C8 exige que esas ejecuciones existan;
    - (R3) si n8n cae a mitad de una ejecución, la ejecución queda guardada;
    - (R4) una ejecución de `notificacion-multicanal` **cancelada** (por *timeout* o por la suspensión del equipo) también guarda el correo con la contraseña temporal, hasta la poda por antigüedad (C10). Esa contraseña deja de valer cuando la retoma del aviso genera otra (M2) o la familia la cambia.
  - **Mitigaciones:**
    - rotación en cada intento;
    - invalidación al cerrar el aviso `fallido` (M3, *best effort*);
    - borrado físico de las ejecuciones cada minuto y poda por antigüedad (C10; en el VPS se decide la configuración con el dato de R1).
  - **Alternativa descartada:** el correo de Keycloak con el enlace para crear la contraseña, como en HU0021. Cumplía la restricción entera, pero cambiaba el texto de HU0004-1.0 y HU0023.
- **[HU0023-2.0]** Se activa la detección de fuerza bruta de Keycloak: se bloquea tras **5 intentos fallidos consecutivos** (pantalla P03c).
- **[PENDIENTE]** La política de contraseñas y el tiempo de bloqueo. Se definen con el colegio y no se inventan.
- **[MOCKUPS G01/G10]** El personal recibe un correo de Keycloak con un enlace para definir su contraseña (*execute actions email*), como indica HU0021-1.0. El enlace vence en 72 h.
- **[PROPUESTA]** Tema de login propio en `infra/keycloak/themes/cil/`, que reproduce P03, P03b y P03c para `portal-familias` y G01 para `gestion-interna`. El tema distingue el cliente.
- **[PROPUESTA]** El frontend usa `oidc-client-ts`. El token de acceso se guarda en memoria y se envía a la API como `Authorization: Bearer`.
- **[PROPUESTA]** La API valida la firma del token contra el JWKS del realm con `jose`, y además el emisor, la audiencia y la expiración. Los roles salen de `realm_access.roles`.
  - **No se usa `keycloak-connect`:** el adaptador oficial para Node quedó obsoleto.
- **[PROPUESTA]** La configuración del realm se versiona en `infra/keycloak/realm-cil-admision.json`, sin usuarios ni secretos, y se importa al arrancar. Keycloak usa su propia base `keycloak` en el mismo servidor PostgreSQL. Su versión queda **fijada** en la imagen.
- **[TI/HU]** La autorización por rol vive en la API: cada ruta declara el rol requerido.
- **[MODELO R2/R3]** Accesos restringidos:
  - **Documentación financiera:** solo `tesoreria`.
  - **Informe psicológico:** `psicologa` y `directora`, como en G10 actualizado.
- **[HU0021-2.0]** Todo intento bloqueado se registra en auditoría como `acceso_denegado`.
- **[EQUIPO, HU0002, C22]** Las rutas del personal (`/personal`, `/configuracion`, `/campana-activa`, `/prospectos` y las que se agreguen) exigen, además del rol del token, una fila **activa** en `personal` con ese mismo rol (`requirePersonalActivo`, después de `requireRol`).
  - Así, una cuenta desactivada o con el rol cambiado deja de entrar aunque su token siga vigente (hasta 5 min).
  - La negativa responde 403 `ACCESO_DENEGADO` y se audita como `acceso_denegado`.
  - `verificarToken` sigue aceptando un token sin fila en `personal`: la exigencia es de las rutas del personal, no de la validación del token.
- **Costo a considerar:** Keycloak necesita alrededor de 1,25 GB de RAM. Hay que dimensionar el VPS con eso en cuenta.

## ADR-03 Cifrado a nivel de columna
- **[EQUIPO]** Los datos sensibles se cifran a nivel de columna.
- **[PROPUESTA]** Cifrado AES-256-GCM en la API (`node:crypto`). La clave va en la variable de entorno `DATA_ENCRYPTION_KEY` y nunca en la BD ni en el repo. Formato almacenado: `v1:iv:authTag:ciphertext` en base64, para poder rotar la clave.
- **[PROPUESTA]** Unicidad sobre datos cifrados: el TI exige DNI único, pero un cifrado con IV aleatorio no admite `UNIQUE`. Por eso se agrega una columna `dni_hash` = HMAC-SHA256(DNI normalizado, `DATA_HMAC_KEY`) con `UNIQUE`. Las búsquedas por DNI usan el hash.
- **[EQUIPO]** Columnas cifradas: el **DNI** de `Apoderado` y de `Postulante` (`dni_cifrado` + `dni_hash`), ya definidas en el modelo de datos v1.1.
- **[PENDIENTE]** Si se cifran más columnas, por ejemplo las observaciones del informe psicológico o del dictamen. No se cifra nada más sin aprobación.
- **[EQUIPO, HU0005, 02/11/2026] Condición especial del postulante:** `tiene_condicion_especial` **no se cifra**, porque es solo un sí/no (boolean). Si alguna HU agrega un detalle en texto (diagnóstico, informe), se reabre esta decisión antes de guardarlo.
- **[EQUIPO, HU0006 y HU0007, 03/11/2026] Archivos cifrados en reposo** (decisión P2 a): los documentos y comprobantes contienen DNI, documentación financiera e informes de terapia de menores.
  - AES-256-GCM en la API, con la clave `ARCHIVOS_ENCRYPTION_KEY` (32 bytes en base64, en `.env`), distinta de `DATA_ENCRYPTION_KEY`. Lo hace un decorador sobre cualquier adaptador de almacenamiento (ADR-21).
  - Formato: cabecera `CILF` + id de la clave (4 bytes del SHA-256 de la clave) + IV aleatorio de 12 bytes, luego el cifrado y la etiqueta. El dato asociado (AAD) es la cabecera más la clave de almacenamiento del archivo: un archivo movido a otro documento no se descifra.
  - La descarga descifra y verifica la etiqueta en memoria (10 MB como máximo) antes de enviar el primer byte: nunca sale contenido sin verificar. La carga cifra en *stream*.
  - Rotación: se escribe con la clave vigente y se lee con la que indique el id (`ARCHIVOS_ENCRYPTION_KEY_ANTERIOR`, opcional). El script que re-cifra los archivos viejos queda pendiente (C47). Perder la clave es perder los archivos: su respaldo se suma a C35.
- Consecuencia: n8n **nunca** lee la BD de negocio directamente (ver ADR-04), porque no tiene la clave.

## ADR-04 n8n accede a los datos solo a través de la API
- **[TI 6.2.3, regla 1]** La interfaz y el motor de orquestación acceden a los datos únicamente a través de la capa de servicios. El TI se corrigió el 21/10/2026: 6.2.4 dice que solo la API accede a la base de admisión.
- **[PROPUESTA]** El servidor PostgreSQL tiene tres bases: `admision` (negocio), `n8n` (estado interno de n8n) y `keycloak` (identidad). Cada servicio tiene su propio usuario, y ni n8n ni Keycloak tienen permisos sobre `admision`.
- **[PROPUESTA]** API → n8n: webhooks internos con autenticación por header (`X-Webhook-Secret`). n8n → API: endpoints `/internal/*` protegidos con token de servicio (`INTERNAL_API_TOKEN`) y no expuestos por NGINX.

## ADR-05 Auditoría y estados del expediente
- **[TI]** Cada transición de estado del Expediente se registra en `Registro_Auditoria` con el estado anterior y el nuevo. Es la fuente de los indicadores de lead time y cycle time (HU0019, G08).
- **[EQUIPO, decisión 2A]** Medición del tiempo de atención (OE3), con los eventos del catálogo de la sección 4.7 del modelo de datos:
  - `atencion_inicio`: el personal **abre** un ítem en G03, G05, G06, G07 o G11.
  - `atencion_fin`: el personal registra su decisión sobre ese ítem.
  - El cycle time es la suma de esos intervalos. Un `atencion_inicio` sin `atencion_fin` en 8 horas no se cuenta.
  - No se agregan botones de «Iniciar revisión».
- `tipo_evento` solo admite los valores del catálogo de la sección 4.7. Un valor nuevo necesita aprobación.
- **[PROPUESTA]** Los cambios de estado pasan por una única función de servicio (`transicionarExpediente`) que valida la transición y escribe la auditoría en la misma transacción.

## ADR-06 Workflows de n8n versionados
- **[EQUIPO]** Los workflows se generan como JSON en `n8n/workflows/` y se importan por la API pública de n8n o con el MCP `n8n-mcp`.
- **[TI]** Son siete flujos: `captacion`, `recepcion-registro`, `verificacion-completitud`, `agendamiento`, `generacion-carta`, `notificacion-multicanal`, `seguimiento-recordatorios`. No se crean flujos adicionales sin aprobación. Sí se permiten sub-workflows internos de un flujo, si el plan los justifica.
- **[EQUIPO]** Las credenciales **nunca** van en el JSON: los workflows las referencian solo por nombre. En cada instancia (dev o VPS) se crean o actualizan con `npm run n8n:credenciales`, que toma los valores de `.env` y los envía a la API pública de n8n sin imprimirlos; ningún secreto ni ID de credencial entra al repositorio. Los workflows se identifican por nombre, no por ID, porque los IDs cambian entre instancias.
- **[PROPUESTA]** El repo es la fuente de verdad. Un cambio hecho en la interfaz de n8n se exporta al repo antes de hacer commit.
- **[EQUIPO, HU0002, C2]** Además de los siete flujos hay un workflow **técnico**, `registro-errores` (nodo Error Trigger), que no cuenta como flujo del TI.
  - Cada flujo lo declara como su *Error Workflow*.
  - A la API (`POST /internal/errores-flujo`) le envía solo el nombre del flujo, el nodo y el id de la ejecución, nunca el mensaje del error, que puede traer datos personales. La API lo deja en su log.
- **[EQUIPO, HU0002]** `npm run n8n:importar` resuelve **por nombre** el `errorWorkflow` de cada flujo y el flujo que llama cada nodo Execute Workflow. Al exportar vuelve a dejar el nombre, así el repo no guarda IDs de la instancia. Importa en orden de dependencias: `registro-errores`, luego `notificacion-multicanal` y luego el resto.

## ADR-07 Notificaciones multicanal
- **[TI]** Canales: correo (SMTP) y WhatsApp. **[memoria del proyecto]** WhatsApp Cloud API oficial, con pago por plantilla.
- **[EQUIPO]** WhatsApp aún no está disponible y debe poder agregarse después sin rehacer flujos.
- **[PROPUESTA]** Todos los envíos pasan por el flujo `notificacion-multicanal`.
- **[MODELO R22]** Se envía por WhatsApp solo si `Consentimiento.autoriza_whatsapp = true` **y** `WHATSAPP_ENABLED=true`. Si no se cumplen las dos condiciones, no se crea `Notificacion` para ese canal y el flujo no falla.
- **[MODELO R22]** Un rebote del correo de la carpeta informativa pasa el expediente a `contacto_no_entregado` y aparece en G04 («Prospectos con contacto no entregado»).
- **[EQUIPO, HU0002] Detección del rebote: solo el rechazo síncrono** (antes PENDIENTE).
  - Cuenta como rebote el rechazo permanente del destinatario que da el servidor SMTP **durante el envío** (5xx en RCPT, p. ej. «550 5.1.1»).
  - **[EQUIPO, HU0002, 26/10/2026] Qué 5xx es rebote:** el código extendido 5.1.x o 5.2.x, o 550, 551 o 553 sin código extendido. Un 5.7.x (política del servidor, p. ej. «550 5.7.1») o cualquier otro 5xx **no** es rebote: la notificación queda `pendiente`, con registro en `registro-errores` (punto siguiente). Lo clasifica el nodo «Estado fallido» de `notificacion-multicanal`.
  - La notificación queda `fallido` (el enum `estado_envio` no tiene «rebotado»), se audita `notificacion_rebotada` y el expediente pasa de `prospecto` a `contacto_no_entregado` (HU0002-2.0).
  - **Cubre solo ese caso.** Si el proveedor acepta el correo y avisa del rebote después (Gmail, Google Workspace o un proveedor transaccional), no se detecta. Esa detección asíncrona (webhook del proveedor o buzón de rebotes) queda para antes del despliegue al VPS (C34). Por eso la matriz muestra HU0002-2.0 por partes.
  - En dev, Mailpit responde 550 a todo destinatario que no sea `@ejemplo.test` (`MP_SMTP_ALLOWED_RECIPIENTS` en `docker-compose.dev.yml`). Las pruebas de rebote usan `@rebota.ejemplo.test`.
- **[EQUIPO, HU0002] Fallos del envío de la carpeta informativa:**
  - rechazo permanente del destinatario → `fallido` con rebote (punto anterior);
  - 400 (entrada inválida) de `notificacion-multicanal`: es un defecto, porque la entrada la arma la API → `fallido`, sin rebote, sin transición y **sin reintento**, con registro en `registro-errores`;
  - 502 `CONTACTO_NO_DISPONIBLE` o 500 de `notificacion-multicanal`, un error técnico de SMTP (conexión, DNS, *timeout*, 4xx temporal), o un 5.7.x u otro 5xx que no es rebote → la notificación queda `pendiente`, con registro en `registro-errores`, y el barrido de `captacion` la retoma a los 10 min (ADR-16). Después de una reserva exitosa, un 502 casi siempre es la API caída (S0-C8), porque la reserva ya comprobó que el expediente existe.
  - No hay límite de reintentos, porque no hay columna para contarlos. Cada ejecución de `captacion` con un intento fallido deja un aviso en el log, con el id de la ejecución. Si el barrido trae varias carpetas, el aviso es uno por ejecución; los demás ítems quedan en la ejecución guardada.
  - Con la carpeta reservada, `notificacion-multicanal` solo cierra el envío exitoso. Ante el rechazo responde `fallido` y la fila la cierra `POST /rebote`, en la misma transacción que el evento y la transición: si ese POST falla, la fila sigue `pendiente` y el barrido la retoma (revisión de `constructor-n8n`).
- **[EQUIPO, HU0003 y HU0004, 29/10/2026] Fallos de los avisos de la visita** (`agendamiento`: confirmación, invitación a reprogramar y credenciales; `seguimiento-recordatorios`: recordatorio):
  - **Clasificación:** la de D7, sin rebote ni transición (P-j).
    - El rechazo permanente y el 400 cierran `fallido` la fila de ese intento, sin reintento.
    - Un error técnico, un 502, un 500 o n8n caído dejan la fila `pendiente`. Su resultado es desconocido (R22): nunca se marca `fallido`, porque el correo pudo salir.
  - **Una fila por intento:** la retoma (más de 10 min en `pendiente`) no reutiliza la fila. Inserta otra `pendiente` para el intento nuevo, con su `id_notificacion`. La fila anterior conserva su estado.
  - **Tope de 6 intentos** (`MAX_INTENTOS_AVISO`):
    - Se cuentan las filas del tipo con `fecha_envio ≥ ancla` (ADR-16), sin columna nueva.
    - Con 6 filas, ninguna `enviado` ni `fallido`, y la última `pendiente` hace más de 10 min, la API cierra el aviso con una **fila de cierre** `fallido` y responde 409 `AVISO_AGOTADO`. La fila de cierre no es un envío y no cambia las filas de los intentos.
    - En las credenciales, el cierre invalida la contraseña (M3).
  - **Aviso cerrado:** tiene una fila `enviado` o una `fallido` desde el ancla. El barrido no lo vuelve a tomar.
  - **Credenciales:**
    - Cada intento genera otra contraseña, así que solo vale la del último (M2).
    - Si la familia ya la cambió, entró con la del último intento: esa fila `pendiente` se marca `enviado` y no se rota (M4).
  - **Recordatorio:** pasada la hora de la visita deja de intentarse, y sus filas conservan su estado.
  - **Garantía:** al menos una vez (P-h). Si n8n cae entre el envío SMTP y el cierre, la retoma puede repetir un correo.
  - **Indicadores (C8, HU0019):**
    - Cada aviso tiene como máximo una fila `enviado` o una `fallido`. Un intento nuevo solo se crea 10 min después del anterior, más que el `executionTimeout` de 8 min, así que un PATCH no puede llegar tarde.
    - Contar las filas `enviado` o `fallido` es contar avisos. Las `pendiente` son intentos de resultado desconocido y no se cuentan como envíos.
  - **`captacion`** (carpeta, HU0002) sigue sin tope: lo resuelve C41.
- **[PROPUESTA]** En desarrollo, el correo va a **Mailpit** (contenedor que captura los correos, visible en el navegador). Ningún correo sale a Internet desde dev.
- **[EQUIPO] Excepción:** el enlace para definir la contraseña del personal lo envía Keycloak (ADR-02) y no se registra en notificacion, porque esa tabla exige un expediente. La evidencia queda en registro_auditoria (gestion_usuario).

## ADR-08 Entornos y portabilidad al VPS
- **[TI 6.2.6]** Los mismos cinco artefactos (build de Vue, código de la API, configuración versionada del realm de Keycloak, JSON de flujos y esquema de BD) se despliegan en dev (Docker Desktop, datos ficticios, sin TLS ni respaldo) y en prod (VPS con NGINX, TLS, red interna y `pg_dump` diario).
- **[PROPUESTA]** `docker-compose.yml` como base, más `docker-compose.dev.yml` y `docker-compose.prod.yml`. Toda URL, puerto y secreto sale de `.env`, sin `localhost` fijo en el código.
- **[PROPUESTA]** Keycloak en dev corre en modo de desarrollo. En prod corre detrás de NGINX bajo `/auth`, con `KC_HOSTNAME` configurado. En prod solo NGINX publica los puertos 80 y 443.

## ADR-09 Pruebas y evidencia ABET
- **[EQUIPO]** Pruebas automatizadas como evidencia.
- **[PROPUESTA]** API: Vitest + Supertest contra una BD de prueba. Frontend: Vitest + Vue Test Utils. Extremo a extremo: Playwright.
- **[PROPUESTA]** Cada escenario de aceptación tiene al menos una prueba cuyo nombre **empieza con su ID** (p. ej., `HU0001-3.0 bloquea el envío sin consentimiento`). Así la matriz de trazabilidad HU → escenario → prueba (entregable del Plan de Dirección) se genera de forma automática.

## ADR-10 Modelo de datos
- **[EQUIPO]** La fuente es `docs/der/modelo-datos.md` (DBML v1.1): 19 entidades, 28 relaciones, reglas R1–R24 y catálogo de eventos de auditoría.
- **Los tipos y enums siguen siendo propuesta**, salvo los que cambió la v1.1. Si el código depende de un valor de enum, se avisa.
- **El archivo `DER_Sistema_Tramitacion_Admision.drawio` de 10 entidades está OBSOLETO. No usarlo.**
- **TI actualizado (21/10/2026):** la Figura 12 es el DER v1.1.

## ADR-11 Fuera de alcance (no implementar aunque parezca útil)
OCR o IA para validar documentos · consulta a centrales de riesgo · cálculo de devoluciones por retiro · integración o exportación a SIEWEB o SIAGIE · pasarela de pagos en línea · Camunda · NoSQL · S3 · SMS · PWA o app móvil · migración de datos históricos · módulos de ERP escolar (notas, horarios, pensiones).

## ADR-12 Almacenamiento de documentos y calendario
- **[TI]** Servicios externos: Google Drive y Sheets, y Google Calendar.
- **[EQUIPO, 29/10/2026] Almacenamiento (D1, antes PENDIENTE):**
  - En desarrollo se usa un adaptador de almacenamiento local (`STORAGE_DRIVER=local`).
  - Se implementa en el bloque 3, con la abstracción `local|gdrive`: es el único punto de cambio ya decidido (ADR-19). Implementado en HU0006 y HU0007 (ADR-21).
  - Si en producción el almacenamiento queda local, `pg_dump` no respalda los archivos (C35).
- **[EQUIPO, 29/10/2026] Calendario (D2, antes PENDIENTE):**
  - Sin Google Calendar: la agenda vive solo en `Horario_Disponible` y `Cita` (HU0003, HU0009).
  - No se crea una abstracción de calendario (ADR-19).
- **Divergencia con el TI:** el TI nombra Google Drive y Google Calendar entre los servicios externos (`docs/tesis/diseno-TI.md`). Hay que implementarlos o declarar la diferencia en el TI antes de la sustentación (C36).

## ADR-13 Forma de trabajo
- **[EQUIPO]** Una HU por vez, o un bloque de HU que John agrupa explícitamente (p. ej., HU0003 + HU0004, 29/10/2026). En un bloque, el plan cubre todas sus HU. Claude Code presenta el plan y espera aprobación antes de editar.
- **[PROPUESTA]** Una rama por HU: `hu/HU0001-solicitud-informacion`.
  - **[EQUIPO, 29/10/2026]** Cuando el bloque agrupa varias HU, una rama por bloque: `hu/HU0003-HU0004-visita-guiada`.
  - Commits con el prefijo de las HU del cambio: `HU0001: ...` o `HU0003-HU0004: ...`.
  - Pull request a `main` revisado por el otro integrante.

## ADR-14 Configuración de la campaña
- **[EQUIPO, HU0022]** La campaña activa es la variable de entorno `CAMPANA_ACTIVA`, por ejemplo `2027`.
  - La leen la API y el tema de login G01 (`theme.properties` con `${env.CAMPANA_ACTIVA}`).
  - G09 solo configura los grados, requisitos y horarios de esa campaña (`campana_admision`).
  - Para cambiarla se edita `.env` y se recrean los contenedores `api` y `keycloak`.
  - No hay una entidad Campaña ni se le da `manage-realm` a la *service account*.
  - Brechas abiertas en C26: el alta de una campaña nueva, el cambio de campaña sin un técnico, las campañas superpuestas y el derecho de admisión (S/ 300, R16), que es una constante de la API y no se configura en G09.
- **[EQUIPO, HU0022]** Las evaluaciones requeridas (`Grado.requiere_*`) se configuran por grado en G09. R11 solo da los valores semilla. La entrevista a los padres aplica siempre.
- **[EQUIPO, HU0022]** `Requisito_Documental.tipo_documento` guarda el nombre visible que escribe Secretaría (p. ej. «Partida de nacimiento»).
  - Es único por grado sin distinguir mayúsculas: índice `uq_requisito_grado_tipo_minusculas`.
- **[EQUIPO, HU0022]** `Grado.monto_cuota_ingreso` admite 0 a propósito, para que la propuesta sirva también a colegios públicos sin cuota de ingreso.
  - Con cuota 0 no puede registrarse un pago de cuota (`ck_pago_monto > 0`), y R18 dispara la carta con ese pago. Cómo se emite la carta en ese caso lo definen HU0013 a HU0016 (C25).
- **[EQUIPO, HU0022]** Vacantes adjudicadas = `vacantes_autorizadas − vacantes_disponibles` (R14, R15 y G07).
  - Al cambiar las autorizadas, las disponibles se mueven con la diferencia y las adjudicadas no cambian.
  - HU0012 y HU0018 prueban que ese valor coincide con los expedientes en `vacante_asignada` o `carta_emitida` (C25).

## ADR-15 Horarios: sin superposición del mismo responsable y responsable según el tipo de cita
- **[EQUIPO, HU0022]** No se registra un horario (`Horario_Disponible`) que se cruce con otro del mismo responsable en la misma fecha, en ninguna campaña.
  - Se rechaza con 409 `HORARIO_SUPERPUESTO`.
  - Los horarios contiguos (9:00–10:00 y 10:00–11:00) sí se aceptan.
- **Justificación:** es una regla de diseño del TI: «Unicidad de la cita por persona responsable, fecha y hora, que evita la doble reserva de un mismo horario» (`docs/tesis/diseno-TI.md:259`).
  - `uq_cita_personal_fecha` solo impide dos citas que empiezan a la misma hora exacta.
  - Con dos horarios de 9:00–10:00 y 9:30–10:30 de la misma psicóloga, una familia podría reservar el primero y otra el segundo, y la psicóloga quedaría con dos citas cruzadas.
  - Rechazar la superposición al configurar la agenda cierra ese caso antes de que exista una reserva.
- **[EQUIPO, HU0022]** El responsable de cada tipo de cita debe ser una cuenta activa con este rol:
  - `visita`: directora;
  - `jornada_observacion`, `evaluacion_psicologica` y `entrevista_padres`: psicóloga;
  - `evaluacion_academica`: evaluador académico.
  - Fuentes: nota de `Horario_Disponible`, G04, P08, TI 6.1.3 y §4.6.
- Qué pasa con los horarios de alguien que se desactiva después lo deciden HU0003 y HU0009 (C25).

## ADR-16 Eventos de la API hacia n8n
- **[EQUIPO, HU0001]** La API avisa a n8n con un POST al webhook interno del flujo, `${N8N_WEBHOOK_INTERNAL_URL}/<nombre del flujo>`, con la cabecera `X-Webhook-Secret` (ADR-04). La única puerta es `api/src/orquestacion/n8n.ts`.
  - El cuerpo lleva solo identificadores, p. ej. `{ "id_expediente": 123 }`. n8n pide los datos por `/internal/*`, así sus ejecuciones guardan menos datos personales (C10, C11).
  - Se envía siempre después del COMMIT y después de responder al cliente: la respuesta no espera a n8n.
- **[EQUIPO, HU0001]** Fallos:
  - Un 4xx no se reintenta, porque es definitivo.
  - Ante errores de red, *timeout* o 5xx: hasta 3 intentos de 5 s, con esperas de 1 s y 3 s.
  - El fallo queda en el log solo con el id y la causa, nunca con el secreto ni el cuerpo. El trámite sigue, porque el registro ya está confirmado.
- No hay *outbox*: el modelo no tiene una tabla para eso. Un evento no entregado se deduce de los datos, y cómo se recupera lo decide el plan del flujo receptor (para `captacion`, HU0002: C27).
- La API lee el mismo `N8N_WEBHOOK_SECRET` que la credencial `cil-webhook-secret` de n8n. Para rotarlo hay que correr `npm run n8n:credenciales` y recrear `api` (C11).
- **[EQUIPO, HU0002] Receptor `captacion`:** valida el cuerpo y responde 202 **antes** de procesar. Así la API no llega al *timeout* de 5 s por la demora del SMTP. Si el cuerpo es inválido responde 400, que la API no reintenta.
- **[EQUIPO, HU0002] Recuperación de `captacion` (C27):** el flujo tiene un segundo disparador, programado cada minuto, que no depende del barrido diario de HU0018. Pide a la API (`GET /internal/captacion/pendientes`):
  - los prospectos sin carpeta registrados hace más de 1 min;
  - las carpetas `pendiente` intentadas hace más de 10 min.
- **[EQUIPO, HU0002] Idempotencia de `captacion`:** antes de enviar, el flujo reserva la carpeta en la API (`POST /internal/expedientes/:id/carpeta-informativa`).
  - En una transacción, con el expediente bloqueado, la API crea la notificación `pendiente`, retoma una `pendiente` de más de 10 min o responde 409.
  - Así, un reintento de la API, el barrido y el webhook a la vez no duplican la carpeta.
  - Se acepta *al menos una vez*: si n8n se cae justo después de enviar, la retoma puede repetir un correo.
- **[EQUIPO, HU0003 y HU0004, 29/10/2026] Receptor `agendamiento`:**
  - **Evento:** la API lo envía después de la reserva en P02 (HU0003-1.0) y del registro de la asistencia en G04 (HU0004). El cuerpo es solo `{ "id_cita": 9 }`.
  - **Recepción:** el flujo valida y responde 202 antes de procesar; un cuerpo inválido recibe 400.
  - **Reserva del aviso:** `POST /internal/citas/:id/aviso` reserva y arma el aviso según el estado actual de la cita:
    - `reservada` → `visita_confirmada`;
    - `no_asistio` → `visita_reprogramacion`, con un enlace de P02;
    - `asistio` → `credenciales_portal` (ADR-02, D3).
  - **Ancla de idempotencia:** el expediente y la cita quedan bloqueados. `notificacion` no tiene `id_cita`, así que el ancla de cada aviso es la `fecha_hora` de la `transicion_estado` de esa cita (`detalle.id_cita`). Una notificación del tipo con `fecha_envio ≥ ancla` pertenece a esa cita.
  - **Recuperación:** como C27, un Schedule cada minuto pide `GET /internal/agendamiento/pendientes`. Solo considera el aviso del estado actual de la cita, así que una `pendiente` de un estado anterior no vuelve.
  - **Tope:** ADR-07.
  - **Ejecuciones:** el flujo no guarda ninguna (ADR-02, D3).
- **[EQUIPO, HU0003, D4, 29/10/2026] `seguimiento-recordatorios`:**
  - Un Schedule cada minuto pide `GET /internal/recordatorios/pendientes` y reserva cada recordatorio con `POST /internal/citas/:id/recordatorio`.
  - **Ventana:** `[fecha_hora − RECORDATORIO_VISITA_HORAS, fecha_hora)`. Una reserva hecha con menos anticipación recibe el recordatorio enseguida (C37).
  - **Unicidad:** un solo recordatorio por cita, con la misma ancla que `agendamiento`.
  - **Sin nodos Wait:** el recordatorio queda «programado» por los datos.
  - Los barridos diarios de R20 y R21 son de HU0018.
- **[EQUIPO, HU0017, D3-i, 03/11/2026] Receptor `recepcion-registro`:**
  - **Evento:** la API lo envía después de «Confirmar documentos» en P06. El cuerpo es solo `{ "id_expediente": 7 }`.
  - **Recepción:** valida y responde 202 antes de procesar; un cuerpo inválido recibe 400.
  - **Recuperación:** como C27, un Schedule cada minuto pide `GET /internal/completitud/pendientes`. Devuelve:
    - las confirmaciones sin verificar de hace más de 1 min;
    - los avisos de faltantes con el último intento `pendiente` hace más de 10 min.
  - Cada expediente pasa a `verificacion-completitud` (Execute Workflow), que pide la verificación con `POST /internal/expedientes/:id/verificacion-completitud` (ADR-22).
  - **Ejecuciones:** `recepcion-registro` y `verificacion-completitud` no guardan las exitosas y sí las de error, como `captacion` (C10 y C11).

## ADR-17 Rutas públicas y formulario P01
- **[EQUIPO, HU0001]** Las rutas `/publico/*` no llevan token ni rol, porque la familia no tiene cuenta hasta HU0004.
  - Es una excepción a «cada ruta declara el rol requerido» (ADR-02), igual que `/salud`.
  - Cada ruta se comenta en el código como pública a propósito.
- **[EQUIPO, HU0001]** Protecciones técnicas, sin servicios de terceros:
  - cuerpo de 4 kB como máximo (413);
  - 5 envíos por IP cada 10 minutos, contados en memoria (429 con `Retry-After`). La API usa `trust proxy = 1`; en prod, NGINX fija `X-Forwarded-For` (C19);
  - un campo trampa oculto: si llega con texto, la respuesta es la misma y no se guarda nada;
  - sin CORS: P01 llama a `/api` desde el mismo origen;
  - la respuesta es la misma en todos los casos, así que no revela si un correo ya existe.
- **[EQUIPO, HU0001]** Teléfono: celular peruano (9 dígitos que empiezan con 9) o número E.164 internacional (`+` y de 8 a 15 dígitos). Siempre se guarda en E.164, p. ej. `+51987654321`. Un número con `+51` debe ser un celular de 9 dígitos que empiece con 9 (S8, confirmado por John el 23/10/2026).
- **[EQUIPO, HU0001]** Política de privacidad:
  - La versión y el texto viven en `api/src/services/politicaPrivacidad.ts`, y P01 los recibe del GET público.
  - El servidor guarda en `consentimiento.version_politica` su versión vigente, y la hora la pone la BD.
  - Hasta que el colegio entregue la política (C29), la versión es `borrador-1` y el texto va entre corchetes.
- **[EQUIPO, HU0001]** Canal de origen: los enlaces que publica el colegio llevan `?origen=facebook` u `?origen=instagram`. Se compara sin distinguir mayúsculas: `Facebook` o `INSTAGRAM` también cuentan. Sin parámetro, o con cualquier otro valor, el canal es `formulario_web`.
- **[EQUIPO, HU0001]** Si la misma familia envía P01 dos veces, se crean filas nuevas (brecha C28).
- **[EQUIPO, HU0001]** Los errores de P01 (borde de los campos con error, caja del consentimiento y mensajes) usan el color del estado «observado» de los prototipos, `#8A4B08` (`--observado`), el mismo de P06, G03, G05 y P07b (HU0001-2.0).
- **[EQUIPO, HU0003, 29/10/2026] P02 (agendamiento de la visita):**
  - **Rutas:** `GET /publico/visita-guiada` y `POST /publico/visita-guiada/reserva`. Son públicas a propósito: la familia aún no tiene cuenta.
  - **Token:** viaja en la cabecera `X-Enlace-Visita`, nunca en la URL de la API, para que no quede en los logs de acceso del proxy.
  - **Límites por IP**, cada uno con su propio contador:
    - el POST, 5 cada 10 min, como P01;
    - el GET, 60 cada 10 min, porque devuelve datos de una familia (nombre, grado) a quien tenga el enlace.
  - **Excepción a «la misma respuesta en todos los casos»:**
    - todo token inválido (alterado, de otra clave, mal formado, de un expediente inexistente o en un estado que ya no admite reservar) recibe el mismo 404 `ENLACE_NO_VALIDO`;
    - con un token válido, que no se puede falsificar, P02 distingue `VISITA_YA_AGENDADA`, `HORARIO_SIN_CUPO` (lo exige HU0003-2.0) y `HORARIO_NO_DISPONIBLE`. No revela datos de otra familia.

## ADR-18 Carpeta informativa y enlace para agendar la visita
- **[EQUIPO, HU0002] Carpeta:** el correo lleva un **enlace** a la carpeta digital del colegio, no un adjunto.
  - La URL es la variable `CARPETA_INFORMATIVA_URL`. Es opcional: si está vacía, el correo lo dice entre corchetes.
  - Los textos del correo viven en `api/src/services/carpetaInformativa.ts` (versión `borrador-1`). Lo que debe redactar el colegio va entre corchetes hasta que lo entregue (C33).
  - Arma el asunto y el cuerpo la API, porque `notificacion-multicanal` no redacta mensajes.
  - No depende de ADR-12: es un enlace (p. ej. a un archivo compartido de Drive), sin integrar la API de Drive.
- **[EQUIPO, HU0002] Enlace de P02:** `${FRONTEND_PUBLIC_URL}/visita-guiada?t=<token>`.
  - El token es AES-256-GCM del `id_expediente` con la clave `ENLACE_VISITA_KEY` (32 bytes en base64, en `.env`), en el formato `v1.` + base64url(iv ‖ cifrado ‖ etiqueta).
  - No muestra el id, no se puede falsificar ni derivar el de otra familia, y no necesita columnas.
  - No vence ni se revoca uno por uno: HU0003 decide qué estados lo aceptan y si vence (C31).
  - Rotar `ENLACE_VISITA_KEY` invalida los enlaces ya enviados.
- **[EQUIPO, HU0003, P2, 29/10/2026] Vigencia del enlace de P02 (cierra C31):**
  - No vence por tiempo y el formato `v1` no cambia: la vigencia la da el estado del expediente.
  - P02 solo acepta un expediente en `prospecto`. En `visita_agendada` (enlace ya usado) responde 409 `VISITA_YA_AGENDADA`; cualquier otro estado, como un enlace inválido: 404 `ENLACE_NO_VALIDO`.
  - Después de «No asistió» (HU0004-2.0, P1), el expediente vuelve a `prospecto`, así que **el enlace original de la carpeta vuelve a valer**.
  - El enlace nuevo de la invitación a reprogramar es por comodidad (IV nuevo) y no reemplaza al anterior.
  - Riesgo aceptado: un enlace reenviado o filtrado sirve mientras el prospecto no reserve (C28 b).

## ADR-19 Puntos de cambio
- **[EQUIPO, 29/10/2026] Regla:**
  - Todo valor provisional va en una variable validada (`api/src/config.ts`) o en el realm, nunca literal en el código.
  - Se crea una abstracción solo donde el cambio ya está decidido (almacenamiento), no por si acaso.
  - Los textos que debe entregar el colegio siguen el patrón de ADR-18: un módulo versionado (`borrador-1`) con lo pendiente entre corchetes.
- **Puntos de cambio vigentes:**

| Decisión | Valor hoy | Dónde vive | Cómo se cambia | Prueba que lo protege |
|---|---|---|---|---|
| D1 Almacenamiento (ADR-12) | `local` | `STORAGE_DRIVER` y `STORAGE_LOCAL_DIR` (`config.ts`); adaptadores en `api/src/almacenamiento/` (ADR-21) | Un adaptador nuevo que pase la suite de contrato; editar `.env` y recrear `api` | La suite de contrato `api/test/almacenamiento/contrato.ts` |
| D2 Calendario (ADR-12) | Solo BD | `horario_disponible` y `cita` (G09, P02) | Una HU nueva con su adaptador | `HU0003-*` (la reserva no llama a servicios externos) |
| D3 Acceso de la familia (ADR-02) | Contraseña temporal con `UPDATE_PASSWORD`, enviada por `agendamiento` | `api/src/identidad/keycloakAdmin.ts`, `api/src/crypto/contrasenaTemporal.ts` y el realm | Plan de HU | `D3 …` (API y E2E) |
| D4 Recordatorio de la visita | 24 h antes | `RECORDATORIO_VISITA_HORAS` (`config.ts`) | Editar `.env` y recrear `api` | `HU0003-1.0 … recordatorio …` |
| D5 WhatsApp (ADR-07) | Desactivado | `WHATSAPP_ENABLED` (`$env` de n8n) | Editar `.env` y recrear `n8n` (con la cuenta, C30) | `HU0002-1.0 [parte: sin WhatsApp] …` |
| D6 Política de contraseñas (ADR-02) | Ninguna; bloqueo tras 5 intentos | Realm (`infra/keycloak/realm-cil-admision.json` y su `README.md`) | Realm versionado y reimportación (C6; en producción, antes del primer despliegue, C12) | HU0023 (pendiente) |
| Campaña activa (ADR-14) | `2027` | `CAMPANA_ACTIVA` (`config.ts` y `theme.properties`) | Editar `.env` y recrear `api` y `keycloak` | `C23 …` |
| Carpeta informativa (ADR-18) | URL ficticia en dev | `CARPETA_INFORMATIVA_URL` (opcional, `config.ts`) | Editar `.env` y recrear `api` (C33) | `HU0002-1.0 [parte: correo] los textos del colegio van entre corchetes, y sin CARPETA_INFORMATIVA_URL el cuerpo lo dice` |
| Lugar de la visita (P02) | Vacío: «[Dirección del colegio]» | `DIRECCION_COLEGIO` (opcional, `config.ts`) | Editar `.env` y recrear `api` (C39) | `HU0003-1.0 … lugar …` |
| Textos de los avisos de la visita | `borrador-1`, entre corchetes | `api/src/services/avisosVisita.ts` | El colegio entrega los textos (C39) y se sube la versión | `HU0003-1.0 …` y `HU0004-*` (correos) |
| Bancos y cuenta del derecho de admisión (P07b) | `borrador-1`, entre corchetes | `api/src/services/derechoAdmision.ts` | El colegio entrega la lista de bancos y la cuenta (C48) y se sube la versión | `HU0007-*` |
| Textos del aviso de documentos faltantes (HU0017) | `borrador-1`, entre corchetes | `api/src/services/avisosCompletitud.ts` | El colegio entrega los textos y se sube la versión | `HU0017-2.0 …` |
| Textos del aviso de observaciones (HU0008, HU0011 y HU0024) | `borrador-1`, entre corchetes | `api/src/services/avisosValidacion.ts` | El colegio entrega los textos y se sube la versión | `HU0008-2.0 [parte: correo] …`, `HU0011-2.0 …` y `HU0024-2.0 …` |
| Tope de archivos por requisito (P06) | 20 (provisional) | `MAX_DOCUMENTOS_POR_REQUISITO` (`config.ts`, de 1 a 100; opcional en `.env`) | Editar `.env` y recrear `api` | `HU0006-1.0 (tope técnico) …` |

## ADR-20 Ficha de inscripción y cuestionario de expectativas (HU0005)
- **[EQUIPO, HU0005, 02/11/2026] Borrador de la ficha:** vive en las tablas del modelo v1.1, sin tablas nuevas (se descartó una tabla de borrador).
  - `Postulante` con `ficha_completa = false` guarda lo que haya; `Cuestionario_Expectativas` con `es_borrador = true` guarda las respuestas.
  - `estudio_en_colegio_peruano` y `tiene_condicion_especial` admiten `NULL` (migración `DROP NOT NULL`): `NULL` = sin responder. La API exige `true` o `false` para completar la ficha.
  - El DNI (del postulante y del segundo apoderado) solo se cifra y se hashea si ya tiene formato válido (DNI de 8 dígitos o CE). Si no, no se escribe, no se consulta `dni_hash` y el campo vuelve como pendiente.
  - El segundo apoderado (opcional) se guarda solo si trae nombres, apellidos, teléfono, correo y parentesco; si no, ese bloque queda pendiente y el resto se guarda.
  - Del titular, P05b solo edita DNI, parentesco y condición laboral; nombres, apellidos, teléfono y correo vienen de P01 y son de solo lectura (el correo es su usuario de Keycloak).
- **[EQUIPO, HU0005] Transición:** el primer guardado (borrador o completo) pasa el expediente de `portal_habilitado` a `en_postulacion` con `transicionarExpediente` (HU0005-2.0). «Guardar y continuar» solo marca `ficha_completa = true`, sin otro cambio de estado.
- **[EQUIPO, HU0005] Rutas `/familia/*`:** rol `familia`; la familia solo accede a su propio expediente (modelo §4.6).
  - Un expediente ajeno responde 404 `EXPEDIENTE_NO_ENCONTRADO`, igual que uno inexistente, para que los ids secuenciales no permitan enumerar expedientes. Si el id existe y es ajeno, se audita `acceso_denegado`. Un id que no existe responde el mismo 404, pero no deja evento: no hay un expediente al que referenciar.
  - Los ids de expediente, postulante y apoderado salen de la URL y del token, nunca del cuerpo (un campo de más recibe 400).
  - Un DNI ya registrado en otro postulante o apoderado responde 409 `DNI_YA_REGISTRADO` sin revelar datos del otro expediente (brecha C28 c y d).
- **[EQUIPO, HU0005] Ficha completa:** con `ficha_completa = true`, otro guardado (borrador o completo) responde 409 `FICHA_YA_COMPLETA` y P05 queda en solo lectura; reabrirla la decide HU0006. Fuera de `portal_habilitado` y `en_postulacion` responde 409 `FICHA_NO_EDITABLE`.
- **[EQUIPO, HU0005] Datos parciales:** el guardado es del estado completo del formulario. Un dato con formato inválido (p. ej. un DNI a medio escribir) se guarda como nulo y no conserva el valor válido anterior; un segundo apoderado a medias no se guarda (C43).
- **[EQUIPO, HU0005] Abandono:** guardado automático del borrador 2 s después del último cambio, al salir de la pantalla y al ocultar la pestaña. Con dos pestañas abiertas **gana el último guardado**: riesgo aceptado.
- **[EQUIPO, HU0005] Lista de documentos (R7):** `GET /familia/expedientes/:id/requisitos` es el contrato que consume HU0006. Responde 409 `FICHA_INCOMPLETA` mientras la ficha no esté completa.
- **[PROPUESTA, HU0005] Cuestionario:** las preguntas viven en `api/src/services/cuestionarioExpectativas.ts` (`borrador-1`, entre corchetes) hasta que el colegio las entregue (C42, ADR-19).

## ADR-21 Carga de documentos y comprobantes (HU0006 y HU0007)
- **[EQUIPO, HU0006 y HU0007, 03/11/2026] Almacenamiento:** interfaz `Almacenamiento` (`guardar`, `abrir`, `eliminar`) en `api/src/almacenamiento/`, con el adaptador `local` (D1, ADR-12) y el decorador de cifrado (ADR-03). Todo adaptador futuro (`gdrive`) pasa la suite de contrato `api/test/almacenamiento/contrato.ts`.
  - La clave de cada archivo es un UUID aleatorio; el nombre original no se usa como ruta ni se guarda (no hay columna, C49). `Documento.url_archivo` y `Pago.comprobante_url` guardan esa clave.
  - **La clave la genera siempre el servidor** (`guardar(contenido, clave?)`): nunca sale de la petición, y un campo `clave`, `url_archivo` o `ruta` en la carga se rechaza con 400. El cifrado fija la clave antes de guardar porque la usa como dato asociado (ADR-03).
  - **Guardar nunca pisa un archivo:** con una clave que ya existe, el adaptador falla con `CLAVE_EXISTENTE` y deja intacto el original. Lo exige la suite de contrato, así que todo adaptador futuro (`gdrive`) lo cumple.
  - Los archivos nunca pasan por n8n. Si hace falta avisar a n8n, solo con ids (ADR-16).
- **[EQUIPO, HU0006] Validación de la carga:** solo PDF, JPG y PNG, reconocidos por su firma (los primeros bytes), no por la extensión ni el `Content-Type`; un ejecutable renombrado se rechaza con 415 `FORMATO_NO_ADMITIDO`.
  - Máximo 10 MB (10 × 1024 × 1024 bytes), cortado mientras se recibe: 413 `ARCHIVO_DEMASIADO_GRANDE`, sin fila y sin archivo. El archivo no se carga entero en memoria.
  - Multipart con `busboy`: los campos van antes del archivo.
  - Si algo falla después de guardar el archivo, se elimina. Si la API cae entre el guardado y el COMMIT, el archivo queda huérfano (C45).
- **[EQUIPO, HU0006] Documentos:** la carga, el reemplazo y la confirmación se admiten en `en_postulacion` con la ficha completa. Un requisito admite varios archivos vigentes; el reemplazo inserta la fila nueva y marca `vigente = false` en la anterior, en la misma transacción.
  - **Tope técnico provisional (John, 03/11/2026):** 20 archivos vigentes por requisito (y por apoderado, si el requisito es por apoderado), en `MAX_DOCUMENTOS_POR_REQUISITO` (`config.ts`, de 1 a 100). Por encima responde 409 `LIMITE_DOCUMENTOS_REQUISITO` con «Ya cargaste el máximo de 20 archivos para este documento…», antes de recibir el archivo y otra vez bajo el bloqueo. Reemplazar no suma. No es una regla de negocio: evita que una cuenta llene el almacenamiento.
- **[EQUIPO, HU0006, P3 A] Confirmación:** «Confirmar documentos» registra el evento `documentos_confirmados` (§4.7) y no cambia el estado. Es la marca que toma HU0017 (C44). No verifica la completitud.
- **[EQUIPO, HU0006] Descarga:** solo por la API, en `/familia/*` para la familia y solo de su expediente (404 como en ADR-20). Cabeceras: `Content-Type` según el formato, `X-Content-Type-Options: nosniff`, `Content-Security-Policy: sandbox`, `Cache-Control: no-store` y `Content-Disposition: inline`. El personal no descarga en este bloque: lo hace HU0008 con R2 por documento (C17).
- **[EQUIPO, HU0007, P1 a] Derecho de admisión:** `Pago` `derecho_admision` con el monto de R16 (constante de la API, C26), fracción 1 y `pendiente` de Tesorería. El número de operación es único por banco (R19), y `banco` sale de una lista cerrada (`derechoAdmision.ts`, `borrador-1`). Un duplicado responde 409 `COMPROBANTE_DUPLICADO` sin revelar el otro expediente.
  - **Estado y fecha (Q-c y Q-g, John, 03/11/2026):** solo se registra con el expediente en `en_postulacion` (409 `DERECHO_NO_REGISTRABLE` en otro estado; HU0017 no lo amplía: el comprobante cuenta para la completitud, así que ningún expediente llega a `en_validacion` sin él, ADR-22 D2-a), y la fecha de pago debe ser una fecha real que no sea futura (validación técnica, hora de Lima). Un segundo comprobante del mismo expediente responde 409 `DERECHO_YA_REGISTRADO`.
  - La constancia de P07b usa el código `CONST-<código del expediente>-<id_pago>` (modelo §7). «Registrado el» solo aparece en la respuesta del registro: `Pago` no guarda la fecha de registro (C49).
- **[EQUIPO, HU0006, 03/11/2026] Desvíos respecto a los mockups de P05, P06 y P07b:**
  - **«Ir a Documentos» (P05):** botón que lleva a P06 desde «Paso siguiente: Documentos», al completar la ficha. El mockup de P05 solo llega a P06 por el menú; el botón se mantiene por comodidad.
  - **«Reemplazar» (P06):** se ofrece en todos los archivos vigentes, no solo en los observados como en el mockup («Subsana solo lo que esté observado»). Limitarlo a los observados queda para HU0011 (subsanación).
  - **Lo que no se muestra por falta de una HU o de un dato (C49 y C50):** en P06 la franja «Condición laboral declarada en la ficha» con «Editar en la ficha» y el nombre original del archivo; en P07b «Volver a Pagos» y «Registrado el» al volver a la pantalla.

## ADR-22 Verificación automática de completitud (HU0017)
- **[EQUIPO, HU0017, 03/11/2026] Qué decide cada componente:**
  - La **API** decide: aplica R7 y R8 sobre la BD, bloquea el expediente, hace la transición con auditoría y arma el mensaje.
  - **n8n** coordina: `recepcion-registro` recibe el evento o lo recupera con el barrido, y `verificacion-completitud` pide la decisión, ramifica y notifica por `notificacion-multicanal` (ADR-04 y ADR-16).
- **[EQUIPO, D1-A] Expediente incompleto:** se mantiene en `en_postulacion` (HU0017-2.0). R8 se corrigió, y el valor `incompleto` del enum queda sin uso.
- **[EQUIPO, D2-a] Derecho de admisión:** completo = cada requisito **obligatorio** de R7 con al menos un documento vigente **y** el Pago `derecho_admision` registrado, en cualquier estado de validación.
  - Si falta el pago, el aviso lo incluye, con el enlace a P07b.
  - Q-c no cambia: el derecho se registra solo en `en_postulacion` (ADR-21).
- **[EQUIPO, D4-X] Apertura de las ramas:** `en_postulacion → en_validacion` es la única transición. `estado_documental`, `estado_financiero` y el Pago quedan en `pendiente`: una rama abierta es una rama `pendiente` de un expediente `en_validacion`.
- **[EQUIPO, D5] Evento `completitud_verificada`** (§4.7, actor Sistema):
  - Se registra una vez por confirmación, bajo el bloqueo del expediente (el mismo de la carga y el reemplazo, ADR-21).
  - `detalle`: `resultado`, `faltantes` (`id_requisito`, `id_apoderado`), `derecho_registrado` y, si es incompleto, `id_notificacion` (el primer intento del aviso), solo con ids.
  - Una confirmación está pendiente de verificar si su `documentos_confirmados` es posterior al último `completitud_verificada`. «Posterior» se compara por `id_evento`: los dos eventos se insertan con el expediente bloqueado.
- **Idempotencia y aviso:**
  - `POST /internal/expedientes/:id/verificacion-completitud`:
    - responde 200 si el expediente está completo;
    - responde 201 con el aviso `documentos_faltantes` si no lo está;
    - responde 409 `VERIFICACION_NO_CORRESPONDE` si no está en `en_postulacion` o ya se verificó esa confirmación sin un aviso por retomar.
  - El aviso sigue ADR-07: una fila por intento, retoma a los 10 min y tope de 6 intentos con una fila de cierre `fallido`.
    - Sus filas son las `documentos_faltantes` con `id_notificacion` ≥ el `detalle.id_notificacion` de la verificación, no un ancla de tiempo como en `agendamiento`.
    - **Por qué:** cerrar un intento de la verificación anterior mueve su `fecha_envio`, que caería después del ancla de la nueva y cerraría un aviso ajeno.
    - Los reintentos usan los faltantes registrados en la verificación.
  - Una confirmación nueva es otra verificación.
- **[EQUIPO, ajuste 2] Confirmación sin cambios:** responde 409 `SIN_CAMBIOS`, sin evento ni correo, si la última verificación fue `incompleto` y desde entonces:
  - no hay un documento vigente con `fecha_carga` posterior;
  - y no apareció el Pago del derecho (`derecho_registrado` era `false`). `Pago` no guarda la fecha de registro (C49);
  - y no hubo ningún evento `cambio_configuracion` después de la verificación (John, 03/11/2026): si Secretaría quita o cambia en G09 el requisito faltante, la familia puede volver a confirmar sin cargar nada. Lo prueba `HU0017-2.0 (G09) …`.
    - **Alcance amplio, aceptado (John, 03/11/2026):** cuenta cualquier `cambio_configuracion`, aunque sea de otro grado o de un horario, sin filtrar por grado ni campaña. Se queda así hasta que C25 (7) defina qué pasa con los expedientes en curso cuando cambia la configuración.
    - **Hora real:** la `fecha_carga` del documento y la `fecha_hora` de la verificación se fijan con `clock_timestamp()` y no con el inicio de la transacción, para que una carga que esperó el bloqueo no quede fechada antes de una verificación que no la vio. Lo prueba `HU0017-2.0 (carrera) …`.
- **[EQUIPO, ajustes 3 y 4] Faltantes visibles:**
  - P06 muestra «Faltan: …» con los datos de la última `completitud_verificada` (`tipo_documento` y `parentesco`, y el derecho si falta).
  - El correo y P06 usan el **parentesco** del apoderado, nunca su nombre: el cuerpo del correo queda en las ejecuciones de error de n8n (C11).
  - Los textos del correo viven en `api/src/services/avisosCompletitud.ts` (`borrador-1`, ADR-19). El enlace es `${FRONTEND_PUBLIC_URL}/portal/documentos`.
- **Matriz:** HU0017-1.0 se verifica por partes: «estado y ramas» (HU0017) y «bandeja» (HU0008, C51).

## ADR-23 Validaciones en paralelo (HU0008, HU0011 y HU0024)
- **[EQUIPO, bloque 5, 04/11/2026] Las tres ramas (R9):**
  - **Documental** (Secretaría, G03): los documentos no financieros y `estado_documental`.
  - **Financiera** (Tesorería, G05): los documentos de categoría `financiero` y `estado_financiero`.
  - **Derecho de admisión** (Tesorería, G05): `Pago.estado_validacion`.
  - Cada documento vigente se marca conforme u observado. «Dar conformidad» (G03) y «Marcar conforme» (G05) pasan la rama de `pendiente` a `conforme` solo con todos sus documentos conformes (409 `DOCUMENTOS_SIN_REVISAR`). La primera observación pasa la rama a `observado`.
  - Transiciones: `pendiente → observado`, `pendiente → conforme` y `observado → pendiente` (subsanación). `en_revision` queda sin uso.
  - Si el grado no exige documentos financieros, «Marcar conforme» registra la conformidad sin documentos (supuesto 3, John, 04/11/2026). Lo prueba `HU0011-1.0 sin requisitos financieros …`.
- **[EQUIPO, B1] «Habilita el agendamiento»:**
  - Es una condición derivada: expediente en `en_validacion` con las tres ramas en `conforme`. No tiene estado ni transición propios, ni evento a n8n. HU0009-1.0 parte de ella y hace `en_validacion → en_evaluacion`.
  - La decisión que completa la unión lleva `habilita_agendamiento: true` en su `atencion_fin`.
  - Cada decisión bloquea el expediente (el mismo bloqueo de la carga de la familia) y evalúa la unión en la misma transacción, así que se registra una sola vez. Lo prueba `HU0008-1.0 (concurrencia) …`.
  - Cómo se entera la familia lo decide HU0009 (C52).
- **[EQUIPO, A1] Subsanación de la familia:**
  - **Documentos:** en `en_validacion` solo se reemplaza un documento vigente observado (409 `DOCUMENTO_NO_OBSERVADO`; una carga nueva sigue en `DOCUMENTOS_NO_EDITABLES`). La rama vuelve a `pendiente` cuando ya no tiene observados vigentes.
  - **Derecho:** el comprobante observado se regulariza con `PUT /familia/expedientes/:id/derecho-admision` en la misma fila del Pago (respeta `uq_pago_expediente_tipo_fraccion` y R19 sin contar el propio pago). Vuelve a `pendiente` y sin validador; el motivo se conserva hasta la nueva decisión. El archivo anterior **no se borra**.
  - **Evento `subsanacion_registrada`** (§4.7, ajuste 1 de John): documento `{ item, id_documento_nuevo, id_documento_anterior }`; pago `{ item, id_pago, anterior: { banco, numero_operacion, clave, motivo } }` (el motivo, porque la conformidad posterior lo borra del Pago; John, 04/11/2026). Con el `atencion_fin` de la observación, mide el tiempo de subsanación (HU0019).
  - Un ítem que volvió a pendiente muestra su motivo como «Motivo anterior» (G02, G03, G05, P06 y P07b), nunca como observación vigente.
- **[EQUIPO] Dos personas del mismo rol:** la decisión sobre un ítem ya decidido responde 409 (`DOCUMENTO_YA_REVISADO`, `VALIDACION_YA_REGISTRADA` o `PAGO_YA_VALIDADO`) y no pisa la anterior. Su `atencion_inicio` queda sin fin (§4.7 lo descarta a las 8 h).
- **[EQUIPO] Tiempo de atención (ADR-05):**
  - Ítems: `validacion_documental` y `documentacion_financiera` con el id del expediente, y `pago` con el id del pago.
  - `atencion_inicio` al abrir el detalle, si espera una decisión del personal: la rama en `pendiente` o con algún documento por revisar, y el comprobante en `pendiente`. Una rama observada sin documentos por revisar o un comprobante observado esperan a la familia. `atencion_fin` al decidir (observación, conformidad de la rama o decisión del pago); las marcas por documento no la cierran.
  - `registrarAtencionFin` siempre guarda `id_evento_inicio`: el último `atencion_inicio` abierto de la misma persona y el mismo ítem, o nulo (John, 04/11/2026).
- **[MODELO R2, C17] Acceso restringido por documento:**
  - G03 no recibe los documentos financieros. Abrir o validar uno desde `/bandeja` responde 403 y se audita `acceso_denegado` con `detalle.recurso`.
  - Las rutas financieras de `/tesoreria` montan `requireAccesoRestringido("documentacion_financiera")`.
  - Las descargas del personal van solo por la API, con las cabeceras de ADR-21. `/bandeja` y `/tesoreria` llevan `requirePersonalActivo` (C22).
- **[EQUIPO] Aviso de observaciones (C9, ADR-07):**
  - Tipo `subsanacion_solicitada`. La observación reserva el primer intento en su transacción (`atencion_fin.detalle.id_notificacion`) y la API dispara el webhook `verificacion-completitud` con `{ id_expediente, id_notificacion }` (ADR-16).
  - Solo se envía el aviso de la **última** observación, con todas las observaciones vigentes del expediente (motivo y enlace a P06 o P07b). Sus intentos son las filas del tipo con `id_notificacion ≥` el primero, como en ADR-22.
  - La retoma (10 min) la hace el barrido `GET /internal/observaciones/pendientes`, con tope de 6 intentos y fila de cierre `fallido`.
  - **Riesgo aceptado (John, 04/11/2026):** el motivo lo escribe el personal y queda en las ejecuciones de error de n8n (C11). G03 y G05 muestran en el campo «Describe el problema del documento; no copies su contenido».
  - WhatsApp (HU0008-2.0) queda pendiente (C30). No se avisa la conformidad (C50 (3)).
- **[EQUIPO] n8n:** `verificacion-completitud` gana la entrada de la rama validación (webhook y barrido cada minuto). La entrada de HU0017 no cambia.
- **[EQUIPO] Pestañas sin HU en el bloque:** se ven deshabilitadas (`aria-disabled`, title «Disponible con HU0009», «… HU0012», «… HU0015» o, en G03, «Disponible en una HU posterior», C53) y no hacen nada.

## Orden recomendado de implementación
0. **Sprint 0, base técnica** (no es una HU; se documenta como habilitador):
   - monorepo y docker-compose de dev con PostgreSQL (bases `admision`, `n8n` y `keycloak`), Keycloak, n8n, Mailpit, la API y el frontend;
   - el realm de Keycloak versionado;
   - la migración de las 19 entidades según el DBML v1.1;
   - el módulo de cifrado de DNI;
   - la validación de tokens y los roles en la API;
   - el servicio de transición de estado con auditoría;
   - el flujo `notificacion-multicanal` con correo a Mailpit;
   - las pruebas y el script de importación de workflows.

   El tema visual de login de Keycloak se construye en HU0023 y HU0021, no en el Sprint 0.
1. HU0021 → HU0022 (sin usuarios ni configuración de campaña, nada más funciona).
2. EPICA0001: HU0001 → HU0002 → HU0003 → HU0004 → HU0023.
3. EPICA0002: HU0005 → HU0006 → HU0017 → HU0007 → HU0008 → HU0024 → HU0011.
4. EPICA0003: HU0009 → HU0025 → HU0010 → HU0012 → HU0013 → HU0014 → HU0015.
5. EPICA0004: HU0016 → HU0020 → HU0018 → HU0019.
