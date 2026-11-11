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

    def get_serializer(self, *args, **kwargs):
        if args and self.action in {"list", "retrieve"}:
            # Reuse the actual instances selected by the view. A detail request
            # must not summarize every account, and list must not fetch twice.
            accounts = [args[0]] if isinstance(args[0], Account) else list(args[0])
            kwargs.setdefault("context", self.get_serializer_context())
            kwargs["context"]["account_balance_summaries"] = calculate_account_balance_summaries(
                accounts=accounts
            )
        return super().get_serializer(*args, **kwargs)

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
