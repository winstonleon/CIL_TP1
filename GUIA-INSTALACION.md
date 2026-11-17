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

- **Instalación desde cero, en este orden y con dev levantado.** Sin el paso 4 no se emite ninguna Carta de Vacante.
  1. `node scripts/generar-secretos.js`: rellena los secretos vacíos o con «cambiar» de `.env`.
  2. `npm run kc:usuarios-prueba`: usuarios ficticios de Keycloak.
  3. `npm run db:migrate` y luego `npm run db:seed`: esquema y datos ficticios de `admision`.
  4. `npm run dev:firma-ficticia`: firma ficticia de la directora de prueba. Va después del seed, porque necesita su fila en `personal`.
  5. `npm run dev:agenda`: horarios de la demo en G09, para que P02 y P08 tengan fechas. Va después del seed, porque usa las cuentas de prueba de `personal`.
  6. `npm run n8n:credenciales` y luego `npm run n8n:importar`: credenciales y flujos de n8n (sección 3).
  7. `npx --workspace e2e playwright install chromium`: navegador para el E2E.
- **Horarios de la demo (`npm run dev:agenda`, solo dev).** Crea los horarios de la campaña activa desde hoy hasta el 31/03/2027, de lunes a viernes y de 8:00 a 13:00 (hora de Lima):
  - visita (directora de prueba) y evaluación académica (evaluador de prueba): de lunes a viernes, turnos de 1 h con 1 cupo;
  - psicóloga de prueba: jornada de observación los lunes y miércoles (un bloque de 8:00 a 13:00 con 6 cupos), evaluación psicológica los martes y jueves y entrevista a los padres los viernes (turnos de 1 h con 1 cupo).
  - Usa el mismo servicio de G09: valida el responsable y la superposición, y cada alta queda en la bitácora (`cambio_configuracion`, con la secretaria de prueba como actor).
  - Es seguro repetirlo: salta los horarios que ya existen y los que se cruzan con otro del mismo responsable (p. ej., los de 5 min que deja el E2E), sin tocarlos. Al final imprime cuántos creó por tipo y cuántos días saltó por feriado.
  - Los feriados están en `api/scripts/feriados.json`, que se edita y se versiona. Los de 2027 se confirman cuando se publique el calendario oficial; los días no laborables del sector público no se incluyen, salvo que el colegio cierre.
  - Tiene la misma guarda que `dev:demo`: no corre con `NODE_ENV=production`, con otra base que `admision` ni con URLs que no sean locales.
  - Los valores (duraciones, cupos y reparto de la psicóloga) son provisionales (C83). En producción, los horarios los crea Secretaría en G09 (C82).
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

### Firma de la Directora y Carta de Vacante (HU0016)

- **Sin firma cargada no se emite ninguna carta.** La API responde 409 `FIRMA_NO_DISPONIBLE` y el expediente sigue en `vacante_asignada`. El barrido reintenta cada minuto y cada intento deja una línea en el log de la API, solo con el id del expediente. En G07 el botón sigue habilitado y el error aparece al pulsarlo.
- **En dev:** `npm run dev:firma-ficticia` carga en `directora.prueba@ejemplo.test` una imagen que dice «FIRMA FICTICIA · SOLO PRUEBAS». Es seguro repetirlo: si ya la tiene, no hace nada. Hay que correrlo otra vez si se recrea el volumen `archivos`.
- **Firma real:** `npm run firma:cargar -- <correo de la directora> <ruta de la imagen>`, con un PNG o JPG de hasta 1 MB y la cuenta activa.
  - Pasa la imagen al contenedor `api`, porque el volumen `archivos` solo se ve desde ahí, y queda cifrada como los documentos (ADR-21). No hay pantalla ni ruta HTTP para cargarla o leerla.
  - Reemplaza la anterior y la borra: las cartas ya emitidas la llevan incrustada.
  - Deja `gestion_usuario` en la bitácora.
