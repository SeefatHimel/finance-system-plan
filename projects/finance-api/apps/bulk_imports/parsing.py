"""Bounded, deterministic CSV/TSV parsing. Source text is never evaluated."""

import csv
import io
import re
from datetime import date, datetime
from decimal import Decimal, InvalidOperation
from rest_framework.exceptions import ValidationError

MAX_ROWS = 500
MAX_BYTES = 1_000_000
FIELDS = ("date", "time", "category", "description", "amount", "notes", "balance_after")
ALIASES = {
    "date": {"date", "transaction date"},
    "time": {"time", "transaction time"},
    "category": {"category"},
    "description": {"description", "merchant", "details"},
    "amount": {"amount", "value"},
    "notes": {"notes", "note"},
    "balance_after": {
        "balance",
        "balance after",
        "reported balance",
        "reported balance after",
    },
}
DIGITS = str.maketrans("০১২৩৪৫৬৭৮৯", "0123456789")


def table(text):
    if len(text.encode("utf-8")) > MAX_BYTES:
        raise ValidationError({"text": "Use at most 1 MB and 500 rows per import."})
    text = text.removeprefix("\ufeff")
    first = text.splitlines()[0] if text.splitlines() else ""
    delimiter = "\t" if "\t" in first else ","
    try:
        records = [
            row
            for row in csv.reader(
                io.StringIO(text, newline=""), delimiter=delimiter, strict=True
            )
            if any(cell.strip() for cell in row)
        ]
    except csv.Error as exc:
        raise ValidationError(
            {
                "text": "The table has invalid quoting. Paste spreadsheet cells or export UTF-8 CSV."
            }
        ) from exc
    if len(records) < 2 or len(records) > MAX_ROWS + 1:
        raise ValidationError({"text": "Provide a header and 1–500 data rows."})
    headers = [cell.strip() for cell in records[0]]
    if (
        len(headers) > 30
        or any(not h for h in headers)
        or len({h.casefold() for h in headers}) != len(headers)
    ):
        raise ValidationError(
            {"text": "Use up to 30 nonempty, unique column headings."}
        )
    if any(len(row) > len(headers) for row in records[1:]):
        raise ValidationError(
            {
                "text": "A row has more cells than the header. Check its delimiter or quoting."
            }
        )
    rows = [row + [""] * (len(headers) - len(row)) for row in records[1:]]
    mapping = {
        field: next(
            (header for header in headers if header.casefold() in ALIASES[field]), ""
        )
        for field in FIELDS
    }
    return headers, rows, mapping


def money(value, *, currency="BDT", allow_zero=False, signed=True):
    value = str(value).strip().translate(DIGITS)
    if currency != "BDT" and (
        "৳" in value or re.search(r"\b(?:BDT|Tk)\b", value, re.I)
    ):
        raise ValueError("This amount is in BDT; choose a BDT account.")
    value = (
        re.sub(r"\b(?:BDT|Tk)\.?\s*", "", value, flags=re.I).replace("৳", "").strip()
    )
    if value.startswith("(") and value.endswith(")"):
        value = "-" + value[1:-1].strip()
    if not re.fullmatch(r"[+-]?(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d{1,2})?", value):
        raise ValueError(
            "Use a number with at most two decimal places, such as 1,250.50."
        )
    try:
        number = Decimal(value.replace(",", ""))
    except InvalidOperation as exc:
        raise ValueError("Enter a valid amount.") from exc
    if (
        abs(number) >= Decimal("1000000000000")
        or (not allow_zero and number == 0)
        or (not signed and number < 0)
    ):
        raise ValueError(
            "Enter a positive amount below 1 trillion."
            if not allow_zero
            else "Enter a nonnegative balance below 1 trillion."
        )
    return number.quantize(Decimal("0.01"))


def day(value, order="ISO"):
    value = str(value).strip()
    if re.fullmatch(r"\d{4}-\d{2}-\d{2}", value):
        return date.fromisoformat(value)
    if order not in {"DMY", "MDY"}:
        raise ValueError("Choose day/month/year or month/day/year for non-ISO dates.")
    for separator in ("/", "-", "."):
        try:
            return datetime.strptime(
                value,
                ("%d" + separator + "%m" if order == "DMY" else "%m" + separator + "%d")
                + separator
                + "%Y",
            ).date()
        except ValueError:
            pass
    raise ValueError("Enter a valid date using the selected date order.")


def clock(value):
    if value is None or not str(value).strip():
        return None
    for fmt in ("%H:%M", "%H:%M:%S", "%I:%M %p", "%I:%M:%S %p"):
        try:
            return datetime.strptime(str(value).strip().upper(), fmt).time()
        except ValueError:
            pass
    raise ValueError("Use a valid time such as 18:30 or 06:30 PM, or leave it blank.")
