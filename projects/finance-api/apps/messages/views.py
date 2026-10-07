from datetime import timedelta

from django.conf import settings
from django.db import IntegrityError, transaction
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework import status
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework.viewsets import ModelViewSet

from apps.audit_logs.models import AuditLogEntry
from apps.audit_logs.services import create_audit_log, transaction_snapshot
from apps.transactions.models import Transaction, TransferEvidence
from apps.transactions.transfers import (
    add_transfer_evidence,
    lock_transfer_user,
    sms_transfer_data,
)

from .models import (
    ParsedMessageCandidate,
    RawMessage,
    SenderRule,
    SenderRuleMapping,
    SmsCapturePreference,
    SmsDeviceStatus,
    default_excluded_message_kinds,
)
from .parsers import classify_message_kind_for_capture, find_sender_rule, has_numeric_content, parse_raw_message
from .serializers import (
    MessageCandidateRejectSerializer,
    ParsedMessageCandidateSerializer,
    ParsedMessageConfirmSerializer,
    RawMessageImportSerializer,
    RawMessageSerializer,
    SenderRuleSerializer,
    SmsCapturePreferenceSerializer,
    SmsDeviceStatusSerializer,
)


class SenderRuleViewSet(ModelViewSet):
    serializer_class = SenderRuleSerializer
    permission_classes = (IsAuthenticated,)

    def get_queryset(self):
        return SenderRule.objects.filter(user=self.request.user).select_related(
            "account",
            "payment_method",
            "category",
        )

    def perform_create(self, serializer):
        serializer.save(user=self.request.user)


class SmsCapturePreferenceView(APIView):
    permission_classes = (IsAuthenticated,)

    def get_object(self, user):
        preference, _created = SmsCapturePreference.objects.get_or_create(user=user)
        return preference

    def get(self, request):
        return Response(SmsCapturePreferenceSerializer(self.get_object(request.user)).data)

    def patch(self, request):
        preference = self.get_object(request.user)
        serializer = SmsCapturePreferenceSerializer(
            preference,
            data=request.data,
            partial=True,
        )
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response(serializer.data)