- **Quién firma:** la directora activa con firma cargada; si hay varias, la que adjudicó la vacante.
- **Después de traer este cambio a una PC ya instalada:** `pdfkit` es una dependencia nueva de la imagen, así que hay que reconstruirla y recrear el contenedor, y después correr lo demás:
  ```bash
  docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d --build api
  npm run db:migrate
  npm run dev:firma-ficticia
  npm run n8n:importar
  ```

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
  - `CORREO_TESORERIA`: el buzón de Tesorería, que recibe el aviso de un comprobante de la cuota de ingreso por conciliar (HU0014-1.0, ADR-26). Es **obligatoria**: sin ella la API no arranca. En dev, `tesoreria@ejemplo.test` (llega a Mailpit).
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

### Seguimiento programado y acceso de las familias (HU0018 y HU0023)

- **Revisión diaria (R20 y R21, ADR-30):** `seguimiento-recordatorios` revisa cada día a las 08:00 de Lima los expedientes con una acción pendiente de la familia: envía el recordatorio por inactividad y caduca los que vencieron su plazo. En dev también toma los expedientes viejos de otras corridas del E2E (C16).
- **Plazos:** son provisionales y opcionales en `.env` (`PLAZO_POSTULACION_DIAS` y los demás de `.env.example`, de 3 a 90 días). Para cambiarlos, edita `.env` y recrea `api`.
- **Correrla a mano** (la usa el E2E, D8-A), sin esperar a las 08:00:
  1. Busca el id del flujo: `docker compose -f docker-compose.yml -f docker-compose.dev.yml exec -T n8n n8n list:workflow`.
  2. Córrelo por su Manual Trigger «Revisión manual»:
     `docker compose -f docker-compose.yml -f docker-compose.dev.yml exec -T n8n sh -c 'N8N_RUNNERS_BROKER_PORT=$N8N_CLI_RUNNERS_BROKER_PORT n8n execute --id=<id>'`
  - `N8N_CLI_RUNNERS_BROKER_PORT` está en `docker-compose.yml` (no en `.env`): `n8n execute` arranca un segundo proceso de n8n, y el puerto por defecto de su task broker ya lo usa el n8n principal. Si tu contenedor de `n8n` es anterior al bloque 11, recréalo: `docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d n8n`.
  - La salida de `n8n execute` trae los asuntos y cuerpos de los avisos (datos ficticios en dev): no la compartas como evidencia.
- **Tema de login (ADR-31):** P03, P03b y P03c se ven en `portal-familias` y G01 en `gestion-interna`. Un cambio en el realm (`login_theme`, `resetPasswordAllowed`) exige reimportarlo (`infra/keycloak/README.md`); un cambio en las plantillas se ve al recargar la página.
- **Cuenta bloqueada en dev:** tras 5 intentos fallidos, una cuenta queda bloqueada por un tiempo (provisional, C6). Para desbloquearla sin esperar: consola de Keycloak → realm `cil-admision` → **Users** → la cuenta → **Details** → desactivar el bloqueo temporal, o `DELETE /admin/realms/cil-admision/attack-detection/brute-force/users/<id>` por la Admin API (lo hace el E2E al terminar).

## 10. Despliegue en producción (VPS)

**Estado (16/11/2026):** ensayado en una PC con `docker-compose.prod.yml`, un certificado autofirmado y
`npm run prod:verificar`. **Todavía no se ha desplegado en un VPS.** Lo que depende de un dominio o de un servidor Linux
está escrito, pero sin probar, y lleva la marca **[sin probar]**.

**No abrir a familias reales todavía.** Faltan, entre otros compromisos de «Antes del despliegue al VPS»
(`docs/compromisos.md`): el SMTP real (C12; sin él no sale ningún correo), la cuenta inicial de la Directora (C18) y,
del respaldo (C35), la copia fuera del servidor y el simulacro de restauración en un servidor nuevo. El respaldo diario
cifrado en el propio servidor ya está (más abajo).

### Qué cambia respecto de dev

- **Solo NGINX publica puertos** (80 y 443). Postgres, Keycloak, n8n y la API solo existen en la red interna de Docker.
- **NGINX** (`infra/nginx/cil.conf.template`) termina TLS, sirve el build de Vue y reenvía `/api` a la API y `/auth` a
  Keycloak. No publica `/api/internal/*` (C19), los webhooks ni el editor de n8n (C11), ni la consola de administración
  de Keycloak. Su registro de acceso no guarda la consulta (`?t=…`) ni el `Referer`.
