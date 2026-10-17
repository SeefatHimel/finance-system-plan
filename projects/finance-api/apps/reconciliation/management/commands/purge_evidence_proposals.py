"""Prune expired preview/receipt metadata, never canonical source links."""

from datetime import timedelta

from django.core.management.base import BaseCommand, CommandError
from django.utils import timezone

from apps.reconciliation.models import EvidenceProposal


class Command(BaseCommand):
    help = (
        "Count old evidence proposals; --apply deletes a bounded page of metadata only."
    )

    def add_arguments(self, parser):
        parser.add_argument("--days", type=int, default=30)
        parser.add_argument("--limit", type=int, default=1000)
        parser.add_argument("--apply", action="store_true")

    def handle(self, *args, **options):
        if options["days"] < 30 or not 1 <= options["limit"] <= 5000:
            raise CommandError("Keep at least 30 days; limit must be 1–5000.")
        cutoff = timezone.now() - timedelta(days=options["days"])
        old = EvidenceProposal.objects.filter(expires_at__lt=cutoff)
        ids = list(
            old.order_by("expires_at", "pk").values_list("pk", flat=True)[
                : options["limit"]
            ]
        )
        if options["apply"]:
            deleted, _ = old.filter(pk__in=ids).delete()
            self.stdout.write(
                f"Deleted {deleted} expired proposal metadata rows. Canonical links were retained."
            )
        else:
            self.stdout.write(
                f"Dry run: {len(ids)} expired proposal metadata rows in this page. Use --apply to delete."
            )
