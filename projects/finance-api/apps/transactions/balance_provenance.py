"""Small, saved-source observations for balance badges; no parser runs or writes."""
from datetime import date, time
from decimal import Decimal, InvalidOperation
from django.utils import timezone
from apps.messages.models import ParsedMessageCandidate
from apps.statements.models import StatementRow

LIMIT = 20


def sms_queryset(user):
    return ParsedMessageCandidate.objects.filter(user=user, status='confirmed', raw_message__user=user).select_related('account', 'destination_account', 'raw_message').defer('raw_message__body').order_by('pk')


def statement_queryset(user):
    return StatementRow.objects.filter(batch__user=user, state__in=['posted', 'linked']).select_related('batch__account').order_by('pk')


def safe_date(value):
    try:
        return date.fromisoformat(str(value)).isoformat()
    except (ValueError, TypeError):
        return None


def safe_time(value):
    try:
        return time.fromisoformat(str(value)).replace(tzinfo=None).isoformat()
    except (ValueError, TypeError):
        return None


def safe_money(value):
    try:
        number = Decimal(str(value))
        return str(number) if number.is_finite() and number == number.quantize(Decimal('.01')) else None
    except (InvalidOperation, ValueError, TypeError):
        return None


def source_balances(record, *, use_prefetched=True):
    from .transfers import sms_reporting_account
    sms = getattr(record, 'balance_sms_sources', None) if use_prefetched else None
    rows = getattr(record, 'balance_statement_sources', None) if use_prefetched else None
    if sms is None:
        sms = list(sms_queryset(record.user_id).filter(transaction=record)[:LIMIT + 1])
    if rows is None:
        rows = list(statement_queryset(record.user_id).filter(transaction=record)[:LIMIT + 1])
    observations = []
    endpoints = {record.account_id, record.transfer_account_id}

    def append(kind, account, balance, direction, day, clock, time_kind, currency=None):
        owned = account is not None and account.user_id == record.user_id
        source_currency = currency if currency is not None else account.currency if owned else ''
        observations.append({
            'kind': kind, 'account': str(account.pk) if owned else None,
            'balance_after': safe_money(balance), 'currency': source_currency if owned else '',
            'direction': direction or '', 'date': safe_date(day), 'time': safe_time(clock), 'time_kind': time_kind,
            'usable': bool(owned and account.pk in endpoints and source_currency == record.account.currency and direction in {'credit', 'debit'}),
        })

    for item in sms[:LIMIT]:
        if item.user_id != record.user_id or item.raw_message.user_id != record.user_id:
            continue
        received = timezone.localtime(item.raw_message.received_at)
        append('sms', sms_reporting_account(item), item.balance_after, item.source_direction, received.date(), received.time(), 'received')
    for row in rows[:LIMIT]:
        if row.batch.user_id != record.user_id:
            continue
        original = row.extracted
        direction = row.reviewed_source_direction or original.get('direction')
        if row.component == 'fee':
            fee = safe_money(original.get('signed_fee'))
            direction = 'credit' if fee is not None and Decimal(fee) > 0 else 'debit' if fee is not None and Decimal(fee) < 0 else ''
        append('statement', row.batch.account, original.get('balance_after'), direction, original.get('posting_date') or original.get('date'), original.get('time'), 'reported', row.batch.currency)
    return {'observations': observations, 'complete': len(sms) <= LIMIT and len(rows) <= LIMIT}