- **HTTPS es obligatorio:** el ingreso usa PKCE, que el navegador solo permite en un contexto seguro. Por HTTP el ingreso
  falla aunque todo lo demás cargue.
- **La API corre con `tsx`**, sin recarga en caliente, con `NODE_ENV=production` y sin privilegios de root. Limitación
  aceptada: arranca más lento y usa algo más de memoria que con JavaScript compilado. Como `tsx` no revisa los tipos, la
  imagen de producción no se construye si `tsc --noEmit` falla.
- **No existe `admision_test`** (C14) y **n8n recibe sus secretos como archivos**, no como variables (C5).
- **No hay Mailpit:** el correo necesita un servidor SMTP real (C12, pendiente).

### Requisitos del servidor

- Linux con Docker Engine y el plugin Compose. Se ensayó con Docker 29.9 y Compose 5.7; hace falta un Compose que admita
  secretos tomados de una variable (`secrets.<nombre>.environment`).
- Node.js 22, solo para `scripts/generar-secretos.js` y `npm run prod:verificar`. No hace falta `npm ci`.
- Memoria: en reposo, el ensayo usó cerca de 1,5 GB (Keycloak 0,9 GB y n8n 0,4 GB). Keycloak pide más al arrancar.
- Un dominio que apunte al servidor, para el certificado. **Pendiente: hoy no hay dominio.**
- Firewall: del exterior solo se ven el 22, el 80 y el 443. SSH solo con llave, sin contraseña. Docker publica sus
  puertos por encima de `ufw`: por eso ningún otro servicio publica nada.

### Primera instalación

En el servidor, desde la raíz del repo clonado. `C` abrevia el comando de Compose:

```bash
C="docker compose -f docker-compose.yml -f docker-compose.prod.yml"
```

1. **`.env`:** `cp .env.example .env`, reemplaza en él las variables de `.env.prod.example` (el dominio, `TLS_CERT_DIR`,
   `ACME_WEBROOT_DIR`, `RESPALDO_DIR`, `RESPALDO_CLAVE_PUBLICA` y `N8N_CIL_API_KEY` vacía) y completa los datos del
   colegio. La clave del respaldo se genera **fuera** del servidor (ver «Respaldo diario»). Después:
   ```bash
   node scripts/generar-secretos.js
   chmod 600 .env
   ```
   **Fija el dominio definitivo antes del primer arranque.** Va dentro del JavaScript del frontend y del realm de
   Keycloak, que se importa una sola vez. Si cambia después, hay que reconstruir `nginx` y corregir en Keycloak las URL
   de retorno de los clientes `portal-familias` y `gestion-interna`, o empezar con volúmenes nuevos si aún no hay datos.
2. **Certificado provisional**, para que NGINX pueda arrancar antes de pedir el definitivo. El navegador mostrará una
   advertencia: sirve para ensayar con el equipo, no para las familias.
   ```bash
   sudo mkdir -p /etc/cil/tls /var/www/cil-acme
   sudo install -d -m 700 /var/backups/cil      # RESPALDO_DIR
   sudo openssl req -x509 -newkey rsa:2048 -nodes -days 30 -subj "/CN=<dominio>" \
     -keyout /etc/cil/tls/privkey.pem -out /etc/cil/tls/fullchain.pem
   ```
3. **Imágenes, base y migraciones**, en este orden. Las migraciones van antes de levantar la API:
   ```bash
   $C --profile tools build
   $C up -d postgres
   $C --profile tools run --rm admin db:migrate
   $C up -d
   ```
   La primera vez, Keycloak importa el realm y tarda cerca de dos minutos. Mientras tanto `/auth` responde 503
   («Bootstrap in progress»), aunque el contenedor ya figure como `healthy` (en el ensayo: `healthy` a los 73 s y
   `/auth` listo a los 136 s).
