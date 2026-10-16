from typing import ClassVar

from django.conf import settings
from django.db import migrations


def add_specific_bills(apps, schema_editor):
    User = apps.get_model(*settings.AUTH_USER_MODEL.split("."))
    Category = apps.get_model("categories", "Category")
    for user_id in User.objects.values_list("pk", flat=True).iterator():
        existing = set(Category.objects.filter(user_id=user_id).values_list("name", flat=True))
        Category.objects.bulk_create([
            Category(user_id=user_id, name=name, kind="expense", display_order=order)
            for name, order in (("Electricity", 14), ("Internet", 15), ("Mobile Recharge", 16))
            if name not in existing
        ])


class Migration(migrations.Migration):
    dependencies: ClassVar = [migrations.swappable_dependency(settings.AUTH_USER_MODEL), ("categories", "0002_seed_default_categories")]
    operations: ClassVar = [migrations.RunPython(add_specific_bills, migrations.RunPython.noop)]
