"""Review before writing: source rows never become a second ledger."""

from collections import Counter
from datetime import datetime, time
from decimal import Decimal
import re

from django.conf import settings
from django.db.models import Exists, OuterRef, Q
from apps.messages.models import ParsedMessageCandidate
from apps.statements.models import StatementRow
from .models import BulkImportRow
from django.utils import timezone
from rest_framework.exceptions import ValidationError

from apps.accounts.models import Account
from apps.categories.models import Category
from apps.reconciliation.timing import account_rows, checkpoint_expected
from apps.transactions.policy import default_direction
from apps.transactions.balance_reports import reported_values
from .parsing import money, day, clock, FIELDS


from .sources import digest, original_table


def row_values(batch, config):
    headers, cells, automatic = original_table(batch)
    mapping = config.get("mapping", automatic)
    if set(mapping) - set(FIELDS) or any(
        header and header not in headers for header in mapping.values()
    ):
        raise ValidationError({"mapping": "Choose columns from this table only."})
    for required in ("date", "amount"):
        if not mapping.get(required):
            raise ValidationError({"mapping": f"Choose the {required} column."})
    used = [h for h in mapping.values() if h]
    if len(used) != len(set(used)):
        raise ValidationError({"mapping": "Map each source column to only one field."})
    decisions = config.get("decisions", {})
    if any(not key.isdigit() or not 1 <= int(key) <= len(cells) for key in decisions):
        raise ValidationError({"decisions": "Choose a row from this import."})
    categories = {
        str(c.pk): c for c in Category.objects.filter(user=batch.user, is_active=True)
    }
    accounts = {
        str(a.pk): a for a in Account.objects.filter(user=batch.user, is_active=True)
    }
    if not batch.account.is_active:
        raise ValidationError(
            {
                "account": "This account is inactive. Choose another active account in a new import."
            }
        )
    category_names = {c.name.casefold(): str(c.pk) for c in categories.values()}
    result = []
    for number, cells in enumerate(cells, 1):
        source = dict(zip(headers, cells))
        values = {f: source.get(mapping.get(f, ""), "").strip() for f in FIELDS}
        decision = decisions.get(str(number), {})
        warnings, errors = [], []
        original_category = values["category"]
        selected_category = decision.get(
            "category",
            config.get("category_map", {}).get(
                original_category, category_names.get(original_category.casefold())
            ),
        )
        normalized = {
            "date": None,
            "time": None,
            "category": str(selected_category) if selected_category else None,
            "description": decision.get("description", values["description"]),
            "notes": values["notes"],
            "amount": None,
            "balance_after": None,
            "type": decision.get("type", "expense"),
            "direction": "debit",
            "other_account": str(decision["other_account"])
            if decision.get("other_account")
            else None,
        }
        try:
            normalized["date"] = day(
                decision.get("date", values["date"]), config.get("date_order", "ISO")
            ).isoformat()
            parsed_time = clock(decision.get("time", values["time"]))
            normalized["time"] = parsed_time.isoformat() if parsed_time else None
        except ValueError as exc:
            errors.append(str(exc))
        try:
            signed = money(
                decision.get("amount", values["amount"]),
                currency=batch.account.currency,
            )
            direction = config.get("positive_direction", "debit")
            if signed < 0:
                direction = "credit" if direction == "debit" else "debit"
            kind = decision.get(
                "type",
                "refund"
                if signed < 0 and direction == "credit"
                else "income"
                if direction == "credit"
                else "expense",
            )
            normalized.update(
                amount=str(abs(signed)),
                type=kind,
                direction=decision.get("direction", direction),
            )
            if values["balance_after"]:
                normalized["balance_after"] = str(
                    money(
                        values["balance_after"],
                        currency=batch.account.currency,
                        allow_zero=True,
                        signed=False,
                    )
                )
            if (
                kind not in {"transfer", "adjustment"}
                and default_direction(kind) != normalized["direction"]
            ):
                errors.append(
                    "Type and money direction disagree. Choose a compatible type or direction."
                )
            if kind == "transfer":
                other = accounts.get(normalized["other_account"])
                if (
                    not other
                    or other == batch.account
                    or other.currency != batch.account.currency
                ):
                    errors.append(
                        "Choose a different owned account in the same currency for this transfer."
                    )
            if kind == "adjustment":
                warnings.append(
                    "This adjusts the balance; it is not ordinary spending or income."
                )
        except ValueError as exc:
            errors.append(str(exc))
        if normalized["category"] and normalized["category"] not in categories:
            errors.append("Choose an active category that belongs to you.")
        if original_category and not normalized["category"]:
            warnings.append(
                "Category is unmapped; the original category stays in the source notes."
            )
        if not normalized["description"]:
            warnings.append(
                "Description is blank; you can add one or keep this source row as written."
            )
        if re.fullmatch(
            r"(?:grand\s+)?(?:sub)?total", normalized["description"].strip(), re.I
        ):
            warnings.append(
                "This may be a subtotal. Confirm it is a separate expense before adding it."
            )
        if len(normalized["description"]) > 255 or len(normalized["notes"]) > 4000:
            errors.append(
                "Use a description of at most 255 characters and notes of at most 4,000 characters."
            )
        if re.search(
            r"padding|unaccounted|balance adjustment",
            values["description"] + " " + values["notes"],
            re.I,
        ):
            warnings.append(
                "Confirm whether this is a real expense, a balance adjustment, or a row to skip."
            )
        result.append(
            {
                "number": number,
                "original": source,
                "source_category": original_category,
                "values": normalized,
                "action": decision.get("action", "new"),
                "transaction": str(decision["transaction"])
                if decision.get("transaction")
                else None,
                "reviewed": decision.get("reviewed", False),
                "review_fingerprint": "",
                "warnings": warnings,
                "errors": errors,
                "matches": [],
            }
        )
    return headers, result


