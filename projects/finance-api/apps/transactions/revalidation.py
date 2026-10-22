"""Review-only historical corrections from attached evidence and current SMS rules."""

import hashlib
import json
from datetime import timedelta
from decimal import Decimal
from types import SimpleNamespace

from django.core import signing
from django.db import transaction
from django.shortcuts import get_object_or_404
from rest_framework.exceptions import ValidationError

from apps.audit_logs.services import create_audit_log, transaction_snapshot
from apps.credit_cards.models import CreditCardBill, CreditCardPayment
from apps.debts.models import Debt, DebtPayment
from apps.messages.models import ParsedMessageCandidate, RawMessage
from apps.messages.parsers import parse_raw_message
from apps.recurring_bills.models import RecurringBillPayment
from apps.statements.models import StatementRow
from apps.statements.rounding import has_separate_fee, mark_fee_rows, nearby_amount
from apps.statements.services import ReviewConflict
from apps.statements.unified import sms_observation

from .balance_reports import has_unattributed_legacy_balance, reported_values
from .balance_reports import primary_transfer_evidence
from .models import Transaction, TransferEvidence
from .recovery import ActionRecorder, freeze
from .serializers import TransactionSerializer
from .transfers import add_transfer_evidence, lock_transfer_user, sms_transfer_data

POLICY_VERSION = "confirmed-revalidation-v1"
SALT = "transactions.revalidation"
MAX_SOURCES = 100
PREVIEW_SECONDS = 900


def money(value):
    return str(value) if value is not None else None


def _dependencies(record):
    if hasattr(record, "revalidation_has_dependencies"):
        return record.revalidation_has_dependencies
    return any(
        (
            Debt.objects.filter(opened_transaction=record).exists(),
            DebtPayment.objects.filter(transaction=record).exists(),
            CreditCardBill.objects.filter(statement_transaction=record).exists(),
            CreditCardPayment.objects.filter(transaction=record).exists(),
            RecurringBillPayment.objects.filter(transaction=record).exists(),
        )
    )


