from django.shortcuts import get_object_or_404
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework.viewsets import ModelViewSet

from apps.accounts.models import Account

from .models import BalanceSnapshot
from .serializers import BalanceSnapshotSerializer
from .services import calculate_expected_balance


class BalanceSnapshotViewSet(ModelViewSet):
    serializer_class = BalanceSnapshotSerializer
    permission_classes = (IsAuthenticated,)

    def get_queryset(self):
        queryset = BalanceSnapshot.objects.filter(user=self.request.user).select_related(
            "account",
            "adjustment_transaction",
        )
        account = self.request.query_params.get("account")
        if account:
            queryset = queryset.filter(account_id=account)
        return queryset


class AccountReconciliationView(APIView):
    permission_classes = (IsAuthenticated,)

    def get(self, request, account_id):
        account = get_object_or_404(Account, user=request.user, id=account_id)
        latest_snapshot = (
            BalanceSnapshot.objects.filter(user=request.user, account=account)
            .order_by("-checked_at", "-created_at")
            .first()
        )
        expected_balance = calculate_expected_balance(account=account)

        return Response(
            {
                "account": str(account.id),
                "account_name": account.name,
                "expected_balance": f"{expected_balance}",
                "latest_snapshot": (
                    BalanceSnapshotSerializer(
                        latest_snapshot,
                        context={"request": request},
                    ).data
                    if latest_snapshot
                    else None
                ),
            }
        )
