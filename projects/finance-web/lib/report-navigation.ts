import { monthPeriod, periodFromFilters, type DatePeriod } from "./date-period";
import { canonicalReportRules, type ReportRules } from "./report-rules";

export const reportFiltersKey = "finance.reports.filters.v1";
export const customReportFiltersKey = "finance.customReports.filters.v1";
export const customReportListKey = "finance.customReports.list.v1";
const reportIdPattern = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";

export function isCustomReportPathname(pathname: string) {
  return /^\/custom-reports(?:\/new)?\/?$/.test(pathname) || new RegExp(`^/custom-reports/${reportIdPattern}(?:/edit)?/?$`, "i").test(pathname);
}

export function customReportPath(id: string) { return `/custom-reports/${encodeURIComponent(id)}`; }
export function customReportEditPath(id: string) { return `${customReportPath(id)}/edit`; }
export function reportDraftKey(id?: string) { return `${customReportFiltersKey}.${id ?? "new"}`; }
export type ReportFilters = { period: DatePeriod; account: string; currency: string; savedReport: string; rules?: ReportRules };

export function reportReturnPath(value: string | null) {
  if (!value?.startsWith("/") || value.startsWith("//") || value.includes("\\")) return null;
  try {
    const url = new URL(value, "https://finance.invalid");
    return url.origin === "https://finance.invalid" && (url.pathname === "/reports" || isCustomReportPathname(url.pathname))
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
    currency: params.get("currency") ?? "BDT", savedReport: params.get("saved_report") ?? "", ...rulesFromParams(params) };
}

function rulesFromParams(params: URLSearchParams): { rules?: ReportRules } {
  if (!params.has("rules")) return {};
  try { return { rules: canonicalReportRules(JSON.parse(params.get("rules")!)) }; }
  catch { return {}; }
}

export function reportFilterQuery(filters: ReportFilters) {
  return new URLSearchParams({ start_date: filters.period.start, end_date: filters.period.end,
    date_view: filters.period.mode, currency: filters.currency,
    ...(filters.rules ? { rules: JSON.stringify(canonicalReportRules(filters.rules)) } : {}),
    ...(filters.account ? { account: filters.account } : {}), ...(filters.savedReport ? { saved_report: filters.savedReport } : {}) }).toString();
}
