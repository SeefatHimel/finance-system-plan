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
            .select_related("account", "transfer_account", "category")
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

        return queryset

    def perform_create(self, serializer):
        serializer.save(user=self.request.user)
