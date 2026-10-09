"""Inclusive date ranges shared by reports and transaction lists."""

import re
from datetime import date

from rest_framework.exceptions import ValidationError


def custom_bounds(params):
    start_text, end_text = params.get("start_date"), params.get("end_date")
    if start_text is None and end_text is None:
        return None
    if params.get("month"):
        raise ValidationError({"date_range": "Choose a month or a custom date range."})
    dates = []
    for field, value in (("start_date", start_text), ("end_date", end_text)):
        try:
            if not value or not re.fullmatch(r"\d{4}-\d{2}-\d{2}", value):
                raise ValueError
            dates.append(date.fromisoformat(value))
        except ValueError as exc:
            raise ValidationError(
                {field: "Enter a valid date in YYYY-MM-DD format."}
            ) from exc
    start, end = dates
    if start > end:
        raise ValidationError({"end_date": "End date must be on or after start date."})
    if (end - start).days > 365:
        raise ValidationError({"date_range": "Choose a range of at most 366 days."})
    return start, end
