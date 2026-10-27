"""Bounded, read-only extraction of supported digital statement layouts.

This module is deliberately independent of Django and the ledger. Every money
value comes from positioned PDF text; descriptions never authorize posting.
"""

from __future__ import annotations

import io
import re
from datetime import datetime
from decimal import Decimal

import pdfplumber
from pdfminer.pdfdocument import PDFPasswordIncorrect
from pdfplumber.utils.exceptions import PdfminerException

from .bkash_identifiers import identifier as bkash_identifier
from .citytouch import citytouch_printed_code
from .ebl_identifiers import identifier as ebl_identifier

MAX_BYTES = 4 * 1024 * 1024
MAX_PAGES = 30
MAX_ROWS = 2000
PARSER_VERSION = "2"
MONEY = re.compile(r"-?(?:\d{1,3}(?:,\d{3})+|\d+)\.\d{2}")
DATE_TOKEN = (
    r"(?:\d{2}-[A-Za-z]{3}-\d{2,4}|\d{2}-\d{2}-\d{4}|\d{2}\s+[A-Za-z]{3}\s+\d{4})"
)
PROFILES = {
    "ebl_bank": {"out": "DEBITS", "in": "CREDITS", "balance": "BALANCE"},
    "city_bank": {"out": "WITHDRAWAL", "in": "DEPOSIT", "balance": "BALANCE"},
    "bkash": {"out": "Out", "in": "In", "fee": "Charge/Fee", "balance": "Balance"},
}
CARD_SUMMARY_MONEY = re.compile(r"(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d{1,2})?")
CARD_DATE = re.compile(r"\d{2}-[A-Za-z]{3}-\d{2}")


class StatementParseError(Exception):
    def __init__(self, code, message):
        self.code = code
        self.message = message
        super().__init__(message)


def parse_date(value):
    for fmt in ("%d-%b-%Y", "%d-%b-%y", "%d-%m-%Y", "%d %b %Y"):
        try:
            return datetime.strptime(value, fmt).date().isoformat()  # Local statement date, not an instant.
        except ValueError:
            pass
    return None


def mask_identifiers(text):
    # Already-masked card strings remain masked; full phones/accounts/customer
    # numbers in descriptions are reduced to a safe suffix before leaving worker.
    return re.sub(r"\b\d{7,}\b", lambda m: "***" + m[0][-4:], text)


def lines(words):
    groups = []
    for word in sorted(words, key=lambda w: (w["top"], w["x0"])):
        if not groups or abs(groups[-1][0] - word["top"]) > 2:
            groups.append((word["top"], [word]))
        else:
            groups[-1][1].append(word)
    return [
        (y, " ".join(w["text"] for w in sorted(ws, key=lambda w: w["x0"])))
        for y, ws in groups
    ]


def detect_profile(text):
    if (
        "Electronic Credit Card Statement" in text
        and "EBL" in text
        and "Transaction Details" in text
        and "Settlement" in text
    ):
        return "ebl_credit_card"
    if "bKash Statement" in text and "Charge/Fee" in text:
        return "bkash"
    if "Statement of Account" in text and "WITHDRAWAL" in text and "DEPOSIT" in text:
        return "city_bank"
    if "TRN." in text and "DEBITS" in text and "CREDITS" in text:
        return "ebl_bank"
    raise StatementParseError(
        "unsupported_layout",
        "This statement layout is not supported yet. Use an EBL bank or credit-card, City Bank savings, or bKash digital statement.",
    )


def find_header(words, profile):
    names = PROFILES[profile]
    for candidate in words:
        if candidate["text"] != names["out"]:
            continue
        same_line = [w for w in words if abs(w["top"] - candidate["top"]) < 3]
        header = {
            key: next((w for w in same_line if w["text"] == name), None)
            for key, name in names.items()
        }
        if all(header.values()):
            date_word = next(
                (w for w in same_line if w["text"] in {"DATE", "Date"}), None
            )
            if date_word:
                return header, date_word
    return None


def money(value):
    return format(value, ".2f") if value is not None else None


def card_summary_amount(words, label, width, height):
    headings = [
        word for word in words
        if word["text"] == label
        and width * .35 < word["x0"] < width * .55
        and word["top"] < height * .35
    ]
    if len(headings) != 1:
        return None
    values = [
        word for word in words
        if abs(word["top"] - headings[0]["top"]) < 4
        and width * .58 < word["x0"] < width * .69
        and CARD_SUMMARY_MONEY.fullmatch(word["text"])
    ]
    return Decimal(values[0]["text"].replace(",", "")) if len(values) == 1 else None


