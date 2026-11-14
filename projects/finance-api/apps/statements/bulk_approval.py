"""Bounded, source-preserving approval of independently reviewed SMS/PDF pairs."""

import hashlib
import json
from collections import Counter, defaultdict
from copy import copy
from datetime import timedelta
from decimal import Decimal, InvalidOperation

from django.core import signing
from django.core.serializers.json import DjangoJSONEncoder
from django.db import IntegrityError, transaction
from django.utils import timezone
from rest_framework.exceptions import NotFound, ValidationError

from apps.categories.models import Category
from apps.messages.category_suggestions import CategorySuggestions, compatible
from apps.messages.models import ParsedMessageCandidate
from apps.transactions.recovery import ActionRecorder, describe
from apps.transactions.transfers import lock_transfer_user, sms_recorded_elsewhere

from .account_verification import ACCOUNT_WARNING, is_verified, verification_summary
from .bulk_source_checks import competing_pairs, recorded_sms
from .bulk_writer import write_ordinary_pairs
from .insights import analyze, suggestions
from .models import StatementOriginalFile, StatementRow, UnifiedApprovalBatch
from .services import (
    CheckedStatementArithmetic,
    ReviewConflict,
    find_matches,
    posting_issues,
    row_snapshot,
)
from .unified import (
    confirm_pair,
    has_competing_sources,
    pair_signals,
    sms_observation,
    summary,
)

LIMIT = 25
MAX_CONTEXT = 5000
PREVIEW_SECONDS = 900
POLICY = 3
SALT = "statements.bulk-pair-approval"


def digest(value):
    return hashlib.sha256(
        json.dumps(value, cls=DjangoJSONEncoder, sort_keys=True).encode()
    ).hexdigest()


def prepare(user, pairs, *, lock=False):
    """Share statement arithmetic and ledger scans across pairs in each import."""
    row_ids = {str(pair["statement"]) for pair in pairs}
    sms_ids = {str(pair["sms"]) for pair in pairs}
    rows = StatementRow.objects.filter(pk__in=row_ids, batch__user=user).select_related(
        "batch__account",
        "category",
        "other_account",
        "transaction",
    )
    sms = ParsedMessageCandidate.objects.filter(
        pk__in=sms_ids, user=user
    ).select_related(
        "raw_message",
        "user",
        "account",
        "destination_account",
        "category",
    )
    if lock:
        rows, sms = rows.select_for_update(of=("self",)), sms.select_for_update(
            of=("self",)
        )
    row_map, sms_map = {str(row.pk): row for row in rows.order_by("pk")}, {
        str(item.pk): item for item in sms.order_by("pk")
    }
    if row_map.keys() != row_ids or sms_map.keys() != sms_ids:
        raise NotFound("One or more selected sources are no longer available.")
    batches = {row.batch_id: row.batch for row in row_map.values()}
    context = list(
        StatementRow.objects.filter(batch_id__in=batches).select_related(
            "batch__account", "category", "other_account", "transaction__account",
            "transaction__transfer_account",
        )[: MAX_CONTEXT + 1]
    )
    if len(context) > MAX_CONTEXT:
        return row_map, sms_map, None
    grouped = defaultdict(list)
    for row in context:
        grouped[row.batch_id].append(row_map.get(str(row.pk), row))
    matches = {}
    for batch_id, siblings in grouped.items():
        chosen = [row for row in siblings if str(row.pk) in row_ids]
        fee_positions = {row.position for row in siblings if row.component == "fee"}
        for row in chosen:
            row._bulk_has_fee = row.position in fee_positions
            row._bulk_statement_rows = siblings
        try:
            analyze(batches[batch_id], siblings)
            arithmetic = CheckedStatementArithmetic.capture(batches[batch_id], siblings)
            for row in chosen:
                row._bulk_arithmetic = arithmetic
            found, truncated = find_matches(chosen, context_rows=siblings)
        except (InvalidOperation, ValueError, TypeError):
            # Older/unreadable extracted values must never turn into an approval.
            for row in chosen:
                row._draft_issues = [
                    "Original financial values need individual review."
                ]
            found, truncated = {row.pk: [] for row in chosen}, True
        matches.update({str(row.pk): (found[row.pk], truncated) for row in chosen})
    return row_map, sms_map, matches


