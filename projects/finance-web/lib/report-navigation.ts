import { monthPeriod, periodFromFilters, type DatePeriod } from "./date-period";

export const reportFiltersKey = "finance.reports.filters.v1";
export const customReportFiltersKey = "finance.customReports.filters.v1";
export type ReportFilters = { period: DatePeriod; account: string; currency: string; savedReport: string };

export function reportReturnPath(value: string | null) {
  if (!value?.startsWith("/") || value.startsWith("//") || value.includes("\\")) return null;
  try {
    const url = new URL(value, "https://finance.invalid");
    return url.origin === "https://finance.invalid" && ["/reports", "/custom-reports"].includes(url.pathname)
      ? `${url.pathname}${url.search}${url.hash}` : null;
  } catch { return null; }
}

export function reportFiltersFromQuery(query: string): ReportFilters {
  const params = new URLSearchParams(query);
  let period = periodFromFilters(Object.fromEntries(params), params.get("date_view") ?? undefined);
  if (params.get("date_view") === "monthly" && period.mode !== "all") {
    const month = monthPeriod(period.start.slice(0, 7));
    if (month.start === period.start && month.end === period.end) period = month;
  }
  return { period: period.mode === "all" ? monthPeriod() : period, account: params.get("account") ?? "",
    currency: params.get("currency") ?? "BDT", savedReport: params.get("saved_report") ?? "" };
}

export function reportFilterQuery(filters: ReportFilters) {
  return new URLSearchParams({ start_date: filters.period.start, end_date: filters.period.end,
    date_view: filters.period.mode, currency: filters.currency,
    ...(filters.account ? { account: filters.account } : {}), ...(filters.savedReport ? { saved_report: filters.savedReport } : {}) }).toString();
}
