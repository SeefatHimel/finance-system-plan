# Backup Automation

Last updated: 2026-05-31

## Goal

Keep a small, auditable backup path for the finance database before the project
chooses a final hosting provider. Backups can contain sensitive financial data,
so they must stay outside git and should move to encrypted off-machine storage
before real financial use.

## Current Local Automation Pieces

The infra project includes:

- `projects/finance-infra/scripts/backup-postgres.sh`
  - creates a custom-format PostgreSQL dump through Docker Compose
  - refuses tiny backup outputs through `MIN_BACKUP_BYTES`
  - writes a sidecar manifest with timestamp, file size, and checksum
- `projects/finance-infra/scripts/restore-postgres.sh`
  - restores a dump into the Compose PostgreSQL service
  - requires `CONFIRM_RESTORE=finance`
- `projects/finance-infra/scripts/prune-backups.sh`
  - dry-runs by default
  - deletes old dump and manifest files only with `CONFIRM_PRUNE=finance`

## Local Schedule Example

From `projects/finance-infra`, a simple daily cron entry can create and prune
local backups:

```cron
15 2 * * * cd /path/to/finance-system-plan/projects/finance-infra && BACKUP_DIR=/secure/local/finance-backups ./scripts/backup-postgres.sh >> /var/log/finance-backup.log 2>&1
45 2 * * * cd /path/to/finance-system-plan/projects/finance-infra && BACKUP_DIR=/secure/local/finance-backups RETENTION_DAYS=30 CONFIRM_PRUNE=finance ./scripts/prune-backups.sh >> /var/log/finance-backup.log 2>&1
```

For production, replace `/secure/local/finance-backups` with encrypted storage
or a staging directory that is immediately uploaded to encrypted off-machine
storage by the hosting platform.

## Restore Drill

At least once before production use, and then on a recurring schedule:

1. Create a backup.
2. Copy it to a separate test environment.
3. Restore with:

   ```bash
   CONFIRM_RESTORE=finance ./scripts/restore-postgres.sh /path/to/finance.dump
   ```

4. Start the API against the restored database.
5. Verify login, transaction list, SMS review inbox, reconciliation, and audit
   log reads using test data only.
6. Record the backup timestamp, manifest checksum, restore date, result, and
   operator in the deployment notes or incident log.

## Production Requirements Still Needed

Before real financial use, the chosen production environment must add:

- encrypted off-machine storage
- failure alerts for backup and upload jobs
- access control for who can read or restore dumps
- restore approval rules
- attachment/media backups if uploads are added
- recurring restore drills against a separate database

## Verified backup/restore behavior

The scripts now use private files (0600), temporary output and complete-file
publication; failed dumps are not advertised as backups. They refuse overwrite,
reject tiny dumps and include SHA-256 in the manifest. Restore parses the
manifest as data, verifies the hash before connecting, and runs `pg_restore` with
`--single-transaction --exit-on-error`. Older `cksum` manifests still work; prefer
a fresh SHA-256 backup. Checksums detect corruption, not a maliciously substituted
dump. Dumps themselves require encrypted storage and restricted access.

Default transport remains Docker Compose. For native PostgreSQL tools set
`DATABASE_TRANSPORT=local` and normal `PGHOST`, `PGPORT`, `PGUSER`, `PGPASSWORD`
(or a protected `.pgpass`) plus `POSTGRES_DB`/`POSTGRES_USER`. For production
Compose, select the intended `COMPOSE_FILE` and environment explicitly. Do not
run restore against the live database as a verification exercise.

No-database safety tests, from the repository root:

```bash
python -m unittest discover -s projects/finance-infra/tests
```

A repeatable native restore drill accepts only a synthetic `finance_e2e_*` source
and a new `finance_restore_*` target. Supply PostgreSQL credentials through the
normal protected environment, not committed files:

```bash
python projects/finance-infra/scripts/verify-synthetic-restore.py --source finance_e2e_local --target finance_restore_local
```

It refuses an existing target, backs up/restores, compares counts and aggregate
row fingerprints across every public table, and drops only the newly created
target afterward. It prints aggregate results, never row contents. The 1 November
2026 drill verified 46 tables/502 synthetic rows, including encrypted source SMS
and PDF bytes. This proves byte preservation under the tested environment; a
separate application/decryption test must verify recovery with the correct keys.
The CI drill uses its own smaller synthetic browser database.

Original statement PDFs and SMS ciphertext currently live in PostgreSQL and are
included in its dump. Future external attachments need a coordinated backup.
Retention/redaction removes active records according to product policy; old
backups retain their prior content until their own retention expires. Restrict
backup access, retain needed decryption/fallback keys securely and separately,
and treat restore as recovery of a historical snapshot. This patch does not
configure a scheduler, off-machine encryption, alert destination, RPO or RTO.
