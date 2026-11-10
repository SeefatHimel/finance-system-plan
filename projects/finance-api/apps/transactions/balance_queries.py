"""Aggregate money in SQL; materialize only the latest selected reports per account."""

from datetime import time, timedelta
from decimal import Decimal
from django.db.models import (
    Case,
    When,
    Value,
    F,
    Q,
    Sum,
    DecimalField,
    Exists,
    OuterRef,
    Subquery,
    Window,
    BooleanField,
)
from django.db.models.functions import Coalesce, RowNumber
from .models import Transaction, TransferEvidence

from .policy import CREDIT_TYPES as CREDITS, DEBIT_TYPES

DEBITS = DEBIT_TYPES | {"transfer"}
MONEY = DecimalField(max_digits=20, decimal_places=2)


def ledger_totals(accounts, as_of_date=None, cutoffs=None, row_filter=None):
    accounts = list(accounts)
    if not accounts:
        return {}
    ids = [account.pk for account in accounts]
    rows = Transaction.objects.filter(
        user_id__in={account.user_id for account in accounts}
    ).order_by()
    if row_filter is not None:
        rows = rows.filter(row_filter)
    if as_of_date is not None:
        rows = rows.filter(date__lte=as_of_date)
    if cutoffs is not None:
        rows = rows.alias(clock=Coalesce("time", Value(time.min)))

    def scoped(field):
        if cutoffs is None:
            return rows.filter(**{field + "__in": ids})
        condition = Q(pk__in=[])
        for account, (day, clock, created) in cutoffs.items():
            before = Q(date__lt=day) | (
                Q(date=day)
                & (Q(clock__lt=clock) | Q(clock=clock, created_at__lte=created))
            )
            condition |= Q(**{field: account}) & before
        return rows.filter(condition)

    delta = Case(
        When(
            Q(type__in=CREDITS) | Q(type="adjustment", direction="credit"),
            then=F("amount"),
        ),
        When(
            Q(type__in=DEBITS) | Q(type="adjustment", direction="debit"),
            then=-F("amount"),
        ),
        default=Value(Decimal("0")),
        output_field=MONEY,
    )
    result = {account.pk: Decimal(account.starting_balance) for account in accounts}
    sending = scoped("account_id").values("account_id").annotate(value=Sum(delta))
    receiving = (
        scoped("transfer_account_id")
        .filter(type="transfer")
        .values("transfer_account_id")
        .annotate(value=Sum("amount"))
    )
    # One statement gives both sides the same snapshot, including when called
    # inside a writer's existing READ COMMITTED transaction. Keep UNION ALL:
    # equal amounts on the two sides are independent contributions, not duplicates.
    for row in sending.union(receiving, all=True):
        result[row["account_id"]] += row["value"]
    return result


