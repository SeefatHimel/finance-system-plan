import type { Account, Category, SavedReport } from "@/lib/api";
import { savedReportRules } from "@/lib/report-rules";
import { displayLabel, formatCalendarDate } from "../../finance-contracts/presentation";

export function CustomReportDefinition({ report, accounts, categories }: { report: SavedReport; accounts: Account[]; categories: Category[] }) {
  const rules = savedReportRules(report);
  const accountNames = (ids: string[]) => ids.map(id => accounts.find(row => row.id === id)?.name ?? "Unavailable account").join(", ");
  const categoryNames = (ids: string[]) => ids.map(id => id === "uncategorized" ? "Uncategorized" : categories.find(row => row.id === id)?.name ?? "Unavailable category").join(", ");
  const rows = [
    ["Default view", report.report_view === "account_statement" ? "Account statements" : "Analysis"],
    ["Dates", `${formatCalendarDate(report.start_date)}–${formatCalendarDate(report.end_date)}`], ["Currency", report.currency],
    ["Accounts included", rules.accounts.length ? accountNames(rules.accounts) : "All accounts"],
    ["Accounts excluded", rules.excluded_accounts.length ? accountNames(rules.excluded_accounts) : "None"],
    ["Categories included", rules.categories.length ? categoryNames(rules.categories) : "All categories"],
    ["Categories excluded", rules.excluded_categories.length ? categoryNames(rules.excluded_categories) : "None"],
    ["Transaction types", rules.types.length ? rules.types.map(displayLabel).join(", ") : "All types"],
    ["Sources", rules.sources.length ? rules.sources.map(displayLabel).join(", ") : "All sources"],
    ["Directions", rules.directions.length ? rules.directions.map(displayLabel).join(", ") : "Both"],
    ["Amount per transaction", `${rules.min_amount ?? "No minimum"} – ${rules.max_amount ?? "No maximum"}`],
    ["Search", rules.search || "None"],
    ["Opening balance settings", `${Object.keys(report.opening_balances).length} account-specific settings. Inspect or edit them in Account statements.`]
  ];
  return <section className="panel" id="report-definition"><div className="panel__body"><details><summary>Saved report definition</summary><dl className="report-definition-list">{rows.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl><p className="muted-text">Analysis uses the filters and manual membership choices; previous-period comparisons omit manual choices. Account statements use full account movements for these dates and their report-only opening settings. Matching activity stays live.</p></details></div></section>;
}
