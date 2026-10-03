"""URL routes for the finance API."""

from django.contrib import admin
from django.urls import include, path
from drf_spectacular.views import SpectacularAPIView, SpectacularSwaggerView
from rest_framework.routers import DefaultRouter

from apps.accounts.views import AccountViewSet
from apps.audit_logs.views import AuditLogEntryViewSet
from apps.categories.views import CategoryViewSet
from apps.credit_cards.views import CreditCardBillViewSet, CreditCardPaymentCreateView
from apps.debts.views import DebtPaymentCreateView, DebtViewSet
from apps.messages.views import (
    MessageCandidateConfirmView,
    MessageCandidateBulkReprocessView,
    MessageCandidateReprocessView,
    MessageCandidateRejectView,
    MessageReviewListView,
    RawMessageImportView,
    RawMessageRedactView,
    SenderRuleViewSet,
    SmsCapturePreferenceView,
    SmsDeviceStatusView,
    SmsDevelopmentResetView,
)
from apps.payment_methods.views import PaymentMethodViewSet
from apps.recurring_bills.views import RecurringBillPaymentCreateView, RecurringBillViewSet
from apps.reconciliation.views import AccountReconciliationView, BalanceSnapshotViewSet
from apps.transactions.views import TransactionViewSet


router = DefaultRouter()
router.register("accounts", AccountViewSet, basename="account")
router.register("audit-logs", AuditLogEntryViewSet, basename="audit-log")
router.register("categories", CategoryViewSet, basename="category")
router.register("credit-card-bills", CreditCardBillViewSet, basename="credit-card-bill")
router.register("debts", DebtViewSet, basename="debt")
router.register("payment-methods", PaymentMethodViewSet, basename="payment-method")
router.register("recurring-bills", RecurringBillViewSet, basename="recurring-bill")
router.register("reconciliation/snapshots", BalanceSnapshotViewSet, basename="balance-snapshot")
router.register("messages/sender-rules", SenderRuleViewSet, basename="sender-rule")
router.register("transactions", TransactionViewSet, basename="transaction")


urlpatterns = [
    path("admin/", admin.site.urls),
    path("api/auth/", include("apps.users.urls")),
    path("api/", include(router.urls)),
    path("api/health/", include("apps.health.urls")),
    path("api/messages/import/", RawMessageImportView.as_view(), name="raw-message-import"),
    path(
        "api/messages/capture-preferences/",
        SmsCapturePreferenceView.as_view(),
        name="sms-capture-preferences",
    ),
    path(
        "api/messages/device-status/",
        SmsDeviceStatusView.as_view(),
        name="sms-device-status",
    ),
    path(
        "api/messages/raw/<uuid:message_id>/redact/",
        RawMessageRedactView.as_view(),
        name="raw-message-redact",
    ),
    path("api/messages/review/", MessageReviewListView.as_view(), name="message-review-list"),
    path(
        "api/messages/review/reprocess/",
        MessageCandidateBulkReprocessView.as_view(),
        name="message-candidate-bulk-reprocess",
    ),
    path("api/messages/dev/reset/", SmsDevelopmentResetView.as_view(), name="sms-development-reset"),
    path(
        "api/messages/review/<uuid:candidate_id>/reprocess/",
        MessageCandidateReprocessView.as_view(),
        name="message-candidate-reprocess",
    ),
    path(
        "api/messages/review/<uuid:candidate_id>/confirm/",
        MessageCandidateConfirmView.as_view(),
        name="message-candidate-confirm",
    ),
    path(
        "api/messages/review/<uuid:candidate_id>/ignore/",
        MessageCandidateRejectView.as_view(),
        name="message-candidate-ignore",
    ),
    path(
        "api/messages/review/<uuid:candidate_id>/reject/",
        MessageCandidateRejectView.as_view(),
        name="message-candidate-reject",
    ),
    path("api/reports/", include("apps.reports.urls")),
    path(
        "api/reconciliation/accounts/<uuid:account_id>/",
        AccountReconciliationView.as_view(),
        name="account-reconciliation",
    ),
    path(
        "api/credit-card-bills/<uuid:bill_id>/payments/",
        CreditCardPaymentCreateView.as_view(),
        name="credit-card-payment-create",
    ),
    path(
        "api/recurring-bills/<uuid:bill_id>/payments/",
        RecurringBillPaymentCreateView.as_view(),
        name="recurring-bill-payment-create",
    ),
    path("api/debts/<uuid:debt_id>/payments/", DebtPaymentCreateView.as_view(), name="debt-payment-create"),
    path("api/schema/", SpectacularAPIView.as_view(), name="schema"),
    path(
        "api/docs/",
        SpectacularSwaggerView.as_view(url_name="schema"),
        name="swagger-ui",
    ),
]
