#!/bin/sh
# S0-B9: separa el dueño del esquema de la base admision del usuario con que se ejecuta la API.
#   ${ADMISION_MIGRATOR_USER}  LOGIN. Dueño de admision y admision_test; aplica las migraciones (dbmate).
#   admision_app               NOLOGIN. Grupo con los permisos de ejecución, que otorgan las migraciones.
#   ${ADMISION_DB_USER}        LOGIN. Usuario de la API: miembro de admision_app, sin ser dueño de nada,
#                              así que no puede hacer ALTER, DROP ni DISABLE TRIGGER.
# En un volumen nuevo corre solo, después de 01-crear-bases.sh. Es idempotente; sobre un volumen
# ya creado se ejecuta con:  npm run db:roles
set -eu
: "${ADMISION_MIGRATOR_USER:?falta ADMISION_MIGRATOR_USER}"
: "${ADMISION_MIGRATOR_PASSWORD:?falta ADMISION_MIGRATOR_PASSWORD}"

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname postgres \
  -v mig_user="$ADMISION_MIGRATOR_USER" \
  -v mig_pass="$ADMISION_MIGRATOR_PASSWORD" \
  -v app_user="$ADMISION_DB_USER" \
  -v adm_db="$ADMISION_DB" \
  -v adm_db_test="${ADMISION_DB}_test" <<'EOSQL'
SELECT format('CREATE ROLE %I LOGIN', :'mig_user')
 WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :'mig_user') \gexec
ALTER ROLE :"mig_user" WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE PASSWORD :'mig_pass';

SELECT 'CREATE ROLE admision_app NOLOGIN'
 WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'admision_app') \gexec
GRANT admision_app TO :"app_user";

ALTER DATABASE :"adm_db"      OWNER TO :"mig_user";
ALTER DATABASE :"adm_db_test" OWNER TO :"mig_user";

-- La API conectaba como dueña. Ahora conecta solo por el grupo, y sin TEMPORARY.
REVOKE CONNECT, TEMPORARY ON DATABASE :"adm_db"      FROM :"app_user";
REVOKE CONNECT, TEMPORARY ON DATABASE :"adm_db_test" FROM :"app_user";
GRANT CONNECT ON DATABASE :"adm_db"      TO admision_app;
GRANT CONNECT ON DATABASE :"adm_db_test" TO admision_app;
EOSQL

# Objetos que la API creó cuando era dueña (tablas, secuencias, tipos, función, schema_migrations).
for base in "$ADMISION_DB" "${ADMISION_DB}_test"; do
  psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$base" \
    -v mig_user="$ADMISION_MIGRATOR_USER" \
    -v app_user="$ADMISION_DB_USER" <<'EOSQL'
REASSIGN OWNED BY :"app_user" TO :"mig_user";
EOSQL
done

echo "02-separar-roles: dueño = $ADMISION_MIGRATOR_USER; $ADMISION_DB_USER ejecuta vía admision_app"
