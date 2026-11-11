from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.test import RequestFactory, SimpleTestCase, TestCase
from django.urls import reverse

from .settings import database_config


class AdminUserAddViewTests(TestCase):
    def test_user_add_form_renders(self):
        admin_user = get_user_model().objects.create_superuser(
            username="admin",
            email="admin@example.com",
            password="test-password",
        )
        self.client.force_login(admin_user)

        response = self.client.get(reverse("admin:auth_user_add"))

        self.assertEqual(response.status_code, 200)


class ProxySecuritySettingsTests(SimpleTestCase):
    def test_forwarded_https_scheme_is_recognized(self):
        request = RequestFactory().get(
            "/admin/login/",
            HTTP_HOST="api.example.com",
            HTTP_X_FORWARDED_PROTO="https",
        )

        self.assertTrue(request.is_secure())


class DatabaseSettingsTests(SimpleTestCase):
    def test_hosted_postgres_channel_binding_is_preserved_without_connecting(self):
        for mode in ("disable", "prefer", "require"):
            with self.subTest(mode=mode), patch("psycopg.connect") as connect:
                config = self.database_config_for(
                    "postgresql://user:synthetic@ep-example-pooler.c-4.aws.neon.tech/db"
                    f"?sslmode=require&channel_binding={mode}&connect_timeout=10"
                )
                self.assertEqual(config["OPTIONS"], {
                    "sslmode": "require", "channel_binding": mode, "connect_timeout": "10",
                })
                self.assertTrue(config["DISABLE_SERVER_SIDE_CURSORS"])
                connect.assert_not_called()

    def test_other_driver_options_are_not_silently_discarded(self):
        config = self.database_config_for(
            "postgresql://user:synthetic@db.example.com/db"
            "?target_session_attrs=read-write&keepalives_idle=30"
            "&application_name=synthetic%20release%20%27check%27"
        )
        self.assertEqual(config["OPTIONS"], {
            "target_session_attrs": "read-write", "keepalives_idle": "30",
            "application_name": "synthetic release 'check'",
        })

    def test_invalid_options_do_not_expose_connection_values(self):
        import traceback
        from django.core.exceptions import ImproperlyConfigured

        sentinel = "synthetic-secret-must-not-appear"
        try:
            self.database_config_for(
                f"postgresql://user:{sentinel}@db.example.com/db?unknown={sentinel}"
            )
        except ImproperlyConfigured:
            self.assertNotIn(sentinel, traceback.format_exc())
        else:
            self.fail("Unknown options must fail without leaking their values.")

    def test_security_options_and_encoded_credentials_are_preserved(self):
        config = self.database_config_for(
            "postgresql://user%40test:safe%2Ffake@db.example.com/db?sslmode=verify-full&connect_timeout=5"
        )
        self.assertEqual(config["USER"], "user@test")
        self.assertEqual(config["PASSWORD"], "safe/fake")
        self.assertEqual(
            config["OPTIONS"], {"sslmode": "verify-full", "connect_timeout": "5"}
        )

    def test_invalid_or_ignored_options_fail_explicitly(self):
        from django.core.exceptions import ImproperlyConfigured

        for query in [
            "sslmode=invalid",
            "connect_timeout=0",
            "connect_timeout=301",
            "connect_timeout=²",
            "unknown=yes",
            "sslmode=require&sslmode=disable",
            "channel_binding=invalid",
            "channel_binding=require&channel_binding=prefer",
            "host=other.example.com",
            "conninfo=postgresql%3A%2F%2Fother.example.com%2Fdb",
        ]:
            with self.subTest(query=query), self.assertRaises(ImproperlyConfigured):
                self.database_config_for(
                    f"postgresql://user:fake@db.example.com/db?{query}"
                )

    def database_config_for(self, url, override=None):
        environment = {"DATABASE_URL": url}
        if override is not None:
            environment["DJANGO_DB_DISABLE_SERVER_SIDE_CURSORS"] = override
        with patch.dict("os.environ", environment, clear=True):
            return database_config()

    def test_neon_transaction_pooler_disables_server_side_cursors(self):
        config = self.database_config_for(
            "postgresql://user:password@ep-example-pooler.c-4.aws.neon.tech/db"
        )
        self.assertTrue(config["DISABLE_SERVER_SIDE_CURSORS"])

    def test_direct_postgres_keeps_server_side_cursors(self):
        config = self.database_config_for(
            "postgresql://user:password@ep-example.c-4.aws.neon.tech/db"
        )
        self.assertFalse(config["DISABLE_SERVER_SIDE_CURSORS"])

    def test_other_transaction_poolers_can_opt_in(self):
        config = self.database_config_for(
            "postgresql://user:password@db.example.com/db", override="true"
        )
        self.assertTrue(config["DISABLE_SERVER_SIDE_CURSORS"])


class PrivateApiCachingTests(SimpleTestCase):
    def test_public_cache_directives_cannot_cache_api_payloads(self):
        from django.http import JsonResponse
        from .middleware import PrivateApiResponseMiddleware

        response = JsonResponse({"synthetic": "private"})
        response["Cache-Control"] = "public, max-age=3600"
        middleware = PrivateApiResponseMiddleware(lambda request: response)
        result = middleware(RequestFactory().get("/api/accounts/"))
        self.assertEqual(result["Cache-Control"], "private, no-store")

    def test_api_errors_are_private_and_existing_no_store_is_preserved(self):
        from django.http import JsonResponse
        from .middleware import PrivateApiResponseMiddleware

        response = JsonResponse({"error": "synthetic"}, status=401)
        result = PrivateApiResponseMiddleware(lambda request: response)(
            RequestFactory().get("/api/auth/me/")
        )
        self.assertEqual(result["Cache-Control"], "private, no-store")
        response["Cache-Control"] = "no-store"
        result = PrivateApiResponseMiddleware(lambda request: response)(
            RequestFactory().get("/api/health/")
        )
        self.assertEqual(result["Cache-Control"], "no-store")