4. **n8n: usuario owner y clave de API**, una sola vez. El editor no se publica: se abre por un túnel SSH hacia el
   contenedor. **[sin probar: en Docker Desktop las IP de los contenedores no se alcanzan desde el host; en el ensayo el
   owner y la clave se crearon desde dentro del contenedor]**
   ```bash
   # En el servidor, la IP del contenedor:
   docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' cil-admision-n8n-1
   # En tu PC, con esa IP:
   ssh -L 5679:<ip>:5678 <usuario>@<servidor>
   ```
   Abre `http://localhost:5679`, crea el owner y una clave en **Settings → n8n API**. Pégala en `N8N_CIL_API_KEY` del
   `.env` del servidor y corre:
   ```bash
   $C --profile tools run --rm admin n8n:credenciales
   $C --profile tools run --rm admin n8n:importar
   ```
   `n8n:credenciales` todavía configura el SMTP sin usuario ni TLS (C12).
5. **Certificado de Let's Encrypt** (más abajo).
6. **Verificación:** `npm run prod:verificar` (más abajo).

### El contenedor `admin`

Las migraciones, las credenciales y los flujos de n8n se administran desde dentro de la red interna, con un contenedor
de un solo uso que no arranca con `up`. Así Postgres y n8n no publican ningún puerto.

```bash
$C --profile tools run --rm admin <script>      # db:migrate · n8n:credenciales · n8n:importar
```

- Lleva los scripts, las migraciones y los flujos del commit con que se construyó la imagen. Después de un `git pull`
  hay que reconstruirla: `$C --profile tools build`.
- Recibe solo las variables que esos scripts necesitan, y los secretos como archivos (variables `*_FILE`).
- `n8n:importar` reescribe los JSON con el estado de la instancia. Dentro del contenedor esa copia se descarta: el repo
  del servidor no cambia.
- En dev nada cambia: los mismos scripts corren en el host, contra los puertos publicados en `127.0.0.1`.

### Verificación (`npm run prod:verificar`)

Se corre en el servidor. Comprueba, entre otras cosas: que solo NGINX publique puertos, la redirección a HTTPS, el
certificado, que `/api/internal` y sus variantes no lleguen a la API (C19), que los webhooks no se publiquen (C11), el
tope de 11 MB de las cargas (C46), Keycloak bajo `/auth`, el registro de acceso sin consultas, los secretos de n8n (C5)
y que no exista `admision_test` (C14), y que el último respaldo haya terminado bien hace menos de 26 h (C35).

- `--certificado-autofirmado`: mientras el certificado sea el provisional.
- `--limite-por-ip`: comprueba además que `X-Forwarded-For` no esquiva el límite por IP. Deja la IP desde la que se
  corre sin poder enviar P01 durante 10 minutos.
- Con `PROD_VERIFICAR_USUARIO` y `PROD_VERIFICAR_CONTRASENA` en el entorno, comprueba el ingreso de esa cuenta y que la
  API acepte su token.

Además, a mano y como evidencia. **[sin probar: requiere el servidor]**

- `ss -tlnp` en el servidor y `nmap` desde otra máquina: solo el 22, el 80 y el 443.
- `$C logs --tail 20 nginx` después de entrar desde otra red: la primera columna debe ser la IP pública del visitante.
  Si es una IP de Docker (172.x), todas las familias compartirían el límite por IP de P01 y P02.

### Certificado TLS con Let's Encrypt **[sin probar: requiere dominio]**

NGINX solo lee `fullchain.pem` y `privkey.pem` de `TLS_CERT_DIR`. El certificado lo pide y lo renueva `certbot`,
instalado en el servidor, sin detener NGINX: valida el dominio con los archivos que deja en `ACME_WEBROOT_DIR`, que
NGINX sirve por el puerto 80.

```bash
sudo apt install certbot
sudo certbot certonly --webroot -w /var/www/cil-acme -d <dominio> \
  --deploy-hook 'cp -L "$RENEWED_LINEAGE/fullchain.pem" "$RENEWED_LINEAGE/privkey.pem" /etc/cil/tls/ && docker exec cil-admision-nginx-1 nginx -s reload'
```

- El certificado vence a los 90 días. `certbot` lo renueva solo con su temporizador (`systemctl list-timers certbot.timer`)
  y, después de cada renovación, el `--deploy-hook` copia los archivos y recarga NGINX. Sin ese paso, el sitio deja de
  abrir cuando vence el certificado.
- Después de pedirlo, comprueba que `/etc/cil/tls` tiene los archivos nuevos. Si no, corre a mano el comando del
  `--deploy-hook`.
