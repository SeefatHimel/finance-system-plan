"""Bounded preview/apply for late evidence. Source links remain canonical.

This first boundary only attaches to posted movements. Financial corrections,
merges, automatic attachment and historical scans deliberately require later flows.
"""

import hashlib
import json
from dataclasses import dataclass
from datetime import timedelta
from decimal import Decimal

from django.db import transaction
from django.db.models import Q
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework.exceptions import ValidationError

from apps.audit_logs.models import AuditLogEntry
from apps.audit_logs.services import create_audit_log, transaction_snapshot
from apps.messages.models import ParsedMessageCandidate
from apps.statements.models import StatementRow
from apps.statements.services import (
    ReviewConflict,
    decide_locked,
    find_matches,
    reporting_observations,
)
from apps.statements.unified import NON_FINANCIAL, sms_observation
from apps.transactions.balance_reports import (
    account_reports,
    can_fill_missing_transfer_balance,
    reported_values,
    select_effective_account_report,
)
from apps.transactions.models import Transaction, TransactionAction
from apps.transactions.recovery import (
    ActionRecorder,
    describe,
    freeze,
    related_fingerprint,
)
from apps.transactions.transfers import (
    add_transfer_evidence,
    ensure_transfer_evidence,
    lock_transfer_user,
    sms_recorded_elsewhere,
)

from .evidence import (
    finish_sms_link,
    identity_issues,
    missing_report_choice,
    prefetch_source_observations,
)
from .models import EvidenceProposal

POLICY_VERSION = "evidence-attach-v1"
SUPPORTED_TYPES = {"expense", "income", "fee", "refund", "transfer"}
MAX_HISTORY = 1000


def digest(value):
    return hashlib.sha256(
        json.dumps(freeze(value), sort_keys=True).encode()
    ).hexdigest()


def money(value):
    return str(value) if value is not None else None


@dataclass
class Source:
    kind: str
    item: object
    account: object
    currency: str
    amount: Decimal
    direction: str
    date: object
    time: object
    balance: object
    reference: str
    other_id: object = None

    @property
    def ref(self):
        return {
            "kind": self.kind,
            "id": str(self.item.pk),
            "component": getattr(self.item, "component", "principal"),
        }

    def summary(self):
        return {
            **self.ref,
            "account": str(self.account.pk) if self.account else None,
            "amount": money(self.amount),
            "currency": self.currency,
            "direction": self.direction,
            "date": self.date,
            "time": self.time,
            "balance_after": money(self.balance),
            "updated_at": self.item.updated_at,
        }


def load_sources(user, refs, *, lock=False):
    sources = []
    for ref in sorted(refs, key=lambda r: (r["kind"] != "statement", str(r["id"]))):
        if ref["kind"] == "sms":
            qs = ParsedMessageCandidate.objects.select_related(
                "account", "destination_account", "raw_message"
            )
            if lock:
                qs = qs.select_for_update(of=("self",))
            item = get_object_or_404(qs, user=user, pk=ref["id"])
            account, direction, received = sms_observation(item)
            other = (
                item.account
                if direction == "credit" and item.destination_account_id
                else item.destination_account
            )
            sources.append(
                Source(
                    "sms",
                    item,
                    account,
                    account.currency if account else "",
                    item.amount,
                    direction,
                    received.date(),
                    received.time().replace(tzinfo=None, microsecond=0),
                    item.balance_after,
                    item.reference,
                    other.pk if other else None,
                )
            )
        else:
            qs = StatementRow.objects.select_related(
                "batch__account", "other_account", "category"
            )
            if lock:
                qs = qs.select_for_update(of=("self",))
            item = get_object_or_404(
                qs, batch__user=user, pk=ref["id"], component=ref["component"]
            )
            sources.append(
                Source(
                    "statement",
                    item,
                    item.batch.account,
                    item.batch.currency,
                    item.amount,
                    item.direction,
                    item.date,
                    item.time,
                    item.balance_after,
                    item.reference,
                    item.other_account_id,
                )
            )
    return sources


