"""Positioned Pathao Pay wallet tables. Printed columns, never wording, set signs."""

import re
from datetime import datetime
from decimal import Decimal, InvalidOperation
from itertools import pairwise

from apps.messages.identifiers import sanitize_financial_identifier

from .parser import (
    MAX_ROWS,
    PARSER_VERSION,
    StatementParseError,
    lines,
    mask_identifiers,
    money,
)

DATE = re.compile(r"\d{2}\s+[A-Za-z]{3},?\s+\d{4}")
AMOUNT = re.compile(r"-?(?:\d{1,3}(?:,\d{3})+|\d+)\.\d{2}")
IDENTITY = re.compile(r"Account\s+Number\s*:\s*([\d*Xx•…]+)", re.IGNORECASE)
PERIOD = re.compile(
    r"\bPeriod\s*:\s*(\d{2}\s+[A-Za-z]{3},?\s+\d{4})\s+to\s+(\d{2}\s+[A-Za-z]{3},?\s+\d{4})",
    re.IGNORECASE,
)
COLUMNS = ("date", "reference", "type", "details", "in", "out", "fee", "balance")


def date_value(value):
    try:
        return datetime.strptime(value.replace(",", ""), "%d %b %Y").date().isoformat()
    except ValueError:
        return None


def text(words):
    return " ".join(line for _, line in lines(words))


def column_header(words, page):
    for day in words:
        if day["text"] != "Date":
            continue
        nearby = [word for word in words if abs(word["top"] - day["top"]) < 14]
        found = {
            key: [word for word in nearby if word["text"] == label]
            for key, label in (
                ("reference", "ID"),
                ("type", "Type"),
                ("details", "Details"),
                ("in", "In"),
                ("out", "Out"),
                ("fee", "Fee"),
                ("balance", "Balance"),
            )
        }
        times = [word for word in nearby if word["text"] == "Time"]
        if any(len(values) != 1 for values in found.values()) or len(times) != 1:
            continue
        centers = [(day["x0"] + times[0]["x1"]) / 2] + [
            (found[key][0]["x0"] + found[key][0]["x1"]) / 2 for key in COLUMNS[1:]
        ]
        if centers != sorted(centers) or any(
            right - left < 20 for left, right in pairwise(centers)
        ):
            continue
        boundaries = (
            [day["x0"] - 16]
            + [(left + right) / 2 for left, right in pairwise(centers)]
            + [float("inf")]
        )
        return dict(zip(COLUMNS, pairwise(boundaries))), max(
            word["bottom"] for word in nearby
        )
    raise StatementParseError(
        "unsupported_page",
        f"Page {page} has unrecognized Pathao Pay transaction columns; no rows were imported.",
    )


def in_column(word, span):
    return span[0] <= (word["x0"] + word["x1"]) / 2 < span[1]


def cell_money(words, span, label, *, optional=False):
    cell = [word for word in words if in_column(word, span)]
    if not cell and optional:
        return None
    if len(cell) != 1 or not AMOUNT.fullmatch(cell[0]["text"]):
        raise StatementParseError(
            "invalid_amount",
            f"A Pathao Pay {label} cell could not be read unambiguously; no rows were imported.",
        )
    try:
        value = Decimal(cell[0]["text"].replace(",", ""))
    except InvalidOperation as exc:
        raise StatementParseError(
            "invalid_amount", "A Pathao Pay money value is invalid."
        ) from exc
    if not value.is_finite() or abs(value) >= Decimal(1000000000000):
        raise StatementParseError(
            "invalid_amount", "A Pathao Pay amount exceeds the supported ledger limit."
        )
    return value


