# Guía de instalación del kit en Claude Code (VS Code)

Este archivo es para John y Brayan, no para Claude Code. Se puede borrar del repo después de instalar.

## 0. Qué trae este kit

- `docs/der/modelo-datos.md`: el modelo de datos v1.1, con los cambios acordados el 08/10/2026 y su historial en la sección 8.
- `docs/ui/`: los 23 mockups en HTML, copiados del lienzo «Mockups – Sistema de Admisión CIL» (versión del 08/10/2026). Si cambias el lienzo, vuelve a copiar los archivos.
- Decisiones vigentes (`docs/decisiones.md`): Keycloak, DNI cifrado, métrica de atención y demás.

**Pendiente tuyo fuera del repo:** actualizar el TI para que coincida.
- Capítulo 6.2.4: agregar el contenedor de Keycloak.
- Tabla 8: pasar de 19 a 23 pantallas, o explicar las 4 variantes.
- Figura 12: actualizar el DER.
- HU0021-1.0: cambiar «envía las credenciales» por «envía el enlace para definir la contraseña».
- Instrucciones del Proyecto en claude.ai: siguen mencionando OCR/IA, NoSQL, S3, SMS y PWA.

## 1. Crear el repositorio

1. Crea un repo privado en GitHub (por ejemplo, `cil-admision`) y clónalo en `CIL_TP1`.
2. Descomprime este kit en la raíz del repo. Deben quedar `CLAUDE.md`, `.claude/`, `.mcp.json` y `docs/` en la raíz.
3. Copia `.env.example` a `.env` y completa los secretos. `.env` no se versiona.
4. Haz el primer commit: `chore: kit de contexto para Claude Code`.

## 2. Instalar las skills (desde la raíz del repo, en la terminal de VS Code)

Se instalan a nivel de proyecto, en `.claude/skills/`, y se versionan, así los dos usan las mismas.

```bash
npx skills add czlonkowski/n8n-skills -a claude-code \
  --skill n8n-workflow-patterns --skill n8n-node-configuration \
  --skill n8n-expression-syntax --skill n8n-code-javascript \
  --skill n8n-validation-expert --skill n8n-error-handling \
  --skill n8n-mcp-tools-expert --skill n8n-subworkflows \
  --skill n8n-binary-and-data

npx skills add vuejs-ai/skills -a claude-code \
  --skill vue-best-practices --skill vue-router-best-practices \
  --skill vue-pinia-best-practices --skill vue-testing-best-practices

npx skills add mattpocock/skills -a claude-code --skill tdd
```

Verifica con `npx skills ls -a claude-code`.

En PowerShell, reemplaza cada `\` del final de línea por un acento grave (`` ` ``), o escribe cada comando en una sola línea.

## 3. Conectar el n8n del proyecto a Claude Code (MCP `n8n-mcp`)

El MCP apunta **solo** al n8n del docker-compose del proyecto (`http://localhost:5679` por defecto,
`N8N_HOST_PORT` en `.env`), no a un n8n personal que tengas en 5678.

1. Con el entorno dev levantado, abre `http://localhost:5679`, crea el usuario owner y ve a **Settings → n8n API → Create API key**.
2. En PowerShell (una sola vez por PC), define las variables que lee `.mcp.json`:
   ```powershell
   setx N8N_CIL_API_URL "http://localhost:5679"
   setx N8N_CIL_API_KEY "<tu-api-key>"
   ```
3. Cierra **todo** VS Code y vuelve a abrirlo, para que tome las variables.
4. Al abrir Claude Code en el repo, te pedirá aprobar el servidor `n8n-mcp` del proyecto: acéptalo.
5. Prueba: pídele a Claude «usa n8n-mcp para hacer un health check de mi instancia».

Cada integrante usa su propia API key. La key nunca va en el repo.

Dos ajustes ya vienen en `.mcp.json`, sin secretos:
- **Versión fijada:** `npx -y n8n-mcp@2.92.1`. Para actualizarla, se cambia en `.mcp.json`, se prueba y se versiona; así los dos usan la misma.
- **`WEBHOOK_SECURITY_MODE=moderate`:** la protección SSRF de `n8n-mcp` viene en `strict` y bloquea `localhost`, así que el health check falla con «Localhost access is blocked in strict mode». `moderate` permite **solo** `localhost` y sigue bloqueando las IP privadas y las direcciones de metadatos de nube.