def extract_ebl_credit_card(pages):
    """Read card settlement movements without inventing reported row balances.

    The printed monthly outstanding is a liability, not the bank-account running
    balance expected by the other statement profiles. Keep it in reconciliation
    checks only; the source D/C marker and BDT settlement amount define each row.
    """
    from apps.messages.identifiers import sanitize_financial_identifier

    rows, checks, warnings = [], [], [
        "This card statement reports monthly outstanding, not a balance after each transaction. Row balances remain unreported."
    ]
    card_hint = None
    previous_closing = None
    for page_number, (width, height, words, text) in enumerate(pages, 1):
        if detect_profile(text) != "ebl_credit_card" or not .98 < width / 595 < 1.02:
            raise StatementParseError(
                "unsupported_page", f"Page {page_number} is not the supported EBL credit-card layout; no rows were imported."
            )
        card_match = re.search(r"Card\s+No\s*:\s*([\d*Xx•…-]{5,})", text)
        date_match = re.search(r"Statement\s+Date\s*:\s*(" + CARD_DATE.pattern + r")", text, re.IGNORECASE)
        if not card_match or not date_match or not parse_date(date_match[1]):
            raise StatementParseError(
                "unsupported_page", f"Page {page_number} lacks a readable card identifier or statement date."
            )
        hint = sanitize_financial_identifier(card_match[1])
        if not hint or (card_hint is not None and hint != card_hint):
            raise StatementParseError(
                "account_mismatch", "The PDF contains more than one card. Import each card separately."
            )
        card_hint = hint
        opening = card_summary_amount(words, "Previous", width, height)
        closing = card_summary_amount(words, "Total", width, height)
        if opening is None or closing is None:
            raise StatementParseError(
                "unsupported_page", f"Page {page_number} has an unreadable previous balance or total outstanding."
            )
        footer = [
            word for word in words
            if word["text"] == "Outstanding:" and word["top"] > height * .35
        ]
        if len(footer) != 1:
            raise StatementParseError(
                "unsupported_page", f"Page {page_number} has an unreadable transaction table boundary."
            )
        anchors = sorted((
            word for word in words
            if word["x0"] < width * .13
            and height * .35 < word["top"] < footer[0]["top"]
            and CARD_DATE.fullmatch(word["text"])
        ), key=lambda word: word["top"])
        if not anchors:
            raise StatementParseError("no_transactions", f"Page {page_number} has no dated card movements.")
        page_rows = []
        for anchor in anchors:
            line = sorted((
                word for word in words if abs(word["top"] - anchor["top"]) < 3
            ), key=lambda word: word["x0"])
            markers = [word for word in line if word["x0"] > width * .94 and word["text"] in {"D", "C"}]
            if not markers:
                description = " ".join(word["text"] for word in line if width * .14 < word["x0"] < width * .62)
                if re.search(r"Previous\s+Ban?lance|Previous\s+Balance", description, re.IGNORECASE):
                    continue
            if len(markers) != 1:
                raise StatementParseError(
                    "unsupported_page", f"Page {page_number} has a dated row without one readable D/C marker."
                )
            cells = [
                word for word in line
                if width * .62 < word["x0"] < markers[0]["x0"]
            ]
            if len(cells) != 4 or not (
                re.fullmatch(r"[A-Z]{3}", cells[0]["text"])
                and MONEY.fullmatch(cells[1]["text"])
                and re.fullmatch(r"[A-Z]{3}", cells[2]["text"])
                and MONEY.fullmatch(cells[3]["text"])
            ):
                raise StatementParseError(
                    "unsupported_page", f"Page {page_number} has an unreadable source or settlement amount."
                )
            if cells[2]["text"] != "BDT":
                raise StatementParseError("unsupported_currency", "Only BDT card settlements are supported.")
            source_amount = Decimal(cells[1]["text"].replace(",", ""))
            settlement_amount = Decimal(cells[3]["text"].replace(",", ""))
            if not 0 < settlement_amount < Decimal(1000000000000):
                raise StatementParseError("invalid_amount", f"Page {page_number} has an invalid card settlement amount.")
            description = " ".join(
                word["text"] for word in line
                if width * .14 < word["x0"] < cells[0]["x0"]
            ).strip()
            date = parse_date(anchor["text"])
            if not date or not description:
                raise StatementParseError("unsupported_page", f"Page {page_number} has an incomplete dated row.")
            payment_credit = bool(re.search(
                r"\bPMT\s+RECV\b|\bPAYMENT\s+RECEIVED\b", description, re.IGNORECASE
            ))
            cashback_credit = bool(re.search(r"\bCASH\s*BACK\b", description, re.IGNORECASE))
            printed_direction = "debit" if markers[0]["text"] == "D" else "credit"
            source_issues = []
            if printed_direction == "credit" and not (payment_credit or cashback_credit):
                source_issues.append(
                    "Card credit wording is not recognized as a payment or cash-back reward. Check its type and category."
                )
            elif printed_direction == "debit" and (payment_credit or cashback_credit):
                source_issues.append(
                    "Printed card debit conflicts with payment or cash-back wording. Check the original PDF."
                )
            row = {
                "id": f"{page_number}:{len(page_rows) + 1}",
                "page": page_number,
                "row": len(page_rows) + 1,
                "date": date,
                "time": None,
                "posting_date": date,
                "value_date": None,
                "statement_date": parse_date(date_match[1]),
                "description": mask_identifiers(description[:2000]),
                "provider_type": "Card payment" if payment_credit else "Cash back" if cashback_credit else "Card movement",
                "reference": "",
                "direction": printed_direction,
                "printed_direction_marker": markers[0]["text"],
                "amount": money(settlement_amount),
                "source_currency": cells[0]["text"],
                "source_amount": money(source_amount),
                "settlement_currency": cells[2]["text"],
                "signed_fee": "0.00",
                "balance_after": None,
                "issues": source_issues,
                "bounds": [round(anchor["x0"], 2), round(anchor["top"], 2), round(width, 2), round(markers[0]["bottom"], 2)],
            }
            page_rows.append(row)
        if not page_rows:
            raise StatementParseError("no_transactions", f"Page {page_number} has no card movements to import.")
        observed = opening + sum(
            (Decimal(row["amount"]) if row["printed_direction_marker"] == "D" else -Decimal(row["amount"]))
            for row in page_rows
        )
        page_balances_match = closing == observed
        checks.append({
            "label": f"Page {page_number} outstanding debt",
            "expected": money(closing),
            "observed": money(observed),
            "passed": page_balances_match,
        })
        previous_balances_match = previous_closing is None or previous_closing == opening
        if previous_closing is not None:
            checks.append({
                "label": f"Page {page_number} previous outstanding",
                "expected": money(previous_closing),
                "observed": money(opening),
                "passed": previous_balances_match,
            })
        if not page_balances_match or not previous_balances_match:
            for row in page_rows:
                row["issues"].append(
                    "This page does not reconcile with the printed monthly outstanding. Verify the original PDF before recording this row."
                )
        previous_closing = closing
        rows.extend(page_rows)
        if len(rows) > MAX_ROWS:
            raise StatementParseError("row_limit", "This statement contains too many rows. Export a shorter period.")
    if any(not check["passed"] for check in checks):
        warnings.append("A monthly card outstanding total does not reconcile. Verify the printed PDF before recording rows.")
    dates = [row["date"] for row in rows]
    return {
        "profile": "ebl_credit_card",
        "parser_version": PARSER_VERSION,
        "currency": "BDT",
        "page_count": len(pages),
        "period_start": min(dates),
        "period_end": max(dates),
        "account_hint": card_hint,
        "rows": rows,
        "checks": checks,
        "warnings": warnings,
        "opening_balance": None,
        "closing_balance": None,
        "balance_transitions_checked": 0,
        "needs_review_count": sum(bool(row["issues"]) for row in rows),
        "can_post": False,
    }


