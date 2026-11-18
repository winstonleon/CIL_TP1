#!/bin/sh
# Respaldo diario de producción (ADR-08; C35 y C47). Corre en el contenedor `respaldo` de docker-compose.prod.yml.
# Cada día a las 02:00 (America/Lima) deja en /respaldo/destino una carpeta AAAAMMDD-HHMMSS con:
#   globales.sql.age   pg_dumpall --globals-only: los roles, con sus contraseñas en hash
#   admision.dump.age  pg_dump -Fc de la base de negocio
#   keycloak.dump.age  pg_dump -Fc de Keycloak (usuarios, hashes de contraseña y configuración del realm)
#   n8n.dump.age       pg_dump -Fc de n8n SIN los datos de sus ejecuciones (public.execution*), que guardan correos,
#                      cuerpos de los avisos y X-Webhook-Secret y se podan aparte (C10 y C11). Quedan los flujos, las
#                      credenciales cifradas, los usuarios y la clave de API.
#   archivos.tar.age   el volumen `archivos` (documentos, comprobantes, cartas y firma, que la API ya cifra)
#   MANIFIESTO.sha256
# Todo va cifrado con age para RESPALDO_CLAVE_PUBLICA. En el servidor solo está la clave pública: la privada se guarda
# fuera (GUIA-INSTALACION.md, §10), así que un servidor robado no descifra sus propios respaldos.
# No respalda .env: las claves de la aplicación (ARCHIVOS_ENCRYPTION_KEY, DATA_ENCRYPTION_KEY, DATA_HMAC_KEY…) se
# guardan aparte. Sin ellas, los DNI y los archivos restaurados no se pueden leer.
#
# Uso: respaldar.sh bucle      el servicio: respalda al arrancar si no hay uno bueno reciente, cada día a las 02:00
#                              y, mientras el último no sea bueno y reciente, reintenta cada hora
#      respaldar.sh una-vez    un respaldo ahora (sale con error si cualquier paso falla)
#      respaldar.sh comprobar  el último respaldo terminó bien, tiene menos de 26 h y cuadra con su manifiesto
#
# Un respaldo se escribe en .en-curso-* y se renombra al terminar: uno a medias nunca cuenta como el último.
# La poda corre solo después de un respaldo exitoso y conserva siempre los 7 más recientes: si el respaldo falla días
# seguidos, los buenos anteriores no se borran.
set -eu
set -o pipefail

DESTINO=${RESPALDO_DESTINO:-/respaldo/destino}
ARCHIVOS=${RESPALDO_ARCHIVOS:-/respaldo/origen/archivos}
SECRETO=${RESPALDO_SECRETO:-/run/secrets/postgres_superpassword}
HORA=02:00
RETENCION_DIAS=14
MINIMO=7
MAX_HORAS=26
# Solo la prueba (infra/respaldo/probar.sh) lo acorta.
REINTENTO_S=${RESPALDO_REINTENTO_S:-3600}
ESTADO="$DESTINO/ESTADO"
PATRON='^[0-9]{8}-[0-9]{6}$'

registro() { echo "$(date '+%Y-%m-%d %H:%M:%S %Z') respaldo: $*"; }

conservados() { ls -1 "$DESTINO" | grep -E "$PATRON" || true; }

podar() {
  corte=$(date -d "@$(( $(date +%s) - RETENCION_DIAS * 86400 ))" +%Y%m%d%H%M%S)
  n=0
  for d in $(conservados | sort -r); do
    n=$((n + 1))
    [ "$n" -le "$MINIMO" ] && continue
    if [ "$(echo "$d" | tr -d -)" -lt "$corte" ]; then
      rm -rf "${DESTINO:?}/$d"
      registro "podado $d (más de $RETENCION_DIAS días)"
    fi
  done
}

