"""No Docker or database needed: exercise backup failure and restore guards."""

import os
from pathlib import Path
import subprocess
import tempfile
import unittest

SCRIPTS = Path(__file__).resolve().parents[1] / "scripts"


class BackupSafetyTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.dump = self.root / "synthetic.dump"
        self.env = {
            **os.environ,
            "DATABASE_TRANSPORT": "local",
            "OUTPUT_FILE": str(self.dump),
            "POSTGRES_DB": "synthetic",
            "POSTGRES_USER": "synthetic",
            "PATH": str(self.root) + os.pathsep + os.environ["PATH"],
        }
        self.binary("pg_dump", 'printf "%02048d" 0\n')
        self.binary(
            "pg_restore", 'printf "%s\\n" "$@" > "$RESTORE_ARGUMENTS"\ncat >/dev/null\n'
        )
        self.env["RESTORE_ARGUMENTS"] = str(self.root / "restore-arguments")

    def binary(self, name, body):
        file = self.root / name
        file.write_text("#!/bin/sh\nset -eu\n" + body)
        file.chmod(0o700)

    def run_script(self, name, *args):
        return subprocess.run(
            ["sh", str(SCRIPTS / name), *map(str, args)],
            env=self.env,
            capture_output=True,
            text=True,
        )

    def backup(self):
        # The fake pg_dump writes stdout; adapt its --file argument for local mode.
        self.binary("pg_dump", 'for last do :; done\nprintf "%02048d" 0 > "$last"\n')
        response = self.run_script("backup-postgres.sh")
        self.assertEqual(response.returncode, 0, response.stderr)

    def test_success_uses_private_files_and_refuses_overwrite(self):
        self.backup()
        for file in [self.dump, Path(str(self.dump) + ".manifest")]:
            self.assertEqual(file.stat().st_mode & 0o777, 0o600)
        self.assertNotEqual(self.run_script("backup-postgres.sh").returncode, 0)

    def test_failed_dump_never_publishes_partial_backup(self):
        self.binary(
            "pg_dump", 'for last do :; done\nprintf partial > "$last"\nexit 1\n'
        )
        self.assertNotEqual(self.run_script("backup-postgres.sh").returncode, 0)
        self.assertFalse(self.dump.exists())
        self.assertEqual(list(self.root.glob("*.tmp.*")), [])

    def test_restore_requires_confirmation_and_valid_checksum(self):
        self.backup()
        self.assertNotEqual(
            self.run_script("restore-postgres.sh", self.dump).returncode, 0
        )
        self.env["CONFIRM_RESTORE"] = "finance"
        self.dump.write_bytes(b"tampered synthetic backup")
        self.assertNotEqual(
            self.run_script("restore-postgres.sh", self.dump).returncode, 0
        )
        self.assertFalse(Path(self.env["RESTORE_ARGUMENTS"]).exists())

    def test_restore_is_atomic_and_exits_on_first_error(self):
        self.backup()
        self.env["CONFIRM_RESTORE"] = "finance"
        result = self.run_script("restore-postgres.sh", self.dump)
        self.assertEqual(result.returncode, 0, result.stderr)
        args = Path(self.env["RESTORE_ARGUMENTS"]).read_text().splitlines()
        self.assertIn("--single-transaction", args)
        self.assertIn("--exit-on-error", args)


if __name__ == "__main__":
    unittest.main()
