"""Expired-window cleanup must not remove the record between lookup and lock."""

from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta
from unittest import skipUnless
from django.db import close_old_connections, connection
from django.test import TransactionTestCase
from django.utils import timezone
from rest_framework.request import Request
from rest_framework.test import APIRequestFactory
from .models import AuthRateWindow
from .throttles import LoginIpRateThrottle


@skipUnless(
    connection.vendor == "postgresql", "Independent row locks require PostgreSQL"
)
class ConcurrentThrottleCleanupTests(TransactionTestCase):
    def test_cleanup_winning_before_row_lock_recreates_window_and_accepts_login(self):
        request = Request(
            APIRequestFactory().post("/api/auth/login/", {}, format="json")
        )
        throttle = LoginIpRateThrottle()
        key = throttle.get_cache_key(request, None)
        AuthRateWindow.objects.create(
            key=key, hits=[], expires_at=timezone.now() - timedelta(seconds=1)
        )
        swept = False

        def cleanup():
            close_old_connections()
            try:
                return AuthRateWindow.objects.filter(
                    key=key, expires_at__lt=timezone.now()
                ).delete()[0]
            finally:
                close_old_connections()

        def interleave(execute, sql, params, many, context):
            nonlocal swept
            if not swept and "users_authratewindow" in sql and "FOR UPDATE" in sql:
                swept = True
                with ThreadPoolExecutor(max_workers=1) as pool:
                    self.assertEqual(pool.submit(cleanup).result(timeout=10), 1)
            return execute(sql, params, many, context)

        with connection.execute_wrapper(interleave):
            allowed = throttle.allow_request(request, None)
        self.assertTrue(swept)
        self.assertTrue(allowed)
        row = AuthRateWindow.objects.get(key=key)
        self.assertEqual(len(row.hits), 1)
        self.assertGreater(row.expires_at, timezone.now())

    def test_cleanup_waits_for_locked_window_and_preserves_renewed_expiry(self):
        from threading import Event

        request = Request(
            APIRequestFactory().post("/api/auth/login/", {}, format="json")
        )
        throttle = LoginIpRateThrottle()
        key = throttle.get_cache_key(request, None)
        AuthRateWindow.objects.create(
            key=key, hits=[], expires_at=timezone.now() - timedelta(seconds=1)
        )
        started = Event()
        pending = None

        def cleanup():
            close_old_connections()
            try:
                started.set()
                return AuthRateWindow.objects.filter(
                    key=key, expires_at__lt=timezone.now()
                ).delete()[0]
            finally:
                close_old_connections()

        with ThreadPoolExecutor(max_workers=1) as pool:

            def interleave(execute, sql, params, many, context):
                nonlocal pending
                result = execute(sql, params, many, context)
                if (
                    pending is None
                    and "users_authratewindow" in sql
                    and "FOR UPDATE" in sql
                ):
                    pending = pool.submit(cleanup)
                    self.assertTrue(started.wait(timeout=5))
                return result

            with connection.execute_wrapper(interleave):
                self.assertTrue(throttle.allow_request(request, None))
            self.assertIsNotNone(pending)
            self.assertEqual(pending.result(timeout=10), 0)
        self.assertEqual(len(AuthRateWindow.objects.get(key=key).hits), 1)
