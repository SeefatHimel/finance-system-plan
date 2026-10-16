import base64
import json
import subprocess
import sys

from django.conf import settings
from django.utils.decorators import method_decorator
from django.views.decorators.debug import sensitive_post_parameters
from drf_spectacular.utils import extend_schema
from rest_framework import status
from rest_framework.exceptions import ValidationError
from rest_framework.parsers import FormParser, MultiPartParser
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.throttling import UserRateThrottle
from rest_framework.views import APIView

from apps.payment_methods.resolution import statement_account_suggestion

from .serializers import (
    StatementIdentifyRequestSerializer,
    StatementIdentifySerializer,
    StatementPreviewRequestSerializer,
    StatementPreviewSerializer,
)
from .uploads import BoundedStatementUploadHandler


class StatementPreviewThrottle(UserRateThrottle):
    scope = "statement_preview"
    rate = "10/hour"


class StatementIdentifyThrottle(StatementPreviewThrottle):
    # Recognition must not consume the user's existing preview/import allowance.
    scope = "statement_identify"


def extract_pdf_bytes(data, password="", *, include_private_identifiers=False):
    """Run the bounded PDF worker for imports and archived-source refreshes."""
    payload = {
        "pdf": base64.b64encode(data).decode("ascii"), "password": password,
        "include_private_identifiers": include_private_identifiers,
    }
    try:
        result = subprocess.run(
            [sys.executable, "-m", "apps.statements.worker"],
            input=json.dumps(payload).encode(),
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            cwd=settings.BASE_DIR,
            timeout=20,
            check=True,
        )
        output = json.loads(result.stdout)
    except subprocess.TimeoutExpired:
        return Response(
            {"file": ["Preview took too long. Export a shorter statement period and retry."]},
            status=status.HTTP_422_UNPROCESSABLE_ENTITY,
        )
    except (subprocess.SubprocessError, OSError, ValueError):
        return Response(
            {"file": ["Statement processing is temporarily unavailable. Please retry."]},
            status=status.HTTP_503_SERVICE_UNAVAILABLE,
        )
    if "error" in output:
        raise ValidationError({"file": [output["error"]], "code": [output["code"]]})
    return output["preview"]


@method_decorator(sensitive_post_parameters("password", "file"), name="dispatch")
class StatementPreviewView(APIView):
    permission_classes = (IsAuthenticated,)
    parser_classes = (MultiPartParser, FormParser)
    throttle_classes = (StatementPreviewThrottle,)

    def initialize_request(self, request, *args, **kwargs):
        request.upload_handlers.insert(0, BoundedStatementUploadHandler(request))
        return super().initialize_request(request, *args, **kwargs)

    def extract(self, request, serializer=None, *, include_private_identifiers=False):
        serializer = serializer or StatementPreviewRequestSerializer(
            data=request.data, context={"request": request}
        )
        serializer.is_valid(raise_exception=True)
        account = serializer.validated_data.get("account")
        # The worker gets private bytes/password on stdin, never in argv or logs.
        preview = extract_pdf_bytes(
            serializer.validated_data["file"].read(),
            serializer.validated_data.get("password", ""),
            include_private_identifiers=include_private_identifiers,
        )
        if isinstance(preview, Response):
            return preview
        if not include_private_identifiers:
            for row in preview["rows"]:
                row.pop("bkash_identifier", None)
        if account and (preview["profile"] == "bkash") != (
            account.type == "mobile_wallet"
        ):
            raise ValidationError(
                {
                    "account": [
                        "Choose a wallet account for bKash or a bank/savings account for a bank statement."
                    ]
                }
            )
        preview["account"] = str(account.id) if account else None
        hint = preview["account_hint"]
        suggestion = statement_account_suggestion(
            user=request.user, profile=preview["profile"], hint=hint
        )
        preview["account_suggestion"] = suggestion
        suffix_matches = bool(
            account and suggestion and suggestion["account"] == str(account.id)
        )
        if suggestion and (suggestion["ambiguous"] or suggestion.get("requires_review")):
            preview["warnings"].append(suggestion["reason"])
        preview["account_identity"] = "matched_suffix" if suffix_matches else "verify"
        preview["warnings"].append(
            "Verify the selected account against the masked statement identifier. A suffix match is only a hint, not proof of ownership."
        )
        return Response(preview)

    @extend_schema(
        request=StatementPreviewRequestSerializer,
        responses=StatementPreviewSerializer,
        tags=["Statements"],
    )
    def post(self, request):
        return self.extract(request)

    def finalize_response(self, request, response, *args, **kwargs):
        response = super().finalize_response(request, response, *args, **kwargs)
        response["Cache-Control"] = "no-store"
        return response


class StatementIdentifyView(StatementPreviewView):
    throttle_classes = (StatementIdentifyThrottle,)

    @extend_schema(
        request=StatementIdentifyRequestSerializer,
        responses=StatementIdentifySerializer,
        tags=["Statements"],
    )
    def post(self, request):
        serializer = StatementIdentifyRequestSerializer(
            data=request.data, context={"request": request}
        )
        response = self.extract(request, serializer)
        if response.status_code == status.HTTP_200_OK:
            response.data = {
                key: response.data[key]
                for key in ("profile", "account_hint", "account_suggestion")
            }
        return response
