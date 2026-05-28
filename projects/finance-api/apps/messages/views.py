from rest_framework.permissions import IsAuthenticated
from rest_framework.viewsets import ModelViewSet

from .models import SenderRule
from .serializers import SenderRuleSerializer


class SenderRuleViewSet(ModelViewSet):
    serializer_class = SenderRuleSerializer
    permission_classes = (IsAuthenticated,)

    def get_queryset(self):
        return SenderRule.objects.filter(user=self.request.user).select_related(
            "account",
            "payment_method",
        )

    def perform_create(self, serializer):
        serializer.save(user=self.request.user)
