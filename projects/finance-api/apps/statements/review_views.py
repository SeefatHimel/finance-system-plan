from uuid import UUID

from django.db import transaction as db_transaction
from django.db.models import Count, Q
from django.shortcuts import get_object_or_404
from django.utils.decorators import method_decorator
from django.views.decorators.debug import sensitive_post_parameters
from drf_spectacular.types import OpenApiTypes
from drf_spectacular.utils import OpenApiParameter, extend_schema
from rest_framework import mixins, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import ValidationError
from rest_framework.pagination import LimitOffsetPagination
from rest_framework.parsers import FormParser, JSONParser, MultiPartParser
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from apps.categories.models import Category
from apps.transactions.transfers import lock_transfer_user

from .insights import analyze, prepare
from .models import StatementImport, StatementRow
from .serializers import (
    SavedStatementRowSerializer,
    StatementBulkResultSerializer,
    StatementBulkSerializer,
    StatementDecisionSerializer,
    StatementImportSerializer,
    StatementPreviewRequestSerializer,
    StatementRowEditSerializer,
    StatementRowPageSerializer,
    StatementSelectedSerializer,
    StatementSummarySerializer,
)
from .services import (
    ReviewConflict,
    decide_locked,
    file_digest,
    find_matches,
    posting_issues,
    resolved,
    review_context,
    row_snapshot,
    save_import,
    touch,
)
from .uploads import BoundedStatementUploadHandler
from .views import StatementPreviewThrottle, StatementPreviewView


class ImportPagination(LimitOffsetPagination):
    default_limit = 20
    max_limit = 50


class NoStoreMixin:
    def finalize_response(self, request, response, *args, **kwargs):
        response = super().finalize_response(request, response, *args, **kwargs)
        response["Cache-Control"] = "no-store"
        return response


