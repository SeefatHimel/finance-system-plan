import re
from typing import ClassVar

from django.db import migrations
from django.db.models import F
from django.utils import timezone


def refine_pending_bills(apps, schema_editor):
    Category = apps.get_model("categories", "Category")
    StatementRow = apps.get_model("statements", "StatementRow")
    categories = {}
    for category in Category.objects.filter(
        name__in=["Utilities & Bills", "Electricity", "Internet", "Mobile Recharge"],
        kind="expense", is_active=True,
    ):
        categories[(category.user_id, category.name)] = category.id
    rows = StatementRow.objects.filter(
        batch__profile="bkash", component="principal", state="pending",
        transaction__isnull=True, type="expense", direction="debit", version__lte=2,
    ).values_list("id", "batch__user_id", "category_id", "note", "extracted")
    for row_id, user_id, category_id, note, extracted in rows.iterator():
        generic = categories.get((user_id, "Utilities & Bills"))
        if not generic or category_id != generic or note != str((extracted or {}).get("description") or ""):
            continue
        kind = str((extracted or {}).get("provider_type") or "").strip().casefold()
        details = str((extracted or {}).get("description") or "").casefold()
        name = None
        if kind == "mobile recharge":
            name = "Mobile Recharge"
        elif kind == "pay bill":
            if re.search(r"\b(?:desco|dpdc|bpdb|palli\s+bidyut|electric(?:ity)?|power\s+(?:supply|distribution))\b", details):
                name = "Electricity"
            elif re.search(r"\b(?:internet|broadband|wifi|wi-fi|isp)\b", details):
                name = "Internet"
        specific = categories.get((user_id, name))
        if specific:
            StatementRow.objects.filter(pk=row_id, category_id=generic).update(
                category_id=specific, version=F("version") + 1, updated_at=timezone.now(),
            )


class Migration(migrations.Migration):
    dependencies: ClassVar = [
        ("categories", "0003_specific_bills"),
        ("statements", "0009_counterparty_note_template"),
    ]
    operations: ClassVar = [migrations.RunPython(refine_pending_bills, migrations.RunPython.noop)]