una_vez() {
  : "${RESPALDO_CLAVE_PUBLICA:?falta RESPALDO_CLAVE_PUBLICA}"
  : "${ADMISION_DB:?falta ADMISION_DB}" "${N8N_DB:?falta N8N_DB}" "${KEYCLOAK_DB:?falta KEYCLOAK_DB}"
  PGPASSWORD=$(cat "$SECRETO")
  export PGPASSWORD
  umask 077
  rm -rf "$DESTINO"/.en-curso-*
  marca=$(date +%Y%m%d-%H%M%S)
  tmp="$DESTINO/.en-curso-$marca"
  mkdir "$tmp"
  cifrar() { age -r "$RESPALDO_CLAVE_PUBLICA" -o "$tmp/$1"; }

  pg_dumpall --globals-only | cifrar globales.sql.age
  pg_dump -Fc -d "$ADMISION_DB" | cifrar admision.dump.age
  pg_dump -Fc -d "$KEYCLOAK_DB" | cifrar keycloak.dump.age
  pg_dump -Fc -d "$N8N_DB" --exclude-table-data='public.execution*' | cifrar n8n.dump.age
  [ -d "$ARCHIVOS" ] || { echo "no existe $ARCHIVOS" >&2; exit 1; }
  tar -C "$ARCHIVOS" -cf - . | cifrar archivos.tar.age
  (cd "$tmp" && sha256sum -- *.age > MANIFIESTO.sha256)

  mv "$tmp" "$DESTINO/$marca"
  echo "ok $marca $(date +%s)" > "$ESTADO"
  registro "respaldo $marca terminado ($(du -sh "$DESTINO/$marca" | cut -f1))"
  podar
}

comprobar() {
  [ -f "$ESTADO" ] || { echo "no hay ningún respaldo todavía"; return 1; }
  read -r resultado marca epoca < "$ESTADO"
  [ "$resultado" = ok ] || { echo "el último intento falló ($marca); el último bueno sigue en la carpeta"; return 1; }
  horas=$(( ($(date +%s) - epoca) / 3600 ))
  [ "$horas" -lt "$MAX_HORAS" ] || { echo "el último respaldo ($marca) tiene $horas h"; return 1; }
  dir="$DESTINO/$marca"
  [ -d "$dir" ] || { echo "falta la carpeta del último respaldo ($marca)"; return 1; }
  (cd "$dir" && sha256sum -c -s MANIFIESTO.sha256) || { echo "$marca no cuadra con su manifiesto"; return 1; }
  for f in globales.sql admision.dump keycloak.dump n8n.dump archivos.tar; do
    head -c 21 "$dir/$f.age" | grep -q '^age-encryption.org/v1' || { echo "$f.age falta o no está cifrado con age"; return 1; }
  done
  echo "último respaldo $marca, hace $horas h; $(conservados | wc -l) conservados"
}

# Cada respaldo corre en un proceso aparte: así `set -e` sigue activo dentro (en un `if`, el shell lo desactiva).
ejecutar() {
  if "$0" una-vez; then
    return 0
  fi
  echo "fallo $(date +%Y%m%d-%H%M%S) $(date +%s)" > "$ESTADO"
  registro "FALLÓ el respaldo; los anteriores no se tocaron"
}

# Además del respaldo de las 02:00, mientras `comprobar` falle (el último intento falló, o el último bueno tiene más de
# 26 h porque el contenedor estuvo detenido) reintenta cada hora. Así la pérdida no pasa de unas 27 h salvo que el
# respaldo falle una y otra vez, y eso lo muestra prod:verificar.
bucle() {
  registro "respalda cada día a las $HORA ($(date +%Z)) y reintenta cada $((REINTENTO_S / 60)) min si falla; conserva $RETENCION_DIAS días y nunca menos de $MINIMO"
  ultimo_dia=""
  ultimo_intento=0
  while :; do
    if [ "$(date +%H:%M)" = "$HORA" ] && [ "$(date +%F)" != "$ultimo_dia" ]; then
      ultimo_dia=$(date +%F)
      ultimo_intento=$(date +%s)
      ejecutar
    elif [ $(($(date +%s) - ultimo_intento)) -ge "$REINTENTO_S" ] && ! comprobar > /dev/null 2>&1; then
      ultimo_intento=$(date +%s)
      ejecutar
    fi
    sleep 20
  done
}

case "${1:-}" in
  bucle) bucle ;;
  una-vez) una_vez ;;
  comprobar) comprobar ;;
  *) echo "uso: respaldar.sh bucle | una-vez | comprobar" >&2; exit 2 ;;
esac