Si cambias `.mcp.json`, reinicia VS Code (o reconecta el servidor desde `/mcp`) para que tome el cambio.

**La primera vez puede fallar por tiempo.** Al arrancar con una versión que todavía no está en la caché, `npx` descarga `n8n-mcp` y eso puede tardar más de los 30 s que Claude Code espera; el servidor aparece como «connection timed out». No es un error de configuración: espera a que termine la descarga y reconéctalo desde `/mcp` (o recarga VS Code). Las siguientes veces arranca desde la caché.

### Credenciales de n8n del proyecto

Los flujos usan tres credenciales en **tu** n8n. Los secretos nunca van en el JSON de los flujos ni en variables de entorno de n8n (`.claude/rules/n8n.md`).

**Camino normal:** con el entorno levantado y `N8N_CIL_API_URL`/`N8N_CIL_API_KEY` definidas, ejecuta

```bash
npm run n8n:credenciales   # crea o actualiza las tres credenciales con los valores de tu .env (no los imprime)
npm run n8n:importar       # importa los flujos y comprueba que cada nodo quedó con su credencial
```

`n8n:credenciales` busca cada credencial por nombre exacto: si no existe la crea, y si existe la actualiza conservando su ID. Si tuvo que crear alguna, avisa que hay que correr `n8n:importar`. Crearlas a mano (**Overview → Create → Credential**) sigue siendo posible, pero copiar el secreto a mano es fácil de equivocar: un error da 403 «Authorization data is wrong!». La tabla resume lo que configura el script:

| Credencial | Tipo | Campos |
|---|---|---|
| `cil-smtp` | SMTP | User y Password vacíos · Host `mailpit` · Port `1025` · SSL/TLS desactivado · Disable STARTTLS activado · Client Host Name vacío (solo dev; en prod, el proveedor SMTP real) |
| `cil-webhook-secret` | Header Auth | Name `X-Webhook-Secret` · Value = valor de `N8N_WEBHOOK_SECRET` de tu `.env` |
| `cil-api-interna` | Header Auth | Name `Authorization` · Value = `Bearer ` (la palabra, un espacio) + valor de `INTERNAL_API_TOKEN` de tu `.env` · Allowed HTTP Request Domains = *Specific domains* `api` (host de `API_INTERNAL_URL`) |

**Un mismo secreto vive en dos lugares.** `INTERNAL_API_TOKEN` está en `.env` (lo valida la API) y en `cil-api-interna` (lo envía n8n). `N8N_WEBHOOK_SECRET` está en `.env` (lo envía la API al llamar al webhook) y en `cil-webhook-secret` (lo valida n8n). Si cambias uno, por ejemplo al ejecutar `generar-secretos.js` sobre un `.env` nuevo, vuelve a correr `npm run n8n:credenciales`; si no, las llamadas fallan con 401 o 403.

**Al rotar `N8N_WEBHOOK_SECRET`, recrea también `api`** (HU0001, ADR-16). La API lee el secreto y `N8N_WEBHOOK_INTERNAL_URL` al arrancar, para avisar a n8n con el webhook `captacion`. Si solo actualizas la credencial, la API sigue enviando el secreto viejo y n8n responde 403:

```bash
npm run n8n:credenciales
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d --no-deps api
```

En el VPS es lo mismo con `docker-compose.prod.yml`. Las dos variables son obligatorias para la API: sin ellas no arranca.

**Qué hace `n8n:importar` (HU0002, ADR-06):**
- **Orden:** importa primero `registro-errores`, después `notificacion-multicanal` y al final el resto (hoy `captacion`, `agendamiento` y `seguimiento-recordatorios`). Si falla uno del que dependen otros, se detiene.
- **Solo algunos flujos:** `npm run n8n:importar -- agendamiento seguimiento-recordatorios` importa y exporta solo esos, sin reescribir los demás JSON.
- **Publica cada flujo.** n8n 2.x guarda la actualización como borrador; el script lo publica y comprueba que la versión activa sea la importada. Un flujo no se puede publicar si su *Error Workflow* no tiene versión publicada: por eso `registro-errores` va primero.
- **Nombres, no IDs:** resuelve por nombre el `errorWorkflow` de cada flujo y el flujo que llama cada nodo Execute Workflow, y al exportar de vuelta al repo deja otra vez el nombre.
- **`registro-errores` es un workflow técnico** (C2), no uno de los 7 flujos del TI. Es el *Error Workflow* de los demás y avisa a la API con solo el flujo, el nodo y el id de la ejecución, nunca el mensaje del error. En el log de la API queda una línea como `Fallo en n8n (flujo=captacion, nodo=Detener: envío pospuesto, ejecución=142)`; los datos de esa ejecución se ven en la interfaz de n8n.

