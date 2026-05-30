import csv

from django.http import HttpResponse
from rest_framework.decorators import action
from rest_framework.exceptions import ValidationError
from rest_framework.permissions import IsAuthenticated
from rest_framework.viewsets import ModelViewSet

from .models import Transaction
from .serializers import TransactionSerializer


class TransactionViewSet(ModelViewSet):
    serializer_class = TransactionSerializer
    permission_classes = (IsAuthenticated,)

    def get_queryset(self):
        queryset = (
            Transaction.objects.filter(user=self.request.user)
            .select_related("account", "transfer_account", "category", "payment_method", "raw_message")
        )

        month = self.request.query_params.get("month")
        if month:
            try:
                year, month_number = month.split("-", maxsplit=1)
                int(year)
                int(month_number)
            except ValueError as exc:
                raise ValidationError({"month": "Use YYYY-MM format."}) from exc
            queryset = queryset.filter(date__year=year, date__month=month_number)

        account = self.request.query_params.get("account")
        if account:
            queryset = queryset.filter(account_id=account)

        category = self.request.query_params.get("category")
        if category:
            queryset = queryset.filter(category_id=category)

        transaction_type = self.request.query_params.get("type")
        if transaction_type:
            queryset = queryset.filter(type=transaction_type)

        direction = self.request.query_params.get("direction")
        if direction:
            queryset = queryset.filter(direction=direction)

        return queryset

    def perform_create(self, serializer):
        serializer.save(user=self.request.user)

    @action(detail=False, methods=("get",), url_path="export")
    def export(self, request):
        response = HttpResponse(content_type="text/csv")
        response["Content-Disposition"] = 'attachment; filename="transactions.csv"'
        writer = csv.writer(response)
        writer.writerow(
            [
                "id",
                "date",
                "type",
                "direction",
                "amount",
                "account_id",
                "account_name",
                "transfer_account_id",
                "transfer_account_name",
                "category_id",
                "category_name",
                "payment_method_id",
                "payment_method_name",
                "balance_after",
                "reference",
                "counterparty_text",
                "external_key",
                "source",
                "needs_review",
                "note",
                "raw_message_id",
                "created_at",
                "updated_at",
            ]
        )

        for transaction in self.get_queryset().order_by("date", "created_at", "id"):
            writer.writerow(
                [
                    transaction.id,
                    transaction.date,
                    transaction.type,
                    transaction.direction,
                    transaction.amount,
                    transaction.account_id,
                    transaction.account.name,
                    transaction.transfer_account_id or "",
                    transaction.transfer_account.name if transaction.transfer_account else "",
                    transaction.category_id or "",
                    transaction.category.name if transaction.category else "",
                    transaction.payment_method_id or "",
                    transaction.payment_method.name if transaction.payment_method else "",
                    transaction.balance_after or "",
                    transaction.reference,
                    transaction.counterparty_text,
                    transaction.external_key,
                    transaction.source,
                    transaction.needs_review,
                    transaction.note,
                    transaction.raw_message_id or "",
                    transaction.created_at.isoformat(),
                    transaction.updated_at.isoformat(),
                ]
            )

        return response
