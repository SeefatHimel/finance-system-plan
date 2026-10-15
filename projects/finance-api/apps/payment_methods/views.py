from drf_spectacular.utils import extend_schema
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.viewsets import ModelViewSet

from .models import PaymentMethod
from .secure_identifiers import originals_for
from .serializers import OriginalIdentifiersSerializer, PaymentMethodSerializer


class PaymentMethodViewSet(ModelViewSet):
    serializer_class = PaymentMethodSerializer
    permission_classes = (IsAuthenticated,)

    def get_queryset(self):
        return PaymentMethod.objects.filter(user=self.request.user).select_related("account")

    def perform_create(self, serializer):
        serializer.save(user=self.request.user)

    @extend_schema(responses=OriginalIdentifiersSerializer, tags=["Payment methods"])
    @action(detail=True, methods=["get"], url_path="original-identifiers")
    def original_identifiers(self, request, pk=None):
        response = Response(originals_for(self.get_object()))
        response["Cache-Control"] = "no-store"
        return response
