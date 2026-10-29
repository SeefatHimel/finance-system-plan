"""Atomic, explicit payment-to-ledger links shared by planning workflows."""

from django.db import IntegrityError, transaction
from rest_framework import serializers

from apps.accounts.models import Account
from .models import Transaction


class LedgerPaymentSerializer(serializers.ModelSerializer):
    ledger_action = serializers.ChoiceField(choices=("record_only", "link", "create"), required=False, write_only=True)
    funding_account = serializers.PrimaryKeyRelatedField(queryset=Account.objects.none(), required=False, write_only=True)
    request_id = serializers.UUIDField(required=False, write_only=True)

    def get_fields(self):
        fields = super().get_fields()
        request = self.context.get("request")
        fields["funding_account"].queryset = Account.objects.filter(user=request.user, is_active=True) if request and request.user.is_authenticated else Account.objects.none()
        return fields


PAYMENT_FIELDS = ("ledger_action", "funding_account", "request_id")


def payment_models():
    from apps.debts.models import DebtPayment
    from apps.credit_cards.models import CreditCardPayment
    from apps.recurring_bills.models import RecurringBillPayment
    return (DebtPayment, CreditCardPayment, RecurringBillPayment)


def has_payments(record):
    return any(model.objects.filter(transaction=record).exists() for model in payment_models())


