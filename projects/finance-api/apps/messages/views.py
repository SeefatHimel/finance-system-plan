from django.db import IntegrityError, transaction
from rest_framework import status
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework.viewsets import ModelViewSet

from .models import RawMessage, SenderRule
from .serializers import RawMessageImportSerializer, RawMessageSerializer, SenderRuleSerializer


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


class RawMessageImportView(APIView):
    permission_classes = (IsAuthenticated,)

    def post(self, request):
        serializer = RawMessageImportSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        payload = serializer.validated_data
        body_hash = RawMessage.build_body_hash(
            sender=payload["sender"],
            body=payload["body"],
            received_at=payload["received_at"],
        )

        duplicate = self._find_duplicate(
            user=request.user,
            body_hash=body_hash,
            device_message_id=payload.get("device_message_id", ""),
        )
        if duplicate:
            return Response(
                {
                    "is_duplicate": True,
                    "message": RawMessageSerializer(duplicate).data,
                },
                status=status.HTTP_200_OK,
            )

        try:
            with transaction.atomic():
                raw_message = RawMessage.objects.create(
                    user=request.user,
                    sender=payload["sender"],
                    body=payload["body"],
                    received_at=payload["received_at"],
                    device_message_id=payload.get("device_message_id", ""),
                    body_hash=body_hash,
                )
        except IntegrityError:
            raw_message = RawMessage.objects.get(user=request.user, body_hash=body_hash)
            return Response(
                {
                    "is_duplicate": True,
                    "message": RawMessageSerializer(raw_message).data,
                },
                status=status.HTTP_200_OK,
            )

        return Response(
            {
                "is_duplicate": False,
                "message": RawMessageSerializer(raw_message).data,
            },
            status=status.HTTP_201_CREATED,
        )

    def _find_duplicate(self, *, user, body_hash: str, device_message_id: str):
        queryset = RawMessage.objects.filter(user=user)
        if device_message_id:
            duplicate = queryset.filter(device_message_id=device_message_id).first()
            if duplicate:
                return duplicate
        return queryset.filter(body_hash=body_hash).first()
