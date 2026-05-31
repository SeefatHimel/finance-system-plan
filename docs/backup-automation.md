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