- Ensaya la renovación sin esperar: `sudo certbot renew --dry-run`. `npm run prod:verificar` avisa si el certificado
  vence en menos de 15 días.
- Hace falta el puerto 80 abierto, para la validación y para la redirección a HTTPS.

### Keycloak sin consola publicada

La consola de administración no se publica. Keycloak se administra con `kcadm.sh` dentro del contenedor:

```bash
$C exec keycloak sh -c '/opt/keycloak/bin/kcadm.sh config credentials --server http://localhost:8080/auth --realm master --user "$KC_BOOTSTRAP_ADMIN_USERNAME" --password "$KC_BOOTSTRAP_ADMIN_PASSWORD"'
$C exec keycloak /opt/keycloak/bin/kcadm.sh get events -r cil-admision
$C exec keycloak /opt/keycloak/bin/kcadm.sh get users -r cil-admision -q username=<correo> --fields id
$C exec keycloak /opt/keycloak/bin/kcadm.sh delete attack-detection/brute-force/users/<id> -r cil-admision
```

El primero abre la sesión de administración; los otros listan los eventos, buscan una cuenta y la desbloquean.

- **Eventos de inicio de sesión (C24):** el realm guarda solo los intentos fallidos (`LOGIN_ERROR`) y los bloqueos
  temporales (`USER_DISABLED_BY_TEMPORARY_LOCKOUT`), con el usuario y la IP, durante 90 días. Los ingresos correctos no
  se guardan. Es la evidencia de HU0023-2.0. La retención es provisional: la fija el colegio.
- El realm de producción se importa una sola vez. Un cambio posterior en `realm-cil-admision.json` no se aplica solo.

### Respaldo diario (C35)

El servicio `respaldo` (`infra/respaldo/respaldar.sh`) respalda cada día a las 02:00 de Lima. Además, mientras el
último respaldo no sea bueno y de menos de 26 h (porque falló o porque el contenedor estuvo detenido), reintenta al
arrancar y cada hora. Con el servicio funcionando se pierden como máximo unas 27 h de datos. Deja en `RESPALDO_DIR` una carpeta `AAAAMMDD-HHMMSS` con las tres bases
(`pg_dump`), los roles (`pg_dumpall --globals-only`), el volumen `archivos` y su manifiesto, **todo cifrado con age**.
Conserva 14 días y nunca menos de los 7 últimos; la poda corre solo después de un respaldo exitoso.

- **Qué no protege todavía:** la pérdida del servidor. El respaldo vive en el mismo disco que la base hasta que exista
  la copia fuera del VPS (C35, pendiente: el destino lo decide el colegio). No se afirma recuperación ante la pérdida del
  servidor mientras tanto.
- **n8n sin ejecuciones:** de la base `n8n` no se respaldan los datos de `execution*` (correos, cuerpos de avisos y
  `X-Webhook-Secret`, C10 y C11). Sí van los flujos, las credenciales cifradas, los usuarios y la clave de API.
- **Retención y borrado:** un dato que una familia pida borrar sigue en los respaldos hasta que estos venzan: 14 días si
  los respaldos funcionan. Si fallan varios días seguidos, los 7 últimos buenos no se borran hasta que vuelva a haber
  uno exitoso, así que ese plazo se alarga lo mismo que dure la falla.

**Claves: tres cosas distintas, ninguna junto al respaldo.**

1. **Clave privada de age** (`AGE-SECRET-KEY-…`): descifra los respaldos. Se genera en la máquina del responsable, no en
   el servidor; en el `.env` del servidor va solo la línea pública:
   ```bash
   age-keygen -o clave-respaldo-cil.txt      # imprime «Public key: age1…» → RESPALDO_CLAVE_PUBLICA
   ```
2. **El `.env` del servidor:** `ARCHIVOS_ENCRYPTION_KEY`, `DATA_ENCRYPTION_KEY` y `DATA_HMAC_KEY` (sin ellas los DNI y
   los archivos restaurados no se leen, C47), `N8N_ENCRYPTION_KEY` y las contraseñas de las bases. El respaldo no lo
   incluye.
3. **Propuesta, por confirmar con John y el colegio:** dos copias de cada una, en dos lugares distintos, con un
   responsable nombrado y una revisión de que siguen legibles. Hoy no hay responsable ni lugares definidos.

