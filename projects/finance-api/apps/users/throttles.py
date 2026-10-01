import hashlib

from rest_framework.throttling import AnonRateThrottle, SimpleRateThrottle


class LoginIpRateThrottle(AnonRateThrottle):
    scope = "login_ip"


class LoginUsernameRateThrottle(SimpleRateThrottle):
    scope = "login_username"

    def get_cache_key(self, request, view):
        username = str(request.data.get("username", "")).strip().casefold()
        if not username:
            return None

        username_digest = hashlib.sha256(username.encode()).hexdigest()
        return self.cache_format % {
            "scope": self.scope,
            "ident": username_digest,
        }
