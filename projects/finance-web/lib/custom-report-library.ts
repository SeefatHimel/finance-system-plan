import { savedReportRules } from "./report-rules";

type ReportDefinition = { id: string; name: string; start_date: string; end_date: string; currency: string; updated_at: string };
export type ReportListSort = "updated" | "name" | "period";
export function reportListState(query: string) {
  const params = new URLSearchParams(query);
  const sort = params.get("sort");
  return { search: (params.get("q") ?? "").slice(0, 256), sort: sort === "name" || sort === "period" ? sort : "updated" as ReportListSort, currency: /^[A-Z]{3}$/.test(params.get("report_currency") ?? "") ? params.get("report_currency")! : "" };
}
export function reportListQuery(search: string, sort: ReportListSort, currency = "") {
  const params = new URLSearchParams(); if (search) params.set("q", search); if (sort !== "updated") params.set("sort", sort);
  if (currency) params.set("report_currency", currency);
  return params.toString();
}
export function filterReportLibrary<T extends ReportDefinition>(reports: T[], search: string, sort: ReportListSort, currency = ""): T[] {
  const needle = search.trim().toLocaleLowerCase();
  return reports.filter(row => (!currency || row.currency === currency) && `${row.name} ${row.currency}`.toLocaleLowerCase().includes(needle)).sort((a, b) => {
    const order = sort === "name" ? a.name.localeCompare(b.name) : sort === "period" ? b.start_date.localeCompare(a.start_date) : b.updated_at.localeCompare(a.updated_at);
    return order || a.name.localeCompare(b.name) || a.id.localeCompare(b.id);
  });
}
export function reportScopeSummary(report: Parameters<typeof savedReportRules>[0]) {
  const rules = savedReportRules(report);
  return [rules.accounts.length ? `${rules.accounts.length} ${rules.accounts.length === 1 ? "account" : "accounts"}` : "All accounts", rules.categories.length ? `${rules.categories.length} ${rules.categories.length === 1 ? "category" : "categories"}` : "All categories",
    ...(rules.excluded_accounts.length || rules.excluded_categories.length ? [`${rules.excluded_accounts.length + rules.excluded_categories.length} ${rules.excluded_accounts.length + rules.excluded_categories.length === 1 ? "exclusion" : "exclusions"}`] : [])].join(" · ");
}
