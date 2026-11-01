import hashlib
import hmac
import time
from django.conf import settings


def login_identity(request):
    secret = settings.FINANCE_PROXY_AUTH_SECRET
    identity = request.headers.get("X-Finance-Client", "")
    timestamp = request.headers.get("X-Finance-Client-Time", "")
    supplied = request.headers.get("X-Finance-Client-Signature", "")
    if not secret or len(identity) != 64:
        return None
    try:
        if abs(time.time() - int(timestamp)) > 60:
            return None
    except ValueError:
        return None
    expected = hmac.new(
        secret.encode(), f"login:{identity}:{timestamp}".encode(), hashlib.sha256
    ).hexdigest()
    return identity if hmac.compare_digest(expected, supplied) else None


def can_replay_refresh(request, token):
    secret = settings.FINANCE_PROXY_AUTH_SECRET
    if not secret or request is None:
        return False
    digest = hashlib.sha256(token.encode()).hexdigest()
    expected = hmac.new(
        secret.encode(), f"refresh:{digest}".encode(), hashlib.sha256
    ).hexdigest()
    return hmac.compare_digest(
        expected, request.headers.get("X-Finance-Refresh-Signature", "")
    )