@method_decorator(sensitive_post_parameters("password", "file"), name="dispatch")
class StatementImportViewSet(
    NoStoreMixin,
    mixins.ListModelMixin,
    mixins.RetrieveModelMixin,
    viewsets.GenericViewSet,
):
    permission_classes = (IsAuthenticated,)
    serializer_class = StatementImportSerializer
    parser_classes = (MultiPartParser, FormParser)
    pagination_class = ImportPagination

    def initialize_request(self, request, *args, **kwargs):
        request.upload_handlers.insert(0, BoundedStatementUploadHandler(request))
        return super().initialize_request(request, *args, **kwargs)

    def get_throttles(self):
        return [StatementPreviewThrottle()] if self.action == "create" else []

    def get_queryset(self):
        if not self.request.user.is_authenticated:
            return StatementImport.objects.none()
        return (
            StatementImport.objects.filter(user=self.request.user)
            .select_related("account")
            .annotate(
                count_total=Count("rows"),
                count_pending=Count(
                    "rows",
                    filter=Q(rows__state="pending")
                    | Q(
                        rows__state__in=["posted", "linked"],
                        rows__transaction__isnull=True,
                    ),
                ),
                count_posted=Count(
                    "rows",
                    filter=Q(rows__state="posted", rows__transaction__isnull=False),
                ),
                count_linked=Count(
                    "rows",
                    filter=Q(rows__state="linked", rows__transaction__isnull=False),
                ),
                count_skipped=Count("rows", filter=Q(rows__state="skipped")),
            )
            .order_by("-updated_at", "-id")
        )

    @extend_schema(
        request=StatementPreviewRequestSerializer,
        responses={200: StatementImportSerializer, 201: StatementImportSerializer},
        tags=["Statements"],
    )
    def create(self, request):
        serializer = StatementPreviewRequestSerializer(
            data=request.data, context={"request": request}
        )
        serializer.is_valid(raise_exception=True)
        account = serializer.validated_data["account"]
        file = serializer.validated_data["file"]
        digest = file_digest(file.read())
        existing = (
            self.get_queryset().filter(account=account, file_digest=digest).first()
        )
        if existing:
            return Response(self.get_serializer(existing).data)
        file.seek(0)
        # Reuse the verified bounded extractor. It returns errors without saving.
        response = StatementPreviewView().extract(request, serializer)
        if response.status_code != 200:
            return response
        batch, created = save_import(
            user=request.user, account=account, digest=digest, preview=response.data
        )
        batch = self.get_queryset().get(pk=batch.id)
        return Response(self.get_serializer(batch).data, status=201 if created else 200)

    @extend_schema(
        responses=StatementRowPageSerializer,
        tags=["Statements"],
        parameters=[
            OpenApiParameter("offset", int, description="Zero-based row offset."),
            OpenApiParameter("limit", int, description="1–100; default 50."),
            OpenApiParameter(
                "state",
                str,
                enum=[
                    "pending",
                    "new",
                    "possible_match",
                    "needs_correction",
                    "posted",
                    "linked",
                    "skipped",
                ],
            ),
            OpenApiParameter("direction", str, enum=["debit", "credit"]),
            OpenApiParameter("type", str),
            OpenApiParameter(
                "category",
                str,
                description="Owned category UUID or none for uncategorized.",
            ),
            OpenApiParameter("search", str),
            OpenApiParameter("date_from", OpenApiTypes.DATE),
            OpenApiParameter("date_to", OpenApiTypes.DATE),
        ],
    )
    @action(detail=True, methods=("get",))
    def rows(self, request, pk=None):
        batch = self.get_object()
        try:
            offset = int(request.query_params.get("offset", "0"))
            limit = int(request.query_params.get("limit", "50"))
            if offset < 0 or not 1 <= limit <= 100:
                raise ValueError
        except ValueError as error:
            raise ValidationError(
                {"pagination": "Use offset >= 0 and limit from 1 to 100."}
            ) from error
        # A batch has at most 4000 bounded principal/fee components. Matching all
        # rows before pagination keeps New/Match/Correction filters global.
        records = list(
            batch.rows.select_related(
                "batch__account", "other_account", "category", "transaction"
            )
        )
        prepare(records)
        matches, truncated = find_matches(records)
        state = request.query_params.get("state", "")
        if state and state not in {
            "new",
            "possible_match",
            "needs_correction",
            "posted",
            "linked",
            "skipped",
            "pending",
        }:
            raise ValidationError({"state": "Choose a valid review state."})
        search = request.query_params.get("search", "").strip().casefold()
        direction = request.query_params.get("direction", "")
        kind = request.query_params.get("type", "")
        category = request.query_params.get("category", "")
        if direction and direction not in dict(
            StatementRow._meta.get_field("direction").choices
        ):
            raise ValidationError({"direction": "Choose debit or credit."})
        if kind and kind not in dict(StatementRow._meta.get_field("type").choices):
            raise ValidationError({"type": "Choose a valid transaction type."})
        if category and category != "none":
            try:
                category_id = UUID(category)
            except ValueError as error:
                raise ValidationError(
                    {"category": "Choose a category or uncategorized."}
                ) from error
            if not Category.objects.filter(user=request.user, id=category_id).exists():
                raise ValidationError({"category": "Choose one of your categories."})
            category = str(category_id)
        start, end = (
            request.query_params.get("date_from", ""),
            request.query_params.get("date_to", ""),
        )
        from datetime import date

        try:
            start = date.fromisoformat(start) if start else None
            end = date.fromisoformat(end) if end else None
        except ValueError as error:
            raise ValidationError(
                {"date": "Use YYYY-MM-DD for date filters."}
            ) from error
        if start and end and start > end:
            raise ValidationError(
                {"date": "Start date must be before or equal to end date."}
            )
        filtered = []
        for row in records:
            context = review_context(row, matches[row.id], truncated)
            if (
                state == "pending"
                and resolved(row)
                or state
                and state != "pending"
                and state != context["review_state"]
            ):
                continue
            if (
                direction
                and row.direction != direction
                or kind
                and row.type != kind
                or category
                and (
                    (row.category_id is not None)
                    if category == "none"
                    else str(row.category_id) != category
                )
            ):
                continue
            if (
                start
                and (row.date is None or row.date < start)
                or end
                and (row.date is None or row.date > end)
            ):
                continue
            if (
                search
                and search
                not in f"{row.note} {row.reference} {row.counterparty_text} {row.extracted.get('description', '')}".casefold()
            ):
                continue
            filtered.append(row)
        return Response(
            {
                "count": len(filtered),
                "offset": offset,
                "limit": limit,
                "results": SavedStatementRowSerializer(
                    filtered[offset : offset + limit],
                    many=True,
                    context={"matches": matches, "matching_truncated": truncated},
                ).data,
            }
        )

    @extend_schema(responses=StatementSummarySerializer, tags=["Statements"])
    @action(detail=True, methods=("get",))
    def summary(self, request, pk=None):
        batch = self.get_object()
        return Response(analyze(batch, list(batch.rows.select_related("batch"))))

    @extend_schema(
        request=StatementSelectedSerializer,
        responses=StatementBulkResultSerializer,
        tags=["Statements"],
    )
    @action(detail=True, methods=("post",), parser_classes=(JSONParser,))
    def review_selected(self, request, pk=None):
        return self.approve_new(request, pk)

    @extend_schema(
        request=StatementBulkSerializer,
        responses=StatementBulkResultSerializer,
        tags=["Statements"],
    )
    @action(detail=True, methods=("post",), parser_classes=(JSONParser,))
    @db_transaction.atomic
    def approve_new(self, request, pk=None):
        # Override the upload-only parsers for this JSON action.
        batch = self.get_object()
        serializer = (
            StatementSelectedSerializer
            if self.action == "review_selected"
            else StatementBulkSerializer
        )(data=request.data)
        serializer.is_valid(raise_exception=True)
        lock_transfer_user(request.user)
        wanted = serializer.validated_data["rows"]
        decision_action = serializer.validated_data.get("action", "create")
        rows = {
            row.id: row
            for row in batch.rows.select_for_update(of=("self",))
            .select_related("batch__account", "other_account", "category")
            .filter(id__in=[entry["id"] for entry in wanted])
        }
        if len(rows) != len(wanted):
            raise ValidationError({"rows": "Choose rows from this statement only."})
        added, skipped, unchanged, unresolved = 0, 0, 0, []
        for entry in wanted:
            row = rows[entry["id"]]
            if resolved(row):
                if decision_action == "skip" and row.state != "skipped":
                    unresolved.append(
                        {
                            "id": str(row.id),
                            "reason": "Already linked or posted; its ledger entry is retained.",
                        }
                    )
                    continue
                unchanged += 1
                continue
            if decision_action == "skip":
                if entry["version"] != row.version:
                    unresolved.append(
                        {
                            "id": str(row.id),
                            "reason": "Changed row; reload before skipping.",
                        }
                    )
                    continue
                decide_locked(
                    row=row,
                    user=request.user,
                    payload={"action": "skip", "version": row.version},
                    request=request,
                )
                skipped += 1
                continue
            matches, truncated = find_matches([row])
            review = review_context(row, matches[row.id], truncated)
            issues = posting_issues(row)
            if (
                entry["version"] != row.version
                or matches[row.id]
                or truncated
                or issues
                or review["requires_acknowledgement"]
            ):
                unresolved.append(
                    {
                        "id": str(row.id),
                        "reason": "Changed row, possible match, or discrepancy requires individual review.",
                    }
                )
                continue
            _, decision = decide_locked(
                row=row,
                user=request.user,
                payload={"action": "create", "version": entry["version"]},
                request=request,
            )
            added += decision == "create"
            unchanged += decision == "unchanged"
        return Response(
            {
                "added": added,
                "skipped": skipped,
                "unchanged": unchanged,
                "unresolved": unresolved,
            }
        )


