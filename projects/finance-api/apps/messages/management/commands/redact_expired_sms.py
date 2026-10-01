from datetime import timedelta

from django.core.management.base import BaseCommand
from django.utils import timezone

from apps.messages.models import ParsedMessageCandidate, RawMessage, SmsCapturePreference


class Command(BaseCommand):
    help = "Redact confirmed raw SMS bodies after each user's configured retention period."

    def handle(self, *args, **options):
        redacted_count = 0
        preferences = SmsCapturePreference.objects.exclude(raw_sms_retention_days__isnull=True)

        for preference in preferences.iterator():
            retention_days = preference.raw_sms_retention_days
            if retention_days is None:
                continue
            cutoff = timezone.now() - timedelta(days=retention_days)
            messages = RawMessage.objects.filter(
                user=preference.user,
                status=RawMessage.Status.IMPORTED,
                candidate__status=ParsedMessageCandidate.Status.CONFIRMED,
                candidate__updated_at__lte=cutoff,
            )
            for message in messages.iterator():
                message.redact()
                redacted_count += 1

        self.stdout.write(self.style.SUCCESS(f"Redacted {redacted_count} raw SMS message(s)."))
