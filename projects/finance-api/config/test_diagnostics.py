import json
from types import SimpleNamespace
from django.http import JsonResponse
from django.test import RequestFactory, SimpleTestCase, override_settings
from .diagnostics import ApiDiagnosticsMiddleware


class SafeDiagnosticsTests(SimpleTestCase):
    @override_settings(FINANCE_API_REQUEST_LOGS=True)
    def test_logs_have_route_patterns_without_body_headers_query_or_account_ids(self):
        request = RequestFactory().post(
            "/api/transactions/synthetic-private-id/?search=synthetic-private-note",
            data={"amount": "1234.56"},
            HTTP_AUTHORIZATION="Bearer synthetic-private-token",
        )
        request.resolver_match = SimpleNamespace(route="api/transactions/<uuid:pk>/")
        with self.assertLogs("finance.requests", level="INFO") as logs:
            response = ApiDiagnosticsMiddleware(
                lambda request: JsonResponse({"ok": True})
            )(request)
        record = json.loads(logs.records[0].getMessage())
        self.assertEqual(
            set(record), {"request_id", "route", "method", "status", "duration_ms"}
        )
        self.assertEqual(record["route"], request.resolver_match.route)
        self.assertNotIn("synthetic-private", logs.output[0])
        self.assertNotIn("1234.56", logs.output[0])
        self.assertEqual(response["X-Request-ID"], record["request_id"])
        self.assertIn("app;dur=", response["Server-Timing"])

    @override_settings(FINANCE_API_REQUEST_LOGS=False)
    def test_private_diagnostics_can_be_disabled_without_removing_request_identity(
        self,
    ):
        with self.assertNoLogs("finance.requests"):
            response = ApiDiagnosticsMiddleware(
                lambda request: JsonResponse({"ok": True})
            )(RequestFactory().get("/api/health/"))
        self.assertTrue(response["X-Request-ID"])
