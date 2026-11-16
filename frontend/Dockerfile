# Imagen del frontend. Contexto de build: raíz del repo (workspaces de npm).
# Etapas: `dev` (servidor de desarrollo de Vite), `build` (compila Vue) y `prod` (NGINX con el build y su
# configuración, ADR-08). En producción no corre Node: el contenedor es NGINX.
FROM node:22.23.3-alpine AS dev
WORKDIR /app
# npm ci valida el lockfile contra todos los workspaces declarados en la raíz.
COPY package.json package-lock.json ./
COPY api/package.json api/
COPY frontend/package.json frontend/
COPY e2e/package.json e2e/
RUN npm ci --workspace frontend --include-workspace-root=false && npm cache clean --force
COPY frontend/ frontend/
# Vite escribe junto a su configuración (archivo temporal) y su caché en frontend/node_modules/.vite.
RUN chown -R node:node /app/frontend
USER node
EXPOSE 5173
CMD ["npm", "run", "dev", "--workspace", "frontend", "--", "--host", "0.0.0.0"]

# --- Build de producción ---
# Vite incrusta las VITE_* en el JavaScript al compilar: llegan como argumentos desde docker-compose.prod.yml.
# `npm run build` revisa los tipos (vue-tsc) antes de compilar: con errores de tipos no hay imagen.
FROM dev AS build
ARG VITE_API_URL
ARG VITE_OIDC_AUTHORITY
ARG VITE_OIDC_CLIENT_ID_PORTAL
ARG VITE_OIDC_CLIENT_ID_GESTION
# Un build sin estas variables arranca, pero no puede iniciar sesión ni llamar a la API: mejor que falle aquí.
RUN : "${VITE_API_URL:?falta el argumento de build}" \
      "${VITE_OIDC_AUTHORITY:?falta el argumento de build}" \
      "${VITE_OIDC_CLIENT_ID_PORTAL:?falta el argumento de build}" \
      "${VITE_OIDC_CLIENT_ID_GESTION:?falta el argumento de build}"
ENV VITE_API_URL=$VITE_API_URL \
    VITE_OIDC_AUTHORITY=$VITE_OIDC_AUTHORITY \
    VITE_OIDC_CLIENT_ID_PORTAL=$VITE_OIDC_CLIENT_ID_PORTAL \
    VITE_OIDC_CLIENT_ID_GESTION=$VITE_OIDC_CLIENT_ID_GESTION
RUN npm run build --workspace frontend

# --- Producción (ADR-08): NGINX termina TLS, sirve el build y reenvía /api y /auth ---
FROM nginx:1.30.6-alpine AS prod
# La imagen procesa la plantilla con envsubst al arrancar y deja el resultado en /etc/nginx/conf.d/default.conf.
COPY infra/nginx/cil.conf.template /etc/nginx/templates/default.conf.template
COPY --from=build /app/frontend/dist /usr/share/nginx/html
EXPOSE 80 443