## 4. Abrir Claude Code y verificar

- Abre la carpeta del repo en VS Code y luego el panel de Claude Code.
- `CLAUDE.md`, `docs/decisiones.md` (importado), las reglas de `.claude/rules/` y los agentes de `.claude/agents/` se cargan solos. **No hay que adjuntarlos.**
- La sesión arranca en modo plan (`.claude/settings.json`): Claude propone y espera tu aprobación antes de editar.
- Para referirte a un archivo concreto en el chat, escribe `@` y su nombre (por ejemplo, `@HU0001.md`).
- Para un mockup, nómbralo por su ruta (`docs/ui/P05b-DatosPadres.dc.html`). Si quieres que vea el diseño visual, pega también una captura del lienzo en el chat.

## 5. Primer pedido: Sprint 0 (base técnica)

Pega esto tal cual:

```
Sprint 0 (base técnica, no es una HU). Lee CLAUDE.md, docs/decisiones.md, docs/der/modelo-datos.md y docs/tesis/diseno-TI.md (sección 6.2).
Antes de planificar, lista las decisiones PENDIENTE de docs/decisiones.md que afecten al Sprint 0 y hazme las preguntas para resolverlas.
Luego planifica SOLO:
- monorepo (frontend/, api/, n8n/, db/, e2e/, scripts/, infra/);
- docker-compose base + dev: postgres con las bases admision, n8n y keycloak; keycloak, n8n y la imagen de mailpit con versión fijada; la api y el frontend;
- realm de Keycloak versionado en infra/keycloak/ (roles, clientes y detección de fuerza bruta según ADR-02), sin el tema visual;
- migración inicial de las 19 entidades según el DBML v1.1, con sus CHECK;
- módulo de cifrado del DNI;
- middleware de validación de tokens y roles;
- servicio de transición de estado con auditoría y eventos atencion_inicio y atencion_fin;
- flujo notificacion-multicanal con correo a Mailpit y WhatsApp condicionado (ADR-07);
- scripts de pruebas y de importación de workflows;
- la sección "Comandos" de CLAUDE.md.
No implementes ninguna HU.
```

## 6. Pedido por HU (plantilla)

```
Implementa HU0001. Sigue el flujo de trabajo por HU de CLAUDE.md.
Pantallas: docs/ui/Main.dc.html (P01)
Rama: hu/HU0001-solicitud-informacion
```

Para ver un mockup con su diseño, abre el lienzo en claude.ai. Los `.dc.html` del repo solo se renderizan dentro del lienzo; para Claude Code sirven como fuente de campos, textos y colores.

Antes de aprobar un plan, puedes pedir: «Que guardian-alcance revise este plan».

## 7. Trabajo en pareja

- Cada HU va en su propia rama, con un pull request revisado por el otro.
- No trabajen los dos el mismo flujo de n8n a la vez: los JSON de n8n generan conflictos de merge difíciles.
- Si alguno corrige una decisión, se edita `docs/decisiones.md` a mano (Claude no puede) y se avisa al otro.

## 8. Limpieza fuera del repo

Las instrucciones del Proyecto «Desarrollo» en claude.ai todavía mencionan OCR/IA, NoSQL, S3, SMS y PWA. Conviene actualizarlas para que no contradigan `docs/decisiones.md` (ADR-11).

## 9. Notas del entorno de desarrollo

- **Después de traer cambios (`git pull`) o de cambiar de rama, corre `npm run db:migrate`.** `npm run test:e2e` y `npm run evidencias:matriz` (sin `--sin-e2e`) ya lo corren solos antes del E2E.
  - Las migraciones nuevas de `db/migrations/` no se aplican solas a la base de dev. Sin ellas, las pantallas o rutas que dependen de un cambio de esquema pueden responder 500. Por ejemplo, el bloque de HU0006 y HU0007 agregó dos migraciones (R19 por banco y el evento `documentos_confirmados`).
  - Es seguro repetirlo: aplica solo las pendientes, con el rol de migración. Las pruebas de la API (`npm run test:api`) usan `admision_test`, que recrean solas.
