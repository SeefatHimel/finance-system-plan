from datetime import timedelta

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
                self._link_possible_related_candidate(candidate)
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

    def _link_possible_related_candidate(self, candidate):
        if not candidate.possible_internal_transfer or candidate.amount is None:
            return

        start = candidate.raw_message.received_at - timedelta(minutes=10)
        end = candidate.raw_message.received_at + timedelta(minutes=10)
        related = (
            ParsedMessageCandidate.objects.filter(
                user=candidate.user,
                status=ParsedMessageCandidate.Status.NEEDS_REVIEW,
                possible_internal_transfer=True,
                amount=candidate.amount,
                raw_message__received_at__range=(start, end),
            )
            .exclude(id=candidate.id)
            .exclude(provider=candidate.provider)
            .select_related("raw_message")
            .order_by("-raw_message__received_at")
            .first()
        )

        if related is None:
            return

        reason = "Same amount, close timestamp, and different provider."
        candidate.possible_related_candidate = related
        candidate.related_match_reason = reason
        candidate.save(
            update_fields=(
                "possible_related_candidate",
                "related_match_reason",
                "updated_at",
            )
        )

        if related.possible_related_candidate_id is None:
            related.possible_related_candidate = candidate
            related.related_match_reason = reason
            related.save(
                update_fields=(
                    "possible_related_candidate",
                    "related_match_reason",
                    "updated_at",
                )
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
                "possible_related_candidate",
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
        transfer_account = payload.get("transfer_account") or candidate.destination_account
        payment_method = payload.get("payment_method") or candidate.payment_method
        amount = payload.get("amount") or candidate.amount
        balance_after = (
            payload.get("balance_after")
            if "balance_after" in payload
            else candidate.balance_after
        )
        transaction_date = payload.get("date") or candidate.raw_message.received_at.date()
        transaction_type = payload.get("type") or candidate.transaction_type
        direction = payload.get("direction") or Transaction.default_direction_for_type(transaction_type)
        reference = payload.get("reference", candidate.reference)
        counterparty_text = payload.get("counterparty_text", candidate.counterparty_text)

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
        if transaction_type == Transaction.Type.TRANSFER and transfer_account is None:
            return Response(
                {"transfer_account": "Transfer transactions require a destination account."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if transaction_type != Transaction.Type.TRANSFER and transfer_account is not None:
            return Response(
                {"transfer_account": "Only transfer transactions can use a destination account."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if transfer_account and transfer_account.id == account.id:
            return Response(
                {"transfer_account": "Transfer account must be different from source account."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if payment_method and payment_method.account_id != account.id:
            return Response(
                {"payment_method": "Payment method must belong to the selected account."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        external_key = self._build_external_key(
            candidate=candidate,
            account=account,
            amount=amount,
            reference=reference,
            transaction_date=transaction_date,
            transaction_type=transaction_type,
        )
        if (
            external_key
            and Transaction.objects.filter(user=request.user, external_key=external_key).exists()
        ):
            return Response(
                {"detail": "A transaction with the same SMS/reference key already exists."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        transaction_record = Transaction.objects.create(
            user=request.user,
            account=account,
            transfer_account=transfer_account,
            category=payload.get("category"),
            payment_method=payment_method,
            raw_message=candidate.raw_message,
            date=transaction_date,
            type=transaction_type,
            direction=direction,
            amount=amount,
            balance_after=balance_after,
            reference=reference,
            counterparty_text=counterparty_text,
            external_key=external_key,
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
                "possible_related_candidate",
                "transaction",
            ),
            user=user,
            id=candidate_id,
        )

    def _build_external_key(
        self,
        *,
        candidate,
        account,
        amount,
        reference: str,
        transaction_date,
        transaction_type: str,
    ) -> str:
        normalized_reference = reference.strip().lower()
        if normalized_reference:
            provider = candidate.provider or "unknown"
            return f"sms:{provider}:{normalized_reference}"

        if candidate.raw_message_id:
            return f"raw-message:{candidate.raw_message_id}"

        return "|".join(
            [
                "sms-fallback",
                str(account.id),
                str(transaction_date),
                transaction_type,
                str(amount),
            ]
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
