from django.urls import path
from rest_framework.routers import SimpleRouter

from .overview import FinancialOverviewView
from .views import DashboardSummaryView, MonthlyReportView
from .saved import SavedReportViewSet


router = SimpleRouter()
router.register("saved", SavedReportViewSet, basename="saved-report")

urlpatterns = router.urls + [
    path("overview/", FinancialOverviewView.as_view(), name="financial-overview"),
    path("dashboard-summary/", DashboardSummaryView.as_view(), name="dashboard-summary"),
    path("monthly/", MonthlyReportView.as_view(), name="monthly-report"),
]

