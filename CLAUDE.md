# Sistema de tramitación de admisión — CIL (Taller de Proyecto 1, UPC)

Sistema de información basado en orquestación de flujos de trabajo (n8n) para el proceso de admisión del Colegio Internacional de Lima. Es un prototipo de tesis: el código es **evidencia académica** (ABET CAC 1, 2 y 6), así que la trazabilidad HU → código → prueba importa tanto como que funcione.

Equipo: John León (PM) y Brayan Herhuay (Scrum Master). Idioma del código: identificadores en español del dominio (`expediente`, `postulante`, `apoderado`), comentarios y mensajes en español.

## Fuentes de verdad (en este orden)

1. `docs/backlog/HUxxxx.md`: texto literal de cada historia y sus escenarios de aceptación.
2. `docs/decisiones.md`: decisiones técnicas vigentes (se importa abajo).
3. `docs/der/modelo-datos.md`: modelo de datos v1.1 (DBML, 19 entidades) con reglas de negocio R1–R24 y catálogo de eventos de auditoría. **No inventes tablas ni columnas**: si falta un dato, repórtalo como brecha.
4. `docs/ui/`: 23 mockups aprobados en HTML (P01–P08, G01–G11 y las variantes P03b, P03c, P05b y P07b). El índice pantalla → HU está en `docs/ui/README.md`.
5. `docs/tesis/diseno-TI.md`: proceso To-Be, arquitectura e inventario de pantallas del TI. Tiene divergencias conocidas con 2–4; están anotadas al inicio del archivo.

Además, `docs/compromisos.md` lista el trabajo ya aprobado y asignado a una HU o etapa futura. Revísalo al planificar cada HU e incluye en el plan los compromisos que le correspondan.

Si dos fuentes se contradicen, **detente y pregunta**. No elijas una por tu cuenta.

@docs/decisiones.md

## Regla principal: no salir del alcance

- Implementa **solo** lo que exigen los escenarios de la HU en curso. Un comportamiento que no aparece en un escenario no se implementa: se anota como *pregunta abierta* en el plan.
- No agregues dependencias, servicios, contenedores, tablas, columnas, endpoints, flujos de n8n ni pantallas que la HU no necesite. Si crees que hacen falta, propónlos en el plan con su justificación y espera la aprobación.
- No implementes nada de la lista de ADR-11 (fuera de alcance), aunque parezca útil o "rápido".
- No adelantes trabajo de otras HU. Si la HU actual depende de algo que no existe, dilo en el plan.
- Nunca edites `docs/backlog/`, `docs/tesis/` ni `docs/decisiones.md` para que coincidan con el código. Si están mal, avisa.
- Una validación técnica básica (tipos, formato, manejo de errores) sí está permitida sin ser un escenario. Una **regla de negocio** nueva no.

## Flujo de trabajo por HU (obligatorio)

1. Lee `docs/backlog/HUxxxx.md`, las tablas y reglas de `docs/der/modelo-datos.md` que toca, y los mockups de las pantallas indicadas (`docs/ui/`).
2. Revisa qué existe ya en el código. No dupliques.
3. Presenta el plan con la plantilla de abajo y **espera aprobación explícita**. No edites archivos antes.
4. Implementa en la rama `hu/HUxxxx-<slug>`.
5. Escribe las pruebas (una o más por escenario, con el ID del escenario al inicio del nombre) y ejecútalas.
6. Pide al subagente `guardian-alcance` que revise el diff contra la HU. Corrige lo que marque.
7. Cierra con el resumen: escenarios cubiertos, pruebas y resultado, archivos cambiados y preguntas abiertas.

### Plantilla de plan

```
## Plan HUxxxx — <título>
### 1. Especificación
- Escenarios a cubrir: <IDs>
- Entradas y salidas: endpoints (método, ruta, request y response JSON de ejemplo, códigos HTTP)
- Precondiciones y postcondiciones (estados del expediente antes y después)
- Datos: tablas y columnas que se leen o escriben; columnas cifradas involucradas
### 2. Diseño
- Frontend: pantallas (código P/G) y componentes
- API: rutas, servicios, rol requerido, eventos de auditoría
- n8n: flujo afectado (de los 7), nodos en orden, disparador, manejo de errores y reintentos
### 3. Implementación y pruebas
- Archivos a crear o modificar
- Pruebas por escenario (unitaria, integración o E2E)
- Justificación de diseño (1–2 oraciones: eficiencia, mantenibilidad o seguridad)
### Fuera de alcance de esta HU
### Preguntas abiertas / supuestos que necesitan confirmación
```

## Estructura del repositorio

```
frontend/      Vue 3 + Vite (portal de familias y gestión interna)
api/           Node.js + Express (validación de tokens de Keycloak, roles, auditoría, cifrado, acceso a datos)
n8n/workflows/ JSON versionado de los 7 flujos (sin credenciales)
db/migrations/ SQL versionado (dbmate)
db/seeds/      datos ficticios para desarrollo y pruebas
e2e/           pruebas Playwright
scripts/       utilidades (importar workflows a n8n, generar matriz de trazabilidad)
docs/          fuentes de verdad (no editar sin pedirlo)
infra/         nginx, keycloak (realm versionado y tema de login), backups y configuración de prod
```

## Reglas de arquitectura (TI, capítulo 6, y decisiones)

- La identidad es de **Keycloak**. La API no guarda ni compara contraseñas: valida el token (JWKS) y lee los roles de `realm_access.roles`. Para crear usuarios, la API usa la Admin API de Keycloak con su *service account*.

- n8n **no** accede a la BD `admision`. Lee y escribe a través de `/internal/*` en la API, con un token de servicio.
- Toda transición de estado del expediente pasa por un único servicio que escribe en `registro_auditoria` dentro de la misma transacción. Las pantallas de personal registran `atencion_inicio` al abrir un ítem y `atencion_fin` al decidir (sección 4.7 del modelo de datos).
- El DNI se cifra en la API antes de escribirse (`dni_cifrado` + `dni_hash`, ADR-03). La clave nunca va en el código, en la BD ni en el JSON de n8n.
- La documentación financiera solo la ve `tesoreria`. El informe psicológico lo ven `psicologa` y `directora`. Todo acceso denegado se audita como `acceso_denegado`.
- Cada notificación pasa por el flujo `notificacion-multicanal` y queda registrada en `notificacion`.
- Nada fijo para el entorno local: URLs, puertos y secretos vienen de variables de entorno, para que el despliegue al VPS sea solo `docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d`.

## Comandos

> Se completan en el Sprint 0. Mientras estén vacíos, pregunta antes de inventar scripts.

- Levantar dev: `docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d`
- Pruebas API: _(Sprint 0)_
- Pruebas frontend: _(Sprint 0)_
- E2E: _(Sprint 0)_
- Importar workflows a n8n: _(Sprint 0)_

## Seguridad y datos

- Usa siempre datos ficticios en dev, seeds y pruebas. Nunca uses datos reales de familias o menores.
- No leas ni imprimas `.env`. Usa `.env.example` para conocer las variables.
- No hagas `git push`, ni merges a `main`, ni borres ramas sin pedirlo.

## Subagentes del proyecto

- `guardian-alcance`: revisa planes y diffs contra la HU y las decisiones. Se usa en el paso 6 y cuando haya dudas de alcance.
- `constructor-n8n`: diseña, valida e importa los JSON de `n8n/workflows/`. Se usa siempre que la HU toque un flujo.
- `verificador-qa`: escribe y ejecuta las pruebas por escenario y actualiza la matriz de trazabilidad.