**Revisión diaria** durante la validación con familias: `npm run prod:verificar` (o `$C exec respaldo respaldar.sh
comprobar`). Sin clave privada en el servidor, solo puede comprobar que terminó, que es reciente, que cuadra con su
manifiesto y que está cifrado; que se pueda restaurar se prueba con el simulacro.

**Respaldo a mano**, por ejemplo antes de actualizar: `$C exec respaldo respaldar.sh una-vez`.

**Simulacro de restauración en un servidor nuevo [sin probar: requiere un segundo servidor].** Es la única prueba de
que el respaldo sirve si se pierde el servidor. Se hace en un host limpio, con las claves tomadas de sus copias aparte,
y se mide cuánto tarda:

1. Clonar el repo en el host nuevo y copiar el `.env` **desde su copia guardada aparte**, no desde el servidor original.
2. Copiar a `RESPALDO_DIR` la carpeta `AAAAMMDD-HHMMSS` del respaldo y construir: `$C --profile tools build`, `$C build`.
3. Levantar **solo** Postgres, que crea las bases vacías y los roles con el `.env` (`infra/postgres/init/`). **No** correr
   `db:migrate`: el respaldo ya trae el esquema.
   ```bash
   $C up -d postgres
   $C run --rm -v /ruta/clave-respaldo-cil.txt:/clave:ro -v cil-admision_archivos:/respaldo/restaurar \
     respaldo restaurar.sh --prueba <AAAAMMDD-HHMMSS> /clave     # bases temporales y conteo de filas
   $C run --rm -v /ruta/clave-respaldo-cil.txt:/clave:ro -v cil-admision_archivos:/respaldo/restaurar \
     respaldo restaurar.sh <AAAAMMDD-HHMMSS> /clave              # restauración real
   $C up -d
   ```
   Si la restauración real falla a mitad, las bases ya restauradas quedan con datos y `restaurar.sh` se negará a
   repetirlas: hay que borrar el volumen `pgdata` (y `archivos`) y volver a empezar desde `$C up -d postgres`.
4. Comprobar con datos reales: entrar al portal con una cuenta de familia, ver en su ficha (P05) el DNI del postulante
   (prueba `DATA_ENCRYPTION_KEY`) y abrir uno de sus documentos (prueba `ARCHIVOS_ENCRYPTION_KEY`). Después,
   `npm run prod:verificar`.
5. Anotar la fecha, cuánto tardó y quién lo hizo.

La prueba automática del respaldo y la restauración, con contenedores y datos ficticios desechables, se corre en
cualquier PC con Docker: `bash infra/respaldo/probar.sh`. No reemplaza el simulacro: no usa el `.env` guardado aparte
ni descifra un DNI.

### Operación

- **Firma de la Directora:** `npm run firma:cargar -- <correo> <ruta>`, igual que en dev. Necesita la cuenta activa de
  la Directora en `personal` (C18, pendiente).
- **Actualizar a un commit nuevo:**
  ```bash
  git pull
  $C --profile tools build
  $C --profile tools run --rm admin db:migrate
  $C up -d
  $C --profile tools run --rm admin n8n:importar    # si cambiaron los flujos
  npm run prod:verificar
  ```
- **Cambiar una variable de `.env`:** `$C up -d` recrea solo los contenedores afectados. NGINX encuentra a `api` y a
  `keycloak` en su dirección nueva sin reiniciarse. Si cambian `N8N_WEBHOOK_SECRET` o `INTERNAL_API_TOKEN`, corre además
  `admin n8n:credenciales`.

### Al traer este cambio a una PC de dev ya instalada

- `npm ci`: cambió `package-lock.json` (`tsx` y `dbmate` pasan a dependencias; ninguna versión cambia).
- El siguiente `docker compose … up -d` de dev **recrea `postgres`**, que recibe la variable nueva `CREAR_BD_PRUEBA`.
  Los datos se conservan. Después de ese reinicio, la primera petición a Keycloak puede fallar (C7): reintenta.
- Los eventos de Keycloak (C24) solo se activan en dev si se reimporta el realm (`infra/keycloak/README.md`). No hace
  falta para trabajar.
