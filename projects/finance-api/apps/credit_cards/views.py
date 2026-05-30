from django.shortcuts import get_object_or_404
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework.viewsets import ModelViewSet

from .models import CreditCardBill
from .serializers import CreditCardBillSerializer, CreditCardPaymentSerializer


class CreditCardBillViewSet(ModelViewSet):
    serializer_class = CreditCardBillSerializer
    permission_classes = (IsAuthenticated,)

    def get_queryset(self):
        queryset = CreditCardBill.objects.filter(user=self.request.user).select_related(
            "account",
            "statement_transaction",
        )
        account = self.request.query_params.get("account")
        if account:
            queryset = queryset.filter(account=account)
        status = self.request.query_params.get("status")
        if status:
            queryset = queryset.filter(status=status)
        return queryset


class CreditCardPaymentCreateView(APIView):
    permission_classes = (IsAuthenticated,)

    def post(self, request, bill_id):
        bill = get_object_or_404(CreditCardBill, user=request.user, id=bill_id)
        serializer = CreditCardPaymentSerializer(
            data=request.data,
            context={"bill": bill, "request": request},
        )
        serializer.is_valid(raise_exception=True)
        payment = serializer.save()
        return Response(CreditCardPaymentSerializer(payment, context={"request": request}).data, status=201)
