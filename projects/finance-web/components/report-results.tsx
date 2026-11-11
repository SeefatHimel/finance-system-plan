"use client";

import Link from "next/link";
import { ArrowRight } from "@phosphor-icons/react";
import { formatCurrency, formatCalendarDate } from "../../finance-contracts/presentation";
import type { MonthlyReport } from "@/lib/api";

export function ReportResults({ report, loading = false, drill, compact = false, cashDescription }: {
  report: MonthlyReport; loading?: boolean; drill?: (extra?: Record<string, string>) => string;
  compact?: boolean; cashDescription?: string;
}) {
  const money = (amount: string | number) => formatCurrency(amount, report.currency);
  const difference = (now: string, before: string) => {
    const delta = Number(now) - Number(before);
    return `${delta >= 0 ? "+" : "−"}${money(Math.abs(delta))} vs previous period`;
  };
  const drillLink = (children: React.ReactNode, extra?: Record<string, string>, className?: string) => drill && !loading
    ? <Link className={className} href={drill(extra)}>{children}</Link>
    : <span className={className}>{children}</span>;
  return <div className="workspace-grid report-workspace" aria-busy={loading} style={{ opacity: loading ? 0.6 : 1 }}>
    <section className="panel" id="report-overview"><div className="panel__body">
      <h2 className="section-title">{compact ? "Live preview" : "Report overview"}</h2>
      <p className="muted-text">{report.transaction_count} {report.transaction_count === 1 ? "transaction" : "transactions"} · {formatCalendarDate(report.start_date)}–{formatCalendarDate(report.end_date)} · {report.currency}</p>
      <div className="metric-row">
        <div className="metric"><span className="metric__label">Earned income</span><strong className="metric__value">{money(report.income_total)}</strong><small>{difference(report.income_total, report.previous.income_total)}</small></div>
        <div className="metric"><span className="metric__label">Net spending</span><strong className="metric__value">{money(report.expense_total)}</strong><small>{difference(report.expense_total, report.previous.expense_total)}</small></div>
        <div className="metric"><span className="metric__label">Income less spending</span><strong className="metric__value">{money(report.net_total)}</strong><small>{difference(report.net_total, report.previous.net_total)}</small></div>
      </div>
      <p className="muted-text">Previous period: {formatCalendarDate(report.previous.start_date)}–{formatCalendarDate(report.previous.end_date)}. Refunds reduce spending. Totals reflect recorded activity.</p>
      {!compact ? <details><summary>How these totals work</summary><div className="list-stack">
        {[["Expenses and fees", report.gross_spending_total], ["Refunds returned", report.refund_total], ["Loan principal received / repaid to you", report.financing_in_total], ["Lending / principal you repaid", report.financing_out_total], ["Own-account transfers", report.transfers_total], ["Money in", report.cash_in_total], ["Money out", report.cash_out_total], ["Net money movement", report.cash_net_total], ["Balance adjustments", report.adjustments_total]].map(([label, amount]) => <div className="list-row" key={label}><span>{label}</span><strong>{money(amount)}</strong></div>)}
      </div><p className="muted-text">{cashDescription ?? "Money in/out excludes transfers between your accounts."} Principal is financing, not earnings or consumption.</p></details> : null}
      {drill ? <div className="report-actions">{drillLink(<>View these transactions <ArrowRight size={17} /></>, undefined, "button button--ghost")}</div> : null}
    </div></section>
    {!compact ? <div className="report-breakdown-grid" id="report-breakdowns">
      <section className="panel"><div className="panel__body"><h2 className="section-title">Net spending by category</h2><div className="list-stack">{report.categories.map(row => <div key={row.id ?? "uncategorized"}>{drillLink(<><span>{row.name}<small className="report-comparison">{difference(row.amount, row.previous_amount)}</small></span><strong>{money(row.amount)} <ArrowRight size={15} /></strong></>, { category: row.id ?? "uncategorized", spending: "true" }, "list-row")}</div>)}{!report.categories.length ? <p>No spending or refunds in this report.</p> : null}</div></div></section>
      <section className="panel"><div className="panel__body"><h2 className="section-title">Merchants and counterparties</h2><div className="list-stack">{report.merchants.map(row => <div key={row.search}>{drillLink(<><span>{row.name} <small className="muted-text">· {row.count} movements</small><small className="report-comparison">{difference(row.amount, row.previous_amount)}</small></span><strong>{money(row.amount)} <ArrowRight size={15} /></strong></>, { search: `merchant:${JSON.stringify(row.search)}`, spending: "true" }, "list-row")}</div>)}{!report.merchants.length ? <p>No merchants in this report.</p> : null}</div></div></section>
      <section className="panel report-account-breakdown"><div className="panel__body"><h2 className="section-title">Account movement</h2><div className="table-wrap"><table className="data-table"><thead><tr><th>Account</th><th>Money in</th><th>Money out</th></tr></thead><tbody>{report.accounts.map(row => <tr key={row.id}><td>{drillLink(<>{row.name} <ArrowRight size={15} /></>, { account: row.id })}</td><td>{money(row.money_in)}</td><td>{money(row.money_out)}</td></tr>)}</tbody></table></div>{!report.accounts.length ? <p>No account movements in this report.</p> : null}</div></section>
    </div> : null}
  </div>;
}
