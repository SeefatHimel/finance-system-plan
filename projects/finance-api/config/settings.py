"""Django settings for the finance API."""

import os
from datetime import timedelta
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlparse

from django.core.exceptions import ImproperlyConfigured
from dotenv import load_dotenv

BASE_DIR = Path(__file__).resolve().parent.parent
load_dotenv(BASE_DIR / ".env")


def env_bool(name: str, default: bool = False) -> bool:
    value = os.getenv(name)
    if value is None:
        return default
    return value.lower() in {"1", "true", "yes", "on"}


def env_list(name: str, default: list[str]) -> list[str]:
    value = os.getenv(name)
    if not value:
        return default
    return [item.strip() for item in value.split(",") if item.strip()]


def env_int(name: str, default: int) -> int:
    value = os.getenv(name)
    if value is None:
        return default
    try:
        parsed_value = int(value)
    except ValueError as error:
        raise ImproperlyConfigured(f"{name} must be an integer.") from error
    if parsed_value <= 0:
        raise ImproperlyConfigured(f"{name} must be greater than zero.")
    return parsed_value


SECRET_KEY = os.getenv("DJANGO_SECRET_KEY", "local-dev-secret")
SECRET_KEY_FALLBACKS = env_list("DJANGO_SECRET_KEY_FALLBACKS", [])
FINANCE_PROXY_AUTH_SECRET = os.getenv("FINANCE_PROXY_AUTH_SECRET", "")
DEBUG = env_bool("DJANGO_DEBUG", True)
FINANCE_API_REQUEST_LOGS = env_bool("FINANCE_API_REQUEST_LOGS", not DEBUG)
ALLOWED_HOSTS = env_list("DJANGO_ALLOWED_HOSTS", ["localhost", "127.0.0.1"])

RENDER_EXTERNAL_URL = os.getenv("RENDER_EXTERNAL_URL", "").rstrip("/")
CSRF_TRUSTED_ORIGINS = env_list("DJANGO_CSRF_TRUSTED_ORIGINS", [])
if RENDER_EXTERNAL_URL and RENDER_EXTERNAL_URL not in CSRF_TRUSTED_ORIGINS:
    CSRF_TRUSTED_ORIGINS.append(RENDER_EXTERNAL_URL)

# Render and similar platforms terminate TLS before proxying to Django.
SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")
CSRF_COOKIE_SECURE = not DEBUG
SESSION_COOKIE_SECURE = not DEBUG

INSTALLED_APPS = [
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    "corsheaders",
    "rest_framework",
    "drf_spectacular",
    "rest_framework_simplejwt.token_blacklist",
    "apps.accounts",
    "apps.audit_logs",
    "apps.categories.apps.CategoriesConfig",
    "apps.credit_cards",
    "apps.debts",
    "apps.health",
    "apps.messages",
    "apps.payment_methods",
    "apps.recurring_bills",
    "apps.reconciliation",
    "apps.reports",
    "apps.statements",
    "apps.transactions",
    "apps.users",
    "apps.quick_add",
]

MIDDLEWARE = [
    "corsheaders.middleware.CorsMiddleware",
    "config.middleware.PrivateApiResponseMiddleware",
    "config.diagnostics.ApiDiagnosticsMiddleware",
    "django.middleware.security.SecurityMiddleware",
    "whitenoise.middleware.WhiteNoiseMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
]

ROOT_URLCONF = "config.urls"

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
            ],
        },
    },
]

WSGI_APPLICATION = "config.wsgi.application"


def database_config() -> dict[str, object]:
    database_url = os.getenv("DATABASE_URL")
    if not database_url:
        return {
            "ENGINE": "django.db.backends.sqlite3",
            "NAME": BASE_DIR / "db.sqlite3",
        }

    parsed = urlparse(database_url)
    if parsed.scheme not in {"postgres", "postgresql"}:
        raise ValueError("DATABASE_URL must use postgres:// or postgresql://")

    host = parsed.hostname or "localhost"
    # Transaction poolers can move the next FETCH to another server connection.
    # Neon marks pooled endpoints with a -pooler suffix; other poolers can opt in.
    pooled_host = host.split(".", 1)[0].endswith("-pooler")
    query = parse_qs(parsed.query, keep_blank_values=True)
    allowed_options = {"sslmode", "sslrootcert", "sslcert", "sslkey", "connect_timeout", "application_name", "options"}
    if set(query) - allowed_options or any(len(values) != 1 for values in query.values()):
        raise ImproperlyConfigured("DATABASE_URL contains unsupported or repeated connection options.")
    options = {name: values[0] for name, values in query.items()}
    if "sslmode" in options and options["sslmode"] not in {"disable", "allow", "prefer", "require", "verify-ca", "verify-full"}:
        raise ImproperlyConfigured("DATABASE_URL contains an invalid sslmode.")
    if "connect_timeout" in options and (not options["connect_timeout"].isdigit() or not 1 <= int(options["connect_timeout"]) <= 300):
        raise ImproperlyConfigured("DATABASE_URL connect_timeout must be between 1 and 300 seconds.")
    return {
        "ENGINE": "django.db.backends.postgresql",
        "NAME": unquote(parsed.path.lstrip("/")),
        "USER": unquote(parsed.username or ""),
        "PASSWORD": unquote(parsed.password or ""),
        "HOST": host,
        "PORT": parsed.port or 5432,
        "OPTIONS": options,
        "DISABLE_SERVER_SIDE_CURSORS": env_bool(
            "DJANGO_DB_DISABLE_SERVER_SIDE_CURSORS", pooled_host
        ),
    }


