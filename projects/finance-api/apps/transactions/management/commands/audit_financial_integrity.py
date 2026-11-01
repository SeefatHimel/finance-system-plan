import json
from django.core.management.base import BaseCommand, CommandError
from apps.transactions.integrity import audit_integrity, violation_count


class Command(BaseCommand):
    help = "Read-only financial integrity counts; excludes original text, amounts and identifiers."

    def add_arguments(self, parser):
        parser.add_argument("--user-id", type=int)
        parser.add_argument("--fail-on-issues", action="store_true")

    def handle(self, *args, **options):
        result = audit_integrity(user_id=options["user_id"])
        self.stdout.write(json.dumps(result, sort_keys=True))
        if options["fail_on_issues"] and violation_count(result):
            raise CommandError(
                "Integrity issues require explicit review; no values were changed."
            )
