# Imagen de la API. Contexto de build: raíz del repo (workspaces de npm).
# Solo existe la etapa de desarrollo; la de producción se agrega con docker-compose.prod.yml.
FROM node:22.23.3-alpine AS dev
WORKDIR /app
# npm ci valida el lockfile contra todos los workspaces declarados en la raíz.
COPY package.json package-lock.json ./
COPY api/package.json api/
COPY frontend/package.json frontend/
COPY e2e/package.json e2e/
RUN npm ci --workspace api --include-workspace-root=false && npm cache clean --force
COPY api/ api/
ENV NODE_ENV=development
USER node
EXPOSE 3000
CMD ["npm", "run", "dev", "--workspace", "api"]