def source_issues(source):
    item = source.item
    issues = []
    if not source.account or not source.account.is_active:
        issues.append("Choose an active reporting account on the source first.")
    if not source.amount or source.amount <= 0 or not source.date:
        issues.append("Correct the source amount and date before linking.")
    if item.transaction_id or (
        item.status != "needs_review"
        if source.kind == "sms"
        else item.state != "pending"
    ):
        issues.append("This source is already resolved. Refresh its current link.")
    if source.kind == "sms":
        if (
            item.message_kind in NON_FINANCIAL
            or item.transaction_type not in SUPPORTED_TYPES
        ):
            issues.append(
                "This SMS classification is not supported for evidence attachment."
            )
        if item.fee_amount:
            issues.append(
                "Review the SMS principal and fee separately before attaching."
            )
        if sms_recorded_elsewhere(item):
            issues.append("This SMS component already supports a posted transaction.")
    return issues


def compatible(source, target):
    return not identity_issues(
        record=target,
        user_id=source.account.user_id,
        account=source.account,
        currency=source.currency,
        amount=source.amount,
        direction=source.direction,
        other_id=source.other_id,
    )


def target_summary(record):
    return {
        "id": str(record.pk),
        "type": record.type,
        "account": str(record.account_id),
        "transfer_account": str(record.transfer_account_id)
        if record.transfer_account_id
        else None,
        "amount": money(record.amount),
        "currency": record.account.currency,
        "date": record.date,
        "time": record.time,
        "updated_at": record.updated_at,
    }


def discover(user, sources):
    if any(source_issues(s) for s in sources):
        return [], False
    first = sources[0]
    qs = (
        Transaction.objects.filter(user=user, amount=first.amount)
        .filter(
            Q(account=first.account)
            | Q(type="transfer", transfer_account=first.account)
        )
        .filter(
            Q(
                date__range=(
                    first.date - timedelta(days=3),
                    first.date + timedelta(days=3),
                )
            )
            | Q(
                transfer_evidence__account=first.account,
                transfer_evidence__date__range=(
                    first.date - timedelta(days=3),
                    first.date + timedelta(days=3),
                ),
            )
            | Q(
                statement_rows__batch__account=first.account,
                statement_rows__date__range=(
                    first.date - timedelta(days=3),
                    first.date + timedelta(days=3),
                ),
            )
            | Q(
                parsed_message_candidates__status="confirmed",
                parsed_message_candidates__raw_message__received_at__date__range=(
                    first.date - timedelta(days=3),
                    first.date + timedelta(days=3),
                ),
            )
        )
        .select_related("account", "transfer_account")
        .prefetch_related("transfer_evidence")
        .order_by("date", "id")
        .distinct()
    )
    history = list(prefetch_source_observations(qs)[: MAX_HISTORY + 1])
    if len(history) > MAX_HISTORY:
        return [], True
    statement_matches = {}
    for source in sources:
        if source.kind == "statement":
            found, truncated = find_matches([source.item])
            if truncated:
                return [], True
            statement_matches[source.item.pk] = {
                m["id"] for m in found[source.item.pk] if m["can_link"]
            }
    matches = []
    for record in history:
        if (
            record.type not in SUPPORTED_TYPES
            or not record.account.is_active
            or (record.transfer_account and not record.transfer_account.is_active)
        ):
            continue
        signals = []
        for source in sources:
            if not compatible(source, record):
                break
            if (
                source.kind == "statement"
                and str(record.pk) not in statement_matches[source.item.pk]
            ):
                break
            observations = [
                o
                for o in reporting_observations(record, source.account.pk)
                if abs((o.date - source.date).days) <= 3
                or (
                    source.kind == "statement"
                    and source.item.value_date
                    and abs((o.date - source.item.value_date).days) <= 3
                )
            ]
            if not observations:
                break
            reasons = [
                "Same reporting account, currency, direction and amount within three days."
            ]
            # Independent fields must come from a single account observation.
            corroborated = any(
                (
                    source.reference.strip()
                    and source.reference.strip().casefold()
                    == o.reference.strip().casefold()
                )
                or (source.balance is not None and source.balance == o.balance_after)
                for o in observations
            )
            if corroborated:
                reasons.append(
                    "A same-account reference or exact reported balance also agrees."
                )
            else:
                reasons.append(
                    "Amount/date alone are not proof. Explicit comparison is required."
                )
            contradictions = []
            if source.reference.strip() and any(
                o.reference.strip()
                and source.reference.strip().casefold()
                != o.reference.strip().casefold()
                for o in observations
            ):
                contradictions.append(
                    "A retained same-account reference differs. Inspect the original reports."
                )
            if source.balance is not None and any(
                o.balance_after is not None and source.balance != o.balance_after
                for o in observations
            ):
                contradictions.append(
                    "A retained same-account balance differs. Review the report choice."
                )
            signals.append(
                {
                    "source": source.ref,
                    "corroborated": bool(corroborated),
                    "contradictions": contradictions,
                    "reasons": reasons,
                }
            )
        else:
            matches.append({**target_summary(record), "signals": signals})
    # No automatic target, even when a sole candidate is corroborated.
    return matches[:8], len(matches) > 8


