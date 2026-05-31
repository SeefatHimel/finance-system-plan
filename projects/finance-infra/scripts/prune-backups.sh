#!/usr/bin/env sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
INFRA_DIR=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)
BACKUP_DIR=${BACKUP_DIR:-"$INFRA_DIR/backups"}
RETENTION_DAYS=${RETENTION_DAYS:-30}

case "$BACKUP_DIR" in
  /*) BACKUP_PATH=$BACKUP_DIR ;;
  *) BACKUP_PATH=$(pwd)/$BACKUP_DIR ;;
esac

if [ ! -d "$BACKUP_PATH" ]; then
  printf 'Backup directory not found: %s\n' "$BACKUP_PATH" >&2
  exit 2
fi

if [ "${CONFIRM_PRUNE:-}" != "finance" ]; then
  printf 'Dry run only. Set CONFIRM_PRUNE=finance to delete matching files.\n' >&2
  find "$BACKUP_PATH" -type f \( -name '*.dump' -o -name '*.dump.manifest' \) -mtime +"$RETENTION_DAYS" -print
  exit 0
fi

find "$BACKUP_PATH" -type f \( -name '*.dump' -o -name '*.dump.manifest' \) -mtime +"$RETENTION_DAYS" -print -exec rm -f {} \;
printf 'Pruned backup files older than %s day(s) from %s\n' "$RETENTION_DAYS" "$BACKUP_PATH"