def valid_direction(record):
    return record.type == "adjustment" or record.direction == default_direction(
        record.type
    )


def ledger_direction(record, account):
    if record.type == "transfer":
        return "credit" if record.transfer_account_id == account.pk else "debit"
    return (
        record.direction
        if record.type == "adjustment"
        else default_direction(record.type)
    )


def compatible(record, values, account):
    direction = ledger_direction(record, account)
    return (
        valid_direction(record)
        and record.date.isoformat() == values["date"]
        and str(record.amount) == values["amount"]
        and direction == values["direction"]
        and (
            record.account_id == account.pk
            or record.type == "transfer"
            and record.transfer_account_id == account.pk
        )
    )


def candidates(batch, rows):
    valid = [row for row in rows if not row["errors"] and row["action"] != "skip"]
    dates = {r["values"]["date"] for r in valid}
    amounts = {r["values"]["amount"] for r in valid}
    records = list(
        account_rows(batch.account)
        .filter(date__in=dates, amount__in=amounts)
        .annotate(
            bulk_has_sms=Exists(
                ParsedMessageCandidate.objects.filter(
                    transaction_id=OuterRef("pk"),
                    user=batch.user,
                    raw_message__user=batch.user,
                    status="confirmed",
                )
            ),
            bulk_has_pdf=Exists(
                StatementRow.objects.filter(
                    transaction_id=OuterRef("pk"),
                    batch__user=batch.user,
                    state__in=["posted", "linked"],
                )
            ),
            bulk_has_sheet=Exists(
                BulkImportRow.objects.filter(
                    Q(transaction_id=OuterRef("pk"))
                    | Q(transaction__isnull=True, ledger_identity=OuterRef("pk")),
                    batch__user=batch.user,
                    batch__state="committed",
                )
            ),
        )
        .prefetch_related("transfer_evidence", "parsed_message_candidates")
        .order_by("date", "time", "pk")[:2501]
    )
    if len(records) > 2500:
        raise ValidationError(
            {
                "text": "Too many existing movements match this date/amount range. Split the import into smaller date ranges."
            }
        )
    by_key = {}
    for record in records:
        direction = ledger_direction(record, batch.account)
        # A transfer scalar may describe the opposite endpoint. Reuse the
        # effective account-bound choice, including reviewed blank balances.
        record.bulk_reported_balance = (
            reported_values(record).get(batch.account.pk)
            if record.type == "transfer" else record.balance_after
        )
        by_key.setdefault(
            (record.date.isoformat(), str(record.amount), direction), []
        ).append(record)
    repeats = Counter(
        (
            r["values"]["date"],
            r["values"]["amount"],
            r["values"]["direction"],
            r["values"]["description"].strip().casefold(),
        )
        for r in valid
    )
    linked = set()
    for row in valid:
        values = row["values"]
        key = (values["date"], values["amount"], values["direction"])
        matches = by_key.get(key, [])
        row["matches"] = [
            {
                "id": str(r.pk),
                "date": r.date.isoformat(),
                "time": r.time.isoformat() if r.time else None,
                "amount": str(r.amount),
                "type": r.type,
                "direction": key[2],
                "source": r.source,
                "source_labels": (
                    [
                        label
                        for present, label in (
                            (r.raw_message_id is not None or r.bulk_has_sms, "SMS"),
                            (r.bulk_has_pdf, "Statement PDF"),
                            (r.bulk_has_sheet, "Spreadsheet"),
                        )
                        if present
                    ]
                    or [
                        {
                            "web": "Manual entry",
                            "mobile": "Mobile entry",
                            "sms": "Saved SMS entry",
                            "import": "Imported entry",
                            "system": "System entry",
                        }.get(r.source, r.source)
                    ]
                ),
                "description": r.counterparty_text,
                "note": r.note,
                "balance_after": str(r.bulk_reported_balance)
                if r.bulk_reported_balance is not None
                else None,
                "updated_at": r.updated_at.isoformat(),
            }
            for r in matches[:10]
        ]
        if any(not valid_direction(record) for record in matches):
            row["warnings"].append(
                "A saved entry has conflicting type and direction. Correct it in Transactions before linking it."
            )
        if len(matches) > 10:
            row["errors"].append(
                "More than ten ledger matches. Skip this row and resolve it separately."
            )
        elif matches:
            row["warnings"].append(
                "A saved movement has the same account, date, amount and direction. Compare it before adding another."
            )
        if repeats[(*key, values["description"].strip().casefold())] > 1:
            row["warnings"].append(
                "Another row in this table has the same date, description and amount. Repeated purchases can be genuine."
            )
        if row["action"] == "link":
            target = next((r for r in matches if str(r.pk) == row["transaction"]), None)
            if target is None or not compatible(target, values, batch.account):
                row["errors"].append(
                    "Choose a matching saved movement. Its account, date, amount and direction must agree."
                )
            elif str(target.pk) in linked:
                row["warnings"].append(
                    "More than one source row will attach to this same movement; confirm these are duplicate records of one purchase."
                )
            else:
                linked.add(str(target.pk))
            if (
                target is not None
                and values["balance_after"] is not None
                and (
                    target.bulk_reported_balance is None
                    or Decimal(values["balance_after"]) != target.bulk_reported_balance
                )
            ):
                row["warnings"].append(
                    "The source balance differs or is absent on the saved movement. Linking retains its saved balance; the source value remains available."
                )
        row["review_fingerprint"] = digest(
            {
                "matches": row["matches"],
                "repeats": repeats[(*key, values["description"].strip().casefold())],
            }
        )
        decision = batch.configuration.get("decisions", {}).get(str(row["number"]), {})
        row["reviewed"] = (
            row["reviewed"]
            and decision.get("review_fingerprint") == row["review_fingerprint"]
        )
        requires_review = any(
            not warning.startswith(("Category is unmapped", "Description is blank"))
            for warning in row["warnings"]
        )
        if requires_review and not row["reviewed"]:
            row["errors"].append("Review this row and confirm its highlighted details.")
    return records


