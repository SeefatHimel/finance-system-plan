import uuid

from django.conf import settings
from django.db import models


class Category(models.Model):
    class Kind(models.TextChoices):
        EXPENSE = "expense", "Expense"
        INCOME = "income", "Income"
        TRANSFER = "transfer", "Transfer"
        DEBT = "debt", "Debt"
        SYSTEM = "system", "System"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="categories",
    )
    name = models.CharField(max_length=120)
    kind = models.CharField(max_length=32, choices=Kind.choices, default=Kind.EXPENSE)
    parent = models.ForeignKey(
        "self",
        on_delete=models.SET_NULL,
        blank=True,
        null=True,
        related_name="children",
    )
    is_active = models.BooleanField(default=True)
    display_order = models.PositiveIntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ("display_order", "name")
        constraints = [
            models.UniqueConstraint(
                fields=("user", "name"),
                name="unique_category_name_per_user",
            )
        ]

    def __str__(self) -> str:
        return self.name

