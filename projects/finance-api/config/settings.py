"""Django settings for the finance API."""

from datetime import timedelta
from pathlib import Path
from urllib.parse import urlparse
import os

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


SECRET_KEY = os.getenv("DJANGO_SECRET_KEY", "local-dev-secret")
DEBUG = env_bool("DJANGO_DEBUG", True)
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
    "apps.categories",
    "apps.credit_cards",
    "apps.debts",
    "apps.health",
    "apps.messages",
    "apps.payment_methods",
    "apps.recurring_bills",
    "apps.reconciliation",
    "apps.reports",
    "apps.transactions",
    "apps.users",
]

MIDDLEWARE = [
    "corsheaders.middleware.CorsMiddleware",
    "django.middleware.security.SecurityMiddleware",
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

    return {
        "ENGINE": "django.db.backends.postgresql",
        "NAME": parsed.path.lstrip("/"),
        "USER": parsed.username or "",
        "PASSWORD": parsed.password or "",
        "HOST": parsed.hostname or "localhost",
        "PORT": parsed.port or 5432,
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

    if SECRET_KEY == "local-dev-secret" or len(SECRET_KEY) < 32:
        errors.append("DJANGO_SECRET_KEY must be a strong non-default value.")
    if database_engine != "django.db.backends.postgresql":
        errors.append("DATABASE_URL must point to PostgreSQL when DJANGO_DEBUG=false.")
    if not ALLOWED_HOSTS or any(
        host in {"*", "localhost", "127.0.0.1"} for host in ALLOWED_HOSTS
    ):
        errors.append("DJANGO_ALLOWED_HOSTS must be restricted to deployed hostnames.")
    if any(
        origin.startswith("http://localhost") or origin.startswith("http://127.0.0.1")
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
}

SIMPLE_JWT = {
    "ACCESS_TOKEN_LIFETIME": timedelta(minutes=10),
    "REFRESH_TOKEN_LIFETIME": timedelta(days=14),
    "ROTATE_REFRESH_TOKENS": True,
    "BLACKLIST_AFTER_ROTATION": True,
    "UPDATE_LAST_LOGIN": True,
}

SPECTACULAR_SETTINGS = {
    "TITLE": "Finance API",
    "DESCRIPTION": "Backend API for the personal finance system.",
    "VERSION": "0.1.0",
}