def inspect(record, *, lock=False, prepared=None):
    """No writes or parser-result persistence. Bounded sources, no private SMS text."""
    user = record.user

    def protected(query):
        return query.select_for_update(of=("self",)) if lock else query

    if prepared is None:
        candidates = list(
            protected(
                ParsedMessageCandidate.objects.filter(
                    user=user,
                    transaction=record,
                    status="confirmed",
                )
            )
            .select_related("raw_message", "account", "destination_account")
            .order_by("pk")[: MAX_SOURCES + 1]
        )
        rows = list(
            protected(
                StatementRow.objects.filter(
                    batch__user=user,
                    transaction=record,
                    state__in=("posted", "linked"),
                )
            )
            .select_related("batch__account")
            .order_by("pk")[: MAX_SOURCES + 1]
        )
        evidence = list(
            protected(
                TransferEvidence.objects.filter(
                    user=user,
                    transaction=record,
                )
            )
            .select_related("account", "raw_message")
            .order_by("pk")[: MAX_SOURCES + 1]
        )
    else:
        candidates, rows, evidence = prepared
        # These are bounded, already user-scoped source lists from the bulk page.
        # Account-report helpers must use the same bounded evidence, not refetch it.
        record._prefetched_objects_cache = {"transfer_evidence": evidence}
        # Effective reports use the model's event ordering; fingerprints and
        # source comparisons use the same stable PK order as single previews.
        evidence = sorted(evidence, key=lambda item: item.pk)
    sources, warnings, categories, parser_state = [], [], {}, []
    source_versions = {
        "sms": [(str(item.pk), str(item.updated_at)) for item in candidates],
        "statement": [(str(item.pk), item.version) for item in rows],
    }
    capped = any(len(items) > MAX_SOURCES for items in (candidates, rows, evidence))
    if prepared is None:
        mark_fee_rows(rows)
    endpoints = {record.account_id: record.account}
    if record.type == "transfer" and record.transfer_account:
        endpoints[record.transfer_account_id] = record.transfer_account
    path_valid = all(
        account.user_id == user.pk and account.currency == record.account.currency
        for account in endpoints.values()
    )
    if not path_valid:
        warnings.append("The saved account path or currency needs manual review.")

    def add(kind, identifier, account, amount, balance, direction, day, *, fee=False, source_time=None, raw_message_id=None):
        expected = (
            "credit"
            if record.type == "transfer"
            and account
            and account.pk == record.transfer_account_id
            else record.direction
        )
        issues = []
        if not path_valid:
            issues.append("The saved ledger account path or currency needs review.")
        if not account or account.pk not in endpoints or account.user_id != user.pk:
            issues.append("Reporting account does not match this ledger entry.")
        elif account.currency != record.account.currency:
            issues.append("Source account currency differs from the ledger currency.")
        if direction != expected:
            issues.append(
                f"Source direction is {direction or 'unknown'}; ledger direction is {expected or 'unknown'} for this account."
            )
        if not day:
            issues.append("Source date is unavailable.")
        elif abs(day - record.date) > timedelta(days=3):
            issues.append("Source date is more than three days from the ledger date.")
        usable = not issues
        sources.append(
            {
                "kind": kind,
                "id": str(identifier),
                "account": str(account.pk) if account else None,
                "account_name": account.name if account else "Unknown account",
                "currency": account.currency if account else None,
                "direction": direction,
                "date": day.isoformat() if day else None,
                "time": source_time,
                "raw_message": str(raw_message_id) if raw_message_id else None,
                "amount": money(amount),
                "balance_after": money(balance),
                "usable": usable,
                "has_fee": fee,
                "issues": issues,
            }
        )
        if not usable:
            warnings.append(
                "An attached source has a different account, direction, currency or date. Review it manually."
            )

    seen = set()
    messages = []
    for candidate in candidates:
        account, direction, received = sms_observation(candidate)
        add(
            "Saved SMS",
            candidate.pk,
            account,
            candidate.amount,
            candidate.balance_after,
            direction,
            received.date(),
            fee=bool(candidate.fee_amount),
            source_time=received.time().replace(microsecond=0).isoformat(),
            raw_message_id=candidate.raw_message_id,
        )
        if candidate.raw_message.user_id != user.pk:
            sources[-1]["usable"] = False
            sources[-1]["issues"].append("This SMS does not belong to this user.")
            warnings.append(
                "An attached SMS has incompatible ownership. Review it manually."
            )
        seen.add(candidate.raw_message_id)
        messages.append((candidate.raw_message, account))
    for item in evidence:
        if item.raw_message_id and item.raw_message_id not in seen:
            seen.add(item.raw_message_id)
            messages.append((item.raw_message, item.account))
        # Reviewed effective reports are current ledger choices, not new sources.
        if item.source in {"sms", "import"} or item.raw_message_id:
            add(
                "Linked report",
                item.pk,
                item.account,
                None,
                item.balance_after,
                item.direction,
                item.date,
                fee=bool(item.fee_amount),
            )
    for row in rows:
        add(
            "Statement",
            row.pk,
            row.batch.account,
            row.amount,
            row.balance_after,
            row.direction,
            row.date,
            fee=has_separate_fee(row),
        )
        counterpart = (
            record.account_id
            if row.batch.account_id == record.transfer_account_id
            else record.transfer_account_id
        )
        if row.other_account_id and (
            record.type != "transfer" or row.other_account_id != counterpart
        ):
            sources[-1]["usable"] = False
            sources[-1]["issues"].append("The statement identifies a different transfer account path.")
            warnings.append(
                "A statement identifies another account path. Review the transfer manually."
            )
        if row.batch.currency != record.account.currency:
            sources[-1]["usable"] = False
            sources[-1]["issues"].append("Statement currency differs from the ledger currency.")
            warnings.append("A statement currency differs from the ledger account.")
    if record.raw_message_id and record.raw_message_id not in seen:
        messages.append(
            (record.raw_message, record.account if record.type != "transfer" else None)
        )
    if lock:
        locked = {
            item.pk: item
            for item in RawMessage.objects.select_for_update().filter(
                user=user, pk__in=[message.pk for message, _ in messages]
            )
        }
        messages = [
            (locked[message.pk], account)
            for message, account in messages
            if message.pk in locked
        ]
    for message, account in messages:
        if message.user_id != user.pk:
            continue
        if (
            message.status == "redacted"
            or message.redacted_at
            or message.exclusion_reason
        ):
            warnings.append(
                "Original SMS is unavailable; only saved observations can be checked."
            )
            continue
        message.user = user  # Avoid one user fetch for each retained SMS.
        parsed = parse_raw_message(message)
        parser_state.append(
            {
                "message": str(message.pk),
                "body_hash": hashlib.sha256(message.body.encode()).hexdigest(),
                "parsed": {
                    key: str(value.pk) if hasattr(value, "pk") else str(value)
                    for key, value in parsed.items()
                },
            }
        )
        if parsed["message_kind"] in {
            "unknown",
            "otp_or_security",
            "balance_notice",
            "promotional",
        }:
            warnings.append(
                "Current SMS rules cannot identify a financial movement; review this source manually."
            )
            continue
        parsed_account, direction, received = sms_observation(
            SimpleNamespace(
                **{
                    **parsed,
                    "raw_message": message,
                    "suggested_transfer_direction": parsed.get(
                        "suggested_transfer_direction", ""
                    ),
                }
            )
        )
        if not account or not parsed_account or parsed_account.pk != account.pk:
            warnings.append(
                "Current SMS rules do not identify the same reporting account. Review the account manually."
            )
            add(
                "Current SMS parser",
                message.pk,
                parsed_account,
                parsed["amount"],
                parsed["balance_after"],
                direction,
                received.date(),
                fee=bool(parsed.get("fee_amount")),
                source_time=received.time().replace(microsecond=0).isoformat(),
                raw_message_id=message.pk,
            )
            sources[-1]["usable"] = False
            sources[-1]["issues"].append("Current SMS rules identify a different reporting account than the saved SMS.")
            continue
        day = received.date()
        add(
            "Current SMS parser",
            message.pk,
            account,
            parsed["amount"],
            parsed["balance_after"],
            direction,
            day,
            fee=bool(parsed.get("fee_amount")),
            source_time=received.time().replace(microsecond=0).isoformat(),
            raw_message_id=message.pk,
        )
        category = parsed.get("category")
        if (
            sources[-1]["usable"]
            and parsed["transaction_type"] == record.type
            and category
            and category.user_id == user.pk
            and category.is_active
            and category.kind
            == (
                {
                    "fee": "expense",
                    "refund": "income",
                    "lend": "debt",
                    "borrow": "debt",
                    "repayment_paid": "debt",
                    "repayment_received": "debt",
                }.get(record.type, record.type)
            )
        ):
            categories[str(category.pk)] = category

    suggestions = []
    valid = [source for source in sources if source["usable"]]
    unsafe = any(not source["usable"] for source in sources) or capped or not path_valid
    has_fee = any(source["has_fee"] for source in sources)
    dependencies = _dependencies(record)
    if capped:
        warnings.append(
            "Too many attached sources for this bounded check. Corrections are disabled; review the sources manually."
        )
    amounts = [
        record.amount,
        *(
            Decimal(source["amount"])
            for source in valid
            if source["amount"] is not None
        ),
    ]
    low, high = min(amounts), max(amounts)
    if low <= 0 or (
        low != high and not nearby_amount(low, high, record.account.currency)
    ):
        unsafe = True
    conflicting_balances = any(
        len(
            values := [
                Decimal(source["balance_after"])
                for source in valid
                if source["account"] == str(account_id)
                and source["balance_after"] is not None
            ]
        )
        > 1
        and min(values) != max(values)
        and not nearby_amount(min(values), max(values), record.account.currency)
        for account_id in endpoints
    )
    if low != high:
        if (
            not unsafe
            and not has_fee
            and not conflicting_balances
            and not dependencies
            and low > 0
            and nearby_amount(low, high, record.account.currency)
        ):
            suggestions.append(
                {
                    "key": "amount",
                    "label": "Transaction amount",
                    "current": money(record.amount),
                    "proposed": money(high),
                    "reason": "Attached BDT amounts differ by less than Tk 1. Use the higher exact amount.",
                }
            ) if high > record.amount else None
        else:
            warnings.append(
                "Amount differences, fees or debt/bill dependencies need manual review; no amount correction is offered."
            )

    current = (
        reported_values(record)
        if record.type == "transfer"
        else {record.account_id: record.balance_after}
    )
    if record.type == "transfer" and has_unattributed_legacy_balance(record, evidence):
        unsafe = True
        warnings.append(
            "The legacy transfer balance has no reliable reporting account. Review its attribution first."
        )
    for account_id, account in endpoints.items():
        values = [
            Decimal(source["balance_after"])
            for source in valid
            if source["account"] == str(account_id)
            and source["balance_after"] is not None
        ]
        if not values:
            continue
        old = current.get(account_id)
        span = [*values, *([old] if old is not None else [])]
        low, high = min(span), max(span)
        # This is an explicit correction flow, so restoring a reviewed null is
        # offered for selection, never silently filled by revalidation itself.
        agrees = low == high or nearby_amount(low, high, account.currency)
        if not unsafe and not has_fee and agrees and (old is None or high > old):
            suggestions.append(
                {
                    "key": f"balance:{account_id}",
                    "label": f"Balance after · {account.name}",
                    "current": money(old),
                    "proposed": money(high),
                    "reason": "Restore a missing reported balance from attached evidence."
                    if old is None
                    else "Same-account BDT reports differ by less than Tk 1. Use the higher exact balance.",
                }
            )
        elif not agrees or has_fee:
            warnings.append(
                f"Reported balances for {account.name} conflict or include fees. Choose the correct report in Edit."
            )
    if len(categories) == 1 and not unsafe:
        category = next(iter(categories.values()))
        if category.pk != record.category_id:
            suggestions.append(
                {
                    "key": "category",
                    "label": "Category",
                    "current": record.category.name if record.category else None,
                    "proposed": category.name,
                    "reason": "Current SMS rules suggest this category without changing the transaction type.",
                    "value": str(category.pk),
                }
            )
    elif len(categories) > 1:
        warnings.append(
            "Current SMS rules suggest different categories. Review the category manually."
        )
    if not sources:
        warnings.append(
            "No usable attached SMS or statement observations. Add or review evidence first."
        )
    ledger = {
        "date": record.date.isoformat(),
        "type": record.type,
        "amount": money(record.amount),
        "accounts": [
            {
                "id": str(account_id),
                "name": account.name,
                "currency": account.currency,
                "direction": "credit" if record.type == "transfer" and account_id == record.transfer_account_id else record.direction,
                "balance_after": money(current.get(account_id)),
            }
            for account_id, account in endpoints.items()
        ],
    }
    fingerprint = hashlib.sha256(
        json.dumps(
            freeze(
                {
                    "policy": POLICY_VERSION,
                    "record": {
                        field.attname: getattr(record, field.attname)
                        for field in Transaction._meta.concrete_fields
                    },
                    "evidence": [
                        {
                            field.attname: getattr(item, field.attname)
                            for field in TransferEvidence._meta.concrete_fields
                        }
                        for item in evidence
                    ],
                    "source_versions": source_versions,
                    "accounts": [
                        (str(item.pk), item.name, item.currency, item.is_active)
                        for item in endpoints.values()
                    ],
                    "updated_at": record.updated_at,
                    "sources": sources,
                    "parser": parser_state,
                    "suggestions": suggestions,
                    "warnings": sorted(set(warnings)),
                    "dependencies": dependencies,
                }
            ),
            sort_keys=True,
        ).encode()
    ).hexdigest()
    return {
        "transaction": str(record.pk),
        "currency": record.account.currency,
        "policy": POLICY_VERSION,
        "suggestions": suggestions,
        "ledger": ledger,
        "sources": sources,
        "warnings": sorted(set(warnings)),
        "fingerprint": fingerprint,
    }