def latest_reports(accounts, as_of_date=None):
    ids = [account.pk for account in accounts]
    users = {account.user_id for account in accounts}
    records = Transaction.objects.filter(user_id__in=users).filter(
        Q(account_id__in=ids) | Q(type="transfer", transfer_account_id__in=ids)
    )
    if as_of_date is not None:
        records = records.filter(date__lte=as_of_date)
    captured = (
        Q(raw_message__isnull=False)
        | Q(source__in=("sms", "import"))
        | Q(external_key__startswith="statement-row:")
    )
    compatible = (
        Q(account_id=F("transaction__account_id")) & (~captured | Q(direction="debit"))
    ) | (
        Q(account_id=F("transaction__transfer_account_id"))
        & (~captured | Q(direction="credit"))
    )
    evidence = TransferEvidence.objects.filter(
        user_id__in=users, transaction__in=records, transaction__type="transfer"
    ).filter(compatible)
    if as_of_date is not None:
        evidence = evidence.filter(date__lte=as_of_date)
    raw_match = Q(
        raw_message__isnull=False, raw_message_id=F("transaction__raw_message_id")
    )
    key_match = ~Q(external_key="") & Q(external_key=F("transaction__external_key"))
    primary = (
        evidence.filter(transaction_id=OuterRef("transaction_id"))
        .filter(~Q(external_key__startswith="balance:") | raw_match | key_match)
        .annotate(
            priority=Case(
                When(raw_match, then=Value(0)),
                When(key_match, then=Value(1)),
                default=Value(2),
            ),
            match_date=Case(
                When(raw_match | key_match, then=F("date")), default=Value(None)
            ),
            match_time=Case(
                When(raw_match | key_match, then=F("time")), default=Value(None)
            ),
        )
        .order_by("priority", "match_date", "match_time", "created_at", "pk")
        .values("pk")[:1]
    )
    # Find the selected observation inside one movement first. In particular, an
    # explicitly reviewed blank wins over older source balances for that movement.
    selected = (
        evidence.filter(
            transaction_id=OuterRef("transaction_id"), account_id=OuterRef("account_id")
        )
        .annotate(
            primary=Case(When(pk=Subquery(primary), then=Value(1)), default=Value(0))
        )
        .order_by(
            "-is_effective_balance",
            "-primary",
            "-date",
            F("time").desc(nulls_first=True),
            "-created_at",
            "-pk",
        )
        .values("pk")[:1]
    )
    latest_order = ("-date", F("time").desc(nulls_last=True), "-created_at", "-pk")
    latest_evidence_id = (
        evidence.filter(account_id=OuterRef("pk"), balance_after__isnull=False)
        # Keep this a Boolean predicate: estimating UUID = correlated subquery
        # as a near-unique lookup leads PostgreSQL to sort every report instead
        # of taking the ordered index's first eligible observation.
        .filter(
            Case(
                When(pk=Subquery(selected), then=Value(True)),
                default=Value(False),
                output_field=BooleanField(),
            )
        )
        .order_by(*latest_order)
        .values("pk")[:1]
    )
    scalar_id = (
        records.filter(account_id=OuterRef("pk"), balance_after__isnull=False)
        .alias(
            has_evidence=Exists(
                TransferEvidence.objects.filter(
                    transaction_id=OuterRef("pk"), transaction__type="transfer"
                )
            )
        )
        .filter(has_evidence=False)
        .order_by(*latest_order)
        .values("pk")[:1]
    )
    from apps.accounts.models import Account

    # PostgreSQL can stop at the first eligible report in each ordered account
    # index, instead of ranking the account's entire transaction history.
    choices = list(
        Account.objects.filter(pk__in=ids)
        .order_by()
        .annotate(
            scalar_id=Subquery(scalar_id),
            evidence_id=Subquery(latest_evidence_id),
        )
        .values_list("scalar_id", "evidence_id")
    )
    scalar = Transaction.objects.filter(pk__in=[pk for pk, _ in choices if pk])
    latest_evidence = TransferEvidence.objects.filter(
        pk__in=[pk for _, pk in choices if pk]
    ).select_related("transaction")
    reports = {}

    def add(account, value, day, clock, created, source, posting=False):
        order = (day, clock or time.min, created)
        if account not in reports or order >= reports[account][0]:
            reports[account] = (order, value, source, posting, clock)

    for record in scalar:
        add(
            record.account_id,
            record.balance_after,
            record.date,
            record.time,
            record.created_at,
            record,
        )
    for item in latest_evidence:
        add(
            item.account_id,
            item.balance_after,
            item.date,
            item.time,
            item.created_at,
            item.transaction,
        )
    from apps.statements.models import StatementRow

    delayed = StatementRow.objects.filter(
        batch__profile="ebl_bank",
        batch__account_id__in=ids,
        state="linked",
        transaction__in=records,
        transaction__source="sms",
        balance_after__isnull=False,
        date__gte=F("transaction__date") + timedelta(days=2),
        value_date__gte=F("transaction__date") - timedelta(days=1),
        value_date__lte=F("transaction__date") + timedelta(days=1),
    )
    if as_of_date is not None:
        delayed = delayed.filter(date__lte=as_of_date)
    delayed = (
        delayed.annotate(
            latest=Window(
                RowNumber(),
                partition_by=[F("batch__account_id")],
                order_by=[
                    F("date").desc(),
                    F("time").desc(nulls_last=True),
                    F("created_at").desc(),
                    F("pk").desc(),
                ],
            )
        )
        .filter(latest=1)
        .select_related("batch")
        .order_by()
    )
    for row in delayed:
        add(
            row.batch.account_id,
            row.balance_after,
            row.date,
            row.time,
            row.created_at,
            row,
            True,
        )
    return records, reports


def ambiguous_report_accounts(records, reports):
    """Batch same-day timing checks; return account IDs, never ledger history."""
    sending = Q(pk__in=[])
    receiving = Q(pk__in=[])
    for account, (cutoff, _value, source, _posting, report_time) in reports.items():
        condition = Q(date=cutoff[0]) & ~Q(pk=source.pk)
        if report_time is not None:
            condition &= Q(time__isnull=True) | Q(time=report_time)
        sending |= Q(account_id=account) & condition
        receiving |= Q(type="transfer", transfer_account_id=account) & condition
    if not reports:
        return set()
    records = records.order_by()
    return set(
        records.filter(sending).values_list("account_id", flat=True).distinct()
    ) | set(
        records.filter(receiving)
        .values_list("transfer_account_id", flat=True)
        .distinct()
    )
