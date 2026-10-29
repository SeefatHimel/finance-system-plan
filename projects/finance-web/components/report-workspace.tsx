"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowClockwise, ArrowRight } from "@phosphor-icons/react";
import { formatCurrency, formatCalendarDate } from "../../finance-contracts/presentation";
import { type Account, type MonthlyReport, getPeriodReport, listAccounts } from "@/lib/api";
import { getAccessToken } from "@/lib/auth-storage";
import { LoadingState } from "@/components/loading-state";
import { DatePeriodControls } from "@/components/date-period-controls";
import { monthPeriod, type DatePeriod } from "@/lib/date-period";

export function ReportWorkspace() {
  const [revision, setRevision] = useState(0);
  const [period, setPeriod] = useState<DatePeriod>(() => monthPeriod(new Date().toISOString().slice(0, 7)));
  const [report, setReport] = useState<MonthlyReport | null>(null);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [account, setAccount] = useState("");
  const [reportAccount, setReportAccount] = useState("");
  const [currency, setCurrency] = useState("BDT");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  useEffect(() => { const params = new URLSearchParams(window.location.search); setPeriod(params.get("start_date") && params.get("end_date") ? { mode: "custom", start: params.get("start_date")!, end: params.get("end_date")! } : monthPeriod(params.get("month") ?? undefined)); setAccount(params.get("account") ?? ""); setCurrency(params.get("currency") ?? "BDT"); const refresh = () => setRevision(value => value + 1); window.addEventListener("finance:transactions-changed", refresh); return () => window.removeEventListener("finance:transactions-changed", refresh); }, []);
  useEffect(() => { const token = getAccessToken(); if (token) void listAccounts(token).then(setAccounts).catch(() => {}); }, []);
  useEffect(() => {
    const controller = new AbortController();
    const token = getAccessToken();
    if (!token) { setError("Sign in to view your report."); setLoading(false); return; }
    setLoading(true); setError("");
    void getPeriodReport(token, period.start, period.end, controller.signal, { account, currency }).then(result => {
      if (!controller.signal.aborted) { setReport(result); setReportAccount(account); }
    }).catch((reason: unknown) => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Could not load report."); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [period.start, period.end, account, currency, revision]);
  const money = (amount: string | number) => formatCurrency(amount, report?.currency ?? currency);
  const drill = (extra: Record<string, string> = {}) => `/transactions?${new URLSearchParams({ start_date: report?.start_date ?? period.start, end_date: report?.end_date ?? period.end, currency: report?.currency ?? currency, ...(reportAccount ? { account: reportAccount } : {}), ...extra })}`;
  const difference = (now: string, before: string) => {
    const delta = Number(now) - Number(before);
    return `${delta >= 0 ? "+" : "−"}${money(Math.abs(delta))} vs previous period`;
  };
  return <div className="workspace-grid">
    <section className="panel"><div className="panel__body">
      <div className="report-header"><div><h1 className="section-title">Your financial report</h1><p className="section-subtitle">Earned income and spending, with borrowing and account transfers shown separately.</p></div><button className="icon-button" aria-label="Refresh report" title="Refresh report" disabled={loading} onClick={() => setRevision(value => value + 1)}><ArrowClockwise size={20} /></button></div>
      <DatePeriodControls label="Report dates" allowAll={false} value={period} onChange={setPeriod} />
      <div className="transaction-form">
        <label className="field"><span className="field__label">Account</span><select className="field__control" value={account} onChange={event => setAccount(event.target.value)}><option value="">All accounts</option>{accounts.map(row => <option key={row.id} value={row.id}>{row.name} · {row.currency}</option>)}</select></label>
        <label className="field"><span className="field__label">Currency</span><select className="field__control" value={account ? accounts.find(row => row.id === account)?.currency ?? currency : currency} disabled={!!account} onChange={event => setCurrency(event.target.value)}>{Array.from(new Set(["BDT", currency, ...accounts.map(row => row.currency)])).map(value => <option key={value}>{value}</option>)}</select></label>
      </div>
      {error ? <p role="alert" className="form-error">{error}</p> : null}
      {loading ? <p role="status">Updating report…{report ? " Previous results remain visible." : ""}</p> : null}
      {report ? <div aria-busy={loading} style={{ opacity: loading ? 0.6 : 1 }}>
        <p className="muted-text">{report.transaction_count} recorded transactions · {formatCalendarDate(report.start_date)}–{formatCalendarDate(report.end_date)}. Totals depend on imported and reviewed activity; missing transactions are not included.</p>
        <div className="metric-row">
          <div className="metric"><span className="metric__label">Earned income</span><strong className="metric__value">{money(report.income_total)}</strong><small>{difference(report.income_total, report.previous.income_total)}</small></div>
          <div className="metric"><span className="metric__label">Net spending</span><strong className="metric__value">{money(report.expense_total)}</strong><small>{difference(report.expense_total, report.previous.expense_total)}</small></div>
          <div className="metric"><span className="metric__label">Income less spending</span><strong className="metric__value">{money(report.net_total)}</strong><small>{difference(report.net_total, report.previous.net_total)}</small></div>
        </div>
        <p className="muted-text">Previous period: {formatCalendarDate(report.previous.start_date)}–{formatCalendarDate(report.previous.end_date)}. Refunds reduce spending; a refund-only period can have negative spending.</p>
        <details><summary>How these totals work</summary><div className="list-stack">
          {[ ["Expenses and fees", report.gross_spending_total], ["Refunds returned", report.refund_total], ["Loan principal received / repaid to you", report.financing_in_total], ["Lending / principal you repaid", report.financing_out_total], ["Own-account transfers (excluded from income and spending)", report.transfers_total], ["Money in", report.cash_in_total], ["Money out", report.cash_out_total], ["Net money movement", report.cash_net_total], ["Balance adjustments (included in money movement)", report.adjustments_total] ].map(([label, amount]) => <div className="list-row" key={label}><span>{label}</span><strong>{money(amount)}</strong></div>)}
        </div><p className="muted-text">{account ? "Money in/out includes transfers through the selected account." : "Money in/out excludes transfers between your accounts."} Principal is financing, not earnings or consumption.</p></details>
        <Link className="button button--ghost" href={drill()}>View these transactions <ArrowRight size={17} /></Link>
      </div> : !loading && !error ? <p>No report yet.</p> : null}
      {!report && loading ? <LoadingState label="Calculating report" detail="Separating spending, refunds and financing" /> : null}
    </div></section>
    {report ? <>
      <section className="panel"><div className="panel__body"><h2 className="section-title">Net spending by category</h2><div className="list-stack">{report.categories.length ? report.categories.map(row => <Link className="list-row" key={row.id ?? "uncategorized"} href={drill({ category: row.id ?? "uncategorized", spending: "true" })}><span>{row.name}<small className="report-comparison">{difference(row.amount, row.previous_amount)}</small></span><strong>{money(row.amount)} <ArrowRight size={15} /></strong></Link>) : <p>No spending or refunds recorded in this period.</p>}</div></div></section>
      <section className="panel"><div className="panel__body"><h2 className="section-title">Merchants and counterparties</h2><div className="list-stack">{report.merchants.map(row => <Link className="list-row" key={row.search} href={drill({ search: `merchant:${JSON.stringify(row.search)}`, spending: "true" })}><span>{row.name} <small className="muted-text">· {row.count} {row.count === 1 ? "movement" : "movements"}</small><small className="report-comparison">{difference(row.amount, row.previous_amount)}</small></span><strong>{money(row.amount)} <ArrowRight size={15} /></strong></Link>)}{!report.merchants.length ? <p>No merchants in this period.</p> : null}</div></div></section>
      <section className="panel"><div className="panel__body"><h2 className="section-title">Account movement</h2><div className="table-wrap"><table className="data-table"><thead><tr><th>Account</th><th>Money in</th><th>Money out</th></tr></thead><tbody>{report.accounts.map(row => <tr key={row.id}><td><Link href={drill({ account: row.id })}>{row.name} <ArrowRight size={15} /></Link></td><td>{money(row.money_in)}</td><td>{money(row.money_out)}</td></tr>)}</tbody></table></div>{!report.accounts.length ? <p>No account movements in this period.</p> : null}</div></section>
    </> : null}
  </div>;
}