def preview(record, *, prepared=None):
    result = inspect(record, prepared=prepared)
    result["token"] = signing.dumps(
        {
            "user": str(record.user_id),
            "transaction": str(record.pk),
            "fingerprint": result["fingerprint"],
        },
        salt=SALT,
        compress=True,
    )
    result["expires_in"] = PREVIEW_SECONDS
    return result


def _validated_preview(*, user, record_id, token):
    """Validate a signed preview under the caller's atomic writer lock."""
    try:
        signed = signing.loads(token, salt=SALT, max_age=PREVIEW_SECONDS)
    except signing.BadSignature as error:
        raise ReviewConflict(
            "The correction preview expired or is invalid. Revalidate again."
        ) from error
    if signed.get("user") != str(user.pk) or signed.get("transaction") != str(
        record_id
    ):
        raise ValidationError(
            {"token": "This preview belongs to another transaction or user."}
        )
    lock_transfer_user(user)
    record = get_object_or_404(
        Transaction.objects.select_for_update(of=("self",)).select_related(
            "user", "account", "transfer_account", "category", "raw_message"
        ),
        user=user,
        pk=record_id,
    )
    current = inspect(record, lock=True)
    if current["fingerprint"] != signed["fingerprint"]:
        raise ReviewConflict(
            "The transaction, evidence or current suggestions changed. Revalidate and review again."
        )
    return record, current, signed["fingerprint"]


