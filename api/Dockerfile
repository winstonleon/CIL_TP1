# Imagen de la API. Contexto de build: raíz del repo (workspaces de npm).
# Etapas: `dev` (recarga en caliente), `tipos` (chequeo de tipos, puerta de la imagen de producción), `prod` (C13) y
# `admin` (contenedor de un solo uso para administrar el servidor desde la red interna, ADR-08).
FROM node:22.23.3-alpine AS dev
WORKDIR /app
# npm ci valida el lockfile contra todos los workspaces declarados en la raíz.
COPY package.json package-lock.json ./
COPY api/package.json api/
COPY frontend/package.json frontend/
COPY e2e/package.json e2e/
RUN npm ci --workspace api --include-workspace-root=false && npm cache clean --force
COPY api/ api/
# Directorio del almacenamiento local (D1): el volumen `archivos` hereda este dueño al crearse.
RUN mkdir -p /var/lib/cil/archivos && chown node:node /var/lib/cil/archivos
ENV NODE_ENV=development
USER node
EXPOSE 3000
CMD ["npm", "run", "dev", "--workspace", "api"]

# --- Chequeo de tipos: puerta de la imagen de producción ---
# En producción la API corre con tsx, que ejecuta TypeScript sin revisar los tipos. Por eso `prod` copia el testigo de
# esta etapa: si `tsc --noEmit` falla, la imagen de producción no se construye.
# tsconfig.prod.json revisa lo que entra a esa imagen (src y cargarFirma.ts). Las pruebas y los scripts de dev importan
# archivos de fuera de api/, que aquí no están: los revisa `npm run typecheck --workspace api` en el host.
FROM dev AS tipos
RUN cd api && ../node_modules/.bin/tsc --noEmit -p tsconfig.prod.json && touch /tmp/tipos-ok

# --- Producción (C13) ---
# Sin dependencias de desarrollo, sin recarga en caliente y sin los scripts de dev (seed, demo, agenda).
FROM node:22.23.3-alpine AS prod
WORKDIR /app
COPY package.json package-lock.json ./
COPY api/package.json api/
COPY frontend/package.json frontend/
COPY e2e/package.json e2e/
RUN npm ci --workspace api --include-workspace-root=false --omit=dev && npm cache clean --force
COPY --from=tipos /tmp/tipos-ok /tmp/tipos-ok
COPY api/tsconfig.json api/
COPY api/src api/src
# Único script que corre en producción: carga la firma de la Directora dentro de este contenedor (HU0016, C18).
COPY api/scripts/cargarFirma.ts api/scripts/
RUN mkdir -p /var/lib/cil/archivos && chown node:node /var/lib/cil/archivos
# El directorio de trabajo es la raíz, como en dev: `npm run firma:cargar --workspace api` (scripts/firma-cargar.mjs)
# solo encuentra el workspace desde aquí. tsx toma el tsconfig de la API de esta variable.
ENV NODE_ENV=production \
    TSX_TSCONFIG_PATH=/app/api/tsconfig.json
USER node
EXPOSE 3000
# node es el proceso 1 y recibe SIGTERM (server.ts cierra el servidor y el pool); tsx solo carga el TypeScript.
CMD ["node", "--import", "tsx", "api/src/server.ts"]

# --- Administración (ADR-08) ---
# Migraciones, credenciales y flujos de n8n, desde dentro de la red interna: en producción no se publica ningún puerto
# de Postgres ni de n8n. Lleva los mismos scripts, migraciones y flujos del commit con que se construyó la imagen.
#   docker compose -f docker-compose.yml -f docker-compose.prod.yml --profile tools run --rm admin db:migrate
FROM prod AS admin
USER root
WORKDIR /app
# dbmate es dependencia de la raíz del repo: aquí se instala junto con las de la API.
RUN npm ci --workspace api --include-workspace-root --omit=dev && npm cache clean --force
COPY scripts/db.mjs scripts/n8n-credenciales.mjs scripts/importar-workflows.mjs scripts/
COPY scripts/lib/keycloak.mjs scripts/lib/
COPY db/migrations db/migrations
# n8n:importar reescribe los JSON con el estado de la instancia: dentro del contenedor esa copia se descarta.
COPY --chown=node:node n8n/workflows n8n/workflows
# Las variables llegan del compose (y los secretos, de /run/secrets): los scripts no buscan un archivo .env.
# npm no consulta al registro si hay una versión nueva: el contenedor solo habla con la red interna.
ENV CIL_ENTORNO_DEL_CONTENEDOR=1 \
    NPM_CONFIG_UPDATE_NOTIFIER=false
USER node
ENTRYPOINT ["npm", "run"]
CMD []
