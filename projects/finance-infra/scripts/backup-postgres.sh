#!/usr/bin/env sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
INFRA_DIR=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)
BACKUP_DIR=${BACKUP_DIR:-"$INFRA_DIR/backups"}
POSTGRES_DB=${POSTGRES_DB:-finance}
POSTGRES_USER=${POSTGRES_USER:-finance}
TIMESTAMP=$(date -u +"%Y%m%dT%H%M%SZ")
OUTPUT_FILE=${OUTPUT_FILE:-"$BACKUP_DIR/${POSTGRES_DB}-${TIMESTAMP}.dump"}
MIN_BACKUP_BYTES=${MIN_BACKUP_BYTES:-1024}

case "$OUTPUT_FILE" in
  /*) OUTPUT_PATH=$OUTPUT_FILE ;;
  *) OUTPUT_PATH=$(pwd)/$OUTPUT_FILE ;;
esac

mkdir -p "$(dirname -- "$OUTPUT_PATH")"

cd "$INFRA_DIR"

docker compose exec -T postgres pg_dump \
  --username "$POSTGRES_USER" \
  --dbname "$POSTGRES_DB" \
  --format custom \
  --no-owner \
  --file - > "$OUTPUT_PATH"

BACKUP_BYTES=$(wc -c < "$OUTPUT_PATH" | tr -d ' ')
if [ "$BACKUP_BYTES" -lt "$MIN_BACKUP_BYTES" ]; then
  printf 'Backup file is smaller than MIN_BACKUP_BYTES (%s < %s): %s\n' "$BACKUP_BYTES" "$MIN_BACKUP_BYTES" "$OUTPUT_PATH" >&2
  exit 1
fi

CHECKSUM=$(cksum "$OUTPUT_PATH" | awk '{print $1}')
MANIFEST_PATH=${MANIFEST_PATH:-"$OUTPUT_PATH.manifest"}
cat > "$MANIFEST_PATH" <<EOF
created_at_utc=$TIMESTAMP
database=$POSTGRES_DB
format=pg_dump_custom
file=$OUTPUT_PATH
bytes=$BACKUP_BYTES
cksum=$CHECKSUM
EOF

printf 'PostgreSQL backup written to %s\n' "$OUTPUT_PATH"
printf 'Backup manifest written to %s\n' "$MANIFEST_PATH"