- **`docker compose up -d` recrea contenedores sin que hayas cambiado nada.** Puede deberse a que la letra de unidad se escribe distinto según la terminal: `c:\Users\…` en la terminal de VS Code y `C:\Users\…` en otras.
  - Compose calcula el *config-hash* de cada servicio con la ruta absoluta de sus montajes *bind* (`./infra/...`, `./api/src`, `./frontend/src`). Si la mayúscula cambia, el hash cambia y el servicio se recrea. Afecta a `postgres`, `keycloak`, `api` y `frontend`, pero no a `n8n` ni a `mailpit`, que no tienen montajes *bind*.
  - Es inofensivo: los datos se conservan en los volúmenes (`pgdata`, `n8n_data`).
  - Para comprobarlo antes de levantar, `docker compose -f docker-compose.yml -f docker-compose.dev.yml --dry-run up -d` muestra qué contenedores se recrearían, sin tocar nada.
  - Para evitarlo, usa siempre la misma terminal para `docker compose`.
- **Después de reimportar el realm de Keycloak** (procedimiento en `infra/keycloak/README.md`), corre en este orden:
  `npm run kc:usuarios-prueba`, `npm run db:seed` y `npm run dev:limpiar-personal-huerfano`.
  - Al borrar el realm desaparecen las cuentas del personal creadas en dev (desde G10, la API o el E2E), pero sus
    filas siguen en `personal`. El script marca `activo = false` en las filas `@ejemplo.test` sin usuario en
    Keycloak y deja la baja en la bitácora (`gestion_usuario`, origen `limpieza_dev`). No borra filas.
  - Solo corre contra el entorno local: aborta si `KEYCLOAK_PUBLIC_URL` o `FRONTEND_PUBLIC_URL` no son locales.
    Imprime solo cuántas filas cambió.
- **`CAMPANA_ACTIVA` es obligatoria** (HU0022). Copia la línea de `.env.example` a tu `.env` (en dev, `2027`).
  - Sin ella la API no arranca, y fallan `npm run db:seed`, `npm run dev:limpiar-personal-huerfano` y `npm run test:api`, porque cargan la misma configuración.
  - Si la agregas con los contenedores ya levantados, recrea `api` para que la reciba: `docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d --no-deps api`.

- **Ver el nombre de cada prueba** (para revisar la trazabilidad a mano): `npm run test:api -- -- --reporter=verbose`, y lo mismo con `test:front`.
  - Hacen falta los dos `--`. `test:api` llama a su vez a `npm run test --workspace api`: el primer `--` pasa el argumento a ese segundo `npm`, y el segundo lo pasa a Vitest.
  - Con un solo `--` (`npm run test:api -- --reporter=verbose`), el argumento lo toma npm y Vitest usa su reporter por defecto, que no lista las pruebas.
  - `npm run evidencias:matriz` ya llama a Vitest directamente con el reporter correcto.

### Campaña activa (`CAMPANA_ACTIVA`, HU0022)

- **Qué es:** la campaña de admisión que se configura y se atiende (ADR-14), por ejemplo `2027`.
  - G09 solo configura los grados, requisitos y horarios de esa campaña.
  - La muestran la barra lateral de la gestión interna («CIL · Campaña 2027») y el acceso del personal G01 («Colegio Internacional de Lima · Campaña 2027»).
  - La leen dos contenedores: `api` y `keycloak`. El tema G01 la toma de `theme.properties` con `${env.CAMPANA_ACTIVA}`.
- **Cómo se cambia de campaña:**
  1. Edita `CAMPANA_ACTIVA` en `.env`.
  2. Comprueba qué se recrearía: `docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d --dry-run --no-deps api keycloak`.
  3. Recrea solo esos dos: `docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d --no-deps api keycloak`. No hace falta reimportar el realm.
  - En el VPS es lo mismo con `docker-compose.prod.yml`.