def coverage(record):
    accounts = [record.account]
    if record.type == "transfer" and record.transfer_account:
        accounts.append(record.transfer_account)
    found = {
        str(a.pk): {
            "account": str(a.pk),
            "sms": set(),
            "statement": set(),
            "manual": record.source in {"web", "mobile"}
            and a.pk == record.account_id
            and not record.raw_message_id,
            "legacy_sms": False,
        }
        for a in accounts
    }
    for item in record.parsed_message_candidates.select_related(
        "account", "destination_account", "raw_message"
    ):
        account, _, _ = sms_observation(item)
        if item.status == "confirmed" and account and str(account.pk) in found:
            found[str(account.pk)]["sms"].add(str(item.pk))
    for row in record.statement_rows.select_related("batch__account"):
        if str(row.batch.account_id) in found:
            found[str(row.batch.account_id)]["statement"].add(str(row.pk))
    # Legacy captures may have no candidate link; never infer the other side.
    if record.raw_message_id and not any(item["sms"] for item in found.values()):
        if record.type != "transfer":
            found[str(record.account_id)]["legacy_sms"] = True
        else:
            for evidence in record.transfer_evidence.all():
                if (
                    evidence.raw_message_id == record.raw_message_id
                    and str(evidence.account_id) in found
                ):
                    found[str(evidence.account_id)]["legacy_sms"] = True
    return [
        {**item, "sms": sorted(item["sms"]), "statement": sorted(item["statement"])}
        for item in found.values()
    ]


def balances(record):
    if record.type == "transfer":
        reports = reported_values(record)
        if not record.transfer_evidence.exists() and record.raw_message_id:
            primary = (
                record.parsed_message_candidates.filter(
                    raw_message_id=record.raw_message_id
                )
                .select_related("account", "destination_account", "raw_message")
                .first()
            )
            if primary:
                account, _, _ = sms_observation(primary)
                if account:
                    reports = {account.pk: record.balance_after}
        return {str(a): money(value) for a, value in reports.items()}
    return {str(record.account_id): money(record.balance_after)}


def excluded_balance_sources(sources):
    return {
        s.kind
        for s in sources
        if s.kind == "statement"
        and s.item.component == "principal"
        and s.item.batch.rows.filter(position=s.item.position, component="fee").exists()
    }


