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