def extract_pathao(pages):
    opening = closing = reported_in = reported_out = None
    first_identity = first_period = None
    rows, checks, warnings = [], [], []
    seen_ids = set()
    for number, (width, height, words, page_text) in enumerate(pages, 1):
        if not re.search(r"Pathao\s+Pay\s+Statement", page_text, re.IGNORECASE):
            raise StatementParseError(
                "unsupported_page", f"Page {number} is not a Pathao Pay statement."
            )
        currency = re.search(r"\bCurrency\s*:?\s*([A-Z]{3})\b", page_text)
        if currency and currency[1] != "BDT":
            raise StatementParseError(
                "unsupported_currency",
                "Only BDT Pathao Pay wallet statements are supported.",
            )
        identity = IDENTITY.search(page_text)
        period = PERIOD.search(page_text)
        current_period = (
            tuple(date_value(period[index]) for index in (1, 2)) if period else None
        )
        if (
            not identity
            or not current_period
            or not all(current_period)
            or current_period[0] > current_period[1]
        ):
            raise StatementParseError(
                "unsupported_page",
                f"Page {number} has an unreadable Pathao account or statement period.",
            )
        if number == 1:
            first_identity, first_period = identity[1], current_period
        elif identity[1] != first_identity or current_period != first_period:
            raise StatementParseError(
                "mixed_statement",
                "Pages belong to different Pathao accounts or statement periods. Upload each exported statement separately.",
            )
        header, header_bottom = column_header(words, number)
        if not header["balance"][0] < width:
            raise StatementParseError(
                "unsupported_page", "Pathao table columns extend beyond the page."
            )
        # The first page's Main Wallet row explicitly supplies all four totals.
        summary_rows = [
            word
            for word in words
            if word["text"] == "Main"
            and word["top"] < header_bottom
            and any(
                other["text"] == "Wallet" and abs(other["top"] - word["top"]) < 3
                for other in words
            )
        ]
        if number == 1:
            if len(summary_rows) != 1:
                raise StatementParseError(
                    "missing_summary",
                    "The Pathao Main Wallet balance summary could not be identified.",
                )
            summary = summary_rows[0]
            summary_headings = sorted(
                [
                    word
                    for word in words
                    if summary["top"] - 80 < word["top"] < summary["top"]
                    and word["text"] in {"Opening", "Total", "Closing"}
                ],
                key=lambda word: word["x0"],
            )
            if [word["text"] for word in summary_headings] != [
                "Opening",
                "Total",
                "Total",
                "Closing",
            ]:
                raise StatementParseError(
                    "missing_summary",
                    "The Pathao balance summary headings are unrecognized.",
                )
            amounts = sorted(
                [
                    word
                    for word in words
                    if abs(word["top"] - summary["top"]) < 3
                    and AMOUNT.fullmatch(word["text"])
                ],
                key=lambda word: word["x0"],
            )
            if len(amounts) != 4:
                raise StatementParseError(
                    "missing_summary",
                    "Expected opening balance, total in, total out and closing balance in the Pathao summary.",
                )
            opening, reported_in, reported_out, closing = [
                Decimal(word["text"].replace(",", "")) for word in amounts
            ]
        footer_lines = [
            y
            for y, value in lines(words)
            if value.startswith("Pathao Pay is a service")
            or "This is a system-generated statement" in value
        ]
        table_bottom = min(footer_lines, default=height - 40)
        date_words = [
            word
            for word in words
            if in_column(word, header["date"])
            and header_bottom < word["top"] < table_bottom
        ]
        anchors = [
            (y, value) for y, value in lines(date_words) if DATE.fullmatch(value)
        ]
        if not anchors:
            raise StatementParseError(
                "no_transactions",
                f"Page {number} has no readable dated Pathao transactions.",
            )
        for index, (top, printed_date) in enumerate(anchors):
            bottom = (
                anchors[index + 1][0] - 1 if index + 1 < len(anchors) else table_bottom
            )
            row_words = [word for word in words if top - 1 <= word["top"] < bottom]
            inc = cell_money(row_words, header["in"], "In", optional=True)
            out = cell_money(row_words, header["out"], "Out", optional=True)
            printed_fee = cell_money(
                row_words, header["fee"], "Charge/Fee", optional=True
            )
            balance = cell_money(row_words, header["balance"], "Balance")
            if any(value is not None and value < 0 for value in (inc, out)) or (
                bool(inc) == bool(out)
            ):
                raise StatementParseError(
                    "ambiguous_direction",
                    "Expected exactly one positive Pathao In or Out amount; debit/credit was not guessed.",
                )
            direction = "credit" if inc else "debit"
            amount = inc if inc else out
            issues = []
            day = date_value(printed_date)
            if day is None:
                issues.append("The transaction date is invalid.")
            elif not first_period[0] <= day <= first_period[1]:
                issues.append(
                    "The transaction date is outside the printed statement period."
                )
            clock_text = text(
                [
                    word
                    for word in row_words
                    if in_column(word, header["date"]) and word["top"] > top + 3
                ]
            )
            try:
                clock = datetime.strptime(clock_text, "%I:%M %p").time().isoformat()
            except ValueError:
                clock = None
                issues.append("The printed transaction time could not be read.")
            reference = text(
                [word for word in row_words if in_column(word, header["reference"])]
            )
            if not re.fullmatch(r"[A-Za-z0-9-]{1,120}", reference):
                issues.append("The transaction ID could not be read unambiguously.")
                reference = ""
            elif reference.casefold() in seen_ids:
                issues.append(
                    "A transaction ID is repeated in this statement. Compare the original rows."
                )
            seen_ids.add(reference.casefold())
            kind = text([word for word in row_words if in_column(word, header["type"])])
            details = text(
                [word for word in row_words if in_column(word, header["details"])]
            )
            if not kind:
                issues.append("The printed transaction type could not be read.")
            # Charges are positive costs in this column; negative charges rebate
            # money. Keep the printed value as well as the signed ledger delta.
            signed_fee = -(printed_fee or Decimal(0))
            rows.append(
                {
                    "id": f"{number}:{index + 1}",
                    "page": number,
                    "row": index + 1,
                    "date": day,
                    "time": clock,
                    "posting_date": day,
                    "value_date": None,
                    "description": mask_identifiers(
                        " · ".join(value for value in (kind, details) if value)
                    ),
                    "provider_type": mask_identifiers(kind),
                    "reference": reference,
                    "direction": direction,
                    "amount": money(amount),
                    "signed_fee": money(signed_fee),
                    "printed_fee": money(printed_fee),
                    "balance_after": money(balance),
                    "issues": issues,
                    "bounds": [
                        round(header["date"][0], 2),
                        round(top, 2),
                        round(width, 2),
                        round(bottom, 2),
                    ],
                }
            )
            if len(rows) > MAX_ROWS:
                raise StatementParseError(
                    "row_limit",
                    "This statement contains too many rows. Export a shorter period.",
                )
    total_in = total_out = Decimal(0)
    previous = opening
    for row in rows:
        amount, fee, balance = (
            Decimal(row[key]) for key in ("amount", "signed_fee", "balance_after")
        )
        total_in += amount if row["direction"] == "credit" else Decimal(0)
        total_out += amount if row["direction"] == "debit" else Decimal(0)
        total_in += max(fee, Decimal(0))
        total_out -= min(fee, Decimal(0))
        if (
            previous + (amount if row["direction"] == "credit" else -amount) + fee
            != balance
        ):
            row["issues"].append("Balance does not reconcile with the preceding row.")
        previous = balance
    for label, expected, observed in (
        ("Total in (including fee rebates)", reported_in, total_in),
        ("Total out (including wallet charges)", reported_out, total_out),
        ("Closing balance", closing, previous),
        ("Summary balance equation", closing, opening + reported_in - reported_out),
    ):
        checks.append(
            {
                "label": label,
                "expected": money(expected),
                "observed": money(observed),
                "passed": expected == observed,
            }
        )
    if any(not check["passed"] for check in checks):
        warnings.append(
            "Statement totals do not reconcile; verify extraction before importing."
        )
    if any(row["issues"] for row in rows):
        warnings.append(
            "Some Pathao rows need review; original direction and amounts were retained."
        )
    hint = sanitize_financial_identifier(first_identity)
    return {
        "profile": "pathao_pay",
        "parser_version": PARSER_VERSION,
        "currency": "BDT",
        "page_count": len(pages),
        "period_start": first_period[0],
        "period_end": first_period[1],
        "account_hint": "***" + hint if hint.isdigit() else hint,
        "rows": rows,
        "checks": checks,
        "warnings": warnings,
        "opening_balance": money(opening),
        "closing_balance": money(closing),
        "balance_transitions_checked": len(rows),
        "needs_review_count": sum(bool(row["issues"]) for row in rows),
        "can_post": False,
    }
