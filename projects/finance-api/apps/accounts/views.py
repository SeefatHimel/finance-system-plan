from django.db import transaction
from django.db.models.deletion import ProtectedError
from rest_framework.exceptions import ValidationError
from rest_framework.permissions import IsAuthenticated
from rest_framework.viewsets import ModelViewSet

from apps.transactions.services import calculate_account_balance_summaries

from .models import Account
from .serializers import AccountSerializer


class AccountViewSet(ModelViewSet):
    serializer_class = AccountSerializer
    permission_classes = (IsAuthenticated,)

    def get_queryset(self):
        return Account.objects.filter(user=self.request.user).select_related(
            "identity_method"
        )

    def get_serializer_context(self):
        context = super().get_serializer_context()
        if self.request.user.is_authenticated and self.action in {"list", "retrieve"}:
            context["account_balance_summaries"] = calculate_account_balance_summaries(
                accounts=self.get_queryset()
            )
        return context

    def perform_create(self, serializer):
        serializer.save(user=self.request.user)

    def perform_destroy(self, instance):
        try:
            with transaction.atomic():
                # Remove only the account-managed profile. Other links retain
                # their existing protection; failure rolls this deletion back.
                if instance.identity_method_id:
                    instance.identity_method.delete()
                instance.delete()
        except ProtectedError as exc:
            raise ValidationError(
                {
                    "detail": "This account has linked records or payment methods. Remove those links before deleting it."
                }
            ) from exc