def build_preview(user, sources, target):
    blocked = [issue for source in sources for issue in source_issues(source)]
    if len({s.account.pk for s in sources if s.account}) != 1:
        blocked.append(
            "Review sources from one reporting account together; attach the other account separately."
        )
    matches, truncated = discover(user, sources) if not blocked else ([], False)
    if truncated:
        blocked.append(
            "The matching window is incomplete. Narrow or resolve sources before linking."
        )
    if not target:
        blocked.append(
            "Choose a target from the suggestions and request a fresh preview."
        )
    elif str(target.pk) not in {m["id"] for m in matches}:
        blocked.append("The selected transaction is not a supported current match.")
    incoming = {s.kind: s.balance for s in sources}
    account = sources[0].account
    existing = balances(target).get(str(account.pk)) if target and account else None
    can_fill = bool(
        target and account and can_fill_missing_transfer_balance(target, account.pk)
    )
    excluded = excluded_balance_sources(sources)
    available = {
        k: v for k, v in incoming.items() if k not in excluded and v is not None
    }
    conflict = bool(
        len(set(incoming.values()) - {None}) > 1
        or (
            existing is not None
            and any(v is not None and str(v) != existing for v in incoming.values())
        )
    )
    if (
        can_fill
        and excluded
        and not available
        and any(incoming.get(kind) is not None for kind in excluded)
    ):
        blocked.append(
            "The only reported balance includes a separate fee. Review the fee before attaching this principal."
        )
    choices = [{"source": "existing", "value": existing}]
    if can_fill:
        choices += [
            {"source": kind, "value": money(value)} for kind, value in available.items()
        ]
    auto_fill = (
        next(iter(available), None)
        if can_fill and len(set(incoming.values()) - {None}) == 1
        else None
    )
    required = ["acknowledge_match"]
    selected_match = next(
        (m for m in matches if target and m["id"] == str(target.pk)), None
    )
    if conflict or (
        selected_match and any(s["contradictions"] for s in selected_match["signals"])
    ):
        required.append("acknowledge_conflict")
    if can_fill and len(set(incoming.values()) - {None}) > 1:
        required.append("balance_source")
    if any(s.kind == "statement" for s in sources):
        required.append("acknowledge_issues")
    before = coverage(target) if target else []
    after = json.loads(json.dumps(before))
    for item in after:
        for source in sources:
            if source.account and str(source.account.pk) == item["account"]:
                item[source.kind] = sorted(
                    set(item[source.kind]) | {str(source.item.pk)}
                )
    return freeze(
        {
            "policy_version": POLICY_VERSION,
            "intent": "blocked" if blocked else "attach",
            "sources": [s.summary() for s in sources],
            "target": target_summary(target) if target else None,
            "matches": matches,
            "truncated": truncated,
            "blocked_reasons": list(dict.fromkeys(blocked)),
            "required_decisions": required,
            "balance_choices": choices,
            "can_fill_missing_balance": can_fill,
            "field_changes": [
                {
                    "field": "reported_balance",
                    "account": str(account.pk),
                    "current": existing,
                    "proposed": money(available[auto_fill]),
                    "origin": auto_fill,
                }
            ]
            if auto_fill and account
            else [],
            "coverage_before": before,
            "coverage_after": after,
            "impact": {
                "ledger_movements": 0,
                "ledger_amount": "0.00",
                "classification_changed": False,
            },
            "limitations": [
                "No automatic attachment, financial correction, merge or historical revalidation.",
                "Known balances and unknown/deliberately cleared reports are retained.",
            ],
        }
    )


def state_fingerprint(user, sources, target):
    # Hash rather than persist private source content or identifiers in proposals.
    inputs = []
    for source in sources:
        item = source.item
        values = (
            item.__class__.objects.filter(pk=item.pk)
            .values(
                *[
                    field.attname
                    for field in item._meta.fields
                    if field.name != "source_code"
                ]
            )
            .get()
        )
        if source.kind == "statement":
            values.pop("source_code", None)
            values["batch"] = list(
                item.batch.rows.order_by("pk").values(
                    "id", "version", "updated_at", "state", "transaction_id"
                )
            )
            values["import"] = (
                item.batch.__class__.objects.filter(pk=item.batch_id)
                .values("updated_at", "checks")
                .get()
            )
        else:
            values["raw"] = {
                "id": item.raw_message_id,
                "received_at": item.raw_message.received_at,
                "status": item.raw_message.status,
            }
        values["account"] = (
            {
                "id": source.account.pk,
                "active": source.account.is_active,
                "currency": source.account.currency,
            }
            if source.account
            else None
        )
        inputs.append(values)
    return digest(
        {
            "policy": POLICY_VERSION,
            "sources": inputs,
            "target": Transaction.objects.filter(pk=target.pk).values().get()
            if target
            else None,
            "relations": related_fingerprint(user, [str(target.pk)])
            if target
            else None,
            "target_accounts": [
                (a.pk, a.is_active, a.currency)
                for a in (target.account, target.transfer_account)
                if a
            ]
            if target
            else [],
        }
    )


