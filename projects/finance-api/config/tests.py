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