- **Antes de cambiarla**, la campaña nueva debe tener sus grados en la base. Hoy G09 no da de alta grados (brecha C26): en dev los crea `npm run db:seed`, solo para 2027.
- **Limitaciones conocidas** (compromiso C26, antes del despliegue al VPS):
  - Cambiar de campaña exige a alguien con acceso al servidor y recrear `api` y `keycloak`. Además, en la realidad las campañas se superponen (2028 empieza mientras se cierra 2027), y hoy solo hay una campaña activa a la vez.
  - El derecho de admisión (S/ 300, R16) es una constante de la API: cambiarlo exige modificar el código, lo que contradice el «sin modificar su programación» de HU0022.

### Formulario P01 y enlaces para las redes (HU0001)

- **Qué es:** la solicitud de información y consentimiento (P01). Es pública: no pide iniciar sesión.
  - Dirección: `<FRONTEND_PUBLIC_URL>/solicitud-informacion` (en dev, `http://localhost:5173/solicitud-informacion`).
- **Enlaces que publica el colegio** en sus redes:
  - Facebook: `<FRONTEND_PUBLIC_URL>/solicitud-informacion?origen=facebook`
  - Instagram: `<FRONTEND_PUBLIC_URL>/solicitud-informacion?origen=instagram`
  - El parámetro queda como canal de origen del consentimiento (`consentimiento.canal_origen`). Sin `?origen=`, o con otro valor, el canal es `formulario_web`.
  - Se compara sin distinguir mayúsculas: `?origen=Facebook` o `?origen=INSTAGRAM` también cuentan como `facebook` e `instagram`.
- **Límite por IP** (ADR-17): 5 envíos cada 10 minutos.
  - En dev todo el tráfico del navegador pasa por el proxy de Vite y comparte un solo contador: si repites el E2E o las pruebas manuales, puede aparecer «Recibimos varias solicitudes desde tu conexión…».
  - Las llamadas directas al puerto de la API (desde el host) cuentan aparte. `e2e/captacion.spec.ts` registra 3 prospectos por el navegador y el proxy de Vite y 4 por llamadas directas: correr ese archivo solo, más de una vez en menos de 10 minutos, ya no da 429: **antes de cada corrida E2E, `e2e/globalSetup.ts` reinicia la `api` y espera a que esté `healthy`** (hasta 120 s), así el contador en memoria empieza vacío (C16). Si la `api` no queda `healthy` a tiempo, el E2E se aborta con un error que indica cómo ver su log.
  - `docker compose -f docker-compose.yml -f docker-compose.dev.yml restart api` lo limpia.
- **Cada envío dispara el flujo `captacion`** (HU0002), que manda la carpeta informativa en menos de un minuto. Si n8n no está levantado, el log de la API dice `Evento captacion no entregado a n8n (id_expediente=…, 3 intentos, …)` y el barrido de `captacion` la manda cuando n8n vuelve (C27).
- **La política de privacidad es provisional** (versión `borrador-1`, texto entre corchetes) hasta que el colegio entregue la real (C29).

### Carpeta informativa y flujo `captacion` (HU0002)

- **Qué es:** tras cada registro de P01, el flujo `captacion` de n8n envía por correo la carpeta informativa con el enlace para agendar la visita guiada (P02). Un rechazo del destinatario deja el prospecto en «Prospectos con contacto no entregado» de G04 (Visitas guiadas, Secretaría).
- **Variables nuevas en `.env`** (las dos están en `.env.example`):
  - `ENLACE_VISITA_KEY`: clave del token del enlace de P02 (32 bytes en base64, ADR-18). Es un secreto: agrega la línea vacía y corre `node scripts/generar-secretos.js`, que la genera sin imprimirla. Si la cambias, los enlaces ya enviados dejan de valer.
  - `CARPETA_INFORMATIVA_URL`: enlace a la carpeta digital del colegio. Es opcional: vacía, el correo lo dice entre corchetes. En dev se usa la URL ficticia `https://carpeta.ejemplo.test/admision-2027`, hasta que el colegio entregue la real (C33).
  - Si agregas o cambias alguna con los contenedores levantados, recrea `api`: `docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d --no-deps api`.
- **Rebotes en dev:** Mailpit rechaza con 550 a todo destinatario que no sea `@ejemplo.test` (`MP_SMTP_ALLOWED_RECIPIENTS` en `docker-compose.dev.yml`, ADR-07). Para probar un rebote, usa un correo `@rebota.ejemplo.test`.
  - Si tu contenedor de Mailpit es anterior a HU0002, recréalo para que tome la variable: `docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d --force-recreate --no-deps mailpit`. Mailpit guarda los correos en memoria, así que se pierden los que tenía.