@transaction.atomic
def propose(*, user, payload):
    lock_transfer_user(user)
    sources = load_sources(user, payload["sources"])
    target = (
        get_object_or_404(
            Transaction.objects.select_related("account", "transfer_account"),
            user=user,
            pk=payload["transaction"],
        )
        if payload.get("transaction")
        else None
    )
    preview = build_preview(user, sources, target)
    return EvidenceProposal.objects.create(
        user=user,
        sources=[s.ref for s in sources],
        target_id=target.pk if target else None,
        fingerprint=digest(
            {"state": state_fingerprint(user, sources, target), "preview": preview}
        ),
        preview=preview,
        expires_at=timezone.now() + timedelta(minutes=15),
    )


def proposal_response(proposal):
    return {
        "id": str(proposal.pk),
        "fingerprint": proposal.fingerprint,
        "expires_at": proposal.expires_at,
        **proposal.preview,
    }


@transaction.atomic
def apply(*, user, proposal_id, payload, request):
    lock_transfer_user(user)
    proposal = get_object_or_404(
        EvidenceProposal.objects.select_for_update(), user=user, pk=proposal_id
    )
    if payload["fingerprint"] != proposal.fingerprint:
        raise ReviewConflict("The proposal fingerprint differs. Refresh the preview.")
    decision_hash = digest(payload)
    sources = load_sources(user, proposal.sources, lock=True)
    target = (
        get_object_or_404(
            Transaction.objects.select_for_update(of=("self",)).select_related(
                "account", "transfer_account"
            ),
            pk=proposal.target_id,
            user=user,
        )
        if proposal.target_id
        else None
    )
    from apps.accounts.models import Account

    account_ids = {source.account.pk for source in sources if source.account}
    if target:
        account_ids.update(a.pk for a in (target.account, target.transfer_account) if a)
    locked_accounts = {
        a.pk: a
        for a in Account.objects.select_for_update()
        .filter(user=user, pk__in=account_ids)
        .order_by("pk")
    }
    if account_ids != locked_accounts.keys():
        raise ReviewConflict("Account ownership changed. Refresh the sources.")
    for source in sources:
        if source.account:
            source.account = locked_accounts[source.account.pk]
            if source.kind == "sms":
                source.currency = source.account.currency
    if target:
        target.account = locked_accounts[target.account_id]
        if target.transfer_account_id:
            target.transfer_account = locked_accounts[target.transfer_account_id]
    if proposal.applied_at:
        if (
            proposal.idempotency_key != payload["idempotency_key"]
            or proposal.decision_hash != decision_hash
            or proposal.result_fingerprint != state_fingerprint(user, sources, target)
        ):
            raise ReviewConflict(
                "The accepted decision or its linked data changed. Refresh before retrying."
            )
        result = {**proposal.result, "unchanged": True}
        action = (
            TransactionAction.objects.filter(
                user=user, pk=result["undo_action"]["id"]
            ).first()
            if result.get("undo_action")
            else None
        )
        result["undo_action"] = describe(action, check=True) if action else None
        return result
    if EvidenceProposal.objects.filter(
        user=user, idempotency_key=payload["idempotency_key"]
    ).exists():
        raise ReviewConflict(
            "This idempotency key was already used for another decision."
        )
    if proposal.expires_at <= timezone.now():
        raise ReviewConflict("The preview expired. Request a fresh proposal.")
    preview = build_preview(user, sources, target)
    if proposal.fingerprint != digest(
        {"state": state_fingerprint(user, sources, target), "preview": preview}
    ):
        raise ReviewConflict(
            "Sources, ledger data or matching suggestions changed. Request a fresh proposal."
        )
    if preview["intent"] == "blocked":
        raise ValidationError({"proposal": preview["blocked_reasons"]})
    for field in preview["required_decisions"]:
        if field != "balance_source" and not payload.get(field):
            raise ValidationError(
                {field: "Review this decision before attaching the sources."}
            )
    choice = payload["balance_source"]
    if choice not in {c["source"] for c in preview["balance_choices"]}:
        raise ValidationError(
            {"balance_source": "Choose a balance source shown in the preview."}
        )
    account = sources[0].account
    incoming = {s.kind: s.balance for s in sources}
    # Missing-balance policy is identical to the existing combined review route.
    fill = missing_report_choice(
        target, account.pk, incoming, choice, excluded=excluded_balance_sources(sources)
    )
    recorder = ActionRecorder(
        user,
        transaction_ids=[target.pk],
        candidate_ids=[s.item.pk for s in sources if s.kind == "sms"],
        statement_ids=[s.item.pk for s in sources if s.kind == "statement"],
    )
    before = transaction_snapshot(target)
    if target.type == "transfer":
        ensure_transfer_evidence(target)
        existing_report = account_reports(target)[0].get(account.pk)
    else:
        existing_report = None
    for source in sources:
        item = source.item
        if source.kind == "statement":
            decide_locked(
                row=item,
                user=user,
                request=request,
                payload={
                    "action": "link",
                    "version": item.version,
                    "transaction": target,
                    "acknowledge_issues": payload["acknowledge_issues"],
                    "acknowledge_conflict": payload["acknowledge_conflict"],
                    "remember_choices": False,
                    "balance_choice": {
                        "keep": "existing",
                        "existing_balance_after": Decimal(
                            preview["balance_choices"][0]["value"]
                        )
                        if preview["balance_choices"][0]["value"] is not None
                        else None,
                        "statement_balance_after": item.balance_after,
                    }
                    if not preview["can_fill_missing_balance"]
                    else None,
                },
            )
        else:
            if target.type == "transfer":
                add_transfer_evidence(
                    target,
                    {
                        "account": source.account,
                        "direction": source.direction,
                        "date": source.date,
                        "time": source.time,
                        "balance_after": source.balance,
                        "reference": source.reference,
                        "source": "sms",
                        "note": item.counterparty_text,
                    },
                    item,
                )
            finish_sms_link(item, target)
    target.refresh_from_db()
    if target.type == "transfer":
        if fill:
            selected_source = next(s for s in sources if s.kind == fill)
            selected = (
                target.transfer_evidence.get(
                    raw_message=selected_source.item.raw_message
                )
                if fill == "sms"
                else target.transfer_evidence.get(
                    external_key=f"statement-row:{selected_source.item.pk}"
                )
            )
            select_effective_account_report(target, selected)
        elif existing_report:
            select_effective_account_report(target, existing_report)
        _, primary = account_reports(target)
        target.balance_after = (
            primary.balance_after if primary else target.balance_after
        )
    # Touch all attachments, including ordinary transactions. Never replace raw_message
    # or copy identifiers from another account merely because evidence was accepted.
    target.save(update_fields=("balance_after", "updated_at"))
    create_audit_log(
        user=user,
        action=AuditLogEntry.Action.UPDATED,
        entity=target,
        before=before,
        after=transaction_snapshot(target),
        metadata={
            "decision": "evidence_attach",
            "proposal": str(proposal.pk),
            "sources": proposal.sources,
            "filled_report_from": fill,
        },
    )
    recorder.finish(target, "evidence_link")
    result = {
        "undo_action": target.undo_action,
        "proposal": str(proposal.pk),
        "transaction": str(target.pk),
        "intent": "attach",
        "sources": proposal.sources,
        "coverage": coverage(target),
        "balances": balances(target),
        "ledger_movements_added": 0,
        "unchanged": False,
    }
    proposal.applied_at = timezone.now()
    proposal.idempotency_key = payload["idempotency_key"]
    proposal.decision_hash = decision_hash
    proposal.result = freeze(result)
    proposal.result_fingerprint = state_fingerprint(user, sources, target)
    proposal.save(
        update_fields=(
            "applied_at",
            "idempotency_key",
            "decision_hash",
            "result",
            "result_fingerprint",
        )
    )
    return result
