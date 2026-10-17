from django.db import transaction
from django.db.models import Count, Q
from django.db.models.deletion import ProtectedError
from drf_spectacular.utils import extend_schema
from rest_framework.exceptions import ValidationError
from rest_framework.permissions import IsAuthenticated
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.viewsets import ModelViewSet

from .models import Category
from .serializers import CategorySerializer, CategoryUsageSerializer


class CategoryViewSet(ModelViewSet):
    serializer_class = CategorySerializer
    permission_classes = (IsAuthenticated,)

    def get_queryset(self):
        return Category.objects.filter(user=self.request.user)

    def perform_create(self, serializer):
        serializer.save(user=self.request.user)

    def perform_destroy(self, instance):
        try:
            with transaction.atomic():
                instance.delete()
        except ProtectedError as exc:
            raise ValidationError({
                "detail": "This category is used by transactions or other records. Remove those links before deleting it."
            }) from exc

    @extend_schema(responses=CategoryUsageSerializer(many=True))
    @action(detail=False, methods=("get",), url_path="usage")
    def usage(self, request):
        """Count posted ledger entries per owned category, including unused ones."""
        rows = self.get_queryset().annotate(
            transaction_count=Count(
                "transactions", filter=Q(transactions__user=request.user)
            )
        ).values("id", "transaction_count")
        data = [
            {"category": row["id"], "transaction_count": row["transaction_count"]}
            for row in rows
        ]
        return Response(CategoryUsageSerializer(data, many=True).data)

