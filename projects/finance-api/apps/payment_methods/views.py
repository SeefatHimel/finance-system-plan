from rest_framework.permissions import IsAuthenticated
from rest_framework.viewsets import ModelViewSet

from .models import PaymentMethod
from .serializers import PaymentMethodSerializer


class PaymentMethodViewSet(ModelViewSet):
    serializer_class = PaymentMethodSerializer
    permission_classes = (IsAuthenticated,)

    def get_queryset(self):
        return PaymentMethod.objects.filter(user=self.request.user).select_related("account")

    def perform_create(self, serializer):
        serializer.save(user=self.request.user)
