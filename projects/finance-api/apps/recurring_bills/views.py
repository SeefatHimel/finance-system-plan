from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework.viewsets import ModelViewSet

from .models import RecurringBill
from .serializers import RecurringBillPaymentSerializer, RecurringBillSerializer


class RecurringBillViewSet(ModelViewSet):
    serializer_class = RecurringBillSerializer
    permission_classes = (IsAuthenticated,)

    def get_queryset(self):
        queryset = RecurringBill.objects.filter(user=self.request.user).select_related("account", "category")
        status = self.request.query_params.get("status")
        if status:
            queryset = queryset.filter(status=status)
        account = self.request.query_params.get("account")
        if account:
            queryset = queryset.filter(account=account)
        due = self.request.query_params.get("due")
        if due == "overdue":
            queryset = queryset.filter(status=RecurringBill.Status.ACTIVE, next_due_date__lt=timezone.localdate())
        elif due == "upcoming":
            queryset = queryset.filter(status=RecurringBill.Status.ACTIVE, next_due_date__gte=timezone.localdate())
        return queryset


class RecurringBillPaymentCreateView(APIView):
    permission_classes = (IsAuthenticated,)

    def post(self, request, bill_id):
        bill = get_object_or_404(RecurringBill, user=request.user, id=bill_id)
        serializer = RecurringBillPaymentSerializer(
            data=request.data,
            context={"bill": bill, "request": request},
        )
        serializer.is_valid(raise_exception=True)
        payment = serializer.save()
        return Response(RecurringBillPaymentSerializer(payment, context={"request": request}).data, status=201)
