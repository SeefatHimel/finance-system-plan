import hashlib
from datetime import timedelta
from django.db import transaction
from django.utils import timezone
from rest_framework.throttling import AnonRateThrottle, SimpleRateThrottle
from .models import AuthRateWindow
from .proxy_auth import login_identity


class SharedAuthThrottle:
    def get_rate(self):
        from rest_framework.settings import api_settings

        return api_settings.DEFAULT_THROTTLE_RATES[self.scope]

    def allow_request(self, request, view):
        if not self.rate:
            return True
        if self.scope == "login_username" and getattr(
            request, "login_ip_denied", False
        ):
            self.history = []
            self.now = timezone.now().timestamp()
            return False
        key = self.get_cache_key(request, view)
        if key is None:
            return True
        now = timezone.now()
        with transaction.atomic():
            row, _ = AuthRateWindow.objects.select_for_update().get_or_create(
                key=key, defaults={"expires_at": now + timedelta(seconds=self.duration)}
            )
            self.history = [
                hit for hit in row.hits if hit > now.timestamp() - self.duration
            ]
            self.now = now.timestamp()
            allowed = len(self.history) < self.num_requests
            if allowed:
                self.history.insert(0, self.now)
            row.hits = self.history
            row.expires_at = now + timedelta(seconds=self.duration)
            row.save(update_fields=("hits", "expires_at"))
        # A bounded sweep keeps expired, attacker-selected usernames from growing
        # the table forever without requiring an external task scheduler.
        stale = list(
            AuthRateWindow.objects.filter(expires_at__lt=now).values_list(
                "key", flat=True
            )[:100]
        )
        if stale:
            AuthRateWindow.objects.filter(key__in=stale, expires_at__lt=now).delete()
        if self.scope == "login_ip" and not allowed:
            request.login_ip_denied = True
        return allowed


class LoginIpRateThrottle(SharedAuthThrottle, AnonRateThrottle):
    scope = "login_ip"

    def get_ident(self, request):
        # Untrusted forwarded headers must not permit direct API throttle bypass.
        return hashlib.sha256(
            (
                login_identity(request) or request.META.get("REMOTE_ADDR", "unknown")
            ).encode()
        ).hexdigest()


class LoginUsernameRateThrottle(SharedAuthThrottle, SimpleRateThrottle):
    scope = "login_username"

    def get_cache_key(self, request, view):
        username = str(request.data.get("username", "")).strip().casefold()
        if not username:
            return None
        return self.cache_format % {
            "scope": self.scope,
            "ident": hashlib.sha256(username.encode()).hexdigest(),
        }