def final_values(row, sms, edits, categories, sms_hints):
    """Use the same category precedence as individual review; never change money."""

    def eligible(category_id):
        category = categories.get(str(category_id))
        return category if compatible(category, row.type, row.batch.user_id) else None

    suggestion = getattr(row, "_suggestion", None) or {}
    category = eligible(row.category_id)
    if category is None and suggestion.get("type") == row.type:
        category = eligible(suggestion.get("category"))
    if category is None and row.type == sms.transaction_type:
        hint = sms_hints.category(sms)
        category = eligible(hint.pk) if hint else None
    origin = "saved" if category and category.pk == row.category_id else "suggested"
    if "category" in edits:
        category = eligible(edits["category"])
        origin = "chosen"
    if category is None:
        origin = "missing"
    return (
        category,
        {
            "category": str(category.pk) if category else None,
            "description": edits.get(
                "description",
                row.counterparty_text
                or str(row.extracted.get("description") or "")[:255]
                or sms.counterparty_text[:255],
            ),
            "note": edits.get("note", row.note),
        },
        origin,
    )


def inspect_pair(
    row, sms, matches, *, category, final, category_origin, shared=False,
    competing=None, recorded=None,
):
    reasons = []
    try:
        signals = pair_signals(row, sms)
        competing = signals and (
            has_competing_sources(row, sms) if competing is None else competing
        )
    except (InvalidOperation, ValueError, TypeError):
        signals, competing = None, False
        reasons.append(
            "Original financial evidence is unreadable. Review this pair individually."
        )
    if not signals:
        reasons.append("These sources are no longer compatible pending matches.")
    elif signals["strength"] != "strong":
        if "Counterparty wording differs." in signals["reasons"]:
            reasons.append(
                "Original statement and SMS counterparty wording differ. Compare the originals individually; editing the description does not verify this match."
            )
        elif not signals["conflict"]:
            reasons.append(
                "This pair is not a strong identity match. Compare the reference and original counterparty wording individually."
            )
    if shared or competing:
        reasons.append(
            "Another source can claim this movement. Choose the pair individually."
        )
    already_recorded = sms_recorded_elsewhere(sms) if recorded is None else recorded
    if already_recorded:
        reasons.append(
            "An SMS for this movement is already recorded. Review the existing transaction."
        )
    proposed = copy(row)
    proposed.category = category
    reasons.extend(posting_issues(proposed))
    account, direction, received = sms_observation(sms)
    if row.date != received.date() or (row.value_date and row.value_date != row.date):
        reasons.append("Transaction/value dates differ. Review the dates individually.")
    if row.amount != sms.amount:
        reasons.append(
            "Amounts differ. Bulk approval does not make rounding corrections."
        )
    original_direction = row.reviewed_source_direction or row.extracted.get("direction")
    if (
        original_direction not in {"debit", "credit"}
        or original_direction != row.direction
        or sms.source_direction != direction
    ):
        reasons.append(
            "Verify the original debit/credit direction before bulk approval."
        )
    if row.type != sms.transaction_type:
        reasons.append("Transaction types differ. Choose the final type individually.")
    if (
        row.balance_after is not None
        and sms.balance_after is not None
        and row.balance_after != sms.balance_after
    ):
        reasons.append(
            "Reported balances differ. Choose the correct report individually."
        )
    try:
        source_fee = Decimal(str(row.extracted.get("signed_fee") or "0"))
    except (InvalidOperation, ValueError):
        source_fee = None
    if source_fee is None or sms.fee_amount or source_fee:
        reasons.append("This movement has a fee. Review its components individually.")
    has_fee = getattr(row, "_bulk_has_fee", None)
    if has_fee is None:
        has_fee = row.batch.rows.filter(position=row.position, component="fee").exists()
    if has_fee:
        reasons.append("A separate fee row needs individual review.")
    if category is None:
        reasons.append("Choose an active, compatible category in this preview.")
    if row.type == "transfer":
        counterpart = (
            sms.account_id if direction == "credit" else sms.destination_account_id
        )
        if not row.classification_confirmed or counterpart != row.other_account_id:
            reasons.append(
                "Confirm both owned transfer accounts in individual review first."
            )
    if account and (account.user_id != row.batch.user_id or not account.is_active):
        reasons.append("Choose an active reporting account owned by you.")
    if row.other_account_id and row.other_account.user_id != row.batch.user_id:
        reasons.append("Choose an owned transfer destination.")
    if matches is None:
        reasons.append(
            "Too much statement context for bulk approval. Review a smaller selection."
        )
    else:
        found, truncated = matches[str(row.pk)]
        if found or truncated:
            reasons.append(
                "An existing ledger movement may match, or its checks are incomplete. Review individually."
            )
    for label, issues in (
        ("Original statement", row.extracted.get("issues") or []),
        ("Saved draft", getattr(row, "_draft_issues", [])),
        ("Statement warning", row.batch.warnings or []),
    ):
        for issue in issues:
            if label == "Statement warning" and issue == ACCOUNT_WARNING:
                if not is_verified(row.batch):
                    reasons.append(
                        "Confirm the reporting account once for this statement in the account review above."
                    )
                continue
            reasons.append(f"{label}: {issue}")
    for check in row.batch.checks:
        if check.get("passed") is False:
            label = check.get("label") or check.get("name") or "Source check"
            details = ""
            if check.get("expected") is not None or check.get("observed") is not None:
                details = f" Expected {check.get('expected', 'unknown')}; observed {check.get('observed', 'unknown')}."
            reasons.append(f"Statement check failed: {label}.{details}")
    statement, message = summary(row), summary(sms)
    result = {
        "id": f"{row.pk}:{sms.pk}",
        "statement": statement,
        "sms": message,
        "category": (
            {"id": str(category.pk), "name": category.name} if category else None
        ),
        "final": final,
        "category_origin": category_origin,
        "other_account": (
            {"id": str(row.other_account_id), "name": row.other_account.name}
            if row.other_account_id
            else None
        ),
        "ready": not reasons,
        "blockers": list(dict.fromkeys(reasons)),
        "statement_text": str(row.extracted.get("description", ""))[:1200],
        "sms_text": (
            sms.raw_message.body[:1200] if not sms.raw_message.redacted_at else ""
        ),
        "balance_source": "sms" if sms.balance_after is not None else "statement",
    }
    proof = {
        "result": {
            key: value for key, value in result.items() if key != "category_origin"
        },
        "row": row_snapshot(row),
        "source": row.extracted,
        "account_revision": row.batch.account.updated_at,
        "account_review": (
            row.batch.reviewed_account_fingerprint if is_verified(row.batch) else None
        ),
        "category_revision": row.category.updated_at if row.category_id else None,
        "final_category_revision": category.updated_at if category else None,
        "other_revision": (
            row.other_account.updated_at if row.other_account_id else None
        ),
        "sms_category": str(sms.category_id) if sms.category_id else None,
        "sms_raw_revision": sms.raw_message.body_hash,
    }
    return result, digest(proof)


