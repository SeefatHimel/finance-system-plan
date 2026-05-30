from rest_framework.permissions import IsAuthenticated
from rest_framework.viewsets import ReadOnlyModelViewSet

from .models import AuditLogEntry
from .serializers import AuditLogEntrySerializer


class AuditLogEntryViewSet(ReadOnlyModelViewSet):
    serializer_class = AuditLogEntrySerializer
    permission_classes = (IsAuthenticated,)

    def get_queryset(self):
        queryset = AuditLogEntry.objects.filter(user=self.request.user)

        action = self.request.query_params.get("action")
        if action:
            queryset = queryset.filter(action=action)

        entity_type = self.request.query_params.get("entity_type")
        if entity_type:
            queryset = queryset.filter(entity_type=entity_type)

        entity_id = self.request.query_params.get("entity_id")
        if entity_id:
            queryset = queryset.filter(entity_id=entity_id)

        return queryset
