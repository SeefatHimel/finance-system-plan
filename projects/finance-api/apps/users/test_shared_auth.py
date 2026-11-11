"""Synthetic proxy signatures and distributed authentication regressions."""

import hashlib
import hmac
import time
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier
from datetime import timedelta
from django.conf import settings
from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.test import override_settings
from django.test import TransactionTestCase
from django.db import close_old_connections
from django.utils import timezone
from rest_framework.test import APITestCase
from rest_framework.test import APIClient, APIRequestFactory
from rest_framework.request import Request
from rest_framework_simplejwt.tokens import RefreshToken
from .models import RefreshReplay

SECRET = "synthetic-proxy-secret-with-at-least-32-characters"


def refresh_headers(token):
    digest = hashlib.sha256(token.encode()).hexdigest()
    return {
        "HTTP_X_FINANCE_REFRESH_SIGNATURE": hmac.new(
            SECRET.encode(), f"refresh:{digest}".encode(), hashlib.sha256
        ).hexdigest()
    }


def login_headers(ip):
    identity = hashlib.sha256(ip.encode()).hexdigest()
    timestamp = str(int(time.time()))
    signature = hmac.new(
        SECRET.encode(), f"login:{identity}:{timestamp}".encode(), hashlib.sha256
    ).hexdigest()
    return {
        "HTTP_X_FINANCE_CLIENT": identity,
        "HTTP_X_FINANCE_CLIENT_TIME": timestamp,
        "HTTP_X_FINANCE_CLIENT_SIGNATURE": signature,
    }


@override_settings(FINANCE_PROXY_AUTH_SECRET=SECRET)
class SharedAuthTests(APITestCase):
    def setUp(self):
        self.user = get_user_model().objects.create_user(
            username="synthetic-shared-auth"
        )

    def rotate(self, token, **headers):
        return self.client.post(
            "/api/auth/refresh/", {"refresh": token}, format="json", **headers
        )

    def test_signed_retries_reuse_only_a_short_encrypted_result(self):
        token = str(RefreshToken.for_user(self.user))
        first = self.rotate(token, **refresh_headers(token))
        second = self.rotate(token, **refresh_headers(token))
        self.assertEqual(first.status_code, 200)
        self.assertEqual(second.data, first.data)
        saved = RefreshReplay.objects.get()
        self.assertNotIn(first.data["refresh"].encode(), bytes(saved.ciphertext))
        self.assertEqual(self.rotate(token).status_code, 401)
        RefreshReplay.objects.update(expires_at=timezone.now() - timedelta(seconds=1))
        self.assertEqual(self.rotate(token, **refresh_headers(token)).status_code, 401)

    def test_logout_wins_over_replaying_an_old_rotation(self):
        token = str(RefreshToken.for_user(self.user))
        result = self.rotate(token, **refresh_headers(token))
        self.assertEqual(
            self.client.post(
                "/api/auth/logout/", {"refresh": result.data["refresh"]}, format="json"
            ).status_code,
            204,
        )
        self.assertEqual(self.rotate(token, **refresh_headers(token)).status_code, 401)

    def test_logout_of_concurrently_consumed_cookie_revokes_successor(self):
        token = str(RefreshToken.for_user(self.user))
        result = self.rotate(token, **refresh_headers(token))
        self.assertEqual(
            self.client.post(
                "/api/auth/logout/", {"refresh": token}, format="json"
            ).status_code,
            204,
        )
        self.assertEqual(self.rotate(result.data["refresh"]).status_code, 401)
        self.assertFalse(RefreshReplay.objects.exists())

    def test_plain_or_forged_replay_does_not_get_the_proxy_grace(self):
        token = str(RefreshToken.for_user(self.user))
        self.assertEqual(self.rotate(token).status_code, 200)
        self.assertEqual(
            self.rotate(token, HTTP_X_FINANCE_REFRESH_SIGNATURE="forged").status_code,
            401,
        )

    @override_settings(
        REST_FRAMEWORK={
            **settings.REST_FRAMEWORK,
            "DEFAULT_THROTTLE_RATES": {
                "login_ip": "2/minute",
                "login_username": "100/minute",
            },
        }
    )
    def test_throttles_survive_cache_clear_and_separate_signed_proxy_clients(self):
        payload = {"username": "synthetic-missing", "password": "synthetic-invalid"}

        def login(**headers):
            return self.client.post(
                "/api/auth/login/", payload, format="json", **headers
            )

        self.assertEqual(login(**login_headers("192.0.2.10")).status_code, 401)
        cache.clear()
        self.assertEqual(login(**login_headers("192.0.2.10")).status_code, 401)
        self.assertEqual(login(**login_headers("192.0.2.10")).status_code, 429)
        self.assertEqual(login(**login_headers("192.0.2.11")).status_code, 401)
        # A direct caller cannot reset its remote-address quota using X-Forwarded-For.
        for index in range(2):
            self.assertEqual(
                login(HTTP_X_FORWARDED_FOR=f"192.0.2.{index}").status_code, 401
            )
        self.assertEqual(login(HTTP_X_FORWARDED_FOR="192.0.2.99").status_code, 429)


@override_settings(FINANCE_PROXY_AUTH_SECRET=SECRET)
class ConcurrentAuthTests(TransactionTestCase):
    """Use separate database connections, as independent API workers would."""

    def parallel(self, count, callback):
        barrier = Barrier(count)

        def worker(index):
            close_old_connections()
            try:
                barrier.wait(timeout=10)
                return callback(index)
            finally:
                close_old_connections()

        with ThreadPoolExecutor(max_workers=count) as pool:
            return list(pool.map(worker, range(count)))

    def test_simultaneous_signed_refreshes_return_the_same_rotation(self):
        user = get_user_model().objects.create_user(
            username="synthetic-concurrent-auth"
        )
        token = str(RefreshToken.for_user(user))

        def refresh(_):
            response = APIClient().post(
                "/api/auth/refresh/",
                {"refresh": token},
                format="json",
                **refresh_headers(token),
            )
            return response.status_code, response.data

        results = self.parallel(2, refresh)
        self.assertEqual([status for status, _ in results], [200, 200])
        self.assertEqual(results[0][1], results[1][1])
        self.assertEqual(RefreshReplay.objects.count(), 1)

    @override_settings(
        REST_FRAMEWORK={
            **settings.REST_FRAMEWORK,
            "DEFAULT_THROTTLE_RATES": {
                "login_ip": "2/minute",
                "login_username": "100/minute",
            },
        }
    )
    def test_simultaneous_requests_cannot_overspend_ip_quota(self):
        from .throttles import LoginIpRateThrottle

        def attempt(_):
            request = Request(
                APIRequestFactory().post(
                    "/api/auth/login/", {}, **login_headers("192.0.2.30")
                )
            )
            return LoginIpRateThrottle().allow_request(request, None)

        self.assertEqual(sum(self.parallel(5, attempt)), 2)