def inspect(user, pairs, *, lock=False):
    rows, messages, matches = prepare(user, pairs, lock=lock)
    selected = [
        (rows[str(pair["statement"])], messages[str(pair["sms"])]) for pair in pairs
    ]
    try:
        competitors = competing_pairs(user, selected)
    except (InvalidOperation, ValueError, TypeError):
        # The per-pair guarded path reports malformed historical evidence.
        competitors = {}
    recorded = recorded_sms(user, list(messages.values()))
    category_ids = set()
    grouped = defaultdict(list)
    for row in rows.values():
        grouped[row.batch_id].append(row)
    for chosen in grouped.values():
        hints = suggestions(chosen)
        for row in chosen:
            row._suggestion = hints.get(row.pk)
            category_ids.add(str(row.category_id))
            category_ids.add(str((row._suggestion or {}).get("category")))
    for pair in pairs:
        category_ids.add(str(pair.get("edits", {}).get("category")))
    sms_hints = CategorySuggestions(user.pk)
    for sms in messages.values():
        hint = sms_hints.category(sms)
        if hint:
            category_ids.add(str(hint.pk))
    category_query = Category.objects.filter(
        user=user, pk__in=[key for key in category_ids if key != "None"]
    ).order_by("pk")
    if lock:
        category_query = category_query.select_for_update()
    categories = {str(category.pk): category for category in category_query}
    row_claims = Counter(str(pair["statement"]) for pair in pairs)
    sms_claims = Counter(str(pair["sms"]) for pair in pairs)
    finals, projected_batches = {}, defaultdict(list)
    for pair in pairs:
        row_id, sms_id = str(pair["statement"]), str(pair["sms"])
        row, sms = rows[row_id], messages[sms_id]
        finals[(row_id, sms_id)] = final_values(
            row, sms, pair.get("edits", {}), categories, sms_hints
        )
        final = finals[(row_id, sms_id)][1]
        if (
            matches is not None and row_claims[row_id] == 1
            and final["description"] != row.counterparty_text
        ):
            projected = copy(row)
            projected.counterparty_text = final["description"]
            projected_batches[row.batch_id].append(projected)
    for projected in projected_batches.values():
        try:
            found, truncated = find_matches(
                projected, context_rows=projected[0]._bulk_statement_rows
            )
        except (InvalidOperation, ValueError, TypeError):
            found, truncated = {row.pk: [] for row in projected}, True
        for row in projected:
            old, old_truncated = matches[str(row.pk)]
            matches[str(row.pk)] = (old + found[row.pk], old_truncated or truncated)
    results, proofs = [], []
    for pair in pairs:
        row_id, sms_id = str(pair["statement"]), str(pair["sms"])
        row, sms = rows[row_id], messages[sms_id]
        category, final, origin = finals[(row_id, sms_id)]
        item, fingerprint = inspect_pair(
            row,
            messages[sms_id],
            matches,
            category=category,
            final=final,
            category_origin=origin,
            shared=row_claims[row_id] > 1 or sms_claims[sms_id] > 1,
            competing=competitors.get((row_id, sms_id)),
            recorded=sms_id in recorded,
        )
        row._bulk_final_category = category
        results.append(item)
        if item["ready"]:
            proofs.append(
                {"statement": row_id, "sms": sms_id, "fingerprint": fingerprint}
            )
    return results, proofs, rows, messages