def extract_statement(data: bytes, password="", *, include_private_identifiers=False):
    if len(data) > MAX_BYTES:
        raise StatementParseError(
            "file_too_large", "Choose a PDF no larger than 4 MiB."
        )
    if not data.startswith(b"%PDF-"):
        raise StatementParseError(
            "invalid_pdf", "The uploaded file is not a valid PDF."
        )
    try:
        with pdfplumber.open(io.BytesIO(data), password=password) as pdf:
            if not 1 <= len(pdf.pages) <= MAX_PAGES:
                raise StatementParseError(
                    "page_limit", "Choose a statement with 1 to 30 pages."
                )
            pages = []
            for page in pdf.pages:
                words = page.extract_words()
                if len(words) > 20000:
                    raise StatementParseError(
                        "page_too_complex",
                        "This PDF page is too complex to preview. Export a shorter digital statement.",
                    )
                pages.append(
                    (page.width, page.height, words, page.extract_text() or "")
                )
                page.close()
    except PDFPasswordIncorrect:
        raise StatementParseError(
            "password_required",
            "The PDF is locked or the password is incorrect. Enter its unlock password and retry.",
        ) from None
    except PdfminerException as error:
        if error.args and isinstance(error.args[0], PDFPasswordIncorrect):
            raise StatementParseError(
                "password_required",
                "The PDF is locked or the password is incorrect. Enter its unlock password and retry.",
            ) from None
        raise StatementParseError(
            "invalid_pdf",
            "The PDF could not be read. Export a fresh statement and retry.",
        ) from None
    except StatementParseError:
        raise
    except Exception:  # noqa: BLE001 -- untrusted PDF boundary; never expose parser internals
        raise StatementParseError(
            "invalid_pdf",
            "The PDF could not be read. Export a fresh statement and retry.",
        ) from None

    if any(not words for _, _, words, _ in pages):
        raise StatementParseError(
            "ocr_required",
            "This PDF contains pages without readable text. Scanned statements need OCR, which is not supported yet.",
        )
    profile = detect_profile(pages[0][3])
    if profile == "ebl_credit_card":
        return extract_ebl_credit_card(pages)
    full_text = "\n".join(p[3] for p in pages)
    if profile == "city_bank" and not re.search(
        r"Currency\s*:\s*BDT\b", full_text, re.IGNORECASE
    ):
        raise StatementParseError(
            "unsupported_currency",
            "Only BDT City Bank statements are supported in this version.",
        )
    if profile == "ebl_bank" and not re.search(
        r"Currency\s*Name\s*:\s*BANGLADESH\s+TAKA", full_text, re.IGNORECASE
    ):
        raise StatementParseError(
            "unsupported_currency",
            "Only Bangladesh Taka EBL bank statements are supported in this version.",
        )
    period = re.search(
        r"(?:Statement Period|Period From)\s*:\s*("
        + DATE_TOKEN
        + r")\s*(?:to|-)\s*("
        + DATE_TOKEN
        + ")",
        full_text,
        re.IGNORECASE,
    )
    period_start, period_end = (
        (parse_date(period[1]), parse_date(period[2])) if period else (None, None)
    )
    identifier = re.search(
        r"(?:bKash Account Number|Account Number|Account No)\s*:\s*([0-9*Xx•…]{3,})",
        full_text,
        re.IGNORECASE,
    )
    from apps.messages.identifiers import sanitize_financial_identifier

    account_hint = sanitize_financial_identifier(identifier[1]) if identifier else ""
    if account_hint.isdigit():
        account_hint = "***" + account_hint
    rows, warnings, checks = [], [], []
    if not period_start or not period_end:
        warnings.append(
            "The statement period could not be read; verify dates before importing."
        )
    opening, closing = None, None
    for pi, (width, height, words, text) in enumerate(pages, start=1):
        found = find_header(words, profile)
        if found is None:
            raise StatementParseError(
                "unsupported_page",
                f"Page {pi} does not contain the expected statement columns; no rows were imported.",
            )
        header, date_word = found
        page_lines = lines(words)
        description_header = next(
            (
                w
                for w in words
                if w["text"] in {"DESCRIPTION", "Transaction"}
                and abs(w["top"] - date_word["top"]) < 3
            ),
            None,
        )
        if description_header is None:
            raise StatementParseError(
                "unsupported_page", f"Page {pi} has an unrecognized description column."
            )
        date_right = description_header["x0"] - 2
        date_re = (
            r"\d{2}-\d{2}-\d{4}"
            if profile == "city_bank"
            else r"\d{2}-[A-Za-z]{3}-\d{2,4}"
        )
        anchors = [
            w
            for w in words
            if w["x0"] < date_right
            and w["top"] > date_word["bottom"]
            and re.fullmatch(date_re, w["text"])
        ]
        anchors.sort(key=lambda w: w["top"])
        summary_starts = [
            y
            for y, line in page_lines
            if re.search(
                r"STATEMENT\s*CLOSING\s*BALANCE|Total Withdrawal|End of Statement",
                line,
                re.IGNORECASE,
            )
        ]
        for ai, anchor in enumerate(anchors):
            stop = anchors[ai + 1]["top"] - 1 if ai + 1 < len(anchors) else height - 45
            stop = min([stop] + [y - 1 for y in summary_starts if y > anchor["top"]])
            row_words = sorted(
                [w for w in words if anchor["top"] - 1 <= w["top"] < stop],
                key=lambda w: (round(w["top"] / 2), w["x0"]),
            )
            values, issues = {}, []
            for key, h in header.items():
                cells = [
                    w
                    for w in row_words
                    if abs(w["top"] - anchor["top"]) < 3
                    and abs(w["x1"] - h["x1"]) < 8
                    and MONEY.fullmatch(w["text"])
                ]
                if len(cells) > 1:
                    issues.append(f"The {key} column contains multiple amounts.")
                values[key] = (
                    Decimal(cells[0]["text"].replace(",", ""))
                    if len(cells) == 1
                    else None
                )
            numeric_left = (
                min(
                    w["x0"]
                    for w in row_words
                    if MONEY.fullmatch(w["text"]) and w["x0"] > date_right
                )
                if any(
                    MONEY.fullmatch(w["text"]) and w["x0"] > date_right
                    for w in row_words
                )
                else header["out"]["x0"]
            )
            description = " ".join(
                w["text"] for w in row_words if date_right < w["x0"] < numeric_left
            )
            if re.match(r"Opening\s*Balance\b", description, re.IGNORECASE):
                opening = values["balance"]
                continue
            if (
                values["out"] is not None
                and values["in"] is not None
                or values["out"] is None
                and values["in"] is None
            ):
                issues.append("Expected exactly one debit or credit amount.")
            amount = values["out"] if values["out"] is not None else values["in"]
            if amount is not None and not Decimal(0) < amount < Decimal(1000000000000):
                issues.append(
                    "The principal amount must be positive and within the ledger limit."
                )
            if values["balance"] is None:
                issues.append("Reported balance could not be read.")
            date = parse_date(anchor["text"])
            if date is None:
                issues.append("The transaction date is invalid.")
            elif period_start and period_end and not period_start <= date <= period_end:
                issues.append(
                    "The transaction date is outside the printed statement period."
                )
            time_match = (
                next(
                    (
                        t
                        for _, line in lines(row_words)
                        if (t := re.search(r"\b(\d{2}:\d{2}:\d{2}\s*[AP]M)\b", line))
                    ),
                    None,
                )
                if profile == "bkash"
                else None
            )
            event_time = (
                datetime.strptime(time_match[1], "%I:%M:%S %p").time().isoformat()  # Printed local time.
                if time_match
                else None
            )
            value_match = re.search(
                r"value\s*date\s*:\s*(" + DATE_TOKEN + ")", description, re.IGNORECASE
            )
            reference_match = re.search(
                r"TRX\s*ID\s*:\s*([A-Za-z0-9-]+)", description, re.IGNORECASE
            )
            provider_type = ""
            if profile == "bkash":
                details_head = next(
                    (
                        w
                        for w in words
                        if w["text"] == "Details"
                        and abs(w["top"] - date_word["top"]) < 3
                    ),
                    None,
                )
                # The two-word header's first word begins the details column.
                details_left = next(
                    (
                        w["x0"]
                        for w in words
                        if w["text"] == "Transaction"
                        and details_head
                        and w["x0"] > description_header["x0"] + 10
                        and abs(w["top"] - date_word["top"]) < 3
                    ),
                    numeric_left,
                )
                provider_type = " ".join(
                    w["text"] for w in row_words if date_right < w["x0"] < details_left
                )
                description = " ".join(
                    w["text"]
                    for w in row_words
                    if details_left <= w["x0"] < numeric_left
                )
            printed_identifier = (
                bkash_identifier(
                    provider_type, description,
                    reporting_number=identifier[1] if identifier else "",
                ) if profile == "bkash" else None
            ) if include_private_identifiers else None
            printed_ebl_identifier = ebl_identifier(description) if include_private_identifiers and profile == "ebl_bank" else None
            rows.append(
                {
                    "id": f"{pi}:{ai + 1}",
                    "page": pi,
                    "row": ai + 1,
                    "date": date,
                    "time": event_time,
                    "posting_date": date,
                    "value_date": parse_date(value_match[1]) if value_match else None,
                    "description": mask_identifiers(description[:2000]),
                    "citytouch_printed_code": citytouch_printed_code(description[:2000]) if profile == "city_bank" else None,
                    **({"bkash_identifier": printed_identifier} if printed_identifier else {}),
                    **({"ebl_identifier": printed_ebl_identifier} if printed_ebl_identifier else {}),
                    "provider_type": provider_type[:120],
                    "reference": reference_match[1][:120] if reference_match else "",
                    "direction": "debit" if values["out"] is not None else "credit",
                    "amount": money(amount),
                    "signed_fee": money(values.get("fee") or Decimal(0)),
                    "balance_after": money(values["balance"]),
                    "issues": issues,
                    "bounds": [
                        round(date_word["x0"], 2),
                        round(anchor["top"], 2),
                        round(width, 2),
                        round(stop, 2),
                    ],
                }
            )
            if len(rows) > MAX_ROWS:
                raise StatementParseError(
                    "row_limit",
                    "This statement contains too many rows. Export a shorter period.",
                )
    if not rows:
        raise StatementParseError(
            "no_transactions",
            "No dated transaction rows were found. Upload an account activity statement.",
        )

    def summary(pattern):
        match = re.search(pattern, full_text, re.IGNORECASE)
        return Decimal(match[1].replace(",", "")) if match else None

    out_total = sum(
        (
            Decimal(r["amount"])
            for r in rows
            if r["amount"] and r["direction"] == "debit"
        ),
        Decimal(0),
    )
    in_total = sum(
        (
            Decimal(r["amount"])
            for r in rows
            if r["amount"] and r["direction"] == "credit"
        ),
        Decimal(0),
    )
    fee_debits = sum(
        (-min(Decimal(r["signed_fee"]), Decimal(0)) for r in rows), Decimal(0)
    )
    if profile == "bkash":
        reported_out = summary(r"Total Out:\s*([\d,.]+)")
        reported_in = summary(r"Total In:\s*([\d,.]+)")
        out_total += fee_debits
    elif profile == "city_bank":
        reported_out = summary(r"Total Withdrawal\s*:\s*([\d,.]+)")
        reported_in = summary(r"Total Deposit\s*:\s*([\d,.]+)")
        opening = summary(r"Opening Balance\s*:\s*([\d,.]+)")
        closing = summary(r"Available Balance as of.*?:\s*([\d,.]+)")
    else:
        reported_out = summary(r"\nDEBITS\s+([\d,.]+)")
        reported_in = summary(r"\nCREDITS\s+([\d,.]+)")
        closing = summary(r"STATEMENT\s*CLOSING\s*BALANCE\s+([\d,.]+)")

    def check(label, expected, observed):
        checks.append(
            {
                "label": label,
                "expected": money(expected),
                "observed": money(observed),
                "passed": expected == observed
                if expected is not None and observed is not None
                else None,
            }
        )

    check("Total out (including wallet charges)", reported_out, out_total)
    check("Total in", reported_in, in_total)
    previous = opening
    transitions = 0
    for row in rows:
        if row["amount"] is None or row["balance_after"] is None:
            previous = None
            continue
        principal = Decimal(row["amount"])
        delta = (principal if row["direction"] == "credit" else -principal) + Decimal(
            row["signed_fee"]
        )
        balance = Decimal(row["balance_after"])
        if previous is not None:
            transitions += 1
            if balance != previous + delta:
                row["issues"].append(
                    "Balance does not reconcile with the preceding row."
                )
        previous = balance
    check("Closing balance", closing, previous)
    if profile == "ebl_bank":
        for side, marker in [("debit", "DR"), ("credit", "CR")]:
            count_match = re.search(r"#" + marker + r"COUNT:\s*(\d+)", full_text)
            check(
                f"{side.title()} row count",
                Decimal(count_match[1]) if count_match else None,
                Decimal(sum(r["direction"] == side for r in rows)),
            )
    if any(c["passed"] is False for c in checks):
        warnings.append(
            "Statement totals do not reconcile; verify extraction before importing."
        )
    if any(c["passed"] is None for c in checks):
        warnings.append(
            "Some statement summary checks are unavailable; no missing balance was invented."
        )
    return {
        "profile": profile,
        "parser_version": PARSER_VERSION,
        "currency": "BDT",
        "page_count": len(pages),
        "period_start": period_start,
        "period_end": period_end,
        "account_hint": account_hint,
        "rows": rows,
        "checks": checks,
        "warnings": warnings,
        "opening_balance": money(opening),
        "closing_balance": money(closing),
        "balance_transitions_checked": transitions,
        "needs_review_count": sum(bool(r["issues"]) for r in rows),
        "can_post": False,
    }
