import uuid

import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("statements", "0003_reapply_pending_merchants"),
        ("accounts", "0001_initial"),
        ("categories", "0002_seed_default_categories"),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name="StatementCounterpartyCode",
            fields=[
                (
                    "id",
                    models.UUIDField(
                        default=uuid.uuid4,
                        editable=False,
                        primary_key=True,
                        serialize=False,
                    ),
                ),
                ("profile", models.CharField(default="city_bank", max_length=32)),
                ("code", models.CharField(max_length=4)),
                (
                    "direction",
                    models.CharField(
                        choices=[("debit", "Debit"), ("credit", "Credit")],
                        max_length=16,
                    ),
                ),
                (
                    "party_kind",
                    models.CharField(
                        choices=[
                            ("owned", "My account"),
                            ("external", "External party"),
                        ],
                        max_length=16,
                    ),
                ),
                ("label", models.CharField(max_length=120)),
                (
                    "suggested_type",
                    models.CharField(
                        blank=True,
                        choices=[
                            ("expense", "Expense"),
                            ("income", "Income"),
                            ("transfer", "Transfer"),
                            ("adjustment", "Adjustment"),
                            ("fee", "Fee"),
                            ("refund", "Refund"),
                            ("lend", "Lend"),
                            ("borrow", "Borrow"),
                            ("repayment_received", "Repayment received"),
                            ("repayment_paid", "Repayment paid"),
                        ],
                        max_length=32,
                    ),
                ),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                (
                    "account",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        to="accounts.account",
                    ),
                ),
                (
                    "category",
                    models.ForeignKey(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        to="categories.category",
                    ),
                ),
                (
                    "other_account",
                    models.ForeignKey(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="statement_code_mappings",
                        to="accounts.account",
                    ),
                ),
                (
                    "user",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        to=settings.AUTH_USER_MODEL,
                    ),
                ),
            ],
            options={
                "indexes": [
                    models.Index(
                        fields=["user", "account", "code"],
                        name="statements__user_id_14851e_idx",
                    )
                ],
                "constraints": [
                    models.UniqueConstraint(
                        fields=("user", "account", "profile", "code", "direction"),
                        name="statement_counterparty_code_scope",
                    )
                ],
            },
        ),
    ]
