from django.urls import path

from .views import DashboardSummaryView, MonthlyReportView


urlpatterns = [
    path("dashboard-summary/", DashboardSummaryView.as_view(), name="dashboard-summary"),
    path("monthly/", MonthlyReportView.as_view(), name="monthly-report"),
]

