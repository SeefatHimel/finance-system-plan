from collections.abc import Iterable

from django.contrib.auth.models import AbstractBaseUser

from .models import Category


DEFAULT_CATEGORIES: tuple[tuple[str, str], ...] = (
    ("Food & Dining", Category.Kind.EXPENSE),
    ("Transport", Category.Kind.EXPENSE),
    ("Housing", Category.Kind.EXPENSE),
    ("Utilities & Bills", Category.Kind.EXPENSE),
    ("Shopping & Personal", Category.Kind.EXPENSE),
    ("Health & Medical", Category.Kind.EXPENSE),
    ("Education", Category.Kind.EXPENSE),
    ("Entertainment", Category.Kind.EXPENSE),
    ("Fees & Charges", Category.Kind.EXPENSE),
    ("Other Expense", Category.Kind.EXPENSE),
    ("Salary & Wages", Category.Kind.INCOME),
    ("Business Income", Category.Kind.INCOME),
    ("Interest & Rewards", Category.Kind.INCOME),
    ("Refunds", Category.Kind.INCOME),
    ("Other Income", Category.Kind.INCOME),
    ("Account Transfer", Category.Kind.TRANSFER),
    ("Loan & Debt", Category.Kind.DEBT),
)


def default_category_rows() -> Iterable[tuple[str, str, int]]:
    return (
        (name, kind, display_order)
        for display_order, (name, kind) in enumerate(DEFAULT_CATEGORIES, start=10)
    )


def create_default_categories(user: AbstractBaseUser) -> list[Category]:
    existing_names = set(
        Category.objects.filter(user=user).values_list("name", flat=True)
    )
    categories = [
        Category(
            display_order=display_order,
            kind=kind,
            name=name,
            user=user,
        )
        for name, kind, display_order in default_category_rows()
        if name not in existing_names
    ]
    return Category.objects.bulk_create(categories)
