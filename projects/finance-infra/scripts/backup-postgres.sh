#!/usr/bin/env sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
INFRA_DIR=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)
BACKUP_DIR=${BACKUP_DIR:-"$INFRA_DIR/backups"}
POSTGRES_DB=${POSTGRES_DB:-finance}
POSTGRES_USER=${POSTGRES_USER:-finance}
TIMESTAMP=$(date -u +"%Y%m%dT%H%M%SZ")
OUTPUT_FILE=${OUTPUT_FILE:-"$BACKUP_DIR/${POSTGRES_DB}-${TIMESTAMP}.dump"}

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

printf 'PostgreSQL backup written to %s\n' "$OUTPUT_PATH"
