#!/usr/bin/env sh
set -eu

if [ "$#" -ne 1 ]; then
  printf 'Usage: %s path/to/backup.dump\n' "$0" >&2
  exit 2
fi

if [ "${CONFIRM_RESTORE:-}" != "finance" ]; then
  printf 'Refusing to restore without CONFIRM_RESTORE=finance.\n' >&2
  printf 'This operation can overwrite local database objects.\n' >&2
  exit 2
fi

BACKUP_FILE=$1
if [ ! -f "$BACKUP_FILE" ]; then
  printf 'Backup file not found: %s\n' "$BACKUP_FILE" >&2
  exit 2
fi
case "$BACKUP_FILE" in
  /*) BACKUP_PATH=$BACKUP_FILE ;;
  *) BACKUP_PATH=$(pwd)/$BACKUP_FILE ;;
esac

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
INFRA_DIR=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)
POSTGRES_DB=${POSTGRES_DB:-finance}
POSTGRES_USER=${POSTGRES_USER:-finance}

cd "$INFRA_DIR"

docker compose exec -T postgres pg_restore \
  --username "$POSTGRES_USER" \
  --dbname "$POSTGRES_DB" \
  --clean \
  --if-exists \
  --no-owner < "$BACKUP_PATH"

printf 'PostgreSQL restore completed from %s\n' "$BACKUP_PATH"
