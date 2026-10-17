from django.db.models import Count, Q
from drf_spectacular.utils import extend_schema
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