def preview(*, user, pairs):
    results, proofs, rows, _ = inspect(user, pairs)
    batches = {
        row.batch_id: row.batch
        for row in rows.values()
        if ACCOUNT_WARNING in row.batch.warnings
    }
    originals = set(
        StatementOriginalFile.objects.filter(batch_id__in=batches).values_list(
            "batch_id", flat=True
        )
    )
    imports = [
        {**verification_summary(batch), "has_original_file": batch.pk in originals}
        for batch in batches.values()
    ]
    totals = defaultdict(
        lambda: {"debit": Decimal(0), "credit": Decimal(0), "transfer": Decimal(0)}
    )
    for item in results:
        if item["ready"]:
            source = item["statement"]
            totals[source["currency"]][
                "transfer" if source["type"] == "transfer" else source["direction"]
            ] += Decimal(source["amount"])
    return {
        "items": results,
        "imports": imports,
        "ready_count": len(proofs),
        "needs_review": len(results) - len(proofs),
        "totals": {
            currency: {key: str(value) for key, value in amounts.items()}
            for currency, amounts in totals.items()
        },
        "expires_at": (timezone.now() + timedelta(seconds=PREVIEW_SECONDS)).isoformat(),
        "token": (
            signing.dumps(
                {
                    "user": str(user.pk),
                    "policy": POLICY,
                    "ready": proofs,
                    "needs_review": len(results) - len(proofs),
                },
                salt=SALT,
                compress=True,
            )
            if proofs
            else None
        ),
    }


