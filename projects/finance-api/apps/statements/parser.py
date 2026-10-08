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

MAX_BYTES = 4 * 1024 * 1024
MAX_PAGES = 30
MAX_ROWS = 2000
PARSER_VERSION = "1"
MONEY = re.compile(r"-?(?:\d{1,3}(?:,\d{3})+|\d+)\.\d{2}")
DATE_TOKEN = (
    r"(?:\d{2}-[A-Za-z]{3}-\d{2,4}|\d{2}-\d{2}-\d{4}|\d{2}\s+[A-Za-z]{3}\s+\d{4})"
)
PROFILES = {
    "ebl_bank": {"out": "DEBITS", "in": "CREDITS", "balance": "BALANCE"},
    "city_bank": {"out": "WITHDRAWAL", "in": "DEPOSIT", "balance": "BALANCE"},
    "bkash": {"out": "Out", "in": "In", "fee": "Charge/Fee", "balance": "Balance"},
}


class StatementParseError(Exception):
    def __init__(self, code, message):
        self.code = code
        self.message = message
        super().__init__(message)


def parse_date(value):
    for fmt in ("%d-%b-%Y", "%d-%b-%y", "%d-%m-%Y", "%d %b %Y"):
        try:
            return datetime.strptime(value, fmt).date().isoformat()  # noqa: DTZ007 -- local statement date, not an instant
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
    if "bKash Statement" in text and "Charge/Fee" in text:
        return "bkash"
    if "Statement of Account" in text and "WITHDRAWAL" in text and "DEPOSIT" in text:
        return "city_bank"
    if "TRN." in text and "DEBITS" in text and "CREDITS" in text:
        return "ebl_bank"
    raise StatementParseError(
        "unsupported_layout",
        "This statement layout is not supported yet. Use an EBL bank, City Bank savings, or bKash digital statement.",
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


def extract_statement(data: bytes, password=""):
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
        r"(?:bKash Account Number|Account Number|Account No)\s*:\s*(\d+)",
        full_text,
        re.IGNORECASE,
    )
    account_hint = "***" + identifier[1][-4:] if identifier else ""
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
                datetime.strptime(time_match[1], "%I:%M:%S %p").time().isoformat()  # noqa: DTZ007 -- printed local time
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
