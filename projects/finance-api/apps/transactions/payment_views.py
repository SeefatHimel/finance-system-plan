from datetime import date

from django.db import transaction
from django.shortcuts import get_object_or_404
from rest_framework.exceptions import NotFound, ValidationError
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView
from drf_spectacular.utils import extend_schema
from drf_spectacular.types import OpenApiTypes

from .models import Transaction
from .serializers import TransactionSerializer


def payment_context(kind):
    from apps.debts.models import Debt, DebtPayment
    from apps.credit_cards.models import CreditCardBill, CreditCardPayment
    from apps.recurring_bills.models import RecurringBill, RecurringBillPayment
    try:
        return {"debt": (Debt, DebtPayment, "debt"), "card": (CreditCardBill, CreditCardPayment, "bill"), "recurring": (RecurringBill, RecurringBillPayment, "bill")}[kind]
    except KeyError as exc:
        raise NotFound() from exc


class PlanningPaymentView(APIView):
    permission_classes = (IsAuthenticated,)

    @extend_schema(responses=OpenApiTypes.OBJECT)
    def get(self, request, kind, parent_id):
        model, payment_model, field = payment_context(kind)
        parent = get_object_or_404(model, pk=parent_id, user=request.user)
        payments = payment_model.objects.filter(user=request.user, **{field: parent}).order_by("-paid_at", "-created_at")
        eligible = Transaction.objects.filter(user=request.user, debt_payments__isnull=True, credit_card_payments__isnull=True, recurring_bill_payments__isnull=True)
        if kind == "debt":
            eligible = eligible.filter(type="repayment_received" if parent.direction == "lent_by_me" else "repayment_paid")
        elif kind == "card":
            eligible = eligible.filter(type="transfer", transfer_account=parent.account)
        else:
            eligible = eligible.filter(type="expense", account=parent.account)
        if kind == "debt":
            eligible = eligible.filter(account__currency="BDT")
        if request.query_params.get("date"):
            try:
                paid_date = date.fromisoformat(request.query_params["date"])
            except ValueError as exc:
                raise ValidationError({"date": "Use a valid YYYY-MM-DD payment date."}) from exc
            eligible = eligible.filter(date=paid_date)
        count = eligible.count()
        from django.db.models import Count
        eligible = eligible.annotate(statement_count=Count("statement_rows", distinct=True)).select_related("account", "transfer_account", "category", "payment_method", "raw_message").prefetch_related("transfer_evidence").order_by("-date", "-created_at")[:100]
        return Response({"payments": [{"id": str(row.pk), "transaction": str(row.transaction_id) if row.transaction_id else None, "amount": f"{row.amount:.2f}", "paid_at": row.paid_at.isoformat(), "note": row.note} for row in payments], "eligible": TransactionSerializer(eligible, many=True, context={"request": request}).data, "eligible_count": count}, headers={"Cache-Control": "private, no-store"})

    @transaction.atomic
    @extend_schema(responses=OpenApiTypes.OBJECT)
    def delete(self, request, kind, parent_id, payment_id=None):
        if payment_id is None:
            raise NotFound()
        from .transfers import lock_transfer_user
        lock_transfer_user(request.user)
        model, payment_model, field = payment_context(kind)
        parent = get_object_or_404(model.objects.select_for_update(), pk=parent_id, user=request.user)
        payment = get_object_or_404(payment_model.objects.select_for_update(), pk=payment_id, user=request.user, **{field: parent})
        if kind == "debt":
            parent.current_balance += payment.amount
            parent.status = "open" if parent.current_balance == parent.principal_amount else "partially_paid"
            parent.save(update_fields=("current_balance", "status", "updated_at"))
        elif kind == "card":
            parent.paid_amount -= payment.amount
            parent.remaining_balance += payment.amount
            parent.status = "unpaid" if parent.paid_amount == 0 else "partially_paid"
            parent.save(update_fields=("paid_amount", "remaining_balance", "status", "updated_at"))
        else:
            latest = payment_model.objects.filter(**{field: parent}).order_by("-due_date", "-created_at").first()
            if latest.pk != payment.pk:
                raise ValidationError({"payment": "Unlink the latest recurring payment first so the schedule remains correct."})
            due_after = parent.next_due_date
            parent.next_due_date = payment.due_date
            if parent.following_due_date() != due_after:
                raise ValidationError({"payment": "The schedule changed since this payment. Review its due date before removing the latest payment record."})
            parent.next_due_date = payment.due_date
            parent.save(update_fields=("next_due_date", "updated_at"))
        # Keep the financial movement. The user can correct and relink it.
        from apps.audit_logs.models import AuditLogEntry
        from apps.audit_logs.services import create_audit_log
        create_audit_log(user=request.user, action=AuditLogEntry.Action.DELETED, entity=payment, before={"amount": str(payment.amount), "paid_at": str(payment.paid_at), "transaction": str(payment.transaction_id) if payment.transaction_id else None}, metadata={"ledger_transaction_kept": True})
        payment.delete()
        return Response({"detail": "Payment link removed. The ledger transaction was kept."})


class PlanningPaymentListView(PlanningPaymentView):
    http_method_names = ("get", "head", "options")


class PlanningPaymentDetailView(PlanningPaymentView):
    http_method_names = ("delete", "options")
