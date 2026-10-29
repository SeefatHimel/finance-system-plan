from django.urls import path

from .overview import FinancialOverviewView
from .views import DashboardSummaryView, MonthlyReportView


urlpatterns = [
    path("overview/", FinancialOverviewView.as_view(), name="financial-overview"),
    path("dashboard-summary/", DashboardSummaryView.as_view(), name="dashboard-summary"),
    path("monthly/", MonthlyReportView.as_view(), name="monthly-report"),
]

