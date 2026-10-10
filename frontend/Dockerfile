# Servidor de desarrollo de Vite. Contexto de build: raíz del repo (workspaces de npm).
# En producción el build de Vue lo sirve NGINX (docker-compose.prod.yml), no este contenedor.
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
