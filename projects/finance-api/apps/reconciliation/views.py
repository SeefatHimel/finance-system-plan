from django.shortcuts import get_object_or_404
from drf_spectacular.types import OpenApiTypes
from drf_spectacular.utils import extend_schema
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework.viewsets import ModelViewSet

from apps.accounts.models import Account

from .models import BalanceSnapshot
from .proposals import apply, proposal_response, propose
from .serializers import (
    BalanceSnapshotSerializer,
    EvidenceApplySerializer,
    EvidenceProposalInputSerializer,
    EvidenceProposalSerializer,
    EvidenceReceiptSerializer,
)
from .services import calculate_expected_balance


class BalanceSnapshotViewSet(ModelViewSet):
    serializer_class = BalanceSnapshotSerializer
    permission_classes = (IsAuthenticated,)

    def get_queryset(self):
        queryset = BalanceSnapshot.objects.filter(
            user=self.request.user
        ).select_related(
            "account",
            "adjustment_transaction",
        )
        account = self.request.query_params.get("account")
        if account:
            queryset = queryset.filter(account_id=account)
        return queryset


@extend_schema(responses=OpenApiTypes.OBJECT)
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


class EvidenceNoStoreMixin:
    def finalize_response(self, request, response, *args, **kwargs):
        response = super().finalize_response(request, response, *args, **kwargs)
        response["Cache-Control"] = "no-store"
        return response


class EvidenceProposalView(EvidenceNoStoreMixin, APIView):
    permission_classes = (IsAuthenticated,)

    @extend_schema(
        request=EvidenceProposalInputSerializer,
        responses={201: EvidenceProposalSerializer},
        tags=["Reconciliation"],
    )
    def post(self, request):
        serializer = EvidenceProposalInputSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        proposal = propose(user=request.user, payload=serializer.validated_data)
        return Response(
            proposal_response(proposal),
            status=201,
            headers={"Cache-Control": "no-store"},
        )


class EvidenceApplyView(EvidenceNoStoreMixin, APIView):
    permission_classes = (IsAuthenticated,)

    @extend_schema(
        request=EvidenceApplySerializer,
        responses=EvidenceReceiptSerializer,
        tags=["Reconciliation"],
    )
    def post(self, request, proposal_id):
        serializer = EvidenceApplySerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        result = apply(
            user=request.user,
            proposal_id=proposal_id,
            payload=serializer.validated_data,
            request=request,
        )
        return Response(result, headers={"Cache-Control": "no-store"})
