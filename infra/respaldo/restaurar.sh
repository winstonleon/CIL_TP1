#!/bin/sh
# Restauración de un respaldo de respaldar.sh (ADR-08; C35 y C47). Procedimiento completo: GUIA-INSTALACION.md, §10.
#
#   restaurar.sh --prueba <carpeta> <clave-privada>
#       Comprueba el manifiesto, restaura cada base en una base temporal (restauracion_<base>), cuenta sus filas y la
#       borra, y lista el contenido de archivos.tar. No toca las bases ni los archivos reales.
#   restaurar.sh <carpeta> <clave-privada>
#       Restauración real, en un servidor nuevo: solo postgres levantado, con las bases vacías y los roles que crean
#       infra/postgres/init/ (01 y 02) con el .env guardado aparte. NO se corren las migraciones antes: el respaldo ya
#       trae el esquema. Los archivos se descomprimen en /respaldo/restaurar (el volumen `archivos`, montado al correr).
#
# <carpeta> es una carpeta AAAAMMDD-HHMMSS dentro de /respaldo/destino, o una ruta absoluta.
# <clave-privada> es el archivo de age (AGE-SECRET-KEY-…), que nunca vive en el servidor: se monta solo para esto.
# globales.sql.age no se aplica: los roles salen del init. Se descifra a mano si hace falta revisarlos.
set -eu
set -o pipefail

DESTINO=${RESPALDO_DESTINO:-/respaldo/destino}
SECRETO=${RESPALDO_SECRETO:-/run/secrets/postgres_superpassword}
RESTAURAR_ARCHIVOS=${RESPALDO_RESTAURAR_ARCHIVOS:-/respaldo/restaurar}

prueba=false
if [ "${1:-}" = "--prueba" ]; then prueba=true; shift; fi
[ $# -eq 2 ] || { echo "uso: restaurar.sh [--prueba] <carpeta> <clave-privada>" >&2; exit 2; }
case "$1" in /*) dir=$1 ;; *) dir="$DESTINO/$1" ;; esac
clave=$2
[ -d "$dir" ] || { echo "no existe $dir" >&2; exit 1; }
[ -r "$clave" ] || { echo "no se puede leer la clave privada" >&2; exit 1; }
: "${ADMISION_DB:?falta ADMISION_DB}" "${N8N_DB:?falta N8N_DB}" "${KEYCLOAK_DB:?falta KEYCLOAK_DB}"
PGPASSWORD=$(cat "$SECRETO")
export PGPASSWORD

registro() { echo "restaurar: $*"; }
descifrar() { age -d -i "$clave" "$dir/$1"; }

(cd "$dir" && sha256sum -c -s MANIFIESTO.sha256) || { echo "el respaldo no cuadra con su manifiesto" >&2; exit 1; }
registro "manifiesto correcto ($(basename "$dir"))"

# Filas de cada tabla de public, en una sola consulta.
contar() {
  sql=$(psql -X -At -d "$1" -v ON_ERROR_STOP=1 -c "SELECT string_agg(format('SELECT count(*) FROM public.%I', table_name), ' UNION ALL ') FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE'")
  [ -n "$sql" ] || { echo "0 tablas"; return; }
  psql -X -At -d "$1" -v ON_ERROR_STOP=1 -c "SELECT count(*) || ' tablas, ' || sum(c) || ' filas' FROM ($sql) AS t(c)"
}

for base in "$ADMISION_DB" "$KEYCLOAK_DB" "$N8N_DB"; do
  case "$base" in
    "$ADMISION_DB") archivo=admision.dump.age ;;
    "$KEYCLOAK_DB") archivo=keycloak.dump.age ;;
    *) archivo=n8n.dump.age ;;
  esac
  if $prueba; then
    temporal="restauracion_$base"
    dropdb --if-exists "$temporal"
    createdb "$temporal"
    descifrar "$archivo" | pg_restore -d "$temporal" --no-owner --no-acl --exit-on-error
    # En una asignación, un fallo de la sustitución sí aborta el script; dentro de los argumentos de registro, no.
    filas=$(contar "$temporal")
    registro "$base (prueba): $filas"
    dropdb "$temporal"
  else
    vacia=$(psql -X -At -d "$base" -v ON_ERROR_STOP=1 -c "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public'")
    [ "$vacia" = 0 ] || { echo "$base no está vacía: la restauración real va sobre bases recién creadas" >&2; exit 1; }
    descifrar "$archivo" | pg_restore -d "$base" --exit-on-error
    filas=$(contar "$base")
    registro "$base: $filas"
  fi
done

if $prueba; then
  lista=$(descifrar archivos.tar.age | tar -tf -)
  registro "archivos (prueba): $(echo "$lista" | grep -c '[^/]$' || true) archivos"
else
  [ -d "$RESTAURAR_ARCHIVOS" ] || { echo "monta el volumen archivos en $RESTAURAR_ARCHIVOS" >&2; exit 1; }
  descifrar archivos.tar.age | tar -C "$RESTAURAR_ARCHIVOS" -xpf -
  registro "archivos: $(find "$RESTAURAR_ARCHIVOS" -type f | wc -l) archivos restaurados"
fi
registro "terminado"
