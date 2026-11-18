#!/usr/bin/env bash
# Prueba del respaldo y la restauración (C35) con contenedores, volúmenes y una red desechables. No toca el entorno de
# dev ni el de prod, y usa solo datos ficticios. Se corre desde la raíz del repo, con Docker:
#   bash infra/respaldo/probar.sh
# Construye la imagen de infra/respaldo, levanta un Postgres de origen con tres bases de muestra y un volumen de archivos,
# y comprueba: respaldo cifrado y sin texto en claro, sin los datos de las ejecuciones de n8n, `comprobar`, restauración
# de prueba y real en un Postgres nuevo (filas y archivos idénticos), que un fallo de pg_dump no deja respaldo ni poda,
# que la poda conserva siempre 7, y que `comprobar` detecta un respaldo alterado o viejo.
# No prueba la restauración en un servidor nuevo con el .env guardado aparte ni el descifrado de un DNI: eso es el
# simulacro de GUIA-INSTALACION.md, §10.
set -euo pipefail
export MSYS_NO_PATHCONV=1 # Git Bash en Windows: no reescribir las rutas de los contenedores

ID="cilrespaldo$$"
IMG="$ID-img"
RED="$ID-red"
CLAVE_PG=$(head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n')
fallos=0

limpiar() {
  docker rm -f "$ID-origen" "$ID-nuevo" > /dev/null 2>&1 || true
  for v in secreto clave archivos destino restaurado; do docker volume rm -f "$ID-$v" > /dev/null 2>&1 || true; done
  docker network rm "$RED" > /dev/null 2>&1 || true
  docker image rm -f "$IMG" > /dev/null 2>&1 || true
}
trap limpiar EXIT

ok() { echo "✔ $1"; }
mal() { echo "✘ $1"; fallos=$((fallos + 1)); }
comprobar_que() { if eval "$2"; then ok "$1"; else mal "$1"; fi; }

docker build -q -t "$IMG" infra/respaldo > /dev/null
docker network create "$RED" > /dev/null

# Contenedor efímero de la imagen de respaldo, con el entorno del servicio `respaldo` apuntando a un Postgres dado.
en() {
  local host=$1
  shift
  docker run --rm --network "$RED" \
    -e PGHOST="$host" -e PGUSER=superusuario -e TZ=America/Lima \
    -e ADMISION_DB=admision -e N8N_DB=n8n -e KEYCLOAK_DB=keycloak \
    -e RESPALDO_CLAVE_PUBLICA="$PUBLICA" \
    -v "$ID-secreto:/run/secrets:ro" -v "$ID-clave:/clave:ro" \
    -v "$ID-archivos:/respaldo/origen/archivos:ro" -v "$ID-destino:/respaldo/destino" \
    -v "$ID-restaurado:/respaldo/restaurar" \
    "$@"
}
# restaurar.sh sobre el respaldo más reciente. El segundo argumento es --prueba o vacío.
restaurar_en() {
  en "$1" "$IMG" sh -c 'restaurar.sh $0 "$(ls /respaldo/destino | grep -E "^2" | tail -1)" /clave/privada.txt' "$2" 2>&1
}
psql_en() { docker exec "$1" psql -X -v ON_ERROR_STOP=1 -U superusuario -At -d "$2" -c "$3"; }
esperar_pg() { until docker exec "$1" pg_isready -U superusuario -q 2> /dev/null; do sleep 1; done; sleep 2; }
carpetas() { docker run --rm -v "$ID-destino:/d" "$IMG" sh -c 'ls -1 /d | grep -cE "^[0-9]{8}-[0-9]{6}$" || true'; }

# Clave de age desechable: la privada va a un volumen aparte, como si viviera fuera del servidor.
PAR=$(docker run --rm "$IMG" age-keygen 2> /dev/null)
PUBLICA=$(echo "$PAR" | sed -n 's/^# public key: //p')
docker run --rm -i -v "$ID-clave:/c" "$IMG" sh -c 'cat > /c/privada.txt' <<< "$PAR"
docker run --rm -i -v "$ID-secreto:/s" "$IMG" sh -c 'cat > /s/postgres_superpassword' <<< "$CLAVE_PG"

# Origen: tres bases de muestra (datos ficticios) y un volumen de archivos.
for pg in origen nuevo; do
  docker run -d --name "$ID-$pg" --network "$RED" -e POSTGRES_USER=superusuario -e POSTGRES_PASSWORD="$CLAVE_PG" \
    postgres:16.15-alpine > /dev/null
done
esperar_pg "$ID-origen"
esperar_pg "$ID-nuevo"
for b in admision n8n keycloak; do
  psql_en "$ID-origen" postgres "CREATE DATABASE $b" > /dev/null
  psql_en "$ID-nuevo" postgres "CREATE DATABASE $b" > /dev/null
done
psql_en "$ID-origen" admision "CREATE TABLE expediente (id int, correo text); INSERT INTO expediente SELECT g, 'familia' || g || '@ejemplo.test' FROM generate_series(1, 25) g" > /dev/null
psql_en "$ID-origen" keycloak "CREATE TABLE user_entity (id int); INSERT INTO user_entity SELECT generate_series(1, 6)" > /dev/null
psql_en "$ID-origen" n8n "CREATE TABLE workflow_entity (id int); INSERT INTO workflow_entity SELECT generate_series(1, 8);
  CREATE TABLE execution_entity (id int); INSERT INTO execution_entity SELECT generate_series(1, 3);
  CREATE TABLE execution_data (dato text); INSERT INTO execution_data VALUES ('X-Webhook-Secret: secreto-ficticio')" > /dev/null
docker run --rm -v "$ID-archivos:/a" "$IMG" sh -c 'mkdir -p /a/expediente-1 && head -c 300000 /dev/urandom > /a/expediente-1/dni.bin && head -c 5000 /dev/urandom > /a/firma.bin'

echo "--- respaldo"
comprobar_que "la zona horaria del contenedor es la de Lima (-05)" '[ "$(docker run --rm -e TZ=America/Lima "$IMG" date +%Z)" = "-05" ]'
comprobar_que "respaldar.sh una-vez termina bien" 'en "$ID-origen" "$IMG" respaldar.sh una-vez > /dev/null'
comprobar_que "deja una carpeta con los cinco archivos cifrados y su manifiesto" '[ "$(en "$ID-origen" "$IMG" sh -c "ls /respaldo/destino/2*/ | sort | tr \"\n\" \" \"")" = "MANIFIESTO.sha256 admision.dump.age archivos.tar.age globales.sql.age keycloak.dump.age n8n.dump.age " ]'
comprobar_que "comprobar acepta el respaldo recién hecho" 'en "$ID-origen" "$IMG" respaldar.sh comprobar > /dev/null'
comprobar_que "ningún archivo del respaldo tiene texto en claro de la muestra" '! en "$ID-origen" "$IMG" sh -c "grep -rlaE \"ejemplo.test|X-Webhook-Secret|superusuario\" /respaldo/destino/2*/*.age" > /dev/null'

echo "--- restauración"
PRUEBA=$(restaurar_en "$ID-origen" --prueba) || true
echo "$PRUEBA" | sed 's/^/    /'
comprobar_que "la restauración de prueba cuenta las 25 filas de admision" 'echo "$PRUEBA" | grep -q "admision (prueba): 1 tablas, 25 filas"'
comprobar_que "la restauración de prueba no dejó bases temporales" '[ -z "$(psql_en "$ID-origen" postgres "SELECT datname FROM pg_database WHERE datname LIKE '"'"'restauracion_%'"'"'")" ]'
REAL=$(restaurar_en "$ID-nuevo" "") || true
echo "$REAL" | sed 's/^/    /'
comprobar_que "la restauración real en un Postgres nuevo termina" 'echo "$REAL" | grep -q "restaurar: terminado"'
comprobar_que "admision restaurada tiene las mismas filas" '[ "$(psql_en "$ID-nuevo" admision "SELECT count(*) FROM expediente")" = 25 ]'
comprobar_que "keycloak restaurada tiene las mismas filas" '[ "$(psql_en "$ID-nuevo" keycloak "SELECT count(*) FROM user_entity")" = 6 ]'
comprobar_que "n8n restaurada conserva los flujos" '[ "$(psql_en "$ID-nuevo" n8n "SELECT count(*) FROM workflow_entity")" = 8 ]'
comprobar_que "n8n restaurada no trae los datos de las ejecuciones (C10, C11)" '[ "$(psql_en "$ID-nuevo" n8n "SELECT (SELECT count(*) FROM execution_entity) + (SELECT count(*) FROM execution_data)")" = 0 ]'
comprobar_que "los archivos restaurados son idénticos byte a byte" '[ "$(docker run --rm -v "$ID-archivos:/a" "$IMG" sh -c "cd /a && find . -type f | sort | xargs sha256sum")" = "$(docker run --rm -v "$ID-restaurado:/a" "$IMG" sh -c "cd /a && find . -type f | sort | xargs sha256sum")" ]'
comprobar_que "la restauración real se niega sobre una base que ya tiene datos" '! restaurar_en "$ID-nuevo" "" > /dev/null'

echo "--- fallos y poda"
# Diez respaldos viejos (de enero) además del real: la poda debería dejar 7.
docker run --rm -v "$ID-destino:/d" "$IMG" sh -c 'for i in 01 02 03 04 05 06 07 08 09 10; do mkdir /d/202601${i}-020000; done'
comprobar_que "con pg_dump fallando (base inexistente), una-vez sale con error" '! en "$ID-origen" -e N8N_DB=no_existe "$IMG" respaldar.sh una-vez > /dev/null 2>&1'
comprobar_que "un respaldo fallido no crea carpeta ni poda las anteriores (siguen 11)" '[ "$(carpetas)" = 11 ]'
comprobar_que "tras el fallo, comprobar sigue aceptando el último respaldo bueno" 'en "$ID-origen" "$IMG" respaldar.sh comprobar > /dev/null'
sleep 1
comprobar_que "un respaldo exitoso después termina bien" 'en "$ID-origen" "$IMG" respaldar.sh una-vez > /dev/null'
comprobar_que "la poda deja exactamente los 7 más recientes" '[ "$(carpetas)" = 7 ]'
comprobar_que "los dos respaldos reales sobreviven a la poda" '[ "$(en "$ID-origen" "$IMG" sh -c "ls /respaldo/destino | grep -E ^2 | grep -vc ^202601")" = 2 ]'

echo "--- comprobar detecta problemas"
en "$ID-origen" "$IMG" sh -c 'u=$(cut -d" " -f2 /respaldo/destino/ESTADO); printf x >> /respaldo/destino/$u/admision.dump.age'
comprobar_que "comprobar rechaza un respaldo alterado después de escrito" '! en "$ID-origen" "$IMG" respaldar.sh comprobar > /dev/null'
en "$ID-origen" "$IMG" sh -c 'read r m e < /respaldo/destino/ESTADO; echo "ok $m $((e - 27 * 3600))" > /respaldo/destino/ESTADO'
SALIDA=$(en "$ID-origen" "$IMG" respaldar.sh comprobar 2>&1) || true
comprobar_que "comprobar rechaza un respaldo de hace más de 26 h ($SALIDA)" 'echo "$SALIDA" | grep -q "tiene 27 h"'

echo "--- el servicio (bucle)"
# Con --init, como en docker-compose.prod.yml (init: true): el script no es PID 1 y timeout puede terminarlo.
# Sin un respaldo bueno reciente, el servicio respalda al arrancar. Si falla, lo deja escrito en ESTADO para que
# comprobar (y prod:verificar) lo vea, y no toca las carpetas.
ANTES=$(carpetas)
en "$ID-origen" -e N8N_DB=no_existe --init "$IMG" timeout 25 respaldar.sh bucle > /dev/null 2>&1 || true
comprobar_que "al arrancar con pg_dump fallando, el servicio deja «fallo» en ESTADO" '[ "$(en "$ID-origen" "$IMG" cut -d" " -f1 /respaldo/destino/ESTADO)" = fallo ]'
comprobar_que "ese fallo no cambia las carpetas conservadas" '[ "$(carpetas)" = "$ANTES" ]'
comprobar_que "comprobar rechaza el estado «fallo»" '! en "$ID-origen" "$IMG" respaldar.sh comprobar > /dev/null'
REINTENTOS=$(en "$ID-origen" -e N8N_DB=no_existe -e RESPALDO_REINTENTO_S=5 --init "$IMG" timeout 50 respaldar.sh bucle 2>&1 | grep -c "FALLÓ" || true)
comprobar_que "mientras falla, el servicio reintenta (intervalo acortado a 5 s: $REINTENTOS intentos en 50 s)" '[ "$REINTENTOS" -ge 2 ]'
en "$ID-origen" --init "$IMG" timeout 25 respaldar.sh bucle > /dev/null 2>&1 || true
comprobar_que "al arrancar con todo bien, el servicio respalda y comprobar lo acepta" 'en "$ID-origen" "$IMG" respaldar.sh comprobar > /dev/null'

echo
if [ "$fallos" -eq 0 ]; then echo "todas las comprobaciones en verde"; else echo "$fallos comprobación(es) fallida(s)"; exit 1; fi