class StatementRowViewSet(NoStoreMixin, viewsets.GenericViewSet):
    permission_classes = (IsAuthenticated,)
    serializer_class = SavedStatementRowSerializer

    def get_queryset(self):
        if not self.request.user.is_authenticated:
            return StatementRow.objects.none()
        return StatementRow.objects.filter(
            batch__user=self.request.user
        ).select_related("batch__account", "other_account", "category", "transaction")

    def representation(self, row):
        from .insights import suggestions

        if resolved(row):
            records = list(row.batch.rows.select_related("batch"))
            analyze(row.batch, records)
            row._draft_issues = next(
                (item._draft_issues for item in records if item.id == row.id), []
            )
        row._suggestion = suggestions([row]).get(row.id)
        matches, truncated = find_matches([row])
        return SavedStatementRowSerializer(
            row, context={"matches": matches, "matching_truncated": truncated}
        ).data

    def retrieve(self, request, pk=None):
        return Response(self.representation(self.get_object()))

    @extend_schema(
        request=StatementRowEditSerializer,
        responses=SavedStatementRowSerializer,
        tags=["Statements"],
    )
    @db_transaction.atomic
    def partial_update(self, request, pk=None):
        lock_transfer_user(request.user)
        row = get_object_or_404(
            self.get_queryset().select_for_update(of=("self",)), pk=pk
        )
        if resolved(row):
            raise ReviewConflict(
                "Unlink or reopen this resolved row before editing its draft. Existing ledger corrections belong in Transactions."
            )
        serializer = StatementRowEditSerializer(
            row, data=request.data, partial=True, context={"request": request}
        )
        serializer.is_valid(raise_exception=True)
        if serializer.validated_data.pop("version") != row.version:
            raise ReviewConflict()
        before = row_snapshot(row)
        for field, value in serializer.validated_data.items():
            setattr(row, field, value)
        touch(row, request.user, before, {"decision": "edit"})
        return Response(self.representation(row))

    @extend_schema(
        request=StatementDecisionSerializer,
        responses=SavedStatementRowSerializer,
        tags=["Statements"],
    )
    @action(detail=True, methods=("post",))
    @db_transaction.atomic
    def decide(self, request, pk=None):
        lock_transfer_user(request.user)
        row = get_object_or_404(
            self.get_queryset().select_for_update(of=("self",)), pk=pk
        )
        serializer = StatementDecisionSerializer(
            data=request.data, context={"request": request}
        )
        serializer.is_valid(raise_exception=True)
        row, _ = decide_locked(
            row=row,
            user=request.user,
            payload=serializer.validated_data,
            request=request,
        )
        return Response(self.representation(row))
