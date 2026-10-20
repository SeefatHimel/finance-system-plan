"""Bounded, resumable preview scan and atomic groups of reviewed corrections."""

from uuid import uuid4

from django.core import signing
from django.db import transaction
from django.db.models import Exists, OuterRef, Prefetch, Q
from django.utils import timezone
from django.utils.dateparse import parse_datetime
from rest_framework.exceptions import NotFound, ValidationError

from apps.credit_cards.models import CreditCardBill, CreditCardPayment
from apps.debts.models import Debt, DebtPayment
from apps.messages.models import ParsedMessageCandidate
from apps.recurring_bills.models import RecurringBillPayment
from apps.statements.models import StatementRow
from apps.statements.rounding import mark_fee_rows
from apps.statements.services import ReviewConflict

from . import revalidation
from .models import Transaction, TransferEvidence
from .recovery import ActionRecorder, describe
from .transfers import lock_transfer_user

PAGE_SIZE = 20
APPLY_LIMIT = 25
CURSOR_SALT = "transactions.bulk-revalidation-scan"
SCAN_SECONDS = 3600


def _sources(queryset, user):
    """Per-parent slices use window functions, avoiding an unbounded relation load."""
    cap = revalidation.MAX_SOURCES + 1
    return (
        queryset.select_related(
            "user", "account", "transfer_account", "category", "raw_message"
        )
        .annotate(
            revalidation_has_dependencies=(
                Exists(Debt.objects.filter(opened_transaction_id=OuterRef("pk")))
                | Exists(DebtPayment.objects.filter(transaction_id=OuterRef("pk")))
                | Exists(
                    CreditCardBill.objects.filter(
                        statement_transaction_id=OuterRef("pk")
                    )
                )
                | Exists(
                    CreditCardPayment.objects.filter(transaction_id=OuterRef("pk"))
                )
                | Exists(
                    RecurringBillPayment.objects.filter(transaction_id=OuterRef("pk"))
                )
            )
        )
        .prefetch_related(
            Prefetch(
                "parsed_message_candidates",
                to_attr="revalidation_candidates",
                queryset=ParsedMessageCandidate.objects.filter(
                    user=user,
                    status="confirmed",
                )
                .select_related("raw_message", "account", "destination_account")
                .order_by("pk")[:cap],
            ),
            Prefetch(
                "statement_rows",
                to_attr="revalidation_rows",
                queryset=StatementRow.objects.filter(
                    batch__user=user,
                    state__in=("posted", "linked"),
                )
                .select_related("batch__account")
                .order_by("pk")[:cap],
            ),
            Prefetch(
                "transfer_evidence",
                to_attr="revalidation_evidence",
                queryset=TransferEvidence.objects.filter(
                    user=user,
                )
                .select_related("account", "raw_message")
                .order_by("date", "time", "created_at")[:cap],
            ),
        )
    )


def scan_page(*, user, limit=PAGE_SIZE, cursor=""):
    now = timezone.now()
    if cursor:
        try:
            state = signing.loads(cursor, salt=CURSOR_SALT, max_age=SCAN_SECONDS)
        except signing.BadSignature as error:
            raise ReviewConflict(
                "The scan cursor expired or is invalid. Start a new scan."
            ) from error
        if state["user"] != str(user.pk):
            raise ValidationError({"cursor": "This scan belongs to another user."})
        if (
            state["policy"] != revalidation.POLICY_VERSION
            or (now - parse_datetime(state["started_at"])).total_seconds()
            > SCAN_SECONDS
        ):
            raise ReviewConflict(
                "The scan policy changed or the scan expired. Start a new scan."
            )
    else:
        state = {
            "user": str(user.pk),
            "policy": revalidation.POLICY_VERSION,
            "started_at": now.isoformat(),
            "scanned": 0,
            "last_created": None,
            "last_id": None,
        }
    records = Transaction.objects.filter(
        user=user, created_at__lte=parse_datetime(state["started_at"])
    )
    if not cursor:
        state["total"] = records.count()
    if state["last_id"]:
        records = records.filter(
            Q(created_at__gt=state["last_created"])
            | Q(created_at=state["last_created"], pk__gt=state["last_id"])
        )
    records = list(_sources(records.order_by("created_at", "id"), user)[: limit + 1])
    more = len(records) > limit
    records = records[:limit]
    mark_fee_rows([row for record in records for row in record.revalidation_rows])
    results = []
    for record in records:
        value = revalidation.preview(
            record,
            prepared=(
                record.revalidation_candidates,
                record.revalidation_rows,
                record.revalidation_evidence,
            ),
        )
        # Clean entries contribute to progress without filling the review screen.
        if value["suggestions"] or value["warnings"]:
            results.append(
                {
                    "date": record.date,
                    "account_name": record.account.name,
                    "amount": str(record.amount),
                    "description": record.counterparty_text
                    or record.note[:160]
                    or record.type,
                    "preview": value,
                }
            )
    state["scanned"] += len(records)
    if records:
        state["last_created"] = records[-1].created_at.isoformat()
        state["last_id"] = str(records[-1].pk)
    return {
        "scanned": state["scanned"],
        "total": state["total"],
        "started_at": state["started_at"],
        "next_cursor": signing.dumps(state, salt=CURSOR_SALT, compress=True)
        if more
        else None,
        "results": results,
    }


@transaction.atomic
def apply_group(*, user, items, request):
    if not 1 <= len(items) <= APPLY_LIMIT:
        raise ValidationError(
            {"items": f"Select between 1 and {APPLY_LIMIT} transactions."}
        )
    ids = [item["transaction"] for item in items]
    if len(ids) != len(set(ids)):
        raise ValidationError({"items": "Select each transaction only once per group."})
    lock_transfer_user(user)
    owned = list(
        Transaction.objects.select_for_update(of=("self",))
        .filter(user=user, pk__in=ids)
        .order_by("pk")
    )
    if len(owned) != len(ids):
        raise NotFound("One or more selected transactions are no longer available.")
    decisions = []
    for item in items:
        try:
            decisions.append(
                (
                    item,
                    revalidation._reviewed_decision(
                        user=user,
                        record_id=item["transaction"],
                        token=item["token"],
                        selected=item["selected"],
                    ),
                )
            )
        except (ReviewConflict, ValidationError) as error:
            # Escaping the outer atomic block rolls back earlier entries too.
            raise type(error)(
                {
                    "transaction": str(item["transaction"]),
                    "detail": error.detail,
                    "group": "No corrections in this group were applied. Refresh its previews and review again.",
                }
            ) from error
    # Avoid expensive recovery snapshots until all bounded source checks succeed.
    recovery = ActionRecorder(user, transaction_ids=ids)
    batch_id = uuid4()
    applied = []
    for item, (record, choices, fingerprint) in decisions:
        record = revalidation._write_corrections(
            user=user,
            record=record,
            choices=choices,
            selected=item["selected"],
            request=request,
            fingerprint=fingerprint,
            record_recovery=False,
            batch_id=batch_id,
        )
        applied.append(str(record.pk))
    action = recovery.finish(record, "bulk_revalidate")
    return {
        "applied": applied,
        "batch": str(batch_id),
        "undo_action": describe(action) if action else None,
    }