@transaction.atomic
def record_payment(serializer, data, kind):
    from apps.debts.models import Debt, DebtPayment
    from apps.credit_cards.models import CreditCardBill, CreditCardPayment
    from apps.recurring_bills.models import RecurringBill, RecurringBillPayment
    from .serializers import TransactionSerializer

    model, payment_model, parent_field, context_field = {
        "debt": (Debt, DebtPayment, "debt", "debt"),
        "card": (CreditCardBill, CreditCardPayment, "bill", "bill"),
        "recurring": (RecurringBill, RecurringBillPayment, "bill", "bill"),
    }[kind]
    user = serializer.context["request"].user
    from .transfers import lock_transfer_user
    lock_transfer_user(user)
    parent = model.objects.select_for_update().get(pk=serializer.context[context_field].pk, user=user)
    action = data.pop("ledger_action", "link" if data.get("transaction") else "record_only")
    funding = data.pop("funding_account", None)
    request_id = data.pop("request_id", None)
    linked = data.pop("transaction", None)
    if kind == "recurring" and action == "create":
        funding = parent.account
    if request_id:
        previous = payment_model.objects.filter(pk=request_id, user=user, **{parent_field: parent}).first()
        if previous:
            previous_action = "record_only" if not previous.transaction_id else "create" if previous.transaction.external_key == f"payment:{kind}:{request_id}" else "link"
            same = action == previous_action and previous.amount == data["amount"] and previous.paid_at == data["paid_at"] and previous.note == data.get("note", "")
            if action == "link":
                same = same and previous.transaction_id == getattr(linked, "pk", None)
            elif action == "create":
                same = same and previous.transaction_id is not None and funding is not None and previous.transaction.account_id == funding.pk
            else:
                same = same and previous.transaction_id is None
            if not same:
                raise serializers.ValidationError({"request_id": "This request was already used for a different payment."})
            return previous
        if payment_model.objects.filter(pk=request_id).exists():
            raise serializers.ValidationError({"request_id": "Use a new payment request."})
    amount = data["amount"]
    if kind == "debt" and parent.status == "written_off":
        raise serializers.ValidationError({"debt": "Reopen a written-off debt before recording a payment."})
    remaining = parent.current_balance if kind == "debt" else parent.remaining_balance if kind == "card" else None
    if remaining is not None and amount > remaining:
        raise serializers.ValidationError({"amount": "Payment exceeds the remaining balance. Refresh the record."})
    if kind == "recurring" and parent.status != "active":
        raise serializers.ValidationError({"bill": "Only active bills can record a payment."})
    expected_type = "repayment_received" if kind == "debt" and parent.direction == "lent_by_me" else "repayment_paid" if kind == "debt" else "transfer" if kind == "card" else "expense"
    if action == "record_only" and linked:
        raise serializers.ValidationError({"ledger_action": "Choose Link to use an existing transaction."})
    if action == "link":
        if not linked:
            raise serializers.ValidationError({"transaction": "Choose the existing payment transaction."})
        linked = Transaction.objects.select_for_update().get(pk=linked.pk, user=user)
        if kind == "debt" and linked.account.currency != "BDT":
            raise serializers.ValidationError({"transaction": "Debt records currently use BDT. Choose a BDT movement."})
        if has_payments(linked):
            raise serializers.ValidationError({"transaction": "This transaction is already linked to a payment. Unlink it before using it again."})
        if linked.type != expected_type or linked.amount != amount or linked.date != data["paid_at"]:
            raise serializers.ValidationError({"transaction": f"Choose a {expected_type.replace('_', ' ')} with the same amount and payment date."})
        if kind == "card" and linked.transfer_account_id != parent.account_id:
            raise serializers.ValidationError({"transaction": "The transfer must pay this card account."})
        if kind == "recurring" and linked.account_id != parent.account_id:
            raise serializers.ValidationError({"transaction": "The payment must use this bill's account."})
    elif action == "create":
        if not request_id:
            raise serializers.ValidationError({"request_id": "A request ID is required to safely record a new payment."})
        if linked:
            raise serializers.ValidationError({"transaction": "Choose either an existing transaction or a new one."})
        if kind == "recurring":
            funding = parent.account
        if funding is None:
            raise serializers.ValidationError({"funding_account": "Choose the account where the money moved."})
        if not funding.is_active:
            raise serializers.ValidationError({"funding_account": "Choose an active account."})
        if kind == "debt" and funding.currency != "BDT":
            raise serializers.ValidationError({"funding_account": "Debt records currently use BDT. Choose a BDT account."})
        draft = {"account": str(funding.pk), "amount": str(amount), "date": str(data["paid_at"]), "time": None,
                 "type": expected_type, "direction": Transaction.default_direction_for_type(expected_type), "source": "web",
                 "note": data.get("note", ""), "external_key": f"payment:{kind}:{request_id}",
                 "counterparty_text": parent.counterparty_name if kind == "debt" else parent.name if kind == "recurring" else f"Payment to {parent.account.name}"}
        if kind == "card":
            if funding.pk == parent.account_id or funding.currency != parent.account.currency:
                raise serializers.ValidationError({"funding_account": "Choose a different account in the card currency."})
            draft["transfer_account"] = str(parent.account_id)
        if kind == "recurring" and parent.category_id:
            draft["category"] = str(parent.category_id)
        entry = TransactionSerializer(data=draft, context=serializer.context)
        entry.is_valid(raise_exception=True)
        linked = entry.save(user=user)
        from apps.audit_logs.models import AuditLogEntry
        from apps.audit_logs.services import create_audit_log, transaction_snapshot
        create_audit_log(user=user, action=AuditLogEntry.Action.CREATED, entity=linked, after=transaction_snapshot(linked), metadata={"payment_kind": kind})
    kwargs = {"user": user, parent_field: parent, "transaction": linked, **data}
    if request_id:
        kwargs["id"] = request_id
    if kind == "recurring":
        kwargs["due_date"] = parent.next_due_date
    try:
        with transaction.atomic():
            payment = payment_model.objects.create(**kwargs)
    except IntegrityError as exc:
        raise serializers.ValidationError({"request_id": "This request ID has already been used. Refresh the payment history."}) from exc
    if kind == "debt":
        parent.current_balance -= amount
        parent.status = "paid" if parent.current_balance == 0 else "partially_paid"
        parent.save(update_fields=("current_balance", "status", "updated_at"))
    elif kind == "card":
        parent.paid_amount += amount
        parent.remaining_balance -= amount
        parent.status = "paid" if parent.remaining_balance == 0 else "partially_paid"
        parent.save(update_fields=("paid_amount", "remaining_balance", "status", "updated_at"))
    else:
        parent.next_due_date = parent.following_due_date()
        parent.save(update_fields=("next_due_date", "updated_at"))
    from apps.audit_logs.models import AuditLogEntry
    from apps.audit_logs.services import create_audit_log
    create_audit_log(user=user, action=AuditLogEntry.Action.CREATED, entity=payment, after={"amount": str(amount), "paid_at": str(payment.paid_at), "transaction": str(linked.pk) if linked else None}, metadata={"ledger_action": action})
    return payment
