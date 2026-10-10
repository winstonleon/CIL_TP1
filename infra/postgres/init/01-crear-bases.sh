#!/bin/sh
# Crea las bases y usuarios del proyecto (ADR-04). Lo ejecuta la imagen oficial de
# PostgreSQL solo la primera vez, cuando el volumen pgdata está vacío.
#   admision       negocio (solo api_admision)
#   admision_test  BD de prueba de la API (ADR-09, solo api_admision)
#   n8n            estado interno de n8n (solo n8n)
#   keycloak       identidad (solo keycloak)
# Cada base es propiedad de su usuario y se quita CONNECT a PUBLIC, de modo que
# ni n8n ni keycloak pueden conectarse a admision.
set -eu

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname postgres \
  -v adm_db="$ADMISION_DB" \
  -v adm_db_test="${ADMISION_DB}_test" \
  -v adm_user="$ADMISION_DB_USER" \
  -v adm_pass="$ADMISION_DB_PASSWORD" \
  -v n8n_db="$N8N_DB" \
  -v n8n_user="$N8N_DB_USER" \
  -v n8n_pass="$N8N_DB_PASSWORD" \
  -v kc_db="$KEYCLOAK_DB" \
  -v kc_user="$KEYCLOAK_DB_USER" \
  -v kc_pass="$KEYCLOAK_DB_PASSWORD" <<'EOSQL'
CREATE ROLE :"adm_user" LOGIN PASSWORD :'adm_pass';
CREATE ROLE :"n8n_user" LOGIN PASSWORD :'n8n_pass';
CREATE ROLE :"kc_user"  LOGIN PASSWORD :'kc_pass';

CREATE DATABASE :"adm_db"      OWNER :"adm_user" ENCODING 'UTF8';
CREATE DATABASE :"adm_db_test" OWNER :"adm_user" ENCODING 'UTF8';
CREATE DATABASE :"n8n_db"      OWNER :"n8n_user" ENCODING 'UTF8';
CREATE DATABASE :"kc_db"       OWNER :"kc_user"  ENCODING 'UTF8';

REVOKE CONNECT, TEMPORARY ON DATABASE :"adm_db"      FROM PUBLIC;
REVOKE CONNECT, TEMPORARY ON DATABASE :"adm_db_test" FROM PUBLIC;
REVOKE CONNECT, TEMPORARY ON DATABASE :"n8n_db"      FROM PUBLIC;
REVOKE CONNECT, TEMPORARY ON DATABASE :"kc_db"       FROM PUBLIC;
REVOKE CONNECT, TEMPORARY ON DATABASE postgres       FROM PUBLIC;

GRANT CONNECT ON DATABASE :"adm_db"      TO :"adm_user";
GRANT CONNECT ON DATABASE :"adm_db_test" TO :"adm_user";
GRANT CONNECT ON DATABASE :"n8n_db"      TO :"n8n_user";
GRANT CONNECT ON DATABASE :"kc_db"       TO :"kc_user";
EOSQL
