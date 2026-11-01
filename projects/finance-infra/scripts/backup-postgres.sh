#!/usr/bin/env sh
set -eu
umask 077
SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
INFRA_DIR=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)
BACKUP_DIR=${BACKUP_DIR:-"$INFRA_DIR/backups"}
POSTGRES_DB=${POSTGRES_DB:-finance}
POSTGRES_USER=${POSTGRES_USER:-finance}
TIMESTAMP=$(date -u +"%Y%m%dT%H%M%SZ")
OUTPUT_FILE=${OUTPUT_FILE:-"$BACKUP_DIR/${POSTGRES_DB}-${TIMESTAMP}.dump"}
MIN_BACKUP_BYTES=${MIN_BACKUP_BYTES:-1024}
case "$OUTPUT_FILE" in /*) OUTPUT_PATH=$OUTPUT_FILE ;; *) OUTPUT_PATH=$(pwd)/$OUTPUT_FILE ;; esac
MANIFEST_PATH=${MANIFEST_PATH:-"$OUTPUT_PATH.manifest"}
case "$MANIFEST_PATH" in /*) ;; *) MANIFEST_PATH=$(pwd)/$MANIFEST_PATH ;; esac
[ ! -e "$OUTPUT_PATH" ] && [ ! -e "$MANIFEST_PATH" ] || { printf 'Refusing to overwrite a backup or manifest.\n' >&2; exit 2; }
mkdir -p "$(dirname -- "$OUTPUT_PATH")" "$(dirname -- "$MANIFEST_PATH")"
LOCK_PATH="$OUTPUT_PATH.lock"
mkdir "$LOCK_PATH" 2>/dev/null || { printf 'Another backup owns this output path.\n' >&2; exit 2; }
TEMP_DUMP=
TEMP_MANIFEST=
trap 'rm -f "$TEMP_DUMP" "$TEMP_MANIFEST"; rmdir "$LOCK_PATH"' EXIT
trap 'exit 1' HUP INT TERM
[ ! -e "$OUTPUT_PATH" ] && [ ! -e "$MANIFEST_PATH" ] || { printf 'Refusing to overwrite a backup or manifest.\n' >&2; exit 2; }
TEMP_DUMP=$(mktemp "$OUTPUT_PATH.tmp.XXXXXX")
TEMP_MANIFEST=$(mktemp "$MANIFEST_PATH.tmp.XXXXXX")
cd "$INFRA_DIR"
case "${DATABASE_TRANSPORT:-compose}" in
  compose) docker compose exec -T postgres pg_dump --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" --format custom --no-owner --file - > "$TEMP_DUMP" ;;
  local) pg_dump --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" --format custom --no-owner --file "$TEMP_DUMP" ;;
  *) printf 'DATABASE_TRANSPORT must be compose or local.\n' >&2; exit 2 ;;
esac
BACKUP_BYTES=$(wc -c < "$TEMP_DUMP" | tr -d ' ')
[ "$BACKUP_BYTES" -ge "$MIN_BACKUP_BYTES" ] || { printf 'Backup is smaller than MIN_BACKUP_BYTES. No backup published.\n' >&2; exit 1; }
if command -v sha256sum >/dev/null 2>&1; then SHA256=$(sha256sum "$TEMP_DUMP" | awk '{print $1}'); else SHA256=$(shasum -a 256 "$TEMP_DUMP" | awk '{print $1}'); fi
CHECKSUM=$(cksum "$TEMP_DUMP" | awk '{print $1}')
cat > "$TEMP_MANIFEST" <<EOF
created_at_utc=$TIMESTAMP
database=$POSTGRES_DB
format=pg_dump_custom
file=$OUTPUT_PATH
bytes=$BACKUP_BYTES
cksum=$CHECKSUM
sha256=$SHA256
EOF
mv "$TEMP_DUMP" "$OUTPUT_PATH"
mv "$TEMP_MANIFEST" "$MANIFEST_PATH"
printf 'PostgreSQL backup written to %s\nBackup manifest written to %s\n' "$OUTPUT_PATH" "$MANIFEST_PATH"
