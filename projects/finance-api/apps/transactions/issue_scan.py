"""Read-only, bounded checks against saved SMS and current parsing rules."""

from collections import defaultdict

from apps.messages.models import ParsedMessageCandidate, RawMessage
from apps.messages.parsers import is_generic_bank_deposit, parse_raw_message
from apps.payment_methods.models import PaymentMethod
from apps.statements.models import StatementRow
from apps.statements.rounding import equivalent_amount
from apps.statements.unified import sms_observation

from .balance_reports import reported_values
from .models import Transaction, TransferEvidence


def _known_provider(sender):
    normalized = "".join(char for char in sender.upper() if char.isalnum())
    return {"CITYBANK": "city_bank", "EBL": "ebl"}.get(normalized, "")


def _account_provider(account, methods):
    providers = {method.provider for method in methods if method.account_id == account.pk}
    if len(providers) == 1 and next(iter(providers)) in {"city_bank", "ebl"}:
        return next(iter(providers))
    normalized = "".join(char for char in account.name.upper() if char.isalnum())
    return {"CITYBANK": "city_bank", "EBL": "ebl", "EBLBANK": "ebl"}.get(normalized, "")


def _ledger_direction_for_account(record, account_id):
    if record.type == Transaction.Type.TRANSFER:
        if account_id == record.transfer_account_id:
            return "credit"
        if account_id == record.account_id:
            return "debit"
        return None
    return record.direction if account_id == record.account_id else None


