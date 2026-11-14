"use client";

import { accountStatements as getAccountStatements } from "@/lib/report-data";
import { invalidateReportCache } from "@/lib/report-cache";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Export, PencilSimple, X } from "@phosphor-icons/react";
import { saveReportOpeningBalances, exportAccountStatement, type SavedReport, type ReportOpeningBalance, type AccountStatementPage } from "@/lib/api";
import { getAccessToken } from "@/lib/auth-storage";
import { customReportPath } from "@/lib/report-navigation";
import { reportCents, reportMoney } from "@/lib/report-presentation";
import { formatCalendarDate, formatCurrency, displayLabel } from "../../finance-contracts/presentation";
import { ModalDialog } from "@/components/modal-dialog";

export function AccountReportStatements({ report, revision, onSaved }: { report: SavedReport; revision: number; onSaved: (report: SavedReport) => void }) {
  const [account, setAccount] = useState(() => typeof window === "undefined" ? "" : new URLSearchParams(window.location.search).get("statement_account") ?? "");
  const [detailOpen, setDetailOpen] = useState(() => typeof window !== "undefined" && new URLSearchParams(window.location.search).has("statement_account"));
  const [offset, setOffset] = useState(0);
  const [page, setPage] = useState<AccountStatementPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [actionError, setActionError] = useState("");
  const [refresh, setRefresh] = useState(0);
  const [editing, setEditing] = useState(false);
  const [mode, setMode] = useState<ReportOpeningBalance["mode"]>("ledger");
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [message, setMessage] = useState("");
  const inFlight = useRef(false);
  const settings = JSON.stringify([report.start_date, report.end_date, report.currency, report.account, report.filters.accounts, report.filters.excluded_accounts, report.opening_balances]);
  useEffect(() => {
    const token = getAccessToken(); if (!token) return;
    const controller = new AbortController(); setLoading(true); setError("");
    void getAccountStatements(token, report.id, account, offset, controller.signal).then(value => {
      if (controller.signal.aborted) return;
      if (!value.results.length && offset) setOffset(value.count ? Math.max(0, Math.floor((value.count - 1) / 25) * 25) : 0);
      else setPage(value);
    }).catch((reason: unknown) => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Could not load account statements."); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [report.id, settings, account, offset, revision, refresh]);
  useEffect(() => {
    const params = new URLSearchParams(window.location.search); params.set("view", "account_statement");
    if (detailOpen && page?.account) params.set("statement_account", page.account); else params.delete("statement_account");
    window.history.replaceState(window.history.state, "", `${customReportPath(report.id)}?${params}${window.location.hash}`);
  }, [detailOpen, page?.account, report.id]);
  useEffect(() => {
    const open = () => setDetailOpen(true);
    window.addEventListener("finance:open-report-account", open);
    return () => window.removeEventListener("finance:open-report-account", open);
  }, []);
  const selected = page?.accounts.find(row => row.account === page.account);
  const money = (value: string | null) => value === null ? "Not set" : formatCurrency(value, report.currency);
  const basis = (value: ReportOpeningBalance["mode"]) => value === "ledger" ? "Ledger opening" : value === "reported" ? "Last reported, carried forward" : "Manual opening";
  function edit() {
    if (!selected) return;
    setMode(selected.opening_mode); setAmount(selected.opening_balance ?? selected.ledger_opening_balance); setSaveError(""); setEditing(true);
  }
  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); const token = getAccessToken(); if (!token || !selected || inFlight.current) return;
    if (mode === "manual" && !/^-?\d+(\.\d{1,2})?$/.test(amount)) { setSaveError("Enter a signed amount with at most two decimal places."); return; }
    inFlight.current = true; setBusy(true); setSaveError("");
    try { const saved = await saveReportOpeningBalances(token, report, selected.account, { mode, ...(mode === "manual" ? { amount } : {}) }); onSaved(saved); setEditing(false); setMessage("Opening balance saved for this report. Ledger balances are unchanged."); }
    catch (reason) { setSaveError(reason instanceof Error ? reason.message : "Could not save the opening balance."); }
    finally { inFlight.current = false; setBusy(false); }
  }
  async function exportCsv() {
    const token = getAccessToken(); if (!token || !selected || exporting) return;
    setExporting(true); setActionError("");
    try { const blob = await exportAccountStatement(token, report.id, selected.account); const url = URL.createObjectURL(blob); const link = document.createElement("a"); link.href = url; link.download = "account-statement.csv"; link.click(); window.setTimeout(() => URL.revokeObjectURL(url), 1000); }
    catch (reason) { setActionError(reason instanceof Error ? reason.message : "Could not export the account statement."); }
    finally { setExporting(false); }
  }
  const previewOpening = selected ? mode === "manual" ? (/^-?\d+(\.\d{1,2})?$/.test(amount) ? amount : null) : mode === "reported" ? selected.reported_opening_balance : selected.ledger_opening_balance : null;
  const previewClosing = previewOpening !== null && selected ? reportMoney(reportCents(previewOpening) + reportCents(selected.money_in) - reportCents(selected.money_out)) : null;
  const returnPath = selected ? `${customReportPath(report.id)}?view=account_statement&statement_account=${selected.account}` : customReportPath(report.id);
  return <div className="workspace-grid report-workspace" id="account-statements">
    <section className="panel"><div className="panel__body"><div className="report-panel-heading"><div><span className="report-eyebrow">From opening to closing</span><h2>Account statements</h2></div><button className="button button--ghost" disabled={loading} onClick={() => { invalidateReportCache(); setRefresh(value => value + 1); }}>Refresh statements</button></div><p className="muted-text">{formatCalendarDate(report.start_date)}–{formatCalendarDate(report.end_date)} · {report.currency}. Opening is immediately before the first day; closing includes the last day. Results are cached up to five minutes; refresh for the latest activity.</p>
      {error ? <div role="alert" className="form-error"><p>{error}</p><button className="button button--ghost" onClick={() => { setAccount(""); setOffset(0); setRefresh(value => value + 1); }}>Reset account selection and retry</button></div> : null}{actionError ? <p role="alert" className="form-error">{actionError}</p> : null}{loading ? <p role="status">Updating account statements…</p> : null}{message ? <p role="status">{message}</p> : null}
      {page && !error ? <><p className="report-chart-note">Select an account to inspect its statement and edit the opening balance.</p><p className="report-statement-notice">{page.notice}</p><div className="table-wrap"><table className="data-table report-statement-accounts"><caption className="sr-only">Opening and closing balance by account</caption><thead><tr><th scope="col">Account</th><th scope="col">Opening balance</th><th scope="col">Money in</th><th scope="col">Money out</th><th scope="col">Closing balance</th></tr></thead><tbody>{page.accounts.map(row => <tr key={row.account} aria-selected={row.account === page.account}><th scope="row"><button className="report-text-button" disabled={loading} onClick={() => { if (row.account !== page.account) { setAccount(row.account); setOffset(0); } setDetailOpen(true); }}>{row.name}</button><small className="report-comparison">{row.transaction_count} transactions</small></th><td>{money(row.opening_balance)}<small className="report-comparison">{basis(row.opening_mode)}</small></td><td>{money(row.money_in)}</td><td>{money(row.money_out)}</td><td><strong>{money(row.closing_balance)}</strong></td></tr>)}</tbody></table></div>{!page.accounts.length ? <p>No accounts match this report’s account selection and currency.</p> : null}</> : null}
    </div></section>
    {detailOpen && page && !error && selected ? <ModalDialog labelledBy="account-statement-title" initialFocus="#account-statement-title" className="report-detail-modal" onCancel={() => setDetailOpen(false)}><header className="report-modal-header"><div><span className="report-eyebrow">Account statement</span><h2 id="account-statement-title" tabIndex={-1}>{selected.name}</h2><p>{formatCalendarDate(report.start_date)}–{formatCalendarDate(report.end_date)} · {report.currency}</p></div><button className="icon-button" aria-label="Close account statement" onClick={() => setDetailOpen(false)}><X size={20} /></button></header><div className="report-modal-body" id="statement-transactions"><div className="report-panel-heading"><div><span className="report-eyebrow">Account detail</span><h3>Balance and transactions</h3></div><div className="report-actions"><button className="button button--ghost" disabled={loading} onClick={edit}><PencilSimple size={16} aria-hidden="true" />Edit opening balance</button><button className="button button--ghost" disabled={loading || exporting} onClick={() => void exportCsv()}><Export size={16} aria-hidden="true" />{exporting ? "Exporting…" : "Export statement CSV"}</button></div></div>
      <label className="field"><span className="field__label">Statement account</span><select className="field__control" aria-label="Statement account" value={page.account ?? ""} disabled={loading} onChange={event => { setAccount(event.target.value); setOffset(0); }}>{page.accounts.map(row => <option value={row.account} key={row.account}>{row.name}</option>)}</select></label>
      <div className="report-statement-equation"><div><span>Opening balance</span><strong>{money(selected.opening_balance)}</strong></div><span aria-hidden="true">+</span><div><span>Money in</span><strong>{money(selected.money_in)}</strong></div><span aria-hidden="true">−</span><div><span>Money out</span><strong>{money(selected.money_out)}</strong></div><span aria-hidden="true">=</span><div><span>Closing balance</span><strong>{money(selected.closing_balance)}</strong></div></div>
      <p className="report-chart-note">{basis(selected.opening_mode)}. Ledger opening: {money(selected.ledger_opening_balance)} · Ledger closing: {money(selected.ledger_closing_balance)}. These are distinct references when a report-only opening is used.</p>
      {selected.opening_mode === "reported" && selected.last_reported_date ? <p className="report-chart-note">Reported {formatCalendarDate(selected.last_reported_date)}: {money(selected.last_reported_balance)}. Recorded movements after that report have been carried forward to the opening date.</p> : null}
      {selected.opening_balance === null ? <p role="alert" className="form-error">{selected.reported_unavailable_reason} Set an opening balance to calculate running and closing balances.</p> : null}
      <div aria-busy={loading} className="table-wrap"><table className="data-table"><caption className="sr-only">{selected.name} transactions and running balance, oldest first</caption><thead><tr><th scope="col">Date</th><th scope="col">Transaction</th><th scope="col">Money in</th><th scope="col">Money out</th><th scope="col">Running balance</th></tr></thead><tbody>{page.results.map(row => <tr key={row.id}><td>{formatCalendarDate(row.date)}<small className="report-comparison">{row.time?.slice(0, 5) ?? "Time unknown"}</small></td><td>{row.description}<small className="report-comparison">{displayLabel(row.type)} · {row.category ?? "Uncategorized"}</small></td><td>{row.money_in === "0.00" ? "—" : money(row.money_in)}</td><td>{row.money_out === "0.00" ? "—" : money(row.money_out)}</td><td>{money(row.running_balance)}</td></tr>)}</tbody></table></div>
      {!page.results.length ? <p>No transactions in this range. The closing balance equals the opening balance.</p> : null}
      <div className="report-actions"><button className="button button--ghost" disabled={loading || !offset} onClick={() => setOffset(Math.max(0, offset - 25))}>Previous transactions</button><span>{page.count ? `${offset + 1}–${Math.min(offset + 25, page.count)} of ${page.count}` : "0 transactions"}</span><button className="button button--ghost" disabled={loading || page.next_offset === null} onClick={() => setOffset(page.next_offset!)}>Next transactions</button><Link className="report-text-button" href={`/transactions?${new URLSearchParams({ account: selected.account, start_date: report.start_date, end_date: report.end_date, currency: report.currency, report_return: returnPath })}`}>Open account transactions</Link></div>
    </div><footer className="report-modal-footer"><button className="button button--primary" onClick={() => setDetailOpen(false)}>Done</button></footer></ModalDialog> : null}
    {editing && selected ? <ModalDialog labelledBy="statement-opening-title" busy={busy} onCancel={() => setEditing(false)}><div className="panel__body"><h2 id="statement-opening-title">Opening balance for {selected.name}</h2><p>Choose the balance immediately before {formatCalendarDate(report.start_date)}. This setting affects this saved report only.</p><form onSubmit={save}><label className="field"><span className="field__label">Starting balance basis</span><select className="field__control" aria-label="Starting balance basis" disabled={busy} value={mode} onChange={event => { const next = event.target.value as typeof mode; if (next === "manual" && previewOpening !== null) setAmount(previewOpening); setMode(next); }}><option value="ledger">Ledger opening ({money(selected.ledger_opening_balance)})</option><option value="reported" disabled={selected.reported_opening_balance === null}>Last known reported balance, carried forward</option><option value="manual">Enter or edit starting balance</option></select></label>
      {selected.last_reported_date ? <p className="report-chart-note">Last report before the range: {formatCalendarDate(selected.last_reported_date)} · {money(selected.last_reported_balance)}.</p> : null}
      {selected.reported_unavailable_reason ? <p className="report-chart-note">{selected.reported_unavailable_reason}</p> : null}
      {mode === "manual" ? <label className="field"><span className="field__label">Starting balance ({report.currency}, signed)</span><input className="field__control" aria-label={`Starting balance (${report.currency}, signed)`} type="number" step="0.01" required value={amount} disabled={busy} onChange={event => setAmount(event.target.value)} /><small>Use a negative amount for a negative ledger balance. Zero is allowed.</small></label> : null}
      <div className="report-opening-preview"><span>Opening {money(previewOpening)}</span><strong>Closing {money(previewClosing)}</strong></div>
      {saveError ? <p role="alert" className="form-error">{saveError}</p> : null}<div className="report-actions"><button type="button" className="button button--ghost" disabled={busy} onClick={() => setEditing(false)}>Cancel</button><button className="button button--primary" disabled={busy || (mode === "reported" && selected.reported_opening_balance === null)}>{busy ? "Saving…" : "Save opening balance"}</button></div></form></div></ModalDialog> : null}
  </div>;
}
