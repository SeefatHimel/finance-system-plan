"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useState } from "react";
import { ArrowRight, ChartBar, Table } from "@phosphor-icons/react";
import type { MonthlyReport } from "@/lib/api";
import { reportBreakdownRows, reportChange, reportTrend } from "@/lib/report-presentation";
import { formatCalendarDate, formatCurrency } from "../../finance-contracts/presentation";

const BreakdownChart = dynamic(() => import("./report-charts").then(module => module.BreakdownChart), { ssr: false, loading: () => <p role="status">Preparing chart…</p> });
const ActivityChart = dynamic(() => import("./report-charts").then(module => module.ActivityChart), { ssr: false, loading: () => <p role="status">Preparing chart…</p> });
type Drill = (extra?: Record<string, string>) => string;

function ViewToggle({ table, onChange, label }: { table: boolean; onChange: (value: boolean) => void; label: string }) {
  return <div className="report-segmented" role="group" aria-label={`${label} view`}>
    <button type="button" aria-pressed={!table} onClick={() => onChange(false)}><ChartBar size={16} aria-hidden="true" />Chart</button>
    <button type="button" aria-pressed={table} onClick={() => onChange(true)}><Table size={16} aria-hidden="true" />Table</button>
  </div>;
}

export function ReportAnalytics({ report, drill }: { report: MonthlyReport; drill?: Drill }) {
  const [group, setGroup] = useState<"categories" | "merchants">("categories");
  const [breakdownTable, setBreakdownTable] = useState(false);
  const [activityTable, setActivityTable] = useState(false);
  const [cash, setCash] = useState(false);
  const [interval, setInterval] = useState<"day" | "month">(() => report.daily.length > 62 ? "month" : "day");
  const money = (value: string | number) => formatCurrency(value, report.currency);
  const rows: { key: string; name: string; amount: string; previous_amount: string; extra: Record<string, string> }[] = group === "categories" ? report.categories.map(row => ({ ...row, key: row.id ?? "uncategorized", extra: { category: row.id ?? "uncategorized", spending: "true" } }))
    : report.merchants.map(row => ({ ...row, key: row.search, extra: { search: `merchant:${JSON.stringify(row.search)}`, spending: "true" } }));
  const breakdown = reportBreakdownRows(rows);
  const trend = reportTrend(report.daily, interval);
  const trendRows = trend.map(row => ({ label: row.date, current: Number(cash ? row.cash_in_total : row.income_total), previous: Number(cash ? row.cash_out_total : row.expense_total) }));
  const nameLink = (name: string, extra: Record<string, string>) => drill ? <Link href={drill(extra)}>{name}<ArrowRight size={14} aria-hidden="true" /></Link> : name;
  const changeText = (now: string, previous: string) => {
    const change = reportChange(now, previous);
    return `${change.direction === "up" ? "+" : ""}${money(change.amount)}${change.percent !== null && change.direction !== "same" ? ` (${change.percent.toFixed(1)}% ${change.direction === "up" ? "more" : "less"})` : ""}`;
  };
  return <div className="report-analytics" id="report-breakdowns">
    <section className="panel"><div className="panel__body">
      <div className="report-panel-heading"><div><span className="report-eyebrow">Over time</span><h2 className="section-title">Activity over time</h2></div><ViewToggle label="Activity" table={activityTable} onChange={setActivityTable} /></div>
      <div className="report-chart-toolbar"><label className="field"><span className="field__label">Measure</span><select className="field__control" aria-label="Measure" value={cash ? "cash" : "spending"} onChange={event => setCash(event.target.value === "cash")}><option value="spending">Income and spending</option><option value="cash">Money in and out</option></select></label><label className="field"><span className="field__label">Interval</span><select className="field__control" aria-label="Interval" value={interval} onChange={event => setInterval(event.target.value as typeof interval)}><option value="day">Daily</option><option value="month">Monthly</option></select></label></div>
      {activityTable ? <div className="report-data-scroll table-wrap"><table className="data-table"><caption className="sr-only">Report activity by {interval}</caption><thead><tr><th scope="col">{interval === "month" ? "Month" : "Date"}</th><th scope="col">{cash ? "Money in" : "Earned income"}</th><th scope="col">{cash ? "Money out" : "Net spending"}</th></tr></thead><tbody>{trend.map(row => <tr key={row.date}><th scope="row">{interval === "month" ? row.date : formatCalendarDate(row.date)}</th><td>{money(cash ? row.cash_in_total : row.income_total)}</td><td>{money(cash ? row.cash_out_total : row.expense_total)}</td></tr>)}</tbody></table></div> : <ActivityChart rows={trendRows} currency={report.currency} cash={cash} monthly={interval === "month"} />}
      <p className="report-chart-note">{cash ? "Account cash flow includes financing; transfers within the selected account group are excluded." : "Refunds reduce spending and can make a day negative. Loans and own-account transfers are separate from earned income."}</p>
      {report.daily.some(row => row.date < report.start_date || row.date > report.end_date) ? <p className="report-chart-note">Manual additions outside the saved dates are included in this timeline.</p> : null}
    </div></section>
    <section className="panel"><div className="panel__body">
      <div className="report-panel-heading"><div><span className="report-eyebrow">Where it went</span><h2 className="section-title">Spending breakdown</h2></div><ViewToggle label="Breakdown" table={breakdownTable} onChange={setBreakdownTable} /></div>
      <div className="report-chart-toolbar"><label className="field"><span className="field__label">Group by</span><select className="field__control" aria-label="Group by" value={group} onChange={event => setGroup(event.target.value as typeof group)}><option value="categories">Category</option><option value="merchants">Merchant</option></select></label><span className="muted-text">{rows.length} {group}</span></div>
      {breakdownTable ? <div className="report-data-scroll table-wrap"><table className="data-table"><caption className="sr-only">Net spending by {group} compared with the previous period</caption><thead><tr><th scope="col">{group === "categories" ? "Category" : "Merchant"}</th><th scope="col">Net spending</th><th scope="col">Previous</th><th scope="col">Change</th></tr></thead><tbody>{[...breakdown.spending, ...breakdown.refunds, ...breakdown.neutral].map(row => <tr key={row.key}><th scope="row">{nameLink(row.name, row.extra)}</th><td>{money(row.amount)}</td><td>{money(row.previous_amount)}</td><td>{changeText(row.amount, row.previous_amount)}</td></tr>)}</tbody></table></div> : <>
        {breakdown.spending.length ? <><BreakdownChart rows={breakdown.spending.slice(0, 6).map(row => ({ label: row.name, current: Number(row.amount) }))} currency={report.currency} /><div className="report-ranked-list">{breakdown.spending.slice(0, 6).map(row => <div className="report-ranked-row" key={row.key}><div>{nameLink(row.name, row.extra)}<small>{row.share.toFixed(1)}% of positive net spending</small></div><strong>{money(row.amount)}</strong></div>)}</div>{breakdown.spending.length > 6 ? <button className="button button--ghost" onClick={() => setBreakdownTable(true)}>View all {rows.length} {group}</button> : null}</> : <p className="report-chart-empty">No positive net spending in this selection.</p>}
        {breakdown.refunds.length ? <div className="report-refund-summary"><h3>Net refunds</h3><p>Refunds exceeded spending in these {group}.</p>{breakdown.refunds.map(row => <div className="report-ranked-row" key={row.key}>{nameLink(row.name, row.extra)}<strong>{money(row.amount)}</strong></div>)}</div> : null}
        {breakdown.neutral.length ? <button className="button button--ghost" onClick={() => setBreakdownTable(true)}>Show {breakdown.neutral.length} with zero net spending</button> : null}
      </>}
      {!rows.length ? <p className="report-chart-empty">No expenses or refunds match this report. Review income and cash flow above, or edit the saved filters.</p> : <p className="report-chart-note">Shares exclude net-refund {group}. Open a name to inspect its transactions.</p>}
    </div></section>
    <section className="panel report-account-breakdown"><div className="panel__body"><div className="report-panel-heading"><div><span className="report-eyebrow">Across accounts</span><h2 className="section-title">Account movement</h2></div><span className="muted-text">{report.accounts.length} accounts</span></div><div className="table-wrap"><table className="data-table"><thead><tr><th scope="col">Account</th><th scope="col">Money in</th><th scope="col">Money out</th></tr></thead><tbody>{report.accounts.map(row => <tr key={row.id}><th scope="row">{nameLink(row.name, { account: row.id })}</th><td>{money(row.money_in)}</td><td>{money(row.money_out)}</td></tr>)}</tbody></table></div><p className="report-chart-note">Movement during this report’s selection, rather than account balances.</p></div></section>
  </div>;
}
