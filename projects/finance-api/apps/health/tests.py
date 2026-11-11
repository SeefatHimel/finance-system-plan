from unittest.mock import patch

from django.db import OperationalError
from django.test import SimpleTestCase, TestCase
from django.urls import reverse


class HealthEndpointTests(SimpleTestCase):
    def test_health_endpoint_returns_ok(self):
        response = self.client.get(reverse("health"))

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"status": "ok"})

class ReadinessTests(TestCase):
    def test_ready_checks_the_database_and_schema(self):
        response = self.client.get(reverse("readiness"))
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"status": "ready"})
        self.assertEqual(response["Cache-Control"], "no-store")

    def test_database_failure_is_redacted_and_does_not_change_liveness(self):
        with patch("apps.health.views.MigrationExecutor", side_effect=OperationalError("synthetic-private-error")):
            response = self.client.get(reverse("readiness"))
        self.assertEqual(response.status_code, 503)
        self.assertEqual(response.json(), {"status": "unavailable"})
        self.assertEqual(self.client.get(reverse("health")).status_code, 200)

    def test_pending_migrations_fail_readiness(self):
        with patch("apps.health.views.MigrationExecutor") as executor:
            executor.return_value.migration_plan.return_value = ["pending"]
            self.assertEqual(self.client.get(reverse("readiness")).status_code, 503)
