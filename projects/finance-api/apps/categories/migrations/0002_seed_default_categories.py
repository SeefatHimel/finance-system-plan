from django.conf import settings
from django.db import migrations


DEFAULT_CATEGORIES = (
    ("Food & Dining", "expense"),
    ("Transport", "expense"),
    ("Housing", "expense"),
    ("Utilities & Bills", "expense"),
    ("Shopping & Personal", "expense"),
    ("Health & Medical", "expense"),
    ("Education", "expense"),
    ("Entertainment", "expense"),
    ("Fees & Charges", "expense"),
    ("Other Expense", "expense"),
    ("Salary & Wages", "income"),
    ("Business Income", "income"),
    ("Interest & Rewards", "income"),
    ("Refunds", "income"),
    ("Other Income", "income"),
    ("Account Transfer", "transfer"),
    ("Loan & Debt", "debt"),
)


def seed_users_without_categories(apps, schema_editor):
    user_app_label, user_model_name = settings.AUTH_USER_MODEL.split(".")
    User = apps.get_model(user_app_label, user_model_name)
    Category = apps.get_model("categories", "Category")

    for user_id in User.objects.values_list("pk", flat=True).iterator():
        if Category.objects.filter(user_id=user_id).exists():
            continue
        Category.objects.bulk_create(
            [
                Category(
                    display_order=display_order,
                    kind=kind,
                    name=name,
                    user_id=user_id,
                )
                for display_order, (name, kind) in enumerate(DEFAULT_CATEGORIES, start=10)
            ]
        )


class Migration(migrations.Migration):
    dependencies = [
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
        ("categories", "0001_initial"),
    ]

    operations = [
        migrations.RunPython(seed_users_without_categories, migrations.RunPython.noop),
    ]