def scan_ledger_page(*, user, limit, offset):
    queryset = Transaction.objects.filter(user=user).select_related("account", "category", "raw_message").prefetch_related("transfer_evidence").order_by("-date", "-id")
    total = queryset.count()
    records = list(queryset[offset:offset + limit])
    record_ids = [record.pk for record in records]
    sources = defaultdict(dict)
    financials = defaultdict(list)
    directions = defaultdict(list)
    saved_sms_directions = defaultdict(set)
    for record in records:
        if record.raw_message_id:
            sources[record.pk][record.raw_message_id] = (record.raw_message, record.account, False)
    for candidate in ParsedMessageCandidate.objects.filter(
        user=user, transaction_id__in=record_ids, status=ParsedMessageCandidate.Status.CONFIRMED,
    ).select_related("raw_message", "account", "destination_account"):
        account, _, _ = sms_observation(candidate)
        financials[candidate.transaction_id].append((account.pk if account else None, candidate.amount, candidate.balance_after))
        if candidate.source_direction and account:
            directions[candidate.transaction_id].append((
                "sms_source_direction_mismatch", "Saved SMS parser", account.pk, candidate.source_direction,
            ))
            saved_sms_directions[candidate.transaction_id].add(candidate.raw_message_id)
        sources[candidate.transaction_id].setdefault(
            candidate.raw_message_id, (candidate.raw_message, candidate.account, False)
        )
    for evidence in TransferEvidence.objects.filter(
        user=user, transaction_id__in=record_ids, raw_message__isnull=False,
    ).select_related("raw_message", "account"):
        # Linked transfers attribute each SMS to the reporting account, not
        # necessarily the canonical transfer source.
        sources[evidence.transaction_id][evidence.raw_message_id] = (evidence.raw_message, evidence.account, True)
    for row in StatementRow.objects.filter(batch__user=user, transaction_id__in=record_ids, state__in=("posted", "linked")).select_related("batch"):
        financials[row.transaction_id].append((row.batch.account_id, row.amount, row.balance_after))
        directions[row.transaction_id].append((
            "statement_draft_direction_mismatch", "Saved statement draft", row.batch.account_id, row.direction,
        ))
        source_direction = row.reviewed_source_direction or row.extracted.get("direction")
        if row.component == "principal" and source_direction in {"debit", "credit"}:
            directions[row.transaction_id].append((
                "statement_source_direction_mismatch", "Reviewed PDF direction" if row.reviewed_source_direction else "Original PDF extraction", row.batch.account_id, source_direction,
            ))
    methods = list(PaymentMethod.objects.filter(user=user, is_active=True, account__is_active=True))
    findings = []
    for record in records:
        warnings = []
        for code, label, account_id, source_direction in directions[record.pk]:
            ledger_direction = _ledger_direction_for_account(record, account_id)
            if ledger_direction and source_direction != ledger_direction:
                warnings.append({
                    "code": code, "level": "check",
                    "text": f"{label} records {source_direction}; this ledger entry records {ledger_direction} for the reporting account. Review the original source before correcting or relinking evidence.",
                })
        balances = reported_values(record) if record.type == "transfer" else {record.account_id: record.balance_after}
        if any((amount is not None and not (record.amount >= amount and equivalent_amount(record.amount, amount, record.account.currency))) or
               (balance is not None and not (balances.get(account_id) is not None and balances[account_id] >= balance and equivalent_amount(balances[account_id], balance, record.account.currency)))
               for account_id, amount, balance in financials[record.pk]):
            warnings.append({"code": "saved_source_difference", "level": "suggestion",
                             "text": "Attached evidence differs from the saved amount or reported balance. Revalidate to preview eligible corrections; conflicts may require manual review."})
        for message, reporting_account, attributed in sources[record.pk].values():
            if message.user_id != user.pk:
                continue
            checked_account = (
                (reporting_account or record.account)
                if record.type == Transaction.Type.TRANSFER else record.account
            )
            known_account = _account_provider(checked_account, methods)
            known_sender = _known_provider(message.sender)
            if (
                (record.type != Transaction.Type.TRANSFER or attributed)
                and known_account and known_sender and known_account != known_sender
            ):
                warnings.append({
                    "code": "bank_account_conflict", "level": "check",
                    "text": f"The attached {known_sender.replace('_', ' ').title()} SMS conflicts with the selected {checked_account.name} account.",
                })
            if message.status == RawMessage.Status.REDACTED or message.redacted_at or message.exclusion_reason:
                continue
            parsed = parse_raw_message(message)
            source_direction = parsed["source_direction"]
            ledger_direction = _ledger_direction_for_account(record, checked_account.pk)
            if (record.type != Transaction.Type.TRANSFER or attributed) and message.pk not in saved_sms_directions[record.pk] and source_direction and ledger_direction and source_direction != ledger_direction:
                warnings.append({
                    "code": "sms_source_direction_mismatch", "level": "check",
                    "text": f"Current SMS parser reads {source_direction}; this ledger entry records {ledger_direction} for the reporting account. Review the message before correcting the entry.",
                })
            if is_generic_bank_deposit(
                provider=parsed["provider"], message_kind=parsed["message_kind"],
                body=message.body, counterparty_text=parsed["counterparty_text"],
            ) and record.type != Transaction.Type.TRANSFER and (
                record.category_id or record.counterparty_text or record.note
            ):
                warnings.append({
                    "code": "deposit_purpose_unverified", "level": "check",
                    "text": "This deposit SMS does not name its source or purpose; verify the saved category, counterparty, and note.",
                })
            suggested_category = parsed["category"]
            if suggested_category and suggested_category.pk != record.category_id:
                warnings.append({
                    "code": "current_category_suggestion", "level": "suggestion",
                    "text": f"Current rules suggest {suggested_category.name}; review before changing the saved category.",
                })
        if record.needs_review:
            warnings.append({"code": "marked_for_review", "level": "check", "text": "This entry is already marked Needs review."})
        if warnings:
            unique = list({warning["code"]: warning for warning in warnings}.values())
            findings.append({
                "transaction": str(record.pk), "date": record.date.isoformat(),
                "account": record.account.name, "amount": str(record.amount), "issues": unique,
            })
    next_offset = offset + len(records) if offset + len(records) < total else None
    return {"scanned": len(records), "total": total, "next_offset": next_offset, "results": findings}