def receipt_result(receipt, *, replayed):
    return {
        "batch": str(receipt.pk),
        "approved": receipt.approved,
        "needs_review": receipt.needs_review,
        "undo_action": (
            describe(receipt.action, check=True) if receipt.action_id else None
        ),
        "replayed": replayed,
    }


@transaction.atomic
def approve(*, user, token, request_id, request, pairs=None):
    lock_transfer_user(user)
    token_digest = hashlib.sha256(token.encode()).hexdigest()
    receipt = (
        UnifiedApprovalBatch.objects.filter(user=user, request_id=request_id)
        .select_related("action")
        .first()
    )
    if receipt:
        if receipt.token_digest != token_digest:
            raise ReviewConflict(
                "This request ID was already used for a different preview."
            )
        return receipt_result(receipt, replayed=True)
    try:
        signed = signing.loads(token, salt=SALT, max_age=PREVIEW_SECONDS)
    except signing.BadSignature as error:
        raise ReviewConflict(
            "The approval preview expired or is invalid. Refresh the preview."
        ) from error
    if signed.get("user") != str(user.pk) or signed.get("policy") != POLICY:
        raise ReviewConflict(
            "This preview belongs to another user or an older approval policy."
        )
    expected = signed.get("ready", [])
    if not 1 <= len(expected) <= LIMIT:
        raise ValidationError({"token": "The preview has no eligible approval group."})
    if pairs is None:
        pairs = expected
    expected_ids = {(item["statement"], item["sms"]) for item in expected}
    supplied = {(str(item["statement"]), str(item["sms"])): item for item in pairs}
    if supplied.keys() != expected_ids or len(pairs) != len(expected):
        raise ReviewConflict(
            "The selected approval group changed. Refresh the preview."
        )
    ordered = [supplied[(item["statement"], item["sms"])] for item in expected]
    results, current, rows, messages = inspect(user, ordered, lock=True)
    if current != expected:
        raise ReviewConflict(
            "Sources, settings or matches changed. Nothing was approved. Refresh and review the preview again."
        )
    recovery = ActionRecorder(user, candidate_ids=messages, statement_ids=rows)
    try:
        written = write_ordinary_pairs(
            user=user,
            results=results,
            rows=rows,
            messages=messages,
            request=request,
        )
    except IntegrityError as error:
        raise ReviewConflict(
            "A source or entry changed. Nothing was approved. Refresh the review."
        ) from error
    approved = []
    for item in results:
        row, sms = rows[item["statement"]["id"]], messages[item["sms"]["id"]]
        if item["id"] in written:
            record, unchanged = written[item["id"]], False
        else:
            record, unchanged = confirm_pair(
                user=user,
                row=row,
                candidate=sms,
                request=request,
                statement_rows=row._bulk_statement_rows,
                checked_arithmetic=row._bulk_arithmetic,
                payload={
                    "statement_version": row.version,
                    "sms_updated_at": sms.updated_at,
                    "balance_source": item["balance_source"],
                    "acknowledge_match": True,
                    "acknowledge_conflict": False,
                    # Only the signed, financially unchanged metadata draft is acknowledged.
                    "acknowledge_issues": True,
                    "draft": {
                        "version": row.version,
                        "category": row._bulk_final_category,
                        "counterparty_text": item["final"]["description"],
                        "note": item["final"]["note"],
                    },
                    "remember_choices": False,
                },
            )
        if unchanged:
            raise ReviewConflict(
                "A source was already recorded. Nothing was approved; refresh the preview."
            )
        recovery.ids.add(str(record.pk))
        approved.append(
            {
                "statement": str(row.pk),
                "sms": str(sms.pk),
                "transaction": str(record.pk),
            }
        )
    action = recovery.finish(record, "bulk_approve")
    receipt = UnifiedApprovalBatch.objects.create(
        user=user,
        request_id=request_id,
        token_digest=token_digest,
        approved=approved,
        needs_review=signed["needs_review"],
        action=action,
    )
    return receipt_result(receipt, replayed=False)