- **Barrido:** `captacion` revisa cada minuto los prospectos sin carpeta registrados hace más de 1 minuto y las carpetas `pendiente` intentadas hace más de 10 minutos (C27). Al importarlo por primera vez en una base de dev con prospectos, les manda la carpeta a todos.
- **Antes de correr el E2E, desactiva la suspensión automática del equipo** (en Windows 11, Configuración → Sistema → Energía y batería: que no se suspenda mientras corre), o mantenlo activo.
  - Si el equipo se suspende a mitad de una prueba, n8n y la prueba se detienen y la prueba falla por *timeout* al reanudarse (pasó el 25/10/2026, C16).
  - Cada corrida E2E (`npm run test:e2e` o la de `npm run evidencias:matriz`) empieza reiniciando la `api` y esperando a que esté `healthy` (`e2e/globalSetup.ts`, C16): el límite por IP de P01 y P02 (ADR-17) arranca en cero. Mientras se reinicia, la API no responde durante unos segundos.
  - El E2E completo tarda unos 7 minutos: `e2e/captacion.spec.ts` detiene y arranca `n8n` y `mailpit`, y espera al barrido.

### Visita guiada: P02, G04 y los flujos `agendamiento` y `seguimiento-recordatorios` (HU0003 y HU0004)

- **Qué es:**
  - La familia abre el enlace de la carpeta y reserva su visita en P02 (`/visita-guiada?t=…`, pública).
  - `agendamiento` le envía la confirmación, y `seguimiento-recordatorios` el recordatorio, `RECORDATORIO_VISITA_HORAS` antes de la visita.
  - En G04 (Visitas guiadas, Secretaría):
    - «Asistió» → «Registrar y habilitar portal» crea la cuenta de la familia en Keycloak (rol `familia`) y `agendamiento` le envía la contraseña temporal. En el primer ingreso a `/portal`, Keycloak pide cambiarla (tema por defecto hasta HU0023).
    - «No asistió» le envía una invitación a reprogramar con un enlace de P02.
- **Variables nuevas en `.env`** (las dos están en `.env.example`; no son secretos):
  - `RECORDATORIO_VISITA_HORAS`: horas de anticipación del recordatorio (1 a 168). Es obligatoria: sin ella la API no arranca. El valor provisional es `24` (C37).
  - `DIRECCION_COLEGIO`: el «Lugar» de P02 y de los correos. Es opcional: vacía, se ve «[Dirección del colegio]» (C39).
  - `CORREO_ADMISION`: el buzón del personal de admisión, que recibe el aviso del dictamen «En observación» (HU0010-2.0, ADR-25). Es **obligatoria**: sin ella la API no arranca. En dev, `admision@ejemplo.test`.
  - Si agregas o cambias alguna con los contenedores levantados, recrea `api`: `docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d --no-deps api`.
- **Horarios:** P02 ofrece los horarios de visita de la campaña activa que Secretaría crea en G09 (pestaña Horarios), cuyo responsable es una directora activa. Sin horarios, P02 dice que no hay horarios disponibles.
- **Ejecuciones de n8n (ADR-02 D3, R1; C10):**
  - `docker-compose.yml` fija `EXECUTIONS_DATA_PRUNE_HARD_DELETE_INTERVAL=1` y `EXECUTIONS_DATA_HARD_DELETE_BUFFER=0` en el servicio `n8n`. Así, una ejecución que no se guarda (con la contraseña temporal o con `X-Webhook-Secret`) desaparece de la base `n8n` en 1 minuto como máximo.
  - Si tu contenedor de `n8n` es anterior, recréalo: `docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d n8n`.
- **Barridos en dev:** `agendamiento` y `seguimiento-recordatorios` revisan cada minuto las citas de dev. Envían correos reales a Mailpit y, en las credenciales, fijan contraseñas temporales en el Keycloak de dev.
- **E2E:** `e2e/visita-guiada.spec.ts` tarda unos 12 minutos. Espera el recordatorio y dos ciclos del barrido, y detiene y arranca `mailpit`. Correrlo dos veces en menos de 10 minutos da 429, por el límite de reservas de P02 por IP (ADR-17).