def delta(values):
    return Decimal(values["amount"]) * (1 if values["direction"] == "credit" else -1)


def checkpoints(batch, config, rows):
    result = []
    new = [
        r
        for r in rows
        if r["action"] == "new" and r["values"]["date"] and r["values"]["amount"]
    ]
    for index, raw in enumerate(config.get("checkpoints", []), 1):
        item = {
            "number": index,
            "errors": [],
            "unknown": [],
            "expected_balance": None,
            "difference": None,
        }
        try:
            date = day(raw["date"])
            timed = clock(raw.get("time", ""))
            value = money(
                raw["balance"],
                currency=batch.account.currency,
                allow_zero=True,
                signed=False,
            )
            if timed is None and not raw.get("end_of_day"):
                raise ValueError(
                    "Confirm this is the end-of-day balance, or enter its actual time."
                )
            if timed is not None and raw.get("end_of_day"):
                raise ValueError("Choose a specific time or end of day, not both.")
            precision = "instant" if timed else "end_of_day"
            checked = timezone.make_aware(datetime.combine(date, timed or time.max))
            order = {}
            if timed:
                unknown_existing = list(
                    account_rows(batch.account)
                    .filter(date=date, time__isnull=True)
                    .order_by("pk")
                    .values("id", "counterparty_text", "amount")
                )
                item["unknown"] = [
                    {
                        "key": f"transaction:{r['id']}",
                        "description": r["counterparty_text"] or "Saved movement",
                        "amount": str(r["amount"]),
                    }
                    for r in unknown_existing
                ]
                item["unknown"] += [
                    {
                        "key": f"row:{r['number']}",
                        "description": r["values"]["description"] or "Imported entry",
                        "amount": r["values"]["amount"],
                    }
                    for r in new
                    if r["values"]["date"] == str(date) and r["values"]["time"] is None
                ]
                if len(item["unknown"]) > 1000:
                    raise ValueError(
                        "Too many untimed entries to review at a specific time. Use an end-of-day checkpoint."
                    )
                for unknown in item["unknown"]:
                    position = raw.get("exceptions", {}).get(
                        unknown["key"], raw.get("unknown_position", "unresolved")
                    )
                    unknown["position"] = position
                    if position not in {"before", "after"}:
                        raise ValueError(
                            "Choose before or after this balance for untimed entries, then mark any exceptions."
                        )
                    order[unknown["key"]] = position
            existing_order = {
                key.split(":", 1)[1]: position
                for key, position in order.items()
                if key.startswith("transaction:")
            }
            expected = checkpoint_expected(
                batch.account, checked, precision, existing_order
            )
            for row in new:
                values = row["values"]
                if values["date"] > str(date):
                    continue
                if values["date"] == str(date) and timed:
                    if values["time"] is None:
                        if order.get(f"row:{row['number']}") != "before":
                            continue
                    elif clock(values["time"]) > timed:
                        continue
                expected += delta(values)
            item.update(
                checked_at=checked.isoformat(),
                precision=precision,
                balance=str(value),
                expected_balance=str(expected.quantize(Decimal("0.01"))),
                difference=str((value - expected).quantize(Decimal("0.01"))),
                timing_order=order,
                note=raw.get("note", ""),
            )
        except (ValueError, ValidationError) as exc:
            item["errors"].append(str(exc))
        result.append(item)
    return result


