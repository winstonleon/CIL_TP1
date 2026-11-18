# Imagen del contenedor `respaldo` (ADR-08; C35 y C47). Parte de la misma imagen de Postgres que fija
# docker-compose.yml, para que pg_dump y pg_restore sean de la misma versión que el servidor, y agrega solo age
# (cifrado asimétrico, aprobado el 16/11/2026) con su versión fijada. La imagen base ya trae tzdata (America/Lima).
FROM postgres:16.15-alpine
RUN apk add --no-cache age=1.3.2-r1
COPY respaldar.sh restaurar.sh /usr/local/bin/
RUN chmod 0755 /usr/local/bin/respaldar.sh /usr/local/bin/restaurar.sh
# Sin el entrypoint de Postgres: este contenedor no levanta un servidor, solo es cliente.
ENTRYPOINT []
CMD ["respaldar.sh", "bucle"]
