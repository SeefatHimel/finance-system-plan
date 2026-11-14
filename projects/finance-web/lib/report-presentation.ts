import { localDate, monthPeriod, shiftPeriod, type DatePeriod } from "./date-period";
import { emptyReportRules } from "./report-rules";

export const reportStarters = [
  { id: "account-statement", name: "Account statement", description: "Opening balance, transactions and closing balance per account.", types: [] as string[] },
  { id: "overview", name: "Account overview", description: "Income, spending and money movement together.", types: [] as string[] },
  { id: "spending", name: "Spending review", description: "Expenses and fees, with refunds deducted.", types: ["expense", "fee", "refund"] },
  { id: "income", name: "Income review", description: "Earned income, separate from loans and transfers.", types: ["income"] },
];
export function reportStarter(id: string | null) {
  const starter = reportStarters.find(row => row.id === id);
  return starter ? { name: starter.name, report_view: starter.id === "account-statement" ? "account_statement" as const : "analysis" as const, rules: { ...emptyReportRules(), types: [...starter.types] } } : null;
}
export const reportDatePresets = [
  { id: "this-month", label: "This month" }, { id: "last-month", label: "Last month" },
  { id: "year-to-date", label: "Year to date" }, { id: "last-90-days", label: "Last 90 days" },
] as const;
export function reportPresetPeriod(id: string, today = localDate()): DatePeriod {
  if (id === "last-month") return shiftPeriod(monthPeriod(today.slice(0, 7)), -1);
  if (id === "year-to-date") return { mode: "custom", start: `${today.slice(0, 4)}-01-01`, end: today };
  if (id === "last-90-days") {
    const start = new Date(`${today}T00:00:00Z`); start.setUTCDate(start.getUTCDate() - 89);
    return { mode: "custom", start: start.toISOString().slice(0, 10), end: today };
  }
  return monthPeriod(today.slice(0, 7));
}

// Decimal strings stay exact for sums and comparisons. Charts alone use numbers.
export function reportCents(value: string): bigint {
  const negative = value.startsWith("-");
  const [whole, fraction = ""] = value.replace(/^-/, "").split(".");
  return (BigInt(whole || "0") * BigInt(100) + BigInt(fraction.padEnd(2, "0").slice(0, 2))) * BigInt(negative ? -1 : 1);
}
export function reportMoney(cents: bigint): string {
  const absolute = cents < BigInt(0) ? -cents : cents;
  return `${cents < BigInt(0) ? "-" : ""}${absolute / BigInt(100)}.${String(absolute % BigInt(100)).padStart(2, "0")}`;
}
export function reportChange(current: string, previous: string) {
  const now = reportCents(current), before = reportCents(previous), delta = now - before;
  return { amount: reportMoney(delta), direction: delta > BigInt(0) ? "up" : delta < BigInt(0) ? "down" : "same",
    percent: before > BigInt(0) && now >= BigInt(0) ? Math.abs(Number(delta) / Number(before) * 100) : null };
}
export function reportAmountError(min: string | null, max: string | null) {
  for (const value of [min, max]) if (value && !/^\d+(\.\d{1,2})?$/.test(value)) return "Use a non-negative amount with at most two decimal places.";
  return min && max && reportCents(min) > reportCents(max) ? "Maximum amount must be at least the minimum amount." : "";
}
type Daily = { date: string; income_total: string; expense_total: string; cash_in_total: string; cash_out_total: string };
export function reportTrend(rows: Daily[], mode: "day" | "month") {
  const fields = ["income_total", "expense_total", "cash_in_total", "cash_out_total"] as const;
  const groups = new Map<string, Daily>();
  for (const row of rows) {
    const date = mode === "month" ? row.date.slice(0, 7) : row.date;
    const group = groups.get(date) ?? { date, income_total: "0.00", expense_total: "0.00", cash_in_total: "0.00", cash_out_total: "0.00" };
    for (const field of fields) group[field] = reportMoney(reportCents(group[field]) + reportCents(row[field]));
    groups.set(date, group);
  }
  return [...groups.values()].sort((a, b) => a.date.localeCompare(b.date));
}
export function reportBreakdownRows<T extends { name: string; amount: string; previous_amount: string }>(rows: T[]) {
  const spending = rows.filter(row => reportCents(row.amount) > BigInt(0)).sort((a, b) => Number(reportCents(b.amount) - reportCents(a.amount)) || a.name.localeCompare(b.name));
  const positiveTotal = spending.reduce((sum, row) => sum + reportCents(row.amount), BigInt(0));
  return {
    spending: spending.map(row => ({ ...row, share: positiveTotal ? Number(reportCents(row.amount)) / Number(positiveTotal) * 100 : 0 })),
    refunds: rows.filter(row => reportCents(row.amount) < BigInt(0)).sort((a, b) => Number(reportCents(a.amount) - reportCents(b.amount))),
    neutral: rows.filter(row => reportCents(row.amount) === BigInt(0)),
    positiveTotal: reportMoney(positiveTotal),
  };
}
