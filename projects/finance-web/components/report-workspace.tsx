"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { ArrowClockwise, ArrowRight } from "@phosphor-icons/react";
import { formatCurrency, formatCalendarDate } from "../../finance-contracts/presentation";
import { type Account, type MonthlyReport, type SavedReport, getPeriodReport, listAccounts, listSavedReports, saveReport, deleteSavedReport } from "@/lib/api";
import { getAccessToken } from "@/lib/auth-storage";
import { LoadingState } from "@/components/loading-state";
import { DatePeriodControls } from "@/components/date-period-controls";
import { monthPeriod, type DatePeriod } from "@/lib/date-period";
import { customReportFiltersKey, reportFilterQuery, reportFiltersFromQuery, reportFiltersKey } from "@/lib/report-navigation";
import { SavedReportTransactions } from "@/components/saved-report-transactions";
import { ModalDialog } from "@/components/modal-dialog";

export function ReportWorkspace({ custom = false }: { custom?: boolean }) {
  const reportPath = custom ? "/custom-reports" : "/reports";
  const storageKey = custom ? customReportFiltersKey : reportFiltersKey;
  const [revision, setRevision] = useState(0);
  const [period, setPeriod] = useState<DatePeriod>(() => monthPeriod());
  const [report, setReport] = useState<MonthlyReport | null>(null);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [account, setAccount] = useState("");
  const [reportAccount, setReportAccount] = useState("");
  const [currency, setCurrency] = useState("BDT");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [ready, setReady] = useState(false);
  const [savedReports, setSavedReports] = useState<SavedReport[]>([]);
  const savedReportsRef = useRef<SavedReport[]>([]);
  useEffect(() => { savedReportsRef.current = savedReports; }, [savedReports]);
  const [selectedId, setSelectedId] = useState("");
  const [reportSavedId, setReportSavedId] = useState("");
  const [name, setName] = useState("");
  const [saveError, setSaveError] = useState("");
  const [savedListError, setSavedListError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const mutationInFlight = useRef(false);
  const selected = savedReports.find(row => row.id === selectedId);
  const dirty = !!selected && (selected.start_date !== period.start || selected.end_date !== period.end || selected.account !== (account || null) || selected.currency !== currency || selected.date_view !== period.mode);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    const restore = () => {
      let query = window.location.search;
      if (!query) { try { query = window.sessionStorage.getItem(storageKey) ?? ""; } catch { /* URL persistence still works. */ } }
      const filters = reportFiltersFromQuery(query);
      if (!custom) filters.savedReport = "";
      const saved = savedReportsRef.current.find(row => row.id === filters.savedReport);
      const directSavedLink = saved && !new URLSearchParams(query).has("start_date");
      setPeriod(directSavedLink ? { mode: saved.date_view, start: saved.start_date, end: saved.end_date } : filters.period);
      setAccount(directSavedLink ? saved.account ?? "" : filters.account);
      setCurrency(directSavedLink ? saved.currency : filters.currency);
      setSelectedId(filters.savedReport); setName(saved?.name ?? ""); setReady(true);
    };
    const token = getAccessToken();
    if (token) {
      void listAccounts(token).then(value => { if (!cancelled) setAccounts(value); }).catch(() => {});
      if (custom) void listSavedReports(token, controller.signal).then(value => {
        if (!cancelled) { savedReportsRef.current = value; setSavedReports(value); restore(); }
      }).catch((reason: unknown) => {
        if (!cancelled) { setSavedListError(reason instanceof Error ? reason.message : "Could not load saved reports."); restore(); }
      });
      else restore();
    } else restore();
    const refresh = () => setRevision(value => value + 1);
    // History restoration reads current filters, including a saved report's URL.
    const pop = () => { if (!cancelled) restore(); };
    window.addEventListener("popstate", pop);
    window.addEventListener("finance:transactions-changed", refresh);
    return () => { cancelled = true; controller.abort(); window.removeEventListener("popstate", pop); window.removeEventListener("finance:transactions-changed", refresh); };
  }, [custom, storageKey]);
  useEffect(() => {
    if (!ready) return;
    const query = reportFilterQuery({ period, account, currency, savedReport: selectedId });
    window.history.replaceState(window.history.state, "", `${reportPath}?${query}`);
    try { window.sessionStorage.setItem(storageKey, query); } catch { /* Storage may be unavailable. */ }
  }, [ready, period, account, currency, selectedId, reportPath, storageKey]);
  useEffect(() => {
    if (!ready) return;
    if (selectedId && !selected) { setReport(null); setLoading(false); return; }
    const controller = new AbortController();
    const token = getAccessToken();
    if (!token) { setError("Sign in to view your report."); setLoading(false); return; }
    setLoading(true); setError("");
    void getPeriodReport(token, period.start, period.end, controller.signal, { account, currency, saved_report: selected && !dirty ? selected.id : "" }).then(result => {
      if (!controller.signal.aborted) { setReport(result); setReportAccount(account); setReportSavedId(selected && !dirty ? selected.id : ""); }
    }).catch((reason: unknown) => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Could not load report."); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [ready, period.start, period.end, account, currency, revision, selectedId, selected, dirty]);
  const money = (amount: string | number) => formatCurrency(amount, report?.currency ?? currency);
  const drill = (extra: Record<string, string> = {}) => `/transactions?${new URLSearchParams({ ...(reportSavedId ? { saved_report: reportSavedId, month: "" } : { start_date: report?.start_date ?? period.start, end_date: report?.end_date ?? period.end, currency: report?.currency ?? currency, ...(reportAccount ? { account: reportAccount } : {}) }), ...extra, report_return: `${reportPath}?${reportFilterQuery({ period, account, currency, savedReport: selectedId })}` })}`;
  function openSaved(row: SavedReport) {
    setSelectedId(row.id); setPeriod({ mode: row.date_view, start: row.start_date, end: row.end_date });
    setAccount(row.account ?? ""); setCurrency(row.currency); setName(row.name); setSaveError(""); setMessage("");
  }
  async function persist(asNew = false) {
    const token = getAccessToken();
    if (!token || mutationInFlight.current || period.mode === "all") return;
    mutationInFlight.current = true; setBusy(true); setSaveError(""); setMessage("");
    try {
      const row = await saveReport(token, { name: name.trim(), start_date: period.start, end_date: period.end, date_view: period.mode, account: account || null, currency }, asNew ? undefined : selected?.id);
      setSavedReports(current => [...current.filter(item => item.id !== row.id), row].sort((a, b) => a.name.localeCompare(b.name)));
      openSaved(row); setMessage("Report saved."); setRevision(value => value + 1);
    } catch (reason) { setSaveError(reason instanceof Error ? reason.message : "Could not save report."); }
    finally { mutationInFlight.current = false; setBusy(false); }
  }
  async function removeSaved() {
    const token = getAccessToken();
    if (!token || !selected || mutationInFlight.current) return;
    mutationInFlight.current = true; setBusy(true); setSaveError("");
    try {
      await deleteSavedReport(token, selected.id);
      setSavedReports(current => current.filter(row => row.id !== selected.id)); setSelectedId(""); setName("");
      setConfirmDelete(false); setMessage("Saved report deleted. Your transactions are unchanged.");
    } catch (reason) { setSaveError(reason instanceof Error ? reason.message : "Could not delete report."); setConfirmDelete(false); }
    finally { mutationInFlight.current = false; setBusy(false); }
  }
  const difference = (now: string, before: string) => {
    const delta = Number(now) - Number(before);
    return `${delta >= 0 ? "+" : "−"}${money(Math.abs(delta))} vs previous period`;
  };
  return <div className="workspace-grid report-workspace">
    <div className="report-actions"><Link className="button button--ghost" href={custom ? "/reports" : "/custom-reports"}>{custom ? "Financial reports" : "Custom reports"} <ArrowRight size={17} /></Link>{!custom && ready ? <Link className="button button--primary" href={`/custom-reports?${reportFilterQuery({ period, account, currency, savedReport: "" })}`}>Save these filters as a custom report</Link> : null}</div>
    {custom ? <section className="panel"><div className="panel__body">
      <h1 className="section-title">Custom reports</h1><p className="section-subtitle">Keep named filters and tailor the transactions in each report.</p>
      {savedListError ? <p className="form-error" role="alert">{savedListError} Reload the page to retry.</p> : null}
      {!ready ? <p role="status">Loading saved reports…</p> : <div className="report-actions">{savedReports.map(row => <button key={row.id} className="button button--ghost" aria-pressed={selectedId === row.id} disabled={busy} onClick={() => openSaved(row)}>{row.name}</button>)}{!savedReports.length && !savedListError ? <p>No saved reports yet. Choose filters below and save your first report.</p> : null}<button className="button button--ghost" disabled={busy} onClick={() => { setSelectedId(""); setName(""); setMessage(""); setSaveError(""); }}>New report</button></div>}
    </div></section> : null}
    <section className="panel"><div className="panel__body">
      <div className="report-header"><div>{custom ? <h2 className="section-title">{selected?.name ?? "Create a custom report"}</h2> : <h1 className="section-title">Your financial report</h1>}<p className="section-subtitle">Earned income and spending, with borrowing and account transfers shown separately.</p></div><button className="icon-button" aria-label="Refresh report" title="Refresh report" disabled={loading} onClick={() => setRevision(value => value + 1)}><ArrowClockwise size={20} /></button></div>
      <fieldset disabled={!ready || busy} className="report-filter-fields">
      <DatePeriodControls label="Report dates" allowAll={false} value={period} onChange={setPeriod} />
      <div className="transaction-form">
        <label className="field"><span className="field__label">Account</span><select aria-label="Account" className="field__control" value={account} onChange={event => { setAccount(event.target.value); const row = accounts.find(item => item.id === event.target.value); if (row) setCurrency(row.currency); }}><option value="">All accounts</option>{accounts.map(row => <option key={row.id} value={row.id}>{row.name} · {row.currency}</option>)}</select></label>
        <label className="field"><span className="field__label">Currency</span><select aria-label="Currency" className="field__control" value={account ? accounts.find(row => row.id === account)?.currency ?? currency : currency} disabled={!!account} onChange={event => setCurrency(event.target.value)}>{Array.from(new Set(["BDT", currency, ...accounts.map(row => row.currency)])).map(value => <option key={value}>{value}</option>)}</select></label>
      </div>
      {custom ? <form className="report-actions" onSubmit={event => { event.preventDefault(); void persist(); }}>
        <label className="field"><span className="field__label">Report name</span><input className="field__control" required maxLength={160} value={name} onChange={event => setName(event.target.value)} placeholder="e.g. October household spending" /></label>
        <button className="button button--primary" disabled={!name.trim() || !!savedListError || (!!selectedId && !selected)}>{busy ? "Saving…" : selected ? "Save changes" : "Save report"}</button>
        {selected ? <><button className="button button--ghost" type="button" disabled={!name.trim()} onClick={() => void persist(true)}>Save as new</button><button className="button button--ghost" type="button" onClick={() => setConfirmDelete(true)}>Delete saved report</button></> : null}
      </form> : null}
      </fieldset>
      {saveError ? <p role="alert" className="form-error">{saveError}</p> : null}
      {message ? <p role="status">{message}</p> : null}
      {selectedId && !selected && ready ? <p role="alert" className="form-error">This saved report is unavailable. Choose another saved report or start a new report.</p> : null}
      {dirty ? <p role="status">Previewing changed filters. Save changes to apply them to this saved report and restore its transaction choices.</p> : selected ? <p className="muted-text">Viewing {selected.name}. Manual additions may fall outside the saved dates or account. The previous period uses the saved filters without manual changes.</p> : null}
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
    {custom && selected && !dirty ? <SavedReportTransactions key={selected.id} report={selected} accounts={accounts} revision={revision} onChange={() => setRevision(value => value + 1)} /> : null}
    {report ? <>
      <section className="panel"><div className="panel__body"><h2 className="section-title">Net spending by category</h2><div className="list-stack">{report.categories.length ? report.categories.map(row => <Link className="list-row" key={row.id ?? "uncategorized"} href={drill({ category: row.id ?? "uncategorized", spending: "true" })}><span>{row.name}<small className="report-comparison">{difference(row.amount, row.previous_amount)}</small></span><strong>{money(row.amount)} <ArrowRight size={15} /></strong></Link>) : <p>No spending or refunds recorded in this period.</p>}</div></div></section>
      <section className="panel"><div className="panel__body"><h2 className="section-title">Merchants and counterparties</h2><div className="list-stack">{report.merchants.map(row => <Link className="list-row" key={row.search} href={drill({ search: `merchant:${JSON.stringify(row.search)}`, spending: "true" })}><span>{row.name} <small className="muted-text">· {row.count} {row.count === 1 ? "movement" : "movements"}</small><small className="report-comparison">{difference(row.amount, row.previous_amount)}</small></span><strong>{money(row.amount)} <ArrowRight size={15} /></strong></Link>)}{!report.merchants.length ? <p>No merchants in this period.</p> : null}</div></div></section>
      <section className="panel"><div className="panel__body"><h2 className="section-title">Account movement</h2><div className="table-wrap"><table className="data-table"><thead><tr><th>Account</th><th>Money in</th><th>Money out</th></tr></thead><tbody>{report.accounts.map(row => <tr key={row.id}><td><Link href={drill({ account: row.id })}>{row.name} <ArrowRight size={15} /></Link></td><td>{money(row.money_in)}</td><td>{money(row.money_out)}</td></tr>)}</tbody></table></div>{!report.accounts.length ? <p>No account movements in this period.</p> : null}</div></section>
    </> : null}
    {confirmDelete && selected ? <ModalDialog labelledBy="delete-report-title" busy={busy} onCancel={() => setConfirmDelete(false)}><div className="panel__body"><h2 id="delete-report-title">Delete {selected.name}?</h2><p>This deletes the saved report and its transaction choices. Your transactions stay in your ledger.</p><div className="report-actions"><button className="button button--ghost" disabled={busy} onClick={() => setConfirmDelete(false)}>Cancel</button><button className="button button--primary" disabled={busy} onClick={() => void removeSaved()}>{busy ? "Deleting…" : "Delete report"}</button></div></div></ModalDialog> : null}
  </div>;
}
