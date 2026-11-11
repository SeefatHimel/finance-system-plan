#!/usr/bin/env python3
"""Verify a full native-PostgreSQL restore using disposable synthetic databases."""

import argparse
import json
import os
from pathlib import Path
import subprocess
import tempfile
from time import perf_counter

parser = argparse.ArgumentParser()
parser.add_argument("--source", required=True)
parser.add_argument("--target", required=True)
args = parser.parse_args()
if (
    not args.source.startswith("finance_e2e_")
    or not args.target.startswith("finance_restore_")
    or args.source == args.target
):
    parser.error(
        "Use a synthetic finance_e2e_* source and a new finance_restore_* target."
    )


def pg(*command, **kwargs):
    return subprocess.run(
        command, check=True, text=True, capture_output=True, **kwargs
    ).stdout.strip()


def snapshot(database):
    tables = pg(
        "psql",
        "-XAt",
        "--dbname",
        database,
        "-c",
        "SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename",
    ).splitlines()
    result = {}
    for table in tables:
        identifier = '"' + table.replace('"', '""') + '"'
        # Only aggregate fingerprints/counts leave PostgreSQL; source values and
        # identifiers are never printed or written into the verification report.
        result[table] = pg(
            "psql",
            "-XAt",
            "--dbname",
            database,
            "-c",
            f"SELECT count(*)::text || ':' || coalesce(md5(string_agg(digest, '' ORDER BY digest)), '') FROM (SELECT md5(row_to_json(t)::text) AS digest FROM {identifier} t) rows",
        )
    return result


started = perf_counter()
before = snapshot(args.source)
pg("createdb", args.target)  # Fails rather than overwriting an existing database.
try:
    with tempfile.TemporaryDirectory(prefix="finance-restore-") as folder:
        dump = Path(folder) / "synthetic.dump"
        scripts = Path(__file__).resolve().parent
        env = {
            **os.environ,
            "DATABASE_TRANSPORT": "local",
            "POSTGRES_DB": args.source,
            "POSTGRES_USER": os.environ.get("PGUSER", os.environ.get("USER", "")),
            "OUTPUT_FILE": str(dump),
        }
        subprocess.run(
            ["sh", str(scripts / "backup-postgres.sh")],
            env=env,
            check=True,
            capture_output=True,
        )
        env.update(POSTGRES_DB=args.target, CONFIRM_RESTORE="finance")
        subprocess.run(
            ["sh", str(scripts / "restore-postgres.sh"), str(dump)],
            env=env,
            check=True,
            capture_output=True,
        )
        after = snapshot(args.target)
        if before != after:
            raise RuntimeError(
                "Restored table fingerprints/counts differ. No source data was changed."
            )
        print(
            json.dumps(
                {
                    "synthetic": True,
                    "tables_verified": len(before),
                    "rows_verified": sum(
                        int(value.split(":")[0]) for value in before.values()
                    ),
                    "backup_bytes": dump.stat().st_size,
                    "elapsed_s": round(perf_counter() - started, 2),
                }
            )
        )
finally:
    pg("dropdb", args.target)
