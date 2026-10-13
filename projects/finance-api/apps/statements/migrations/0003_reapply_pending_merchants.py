"""Clean untouched merchant drafts from older pending statement imports."""

import re
from typing import ClassVar

from django.db import migrations, models
from django.utils import timezone

# Keep this frozen with the merchant cleanup used when this migration was written.
# Historical migrations must not depend on a helper whose behavior may change.
CARD_PREFIX = re.compile(
    r"^\s*(?:(?:reverse|reversal|refund)\s+)?(?:"
    r"(?:debit\s+|credit\s+)?card\s+purchase|purchase\s+(?:by\s+)?card|pos\s+purchase)\b[\s:/.\-]*",
    re.IGNORECASE,
)


def clean_merchant(description):
    value = CARD_PREFIX.sub("", description, count=1)
    value = re.split(
        r"\b(?:trx\s*id|reference|ref|value\s*date)\s*[:/#]"
        r"|\b(?:(?:sender|receiver|your)\s+(?:card|account|a/c)|card\s*(?:no\.?|number)|a/c|account(?:\s*(?:no\.?|number))?|card\s*[:#])\s*[:#]?\s*(?=[0-9*Xx•…])"
        r"|\bcard\s+(?=[0-9*Xx•…]*[*Xx•…][0-9*Xx•…]*[0-9]{3,})",
        value,
        maxsplit=1,
        flags=re.IGNORECASE,
    )[0]
    return re.sub(r"\s+", " ", value).strip(" :/-,")[:255]


def reapply_pending_merchant_cleanup(apps, schema_editor):
    StatementRow = apps.get_model("statements", "StatementRow")
    database = schema_editor.connection.alias
    rows = (
        StatementRow.objects.using(database)
        .filter(state="pending", transaction__isnull=True)
        .values("pk", "extracted", "counterparty_text")
        .iterator(chunk_size=500)
    )
    for row in rows:
        extracted = row["extracted"]
        description = (
            extracted.get("description") if isinstance(extracted, dict) else None
        )
        if (
            not isinstance(description, str)
            or row["counterparty_text"] != description[:255]
        ):
            continue
        cleaned = clean_merchant(description)
        if not cleaned or cleaned == row["counterparty_text"]:
            continue
        # The conditional update preserves edits made while the migration runs.
        StatementRow.objects.using(database).filter(
            pk=row["pk"],
            state="pending",
            transaction__isnull=True,
            counterparty_text=row["counterparty_text"],
        ).update(
            counterparty_text=cleaned,
            version=models.F("version") + 1,
            updated_at=timezone.now(),
        )


class Migration(migrations.Migration):
    dependencies: ClassVar = [("statements", "0002_statementmapping")]

    operations: ClassVar = [
        migrations.RunPython(
            reapply_pending_merchant_cleanup, migrations.RunPython.noop
        )
    ]
