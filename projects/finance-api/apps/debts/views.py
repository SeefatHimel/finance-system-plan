from django.shortcuts import get_object_or_404
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework.viewsets import ModelViewSet

from .models import Debt
from .serializers import DebtPaymentSerializer, DebtSerializer


class DebtViewSet(ModelViewSet):
    serializer_class = DebtSerializer
    permission_classes = (IsAuthenticated,)

    def get_queryset(self):
        queryset = Debt.objects.filter(user=self.request.user).select_related("opened_transaction")
        status = self.request.query_params.get("status")
        if status:
            queryset = queryset.filter(status=status)
        direction = self.request.query_params.get("direction")
        if direction:
            queryset = queryset.filter(direction=direction)
        return queryset


class DebtPaymentCreateView(APIView):
    permission_classes = (IsAuthenticated,)

    def post(self, request, debt_id):
        debt = get_object_or_404(Debt, user=request.user, id=debt_id)
        serializer = DebtPaymentSerializer(
            data=request.data,
            context={"debt": debt, "request": request},
        )
        serializer.is_valid(raise_exception=True)
        payment = serializer.save()
        return Response(DebtPaymentSerializer(payment, context={"request": request}).data, status=201)
