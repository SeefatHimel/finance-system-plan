"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowClockwise } from "@phosphor-icons/react";
import { type Account, type MonthlyReport, getPeriodReport, listAccounts } from "@/lib/api";
import { getAccessToken } from "@/lib/auth-storage";
import { DatePeriodControls } from "@/components/date-period-controls";
import { monthPeriod, type DatePeriod } from "@/lib/date-period";
import { reportFilterQuery, reportFiltersFromQuery, reportFiltersKey } from "@/lib/report-navigation";
import { ReportResults } from "@/components/report-results";

export function ReportWorkspace() {
  const [revision, setRevision] = useState(0);
  const [period, setPeriod] = useState<DatePeriod>(() => monthPeriod());
  const [report, setReport] = useState<MonthlyReport | null>(null);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [account, setAccount] = useState("");
  const [currency, setCurrency] = useState("BDT");
  const [ready, setReady] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [resultAccount, setResultAccount] = useState("");
  useEffect(() => {
    const restore = () => {
      let query = window.location.search;
      if (!query) { try { query = sessionStorage.getItem(reportFiltersKey) ?? ""; } catch {} }
      const filters = reportFiltersFromQuery(query);
      setPeriod(filters.period); setAccount(filters.account); setCurrency(filters.currency); setReady(true);
    };
    restore(); const token = getAccessToken(); const controller = new AbortController();
    if (token) void listAccounts(token, controller.signal).then(setAccounts).catch(() => {});
    const refresh = () => setRevision(value => value + 1);
    window.addEventListener("popstate", restore); window.addEventListener("finance:transactions-changed", refresh);
    return () => { controller.abort(); window.removeEventListener("popstate", restore); window.removeEventListener("finance:transactions-changed", refresh); };
  }, []);
  const query = reportFilterQuery({ period, account, currency, savedReport: "" });
  useEffect(() => {
    if (!ready) return;
    window.history.replaceState(window.history.state, "", `/reports?${query}`);
    try { sessionStorage.setItem(reportFiltersKey, query); } catch {}
  }, [ready, query]);
  useEffect(() => {
    if (!ready) return;
    const token = getAccessToken(); if (!token) { setError("Sign in to view reports."); setLoading(false); return; }
    const controller = new AbortController(); setLoading(true); setError("");
    void getPeriodReport(token, period.start, period.end, controller.signal, { account, currency }).then(result => {
      if (!controller.signal.aborted) { setReport(result); setResultAccount(account); }
    }).catch((reason: unknown) => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Could not load report."); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [ready, period.start, period.end, account, currency, revision]);
  const drill = (extra: Record<string, string> = {}) => `/transactions?${new URLSearchParams({ start_date: report?.start_date ?? period.start, end_date: report?.end_date ?? period.end, currency: report?.currency ?? currency, ...(resultAccount ? { account: resultAccount } : {}), ...extra, report_return: `/reports?${query}` })}`;
  return <div className="workspace-grid report-workspace">
    <div className="report-actions"><Link className="button button--ghost" href="/custom-reports">Custom report library</Link>{ready ? <Link className="button button--primary" href={`/custom-reports/new?${query}`}>Save these filters as a custom report</Link> : null}</div>
    <section className="panel"><div className="panel__body">
      <div className="report-header"><div><h1 className="section-title">Your financial report</h1><p className="section-subtitle">Income, spending and account movement for your selected period.</p></div><button className="icon-button" aria-label="Refresh report" disabled={loading} onClick={() => setRevision(value => value + 1)}><ArrowClockwise size={20} /></button></div>
      <DatePeriodControls label="Report dates" allowAll={false} value={period} onChange={setPeriod} />
      <div className="transaction-form"><label className="field"><span className="field__label">Account</span><select aria-label="Account" className="field__control" value={account} onChange={event => { setAccount(event.target.value); const row = accounts.find(item => item.id === event.target.value); if (row) setCurrency(row.currency); }}><option value="">All accounts</option>{accounts.map(row => <option key={row.id} value={row.id}>{row.name} · {row.currency}</option>)}</select></label><label className="field"><span className="field__label">Currency</span><select aria-label="Currency" className="field__control" value={currency} disabled={!!account} onChange={event => setCurrency(event.target.value)}>{Array.from(new Set(["BDT", currency, ...accounts.map(row => row.currency)])).map(value => <option key={value}>{value}</option>)}</select></label></div>
      {error ? <p role="alert" className="form-error">{error}</p> : null}{loading ? <p role="status">Updating report…</p> : null}
    </div></section>
    {report ? <ReportResults report={report} loading={loading} drill={!error ? drill : undefined} cashDescription={resultAccount ? "Money in/out includes transfers through the selected account." : undefined} /> : null}
  </div>;
}
