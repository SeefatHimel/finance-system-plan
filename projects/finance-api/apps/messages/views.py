from django.db import IntegrityError, transaction
from django.shortcuts import get_object_or_404
from rest_framework import status
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework.viewsets import ModelViewSet

from apps.transactions.models import Transaction

from .models import ParsedMessageCandidate, RawMessage, SenderRule
from .parsers import parse_raw_message
from .serializers import (
    ParsedMessageCandidateSerializer,
    ParsedMessageConfirmSerializer,
    RawMessageImportSerializer,
    RawMessageSerializer,
    SenderRuleSerializer,
)


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
            candidate = getattr(duplicate, "candidate", None)
            return Response(
                {
                    "candidate": (
                        ParsedMessageCandidateSerializer(candidate).data
                        if candidate
                        else None
                    ),
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
                candidate = self._create_candidate(raw_message)
        except IntegrityError:
            raw_message = RawMessage.objects.get(user=request.user, body_hash=body_hash)
            candidate = getattr(raw_message, "candidate", None)
            return Response(
                {
                    "candidate": (
                        ParsedMessageCandidateSerializer(candidate).data
                        if candidate
                        else None
                    ),
                    "is_duplicate": True,
                    "message": RawMessageSerializer(raw_message).data,
                },
                status=status.HTTP_200_OK,
            )

        return Response(
            {
                "candidate": ParsedMessageCandidateSerializer(candidate).data,
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

    def _create_candidate(self, raw_message):
        parsed = parse_raw_message(raw_message)
        return ParsedMessageCandidate.objects.create(
            user=raw_message.user,
            raw_message=raw_message,
            sender_rule=parsed["sender_rule"],
            account=parsed["account"],
            payment_method=parsed["payment_method"],
            destination_account=parsed["destination_account"],
            destination_payment_method=parsed["destination_payment_method"],
            provider=parsed["provider"],
            message_kind=parsed["message_kind"],
            transaction_type=parsed["transaction_type"],
            amount=parsed["amount"],
            counterparty_text=parsed["counterparty_text"],
            reference=parsed["reference"],
            balance_after=parsed["balance_after"],
            fee_amount=parsed["fee_amount"],
            possible_internal_transfer=parsed["possible_internal_transfer"],
            confidence=parsed["confidence"],
            parser_name=parsed["parser_name"],
            parser_notes=parsed["parser_notes"],
        )


class MessageReviewListView(APIView):
    permission_classes = (IsAuthenticated,)

    def get(self, request):
        candidates = (
            ParsedMessageCandidate.objects.filter(
                user=request.user,
                status=ParsedMessageCandidate.Status.NEEDS_REVIEW,
            )
            .select_related(
                "raw_message",
                "sender_rule",
                "account",
                "payment_method",
                "destination_account",
                "destination_payment_method",
                "transaction",
            )
        )
        return Response(ParsedMessageCandidateSerializer(candidates, many=True).data)


class MessageCandidateConfirmView(APIView):
    permission_classes = (IsAuthenticated,)

    def post(self, request, candidate_id):
        candidate = self._get_candidate(request.user, candidate_id)
        if candidate.status != ParsedMessageCandidate.Status.NEEDS_REVIEW:
            return Response(
                {"detail": "Only candidates needing review can be confirmed."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        serializer = ParsedMessageConfirmSerializer(data=request.data, context={"request": request})
        serializer.is_valid(raise_exception=True)
        payload = serializer.validated_data

        account = payload.get("account") or candidate.account
        amount = payload.get("amount") or candidate.amount
        transaction_date = payload.get("date") or candidate.raw_message.received_at.date()
        transaction_type = payload.get("type") or candidate.transaction_type

        if account is None:
            return Response(
                {"account": "Account is required to confirm this message."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if amount is None:
            return Response(
                {"amount": "Amount is required to confirm this message."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        transaction_record = Transaction.objects.create(
            user=request.user,
            account=account,
            category=payload.get("category"),
            date=transaction_date,
            type=transaction_type,
            amount=amount,
            note=payload.get("note", candidate.raw_message.body),
            source=Transaction.Source.SMS,
            needs_review=False,
        )
        candidate.transaction = transaction_record
        candidate.status = ParsedMessageCandidate.Status.CONFIRMED
        candidate.save(update_fields=("transaction", "status", "updated_at"))

        return Response(ParsedMessageCandidateSerializer(candidate).data)

    def _get_candidate(self, user, candidate_id):
        return get_object_or_404(
            ParsedMessageCandidate.objects.select_related(
                "raw_message",
                "sender_rule",
                "account",
                "payment_method",
                "destination_account",
                "destination_payment_method",
                "transaction",
            ),
            user=user,
            id=candidate_id,
        )


class MessageCandidateIgnoreView(APIView):
    permission_classes = (IsAuthenticated,)

    def post(self, request, candidate_id):
        candidate = get_object_or_404(
            ParsedMessageCandidate.objects.select_related("raw_message"),
            user=request.user,
            id=candidate_id,
        )
        candidate.status = ParsedMessageCandidate.Status.IGNORED
        candidate.save(update_fields=("status", "updated_at"))
        return Response(ParsedMessageCandidateSerializer(candidate).data)