def _reviewed_decision(*, user, record_id, token, selected):
    """Validate a signed choice under the caller's atomic writer lock; no writes."""
    record, current, fingerprint = _validated_preview(
        user=user, record_id=record_id, token=token
    )
    choices = {item["key"]: item for item in current["suggestions"]}
    if (
        not selected
        or len(selected) != len(set(selected))
        or any(key not in choices for key in selected)
    ):
        raise ValidationError(
            {"selected": "Select only corrections offered in this preview, once each."}
        )
    return record, choices, fingerprint


@transaction.atomic
def correct_sms_evidence(*, user, record_id, token, candidate_id, action, account_id=None):
    """Correct one confirmed SMS link; never change the transfer movement."""
    record, current, fingerprint = _validated_preview(
        user=user, record_id=record_id, token=token
    )
    if record.type != Transaction.Type.TRANSFER or not record.transfer_account_id:
        raise ValidationError({"candidate": "SMS evidence correction requires a transfer."})
    if not any(
        source["kind"] == "Saved SMS" and source["id"] == str(candidate_id)
        for source in current["sources"]
    ):
        raise ValidationError({"candidate": "Select a saved SMS shown in this preview."})
    candidate = get_object_or_404(
        ParsedMessageCandidate.objects.select_for_update(of=("self",)).select_related(
            "raw_message", "account", "destination_account"
        ),
        pk=candidate_id, user=user, transaction=record, status="confirmed",
        raw_message__user=user,
    )
    evidence = list(
        TransferEvidence.objects.select_for_update(of=("self",)).filter(
            user=user, transaction=record, raw_message=candidate.raw_message
        )
    )
    if len(evidence) > 1:
        raise ReviewConflict("This SMS has multiple reports. Review it manually before changing its link.")
    previous_primary = primary_transfer_evidence(record, list(record.transfer_evidence.all()))
    changes_primary_report = bool(
        (previous_primary and previous_primary.raw_message_id == candidate.raw_message_id)
        or record.raw_message_id == candidate.raw_message_id
    )
    before = transaction_snapshot(record)
    old_account, old_direction, _ = sms_observation(candidate)
    recorder = ActionRecorder(user, transaction_ids=[record.pk], candidate_ids=[candidate.pk])

    if action == "move":
        target = {record.account_id: record.account, record.transfer_account_id: record.transfer_account}.get(account_id)
        if not target or not old_account or target.pk == old_account.pk:
            raise ValidationError({"account": "Choose the other account in this transfer."})
        expected = "credit" if target.pk == record.transfer_account_id else "debit"
        if candidate.source_direction != expected or old_direction != expected:
            raise ValidationError({"account": "The SMS direction does not match that account's transfer side."})
        candidate.account = record.account
        candidate.destination_account = record.transfer_account
        candidate.suggested_transfer_direction = expected
        if candidate.payment_method_id and candidate.payment_method.account_id != record.account_id:
            candidate.payment_method = None
        if candidate.destination_payment_method_id and candidate.destination_payment_method.account_id != record.transfer_account_id:
            candidate.destination_payment_method = None
        candidate.save(update_fields=(
            "account", "destination_account", "suggested_transfer_direction",
            "payment_method", "destination_payment_method", "updated_at",
        ))
        for item in evidence:
            item.account = target
            item.direction = expected
            item.save(update_fields=("account", "direction"))
        if not evidence:
            _data, observation = sms_transfer_data(candidate)
            add_transfer_evidence(record, observation, candidate)
    elif action == "unlink":
        candidate.transaction = None
        candidate.status = ParsedMessageCandidate.Status.NEEDS_REVIEW
        candidate.save(update_fields=("transaction", "status", "updated_at"))
        for item in evidence:
            item.delete()
        if record.raw_message_id == candidate.raw_message_id:
            record.raw_message = None
        if record.external_key == f"raw-message:{candidate.raw_message_id}":
            record.external_key = ""
    else:
        raise ValidationError({"action": "Choose move or unlink."})

    # A secondary report correction must not replace an independently reviewed
    # scalar balance. Recompute only when this SMS supplied the primary report.
    if changes_primary_report:
        getattr(record, "_prefetched_objects_cache", {}).pop("transfer_evidence", None)
        primary = primary_transfer_evidence(record, list(record.transfer_evidence.all()))
        record.balance_after = primary.balance_after if primary else None
    record.save(update_fields=("raw_message", "external_key", "balance_after", "updated_at"))
    create_audit_log(
        user=user, action="updated", entity=record, before=before,
        after=transaction_snapshot(record), metadata={
            "operation": "correct_sms_evidence", "action": action,
            "candidate": str(candidate.pk), "from_account": str(old_account.pk) if old_account else None,
            "to_account": str(account_id) if action == "move" else None,
            "preview_fingerprint": fingerprint,
        },
    )
    recorder.finish(record, "update")
    return record