DATABASES = {"default": database_config()}

AUTH_PASSWORD_VALIDATORS = [
    {"NAME": "django.contrib.auth.password_validation.UserAttributeSimilarityValidator"},
    {"NAME": "django.contrib.auth.password_validation.MinimumLengthValidator"},
    {"NAME": "django.contrib.auth.password_validation.CommonPasswordValidator"},
    {"NAME": "django.contrib.auth.password_validation.NumericPasswordValidator"},
]

LANGUAGE_CODE = "en-us"
TIME_ZONE = "Asia/Dhaka"
USE_I18N = True
USE_TZ = True

STATIC_URL = "static/"
STATIC_ROOT = BASE_DIR / "staticfiles"
if not DEBUG or env_bool("DJANGO_COLLECT_STATIC", False):
    STORAGES = {
        "staticfiles": {"BACKEND": "whitenoise.storage.CompressedManifestStaticFilesStorage"},
    }
DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

CORS_ALLOWED_ORIGINS = env_list(
    "DJANGO_CORS_ALLOWED_ORIGINS",
    ["http://localhost:3000"],
)


def validate_production_settings() -> None:
    if DEBUG:
        return

    errors = []
    database_engine = str(DATABASES["default"].get("ENGINE", ""))

    if len(FINANCE_PROXY_AUTH_SECRET) < 32:
        errors.append("FINANCE_PROXY_AUTH_SECRET must contain at least 32 characters and match the web proxy secret.")
    if SECRET_KEY == "local-dev-secret" or len(SECRET_KEY) < 32:
        errors.append("DJANGO_SECRET_KEY must be a strong non-default value.")
    if database_engine != "django.db.backends.postgresql":
        errors.append("DATABASE_URL must point to PostgreSQL when DJANGO_DEBUG=false.")
    if not ALLOWED_HOSTS or any(
        host in {"*", "localhost", "127.0.0.1"} for host in ALLOWED_HOSTS
    ):
        errors.append("DJANGO_ALLOWED_HOSTS must be restricted to deployed hostnames.")
    if any(
        origin.startswith(("http://localhost", "http://127.0.0.1"))
        for origin in CORS_ALLOWED_ORIGINS
    ):
        errors.append("DJANGO_CORS_ALLOWED_ORIGINS must be restricted to deployed HTTPS origins.")
    if not CSRF_TRUSTED_ORIGINS or any(
        not origin.startswith("https://") for origin in CSRF_TRUSTED_ORIGINS
    ):
        errors.append("DJANGO_CSRF_TRUSTED_ORIGINS must contain deployed HTTPS origins.")

    if errors:
        raise ImproperlyConfigured("Production settings are not safe: " + " ".join(errors))


validate_production_settings()

REST_FRAMEWORK = {
    "DEFAULT_SCHEMA_CLASS": "drf_spectacular.openapi.AutoSchema",
    "DEFAULT_AUTHENTICATION_CLASSES": (
        "rest_framework_simplejwt.authentication.JWTAuthentication",
        "rest_framework.authentication.SessionAuthentication",
    ),
    "DEFAULT_PERMISSION_CLASSES": (
        "rest_framework.permissions.IsAuthenticated",
    ),
    "DEFAULT_THROTTLE_RATES": {
        "login_ip": os.getenv("DJANGO_LOGIN_IP_RATE", "20/minute"),
        "login_username": os.getenv("DJANGO_LOGIN_USERNAME_RATE", "10/minute"),
    },
}

SIMPLE_JWT = {
    "ACCESS_TOKEN_LIFETIME": timedelta(
        minutes=env_int("DJANGO_JWT_ACCESS_MINUTES", 15)
    ),
    "REFRESH_TOKEN_LIFETIME": timedelta(
        days=env_int("DJANGO_JWT_REFRESH_DAYS", 30)
    ),
    "ROTATE_REFRESH_TOKENS": True,
    "BLACKLIST_AFTER_ROTATION": True,
    "UPDATE_LAST_LOGIN": True,
}

SPECTACULAR_SETTINGS = {
    "TITLE": "Finance API",
    "DESCRIPTION": "Backend API for the personal finance system.",
    "VERSION": "0.1.0",
}

LOGGING = {
    "version": 1, "disable_existing_loggers": False,
    "formatters": {"safe_json": {"format": "%(message)s"}},
    "handlers": {"finance_console": {"class": "logging.StreamHandler", "formatter": "safe_json"}},
    "loggers": {"finance.requests": {"handlers": ["finance_console"], "level": "INFO", "propagate": False}},
}
