"""Operational request metadata, deliberately excluding financial/personal input."""

import json
import logging
from time import perf_counter
from uuid import uuid4
from django.conf import settings

logger = logging.getLogger("finance.requests")


class ApiDiagnosticsMiddleware:
    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        if not request.path.startswith("/api/"):
            return self.get_response(request)
        request_id = uuid4().hex
        started = perf_counter()
        response = self.get_response(request)
        elapsed = round((perf_counter() - started) * 1000, 2)
        response["X-Request-ID"] = request_id
        response["Server-Timing"] = f"app;dur={elapsed:.2f}"
        if settings.FINANCE_API_REQUEST_LOGS:
            match = getattr(request, "resolver_match", None)
            record = {
                "request_id": request_id,
                "method": request.method,
                "route": str(match.route) if match else "unmatched",
                "status": response.status_code,
                "duration_ms": elapsed,
            }
            level = (
                logging.ERROR
                if response.status_code >= 500
                else logging.WARNING
                if response.status_code >= 400
                else logging.INFO
            )
            logger.log(level, json.dumps(record, sort_keys=True))
        return response
