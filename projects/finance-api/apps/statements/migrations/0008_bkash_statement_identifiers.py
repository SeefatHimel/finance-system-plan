from typing import ClassVar

from django.db import migrations, models
from django.db.models import F
from django.utils import timezone


def categorize_pending_bkash_bills(apps, schema_editor):
    Category = apps.get_model("categories", "Category")
    StatementRow = apps.get_model("statements", "StatementRow")
    categories = {
        category.user_id: category.id
        for category in Category.objects.filter(
            name="Utilities & Bills", kind="expense", is_active=True
        ).order_by("id")
    }
    rows = StatementRow.objects.filter(
        batch__profile="bkash", component="principal", state="pending",
        transaction__isnull=True, category__isnull=True, type="expense", direction="debit",
    ).values_list("id", "batch__user_id", "extracted")
    for row_id, user_id, extracted in rows.iterator():
        if user_id not in categories or str((extracted or {}).get("provider_type") or "").casefold() not in {
            "pay bill", "mobile recharge",
        }:
            continue
        StatementRow.objects.filter(pk=row_id, category__isnull=True).update(
            category_id=categories[user_id], version=F("version") + 1,
            updated_at=timezone.now(),
        )


class Migration(migrations.Migration):
    dependencies: ClassVar = [("statements", "0007_statementrow_source_code")]

    operations: ClassVar = [
        migrations.AlterField(
            model_name="statementcounterpartycode",
            name="code",
            field=models.CharField(max_length=64),
        ),
        migrations.RunPython(categorize_pending_bkash_bills, migrations.RunPython.noop),
    ]