def _write_corrections(
    *,
    user,
    record,
    choices,
    selected,
    request,
    fingerprint,
    record_recovery=True,
    batch_id=None,
):
    """Only called after every selected preview has passed validation."""
    data, reports = {}, []
    for key in selected:
        item = choices[key]
        if key.startswith("balance:"):
            if record.type == "transfer":
                reports.append(
                    {"account": key.split(":", 1)[1], "balance_after": item["proposed"]}
                )
            else:
                data["balance_after"] = item["proposed"]
        elif key == "category":
            data["category"] = item["value"]
        else:
            data[key] = item["proposed"]
    if reports:
        data["reported_balances"] = reports
    if "amount" in data:
        data["allow_linked_correction"] = (
            True  # Explicit preview approval, not a caller override.
        )
    before = transaction_snapshot(record)
    recovery = (
        ActionRecorder(user, transaction_ids=[record.pk]) if record_recovery else None
    )
    serializer = TransactionSerializer(
        record, data=data, partial=True, context={"request": request}
    )
    serializer.is_valid(raise_exception=True)
    record = serializer.save()
    create_audit_log(
        user=user,
        action="updated",
        entity=record,
        before=before,
        after=transaction_snapshot(record),
        metadata={
            "operation": "revalidate",
            **({"bulk_batch": str(batch_id)} if batch_id else {}),
            "policy": POLICY_VERSION,
            "selected": selected,
            "preview_fingerprint": fingerprint,
        },
    )
    if recovery:
        recovery.finish(record, "update")
    return record


@transaction.atomic
def apply(*, user, record_id, token, selected, request):
    record, choices, fingerprint = _reviewed_decision(
        user=user, record_id=record_id, token=token, selected=selected
    )
    return _write_corrections(
        user=user,
        record=record,
        choices=choices,
        selected=selected,
        request=request,
        fingerprint=fingerprint,
    )
