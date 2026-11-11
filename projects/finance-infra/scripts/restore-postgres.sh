#!/usr/bin/env sh
set -eu
[ "$#" -eq 1 ] || { printf 'Usage: %s path/to/backup.dump\n' "$0" >&2; exit 2; }
[ "${CONFIRM_RESTORE:-}" = finance ] || { printf 'Refusing to restore without CONFIRM_RESTORE=finance. This can overwrite database objects.\n' >&2; exit 2; }
BACKUP_FILE=$1
[ -f "$BACKUP_FILE" ] || { printf 'Backup file not found.\n' >&2; exit 2; }
case "$BACKUP_FILE" in /*) BACKUP_PATH=$BACKUP_FILE ;; *) BACKUP_PATH=$(pwd)/$BACKUP_FILE ;; esac
MANIFEST_PATH=${MANIFEST_PATH:-"$BACKUP_PATH.manifest"}
[ -f "$MANIFEST_PATH" ] || { printf 'Backup manifest is required.\n' >&2; exit 2; }
# Parse as data, never source a manifest as executable shell code.
EXPECTED=$(awk -F= '$1 == "sha256" {print $2}' "$MANIFEST_PATH")
if [ -n "$EXPECTED" ]; then
  if command -v sha256sum >/dev/null 2>&1; then ACTUAL=$(sha256sum "$BACKUP_PATH" | awk '{print $1}'); else ACTUAL=$(shasum -a 256 "$BACKUP_PATH" | awk '{print $1}'); fi
else
  # Older manifests contain cksum only. Preserve compatibility, but newly made
  # backups always use SHA-256. Neither checksum authenticates an untrusted file.
  EXPECTED=$(awk -F= '$1 == "cksum" {print $2}' "$MANIFEST_PATH")
  ACTUAL=$(cksum "$BACKUP_PATH" | awk '{print $1}')
fi
[ -n "$EXPECTED" ] && [ "$ACTUAL" = "$EXPECTED" ] || { printf 'Backup checksum mismatch. Nothing restored.\n' >&2; exit 2; }
SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
INFRA_DIR=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)
POSTGRES_DB=${POSTGRES_DB:-finance}
POSTGRES_USER=${POSTGRES_USER:-finance}
cd "$INFRA_DIR"
case "${DATABASE_TRANSPORT:-compose}" in
  compose) docker compose exec -T postgres pg_restore --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" --clean --if-exists --no-owner --single-transaction --exit-on-error < "$BACKUP_PATH" ;;
  local) pg_restore --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" --clean --if-exists --no-owner --single-transaction --exit-on-error < "$BACKUP_PATH" ;;
  *) printf 'DATABASE_TRANSPORT must be compose or local.\n' >&2; exit 2 ;;
esac
printf 'PostgreSQL restore completed from %s\n' "$BACKUP_PATH"
