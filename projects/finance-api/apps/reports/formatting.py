"""Decimal-only formatting shared by independent report projections."""

from decimal import Decimal

ZERO = Decimal("0.00")


def money(value):
    return f"{value.quantize(Decimal('0.01'))}"
