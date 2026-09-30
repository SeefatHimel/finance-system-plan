from rest_framework.permissions import IsAuthenticated
from rest_framework.viewsets import ModelViewSet

from apps.transactions.services import calculate_account_balance_summaries

from .models import Account
from .serializers import AccountSerializer


class AccountViewSet(ModelViewSet):
    serializer_class = AccountSerializer
    permission_classes = (IsAuthenticated,)

    def get_queryset(self):
        return Account.objects.filter(user=self.request.user)

    def get_serializer_context(self):
        context = super().get_serializer_context()
        if self.request.user.is_authenticated and self.action in {"list", "retrieve"}:
            context["account_balance_summaries"] = calculate_account_balance_summaries(
                accounts=self.get_queryset()
            )
        return context

    def perform_create(self, serializer):
        serializer.save(user=self.request.user)