class SmsDeviceStatusView(APIView):
    permission_classes = (IsAuthenticated,)

    def get(self, request):
        device_status = SmsDeviceStatus.objects.filter(user=request.user).first()
        if device_status is None:
            return Response(
                {
                    "device_id": "",
                    "platform": "android",
                    "app_version": "",
                    "sms_permission_state": "unknown",
                    "background_state": "disabled",
                    "pending_upload_count": 0,
                    "failed_upload_count": 0,
                    "last_error": "",
                    "last_scan_at": None,
                    "last_successful_sync_at": None,
                    "last_seen_at": None,
                    "health_state": "not_connected",
                    "health_label": "Connect the mobile app",
                    "created_at": None,
                    "updated_at": None,
                }
            )
        return Response(SmsDeviceStatusSerializer(device_status).data)

    def post(self, request):
        device_status, _created = SmsDeviceStatus.objects.get_or_create(user=request.user)
        serializer = SmsDeviceStatusSerializer(device_status, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        serializer.save(last_seen_at=timezone.now())
        return Response(serializer.data)


class RawMessageImportView(APIView):
    permission_classes = (IsAuthenticated,)

    def post(self, request):
        serializer = RawMessageImportSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        payload = serializer.validated_data
        sender_rule = find_sender_rule(user=request.user, sender=payload["sender"])
        if sender_rule is None:
            return Response(
                {"sender": "No active trusted sender rule matches this message."},
                status=status.HTTP_400_BAD_REQUEST,
            )
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
            was_reprocessed = self._reprocess_candidate(candidate) if payload["reprocess_existing"] else False
            return Response(
                {
                    "candidate": (
                        ParsedMessageCandidateSerializer(candidate).data
                        if candidate
                        else None
                    ),
                    "is_duplicate": True,
                    "was_reprocessed": was_reprocessed,
                    "message": RawMessageSerializer(duplicate).data,
                },
                status=status.HTTP_200_OK,
            )

        transient_message = RawMessage(
            user=request.user,
            sender=payload["sender"],
            body=payload["body"],
            received_at=payload["received_at"],
        )
        parsed = parse_raw_message(transient_message)
        preference = SmsCapturePreference.objects.filter(user=request.user).first()
        excluded_providers = set(preference.excluded_providers if preference else [])
        excluded_message_kinds = set(
            preference.excluded_message_kinds
            if preference
            else default_excluded_message_kinds()
        )
        exclusion_reason = ""
        if parsed["provider"] in excluded_providers:
            exclusion_reason = "provider_excluded"
        elif parsed["message_kind"] in excluded_message_kinds:
            exclusion_reason = "message_kind_excluded"
        elif not has_numeric_content(payload["body"]):
            exclusion_reason = "no_numeric_content"

        if exclusion_reason:
            try:
                with transaction.atomic():
                    raw_message = RawMessage.objects.create(
                        user=request.user,
                        sender=payload["sender"],
                        body="[excluded before storage]",
                        received_at=payload["received_at"],
                        device_message_id=payload.get("device_message_id", ""),
                        body_hash=body_hash,
                        provider=parsed["provider"],
                        message_kind=parsed["message_kind"],
                        exclusion_reason=exclusion_reason,
                        status=RawMessage.Status.IGNORED,
                    )
            except IntegrityError:
                raw_message = self._find_duplicate(
                    user=request.user,
                    body_hash=body_hash,
                    device_message_id=payload.get("device_message_id", ""),
                )
                return Response(
                    {
                        "candidate": None,
                        "is_duplicate": True,
                        "was_reprocessed": False,
                        "message": RawMessageSerializer(raw_message).data,
                    },
                    status=status.HTTP_200_OK,
                )
            return Response(
                {
                    "candidate": None,
                    "is_duplicate": False,
                    "was_reprocessed": False,
                    "message": RawMessageSerializer(raw_message).data,
                },
                status=status.HTTP_201_CREATED,
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
                    provider=parsed["provider"],
                    message_kind=parsed["message_kind"],
                )
                candidate = self._create_candidate(raw_message, parsed=parsed)
                self._link_possible_related_candidate(candidate)
        except IntegrityError:
            raw_message = RawMessage.objects.get(user=request.user, body_hash=body_hash)
            candidate = getattr(raw_message, "candidate", None)
            was_reprocessed = self._reprocess_candidate(candidate) if payload["reprocess_existing"] else False
            return Response(
                {
                    "candidate": (
                        ParsedMessageCandidateSerializer(candidate).data
                        if candidate
                        else None
                    ),
                    "is_duplicate": True,
                    "was_reprocessed": was_reprocessed,
                    "message": RawMessageSerializer(raw_message).data,
                },
                status=status.HTTP_200_OK,
            )

        return Response(
            {
                "candidate": ParsedMessageCandidateSerializer(candidate).data,
                "is_duplicate": False,
                "was_reprocessed": False,
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

    def _create_candidate(self, raw_message, *, parsed=None):
        parsed = parsed or parse_raw_message(raw_message)
        return ParsedMessageCandidate.objects.create(
            user=raw_message.user,
            raw_message=raw_message,
            sender_rule=parsed["sender_rule"],
            account=parsed["account"],
            payment_method=parsed["payment_method"],
            category=parsed["category"],
            destination_account=parsed["destination_account"],
            destination_payment_method=parsed["destination_payment_method"],
            provider=parsed["provider"],
            message_kind=parsed["message_kind"],
            transaction_type=parsed["transaction_type"],
            amount=parsed["amount"],
            sender_account_identifier=parsed["sender_account_identifier"],
            sender_card_identifier=parsed["sender_card_identifier"],
            receiver_account_identifier=parsed["receiver_account_identifier"],
            receiver_card_identifier=parsed["receiver_card_identifier"],
            counterparty_text=parsed["counterparty_text"],
            suggested_transfer_direction=parsed["suggested_transfer_direction"],
            transfer_suggestion_reason=parsed["transfer_suggestion_reason"],
            reference=parsed["reference"],
            balance_after=parsed["balance_after"],
            fee_amount=parsed["fee_amount"],
            possible_internal_transfer=parsed["possible_internal_transfer"],
            confidence=parsed["confidence"],
            parser_name=parsed["parser_name"],
            parser_notes=parsed["parser_notes"],
        )

    @transaction.atomic
    def _reprocess_candidate(self, candidate):
        if candidate is None:
            return False
        # Confirmation uses the same user lock: skip decisions must never
        # overwrite a candidate confirmed while the review queue was loading.
        lock_transfer_user(candidate.user)
        candidate.refresh_from_db()
        if candidate.status != ParsedMessageCandidate.Status.NEEDS_REVIEW:
            return False
        preference = SmsCapturePreference.objects.filter(user=candidate.user).first()
        excluded_kinds = preference.excluded_message_kinds if preference else default_excluded_message_kinds()
        if candidate.raw_message.status == RawMessage.Status.REDACTED:
            if candidate.message_kind in excluded_kinds:
                self._discard_candidate(candidate, exclusion_reason="message_kind_excluded")
                return True
            return False
        if not has_numeric_content(candidate.raw_message.body):
            self._discard_candidate(candidate)
            return True

        parsed = parse_raw_message(candidate.raw_message)
        if parsed["message_kind"] in excluded_kinds:
            self._discard_candidate(candidate, exclusion_reason="message_kind_excluded", message_kind=parsed["message_kind"])
            return True
        parsed_fields = (
            "sender_rule",
            "account",
            "payment_method",
            "category",
            "destination_account",
            "destination_payment_method",
            "provider",
            "message_kind",
            "transaction_type",
            "amount",
            "sender_account_identifier",
            "sender_card_identifier",
            "receiver_account_identifier",
            "receiver_card_identifier",
            "counterparty_text",
            "suggested_transfer_direction",
            "transfer_suggestion_reason",
            "reference",
            "balance_after",
            "fee_amount",
            "possible_internal_transfer",
            "confidence",
            "parser_name",
            "parser_notes",
        )
        for field in parsed_fields:
            setattr(candidate, field, parsed[field])

        related_candidate = candidate.possible_related_candidate
        candidate.possible_related_candidate = None
        candidate.related_match_reason = ""
        candidate.save(
            update_fields=(*parsed_fields, "possible_related_candidate", "related_match_reason", "updated_at")
        )
        if related_candidate and related_candidate.possible_related_candidate_id == candidate.id:
            related_candidate.possible_related_candidate = None
            related_candidate.related_match_reason = ""
            related_candidate.save(
                update_fields=("possible_related_candidate", "related_match_reason", "updated_at")
            )
        self._link_possible_related_candidate(candidate)
        return True

    def _discard_candidate(self, candidate, *, exclusion_reason="no_numeric_content", message_kind=None):
        related_candidate = candidate.possible_related_candidate
        with transaction.atomic():
            candidate.status = ParsedMessageCandidate.Status.IGNORED
            candidate.rejection_reason = ParsedMessageCandidate.RejectionReason.NOT_TRANSACTION
            candidate.rejection_note = (
                "Automatically discarded because the message contains no numeric content."
                if exclusion_reason == "no_numeric_content"
                else "Automatically skipped because this message type is excluded by your capture rules."
            )
            if message_kind:
                candidate.message_kind = message_kind
            candidate.rejected_at = timezone.now()
            candidate.possible_related_candidate = None
            candidate.related_match_reason = ""
            candidate.parser_name = "non_transaction_classifier"
            candidate.parser_notes = (
                "Automatically discarded before parsing because the message contains no numeric content."
                if exclusion_reason == "no_numeric_content" else candidate.rejection_note
            )
            candidate.save(
                update_fields=(
                    "status",
                    "message_kind",
                    "rejection_reason",
                    "rejection_note",
                    "rejected_at",
                    "possible_related_candidate",
                    "related_match_reason",
                    "parser_name",
                    "parser_notes",
                    "updated_at",
                )
            )

            raw_message = candidate.raw_message
            raw_message.body = "[excluded before storage]"
            raw_message.provider = candidate.provider
            raw_message.message_kind = candidate.message_kind
            raw_message.exclusion_reason = exclusion_reason
            raw_message.status = RawMessage.Status.IGNORED
            raw_message.save(
                update_fields=(
                    "body",
                    "provider",
                    "message_kind",
                    "exclusion_reason",
                    "status",
                )
            )

            if related_candidate and related_candidate.possible_related_candidate_id == candidate.id:
                related_candidate.possible_related_candidate = None
                related_candidate.related_match_reason = ""
                related_candidate.save(
                    update_fields=(
                        "possible_related_candidate",
                        "related_match_reason",
                        "updated_at",
                    )
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
                "category",
                "destination_account",
                "destination_payment_method",
                "possible_related_candidate",
                "transaction",
            )
        )
        return Response(ParsedMessageCandidateSerializer(candidates, many=True).data)


class MessageCandidateReprocessView(RawMessageImportView):
    def post(self, request, candidate_id):
        candidate = get_object_or_404(
            ParsedMessageCandidate.objects.select_related("raw_message"),
            id=candidate_id,
            user=request.user,
        )
        if candidate.status != ParsedMessageCandidate.Status.NEEDS_REVIEW:
            return Response(
                {"detail": "Only candidates needing review can be reprocessed."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if candidate.raw_message.status == RawMessage.Status.REDACTED:
            return Response(
                {"detail": "Redacted messages cannot be reprocessed."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        self._reprocess_candidate(candidate)
        candidate.refresh_from_db()
        return Response(ParsedMessageCandidateSerializer(candidate).data)


class MessageCandidateBulkReprocessView(RawMessageImportView):
    def post(self, request):
        candidates = (
            ParsedMessageCandidate.objects.filter(
                user=request.user,
                status=ParsedMessageCandidate.Status.NEEDS_REVIEW,
            )
            .select_related("raw_message")
            .order_by("created_at")
        )
        requested_count = candidates.count()
        reprocessed_count = 0
        for candidate in candidates.iterator():
            if self._reprocess_candidate(candidate):
                reprocessed_count += 1

        return Response(
            {
                "requested": requested_count,
                "reprocessed": reprocessed_count,
                "remaining_for_review": ParsedMessageCandidate.objects.filter(
                    user=request.user,
                    status=ParsedMessageCandidate.Status.NEEDS_REVIEW,
                ).count(),
            }
        )


class SmsDevelopmentResetView(APIView):
    permission_classes = (IsAuthenticated,)

    def post(self, request):
        if not settings.DEBUG:
            return Response({"detail": "Not found."}, status=status.HTTP_404_NOT_FOUND)

        sms_transactions = Transaction.objects.filter(user=request.user, source=Transaction.Source.SMS)
        transaction_count = sms_transactions.count()
        raw_messages = RawMessage.objects.filter(user=request.user)
        raw_message_count = raw_messages.count()
        candidate_count = ParsedMessageCandidate.objects.filter(user=request.user).count()

        with transaction.atomic():
            sms_transactions.delete()
            raw_messages.delete()

        return Response(
            {
                "deleted_candidates": candidate_count,
                "deleted_messages": raw_message_count,
                "deleted_transactions": transaction_count,
            }
        )


class MessageCandidateConfirmView(APIView):
    permission_classes = (IsAuthenticated,)

    @transaction.atomic
    def post(self, request, candidate_id):
        lock_transfer_user(request.user)
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
        category = payload.get("category") if "category" in payload else candidate.category
        amount = payload.get("amount") or candidate.amount
        balance_after = (
            payload.get("balance_after")
            if "balance_after" in payload
            else candidate.balance_after
        )
        received_at = timezone.localtime(candidate.raw_message.received_at)
        transaction_date = payload.get("date") or received_at.date()
        transaction_time = (
            payload.get("time")
            if "time" in payload
            else received_at.time().replace(tzinfo=None, microsecond=0)
        )
        transaction_type = payload.get("type") or candidate.transaction_type
        observation = None
        if transaction_type == Transaction.Type.TRANSFER:
            transfer_data, observation = sms_transfer_data(candidate, payload)
            account = transfer_data["account"]
            transfer_account = transfer_data["transfer_account"]
            payment_method = transfer_data["payment_method"]
        direction = (
            Transaction.Direction.DEBIT if transaction_type == Transaction.Type.TRANSFER
            else payload.get("direction") or Transaction.default_direction_for_type(transaction_type)
        )
        reference = payload.get("reference", candidate.reference)
        counterparty_text = payload.get("counterparty_text", candidate.counterparty_text)
        sender_account_identifier = payload.get(
            "sender_account_identifier",
            candidate.sender_account_identifier,
        )
        sender_card_identifier = payload.get(
            "sender_card_identifier",
            candidate.sender_card_identifier,
        )
        receiver_account_identifier = payload.get(
            "receiver_account_identifier",
            candidate.receiver_account_identifier,
        )
        receiver_card_identifier = payload.get(
            "receiver_card_identifier",
            candidate.receiver_card_identifier,
        )

        if account is None:
            if transaction_type == Transaction.Type.TRANSFER and payload.get("account_perspective"):
                return Response(
                    {"transfer_account": "Choose the other transfer account before confirming."},
                    status=status.HTTP_400_BAD_REQUEST,
                )
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
            and (
                Transaction.objects.filter(user=request.user, external_key=external_key).exists()
                or TransferEvidence.objects.filter(user=request.user, raw_message=candidate.raw_message).exists()
                or (reference and TransferEvidence.objects.filter(
                    user=request.user, provider=candidate.provider, reference__iexact=reference,
                ).exists())
            )
        ):
            return Response(
                {"detail": "A transaction with the same SMS/reference key already exists."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        transaction_record = Transaction.objects.create(
            user=request.user,
            account=account,
            transfer_account=transfer_account,
            category=category,
            payment_method=payment_method,
            raw_message=candidate.raw_message,
            date=transaction_date,
            time=transaction_time,
            type=transaction_type,
            direction=direction,
            amount=amount,
            balance_after=balance_after,
            sender_account_identifier=sender_account_identifier,
            sender_card_identifier=sender_card_identifier,
            receiver_account_identifier=receiver_account_identifier,
            receiver_card_identifier=receiver_card_identifier,
            reference=reference,
            counterparty_text=counterparty_text,
            external_key=external_key,
            note=payload.get("note") or self._build_transaction_note(candidate),
            source=Transaction.Source.SMS,
            needs_review=False,
        )
        if transaction_type == Transaction.Type.TRANSFER:
            add_transfer_evidence(transaction_record, observation, candidate)
            create_audit_log(
                user=request.user, action=AuditLogEntry.Action.CREATED,
                entity=transaction_record, after=transaction_snapshot(transaction_record),
                metadata={"candidate": str(candidate.id)},
            )
        candidate.transaction = transaction_record
        candidate.status = ParsedMessageCandidate.Status.CONFIRMED
        candidate.save(update_fields=("transaction", "status", "updated_at"))

        if payload["remember_mapping"] and observation:
            from .transfer_suggestions import remember_transfer_path
            remember_transfer_path(candidate, transaction_record, observation)

        if payload["remember_mapping"] and candidate.sender_rule and not (
            observation and counterparty_text
        ):
            sender_rule = candidate.sender_rule
            SenderRuleMapping.objects.update_or_create(
                sender_rule=sender_rule,
                message_kind=candidate.message_kind,
                defaults={
                    "user": request.user,
                    "account": account,
                    "payment_method": payment_method,
                    "category": category,
                    "transaction_type": transaction_type,
                },
            )
            pending = ParsedMessageCandidate.objects.filter(
                user=request.user,
                sender_rule=sender_rule,
                message_kind=candidate.message_kind,
                status=ParsedMessageCandidate.Status.NEEDS_REVIEW,
            )
            if observation and payload.get("account_perspective") and observation["direction"] == "credit":
                # One-sided incoming candidates store the receiver in account.
                pending.filter(destination_account__isnull=False).update(
                    account=account, payment_method=payment_method,
                )
                pending.update(category=category, transaction_type=transaction_type)
            else:
                pending.update(
                    account=account,
                    payment_method=payment_method,
                    category=category,
                    transaction_type=transaction_type,
                )

        capture_preference, _created = SmsCapturePreference.objects.get_or_create(user=request.user)
        retention_days = capture_preference.raw_sms_retention_days
        if retention_days == 0:
            candidate.raw_message.redact()

        return Response(ParsedMessageCandidateSerializer(candidate).data)

    def _build_transaction_note(self, candidate):
        parts = [candidate.get_message_kind_display()]
        if candidate.counterparty_text:
            parts.append(candidate.counterparty_text)
        return " · ".join(parts)

    def _get_candidate(self, user, candidate_id):
        return get_object_or_404(
            ParsedMessageCandidate.objects.select_related(
                "raw_message",
                "sender_rule",
                "account",
                "payment_method",
                "category",
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


class MessageCandidateRejectView(APIView):
    permission_classes = (IsAuthenticated,)

    @transaction.atomic
    def post(self, request, candidate_id):
        lock_transfer_user(request.user)
        candidate = get_object_or_404(
            ParsedMessageCandidate.objects.select_related("raw_message", "sender_rule"),
            user=request.user,
            id=candidate_id,
        )
        if candidate.status != ParsedMessageCandidate.Status.NEEDS_REVIEW:
            return Response(
                {"status": "Only pending candidates can be rejected."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        payload = request.data.copy()
        payload.setdefault("reason", ParsedMessageCandidate.RejectionReason.NOT_TRANSACTION)
        serializer = MessageCandidateRejectSerializer(data=payload)
        serializer.is_valid(raise_exception=True)
        rejection = serializer.validated_data
        excluded_kind = classify_message_kind_for_capture(candidate.raw_message.body)
        if candidate.raw_message.status == RawMessage.Status.REDACTED:
            excluded_kind = candidate.message_kind if candidate.message_kind in {"promotional", "otp_or_security", "balance_notice"} else ""
        if rejection["exclude_message_kind"] and not excluded_kind:
            return Response(
                {"exclude_message_kind": "Only recognized promotional, OTP/security or balance notices can be skipped by type. Unknown formats and financial messages require individual review."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        with transaction.atomic():
            candidate.status = ParsedMessageCandidate.Status.IGNORED
            candidate.rejection_reason = rejection["reason"]
            candidate.rejection_note = rejection["note"]
            candidate.rejected_at = timezone.now()
            candidate.save(
                update_fields=(
                    "status",
                    "rejection_reason",
                    "rejection_note",
                    "rejected_at",
                    "updated_at",
                )
            )

            raw_message = candidate.raw_message
            raw_message.provider = candidate.provider
            raw_message.message_kind = candidate.message_kind
            raw_message.exclusion_reason = f"user_rejected:{rejection['reason']}"
            raw_message.status = RawMessage.Status.IGNORED
            raw_message.save(
                update_fields=(
                    "provider",
                    "message_kind",
                    "exclusion_reason",
                    "status",
                )
            )

            if rejection["exclude_sender"] and candidate.sender_rule:
                candidate.sender_rule.is_active = False
                candidate.sender_rule.save(update_fields=("is_active", "updated_at"))

            if rejection["exclude_provider"] and candidate.provider:
                preference, _created = SmsCapturePreference.objects.get_or_create(
                    user=request.user
                )
                if candidate.provider not in preference.excluded_providers:
                    preference.excluded_providers = [
                        *preference.excluded_providers,
                        candidate.provider,
                    ]
                    preference.save(update_fields=("excluded_providers", "updated_at"))

            if rejection["exclude_message_kind"]:
                preference, _created = SmsCapturePreference.objects.get_or_create(user=request.user)
                if excluded_kind not in preference.excluded_message_kinds:
                    preference.excluded_message_kinds = [*preference.excluded_message_kinds, excluded_kind]
                    preference.save(update_fields=("excluded_message_kinds", "updated_at"))
                # Reuse capture classification, including older unknown offers.
                for pending in ParsedMessageCandidate.objects.filter(
                    user=request.user, status=ParsedMessageCandidate.Status.NEEDS_REVIEW,
                ).select_related("raw_message"):
                    if pending.message_kind == excluded_kind or classify_message_kind_for_capture(pending.raw_message.body) == excluded_kind:
                        RawMessageImportView()._reprocess_candidate(pending)

            if rejection["redact_raw_sms"]:
                raw_message.redact()

        candidate.refresh_from_db()
        return Response(ParsedMessageCandidateSerializer(candidate).data)


class RawMessageRedactView(APIView):
    permission_classes = (IsAuthenticated,)

    def post(self, request, message_id):
        raw_message = get_object_or_404(RawMessage, user=request.user, id=message_id)
        original_body = raw_message.body
        raw_message.redact()

        Transaction.objects.filter(
            user=request.user,
            raw_message=raw_message,
            note=original_body,
        ).update(note="SMS body redacted.")

        candidate = getattr(raw_message, "candidate", None)
        return Response(
            {
                "candidate": (
                    ParsedMessageCandidateSerializer(candidate).data
                    if candidate
                    else None
                ),
                "message": RawMessageSerializer(raw_message).data,
            }
        )