def preview(batch):
    headers, cells, automatic = original_table(batch)
    mapping = batch.configuration.get("mapping", automatic)
    if not mapping.get("date") or not mapping.get("amount"):
        return {
            "id": str(batch.pk),
            "account": str(batch.account_id),
            "filename": batch.filename,
            "state": batch.state,
            "version": batch.version,
            "headers": headers,
            "configuration": batch.configuration,
            "rows": [
                {"number": n, "original": dict(zip(headers, row))}
                for n, row in enumerate(cells, 1)
            ],
            "checkpoints": [],
            "summary": {},
            "errors": ["Map the date and amount columns to continue."],
            "review_token": "",
            "timezone": settings.TIME_ZONE,
            "receipt": batch.receipt,
        }
    headers, rows = row_values(batch, batch.configuration)
    records = candidates(batch, rows)
    checks = checkpoints(batch, batch.configuration, rows)
    errors = []
    selected = [r for r in rows if r["action"] != "skip"]
    if not selected and not checks:
        errors.append("Choose at least one row or add a balance checkpoint.")
    summary = {
        "new": sum(r["action"] == "new" for r in rows),
        "linked": sum(r["action"] == "link" for r in rows),
        "skipped": sum(r["action"] == "skip" for r in rows),
        "checkpoints": len(checks),
        "needs_review": sum(bool(r["errors"]) for r in selected)
        + sum(bool(c["errors"]) for c in checks),
    }
    # Include all relevant account changes, even when a new untimed movement
    # changes a checkpoint but does not match any imported amount.
    current = {
        "matches": [(str(r.pk), r.updated_at.isoformat()) for r in records],
        "checkpoints": checks,
        "starting_balance": str(batch.account.starting_balance),
        "currency": batch.account.currency,
    }
    token = digest(
        {
            "version": batch.version,
            "configuration": batch.configuration,
            "rows": rows,
            "context": current,
        }
    )
    return {
        "id": str(batch.pk),
        "account": str(batch.account_id),
        "filename": batch.filename,
        "state": batch.state,
        "version": batch.version,
        "headers": headers,
        "configuration": batch.configuration,
        "rows": rows,
        "checkpoints": checks,
        "errors": errors,
        "summary": summary,
        "review_token": token,
        "timezone": settings.TIME_ZONE,
        "receipt": batch.receipt,
    }
