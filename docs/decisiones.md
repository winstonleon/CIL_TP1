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
- **Costo a considerar:** Keycloak necesita alrededor de 1,25 GB de RAM. Hay que dimensionar el VPS con eso en cuenta.

## ADR-03 Cifrado a nivel de columna
- **[EQUIPO]** Los datos sensibles se cifran a nivel de columna.
- **[PROPUESTA]** Cifrado AES-256-GCM en la API (`node:crypto`). La clave va en la variable de entorno `DATA_ENCRYPTION_KEY` y nunca en la BD ni en el repo. Formato almacenado: `v1:iv:authTag:ciphertext` en base64, para poder rotar la clave.
- **[PROPUESTA]** Unicidad sobre datos cifrados: el TI exige DNI único, pero un cifrado con IV aleatorio no admite `UNIQUE`. Por eso se agrega una columna `dni_hash` = HMAC-SHA256(DNI normalizado, `DATA_HMAC_KEY`) con `UNIQUE`. Las búsquedas por DNI usan el hash.
- **[EQUIPO]** Columnas cifradas: el **DNI** de `Apoderado` y de `Postulante` (`dni_cifrado` + `dni_hash`), ya definidas en el modelo de datos v1.1.
- **[PENDIENTE]** Si se cifran más columnas, por ejemplo las observaciones del informe psicológico o del dictamen. No se cifra nada más sin aprobación.
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

## ADR-07 Notificaciones multicanal
- **[TI]** Canales: correo (SMTP) y WhatsApp. **[memoria del proyecto]** WhatsApp Cloud API oficial, con pago por plantilla.
- **[EQUIPO]** WhatsApp aún no está disponible y debe poder agregarse después sin rehacer flujos.
- **[PROPUESTA]** Todos los envíos pasan por el flujo `notificacion-multicanal`.
- **[MODELO R22]** Se envía por WhatsApp solo si `Consentimiento.autoriza_whatsapp = true` **y** `WHATSAPP_ENABLED=true`. Si no se cumplen las dos condiciones, no se crea `Notificacion` para ese canal y el flujo no falla.
- **[MODELO R22]** Un rebote del correo de la carpeta informativa pasa el expediente a `contacto_no_entregado` y aparece en G04 («Prospectos con contacto no entregado»).
- **[PENDIENTE]** Cómo se detecta un rebote de correo: por *webhook* del proveedor SMTP o leyendo el buzón de rebotes. Mailpit no simula rebotes. Resolverlo en el plan de HU0002.
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
- **[PENDIENTE]** Si en desarrollo se usa Google Drive real o un adaptador de almacenamiento local (`STORAGE_DRIVER=local|gdrive`). Lo mismo para Google Calendar frente a solo `Horario_Disponible` y `Cita` en BD. Preguntar antes de HU0003 y HU0006.

## ADR-13 Forma de trabajo
- **[EQUIPO]** Una HU por vez. Claude Code presenta el plan y espera aprobación antes de editar.
- **[PROPUESTA]** Una rama por HU: `hu/HU0001-solicitud-informacion`. Commits con el prefijo de la HU: `HU0001: ...`. Pull request a `main` revisado por el otro integrante.

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
