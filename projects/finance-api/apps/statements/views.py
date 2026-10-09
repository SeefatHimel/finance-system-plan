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

from .serializers import StatementPreviewRequestSerializer, StatementPreviewSerializer
from .uploads import BoundedStatementUploadHandler


class StatementPreviewThrottle(UserRateThrottle):
    scope = "statement_preview"
    rate = "10/hour"


@method_decorator(sensitive_post_parameters("password", "file"), name="dispatch")
class StatementPreviewView(APIView):
    permission_classes = (IsAuthenticated,)
    parser_classes = (MultiPartParser, FormParser)
    throttle_classes = (StatementPreviewThrottle,)

    def initialize_request(self, request, *args, **kwargs):
        request.upload_handlers.insert(0, BoundedStatementUploadHandler(request))
        return super().initialize_request(request, *args, **kwargs)

    def extract(self, request, serializer=None):
        serializer = serializer or StatementPreviewRequestSerializer(
            data=request.data, context={"request": request}
        )
        serializer.is_valid(raise_exception=True)
        account = serializer.validated_data["account"]
        payload = {
            "pdf": base64.b64encode(serializer.validated_data["file"].read()).decode(
                "ascii"
            ),
            "password": serializer.validated_data.get("password", ""),
        }
        try:
            # subprocess.run kills and waits for the worker on timeout. No PDFs,
            # passwords, or parser tracebacks are persisted or logged here.
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
                {
                    "file": [
                        "Preview took too long. Export a shorter statement period and retry."
                    ]
                },
                status=status.HTTP_422_UNPROCESSABLE_ENTITY,
            )
        except (subprocess.SubprocessError, OSError, ValueError):
            return Response(
                {
                    "file": [
                        "Statement processing is temporarily unavailable. Please retry."
                    ]
                },
                status=status.HTTP_503_SERVICE_UNAVAILABLE,
            )
        if "error" in output:
            raise ValidationError({"file": [output["error"]], "code": [output["code"]]})
        preview = output["preview"]
        if (preview["profile"] == "bkash") != (account.type == "mobile_wallet"):
            raise ValidationError(
                {
                    "account": [
                        "Choose a wallet account for bKash or a bank/savings account for a bank statement."
                    ]
                }
            )
        preview["account"] = str(account.id)
        hint = preview["account_hint"]
        suggestion = statement_account_suggestion(
            user=request.user, profile=preview["profile"], hint=hint
        )
        preview["account_suggestion"] = suggestion
        suffix_matches = bool(suggestion and suggestion["account"] == str(account.id))
        if suggestion and suggestion["ambiguous"]:
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
