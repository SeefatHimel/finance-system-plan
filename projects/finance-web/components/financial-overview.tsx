"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowClockwise, ArrowRight, CheckCircle, WarningCircle } from "@phosphor-icons/react";
import { getAccessToken } from "@/lib/auth-storage";
import { getFinancialOverview } from "@/lib/api";
import { AccountLabel } from "@/components/account-avatar";
import { formatCalendarDate, formatCurrency } from "../../finance-contracts/presentation";

const comparisons: Record<string, string> = { matched: "Latest report matches", mismatch: "Balance difference", timing_unknown: "Order needs review", report_precedes_movement: "Report predates activity", credit_card_reference: "Card reference balance", unavailable: "No comparable report" };
export function FinancialOverview({ coverageOnly = false }: { coverageOnly?: boolean }) {
  const [data, setData] = useState<Awaited<ReturnType<typeof getFinancialOverview>> | null>(null);
  const [revision, setRevision] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  useEffect(() => { const refresh = () => setRevision(value => value + 1); window.addEventListener("finance:transactions-changed", refresh); return () => window.removeEventListener("finance:transactions-changed", refresh); }, []);
  useEffect(() => {
    const token = getAccessToken(); if (!token) { setLoading(false); return; }
    const controller = new AbortController(); setLoading(true); setError("");
    void getFinancialOverview(token, controller.signal).then(result => { if (!controller.signal.aborted) setData(result); })
      .catch((reason: unknown) => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Could not refresh overview."); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [revision]);
  if (!data) return <section className="panel"><div className="panel__body"><p role="status">{error || (loading ? "Checking account coverage…" : "Sign in to view account coverage.")}</p>{error ? <button className="button button--ghost" onClick={() => setRevision(value => value + 1)}>Retry</button> : null}</div></section>;
  const compared = data.coverage.filter(row => row.comparison === "matched").length;
  const checks = data.coverage.filter(row => row.last_check).length;
  const setup = [
    { done: data.accounts.length > 0, text: "Add your accounts and opening balances", href: "/accounts" },
    { done: data.transaction_count > 0, text: "Import or record your first activity", href: "/statements" },
    { done: data.transaction_count > 0 && data.pending_sms + data.pending_statement_rows + data.needs_review === 0, text: "Review captured sources", href: "/messages/review" },
    { done: data.accounts.length > 0 && checks === data.accounts.length, text: "Check each account against a real balance", href: "/reconciliation" }
  ];
  return <section className="panel financial-overview" aria-busy={loading}><div className="panel__body">
    <div className="report-header"><div><h2 className="section-title">{coverageOnly ? "Account coverage" : "Your money, with context"}</h2><p className="muted-text">As of {formatCalendarDate(data.as_of)} · {data.accounts.length} accounts · {compared} comparable latest reports match</p></div><button className="icon-button" type="button" aria-label="Refresh account overview" title="Refresh account overview" disabled={loading} onClick={() => setRevision(value => value + 1)}><ArrowClockwise size={20} /></button></div>
    {error ? <p role="alert" className="form-error">{error} Previous results remain visible.</p> : null}
    <p className="coverage-notice"><WarningCircle size={18} aria-hidden="true" />{data.notice}</p>
    {!coverageOnly ? <>
      {data.transaction_count === 0 || data.accounts.length === 0 ? <div className="list-stack" aria-label="Getting started checklist"><h3>Build your financial picture</h3>{setup.map(step => <Link className="list-row" href={step.href} key={step.text}><span>{step.done ? <CheckCircle size={18} aria-label="Complete" /> : <span aria-label="To do">○</span>} {step.text}</span><ArrowRight size={17} /></Link>)}<p className="muted-text">No recorded activity yet is different from zero spending. Set opening balances before relying on your totals.</p></div> : null}
      {data.currencies.map(row => <div key={row.currency}><h3>{row.currency} · Current position</h3><div className="metric-row">
        <div className="metric"><span className="metric__label">Cash & non-card accounts</span><strong className="metric__value">{formatCurrency(row.cash_and_accounts, row.currency)}</strong><small>Includes savings {formatCurrency(row.savings, row.currency)}</small></div>
        <div className="metric"><span className="metric__label">Card liability</span><strong className="metric__value">{formatCurrency(row.card_liability, row.currency)}</strong><small>Card overpayments {formatCurrency(row.card_credit, row.currency)}</small></div>
        <div className="metric"><span className="metric__label">Owed to you / you owe</span><strong className="metric__value financial-overview__debt">{formatCurrency(row.receivable, row.currency)} / {formatCurrency(row.payable, row.currency)}</strong><Link href="/debts">Review debts</Link></div>
      </div><p className="muted-text">Account balances after card liabilities: {formatCurrency(row.account_balance, row.currency)}. Debt records are shown separately. Upcoming card dues are a payment schedule, not an extra liability added to this total.</p></div>)}
      <div className="coverage-actions"><Link href="/messages/review">SMS to review <span className="badge">{data.pending_sms}</span></Link><Link href="/statements">Statement rows <span className="badge">{data.pending_statement_rows}</span></Link><Link href="/transactions?needs_review=true&month=">Ledger checks <span className="badge">{data.needs_review}</span></Link><Link href="/transactions?category=uncategorized&spending=true&month=">Uncategorized spending <span className="badge">{data.uncategorized_spending}</span></Link></div>
      <details><summary><strong>Due in the next 30 days & overdue ({data.upcoming.length})</strong></summary>{data.upcoming.length ? <div className="list-stack">{data.upcoming.map(row => <Link className="list-row" href={row.href} key={row.id}><span>{row.name} · {formatCalendarDate(row.date)}{row.date < data.as_of ? <span className="badge badge--warning">Overdue</span> : null}</span><strong>{formatCurrency(row.amount, row.currency)} <ArrowRight size={15} /></strong></Link>)}</div> : <p>No scheduled commitments in this window. Add bills or debts to track them.</p>}</details>
    </> : null}
    <details open={coverageOnly}><summary><strong>Coverage by account</strong></summary><div className="list-stack">{data.coverage.map(row => {
      const account = data.accounts.find(item => item.id === row.account);
      return <div className="coverage-account" key={row.account}><div className="report-header"><AccountLabel account={account} /><span className={`badge${row.comparison === "mismatch" ? " badge--warning" : ""}`}>{comparisons[row.comparison] ?? "Check needed"}</span></div>
        <p className="muted-text">Latest source balance: {row.last_report_date ? formatCalendarDate(row.last_report_date) : "Not available"}. Last manual check: {row.last_check ? `${formatCalendarDate(row.last_check.date.slice(0, 10))} · ${row.last_check.status.replaceAll("_", " ")}` : "Not checked"}.</p>
        <p className="muted-text">{row.statement ? `Saved statement period: ${row.statement.start ? formatCalendarDate(row.statement.start) : "Unknown start"}–${row.statement.end ? formatCalendarDate(row.statement.end) : "Unknown end"}.` : "No statement saved."} {row.pending_sms} SMS and {row.pending_rows} statement rows pending.</p>
        <div className="coverage-actions"><Link href={`/transactions?account=${row.account}&month=`}>View activity <ArrowRight size={15} /></Link><Link href={`/reconciliation?account=${row.account}`}>Check balance</Link>{row.statement ? <Link href={`/statements?import=${row.statement.id}`}>Review statement</Link> : <Link href="/statements">Import statement</Link>}</div>
      </div>;
    })}</div></details>
  </div></section>;
}
