"use client";

import { savedReport as getSavedReport, periodReport as getPeriodReport, reportAccounts as listAccounts, reportCategories as listCategories } from "@/lib/report-data";
import { invalidateReportCache } from "@/lib/report-cache";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { ArrowClockwise, PencilSimple, Export, CheckCircle } from "@phosphor-icons/react";
import { deleteSavedReport, exportTransactionsCsv, type SavedReport, type MonthlyReport, type Account, type Category } from "@/lib/api";
import { getAccessToken } from "@/lib/auth-storage";
import { customReportPath, customReportEditPath } from "@/lib/report-navigation";
import { savedReportRules } from "@/lib/report-rules";
import { emptyReportRules } from "@/lib/report-rules";
import { formatCalendarDate, formatTimestamp } from "../../finance-contracts/presentation";
import { ReportResults } from "@/components/report-results";
import { CustomReportDefinition } from "@/components/custom-report-definition";
import { SavedReportTransactions } from "@/components/saved-report-transactions";
import { ModalDialog } from "@/components/modal-dialog";
import { ReportScopeChips } from "@/components/report-scope-chips";
import { ReportTransactionModal, type ReportSelection } from "@/components/report-transaction-modal";
import type { TransactionFilters } from "@/lib/api";
import { AccountReportStatements } from "@/components/account-report-statements";

export function CustomReportDetail({ id }: { id: string }) {
  const router = useRouter();
  const [definition, setDefinition] = useState<SavedReport | null>(null);
  const [view, setView] = useState<SavedReport["report_view"] | null>(null);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [report, setReport] = useState<MonthlyReport | null>(null);
  const [loadError, setLoadError] = useState("");
  const [error, setError] = useState("");
  const [warning, setWarning] = useState("");
  const [loading, setLoading] = useState(true);
  const [definitionRevision, setDefinitionRevision] = useState(0);
  const [revision, setRevision] = useState(0);
  const [selection, setSelection] = useState<ReportSelection | null>(null);
  const [managing, setManaging] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [refreshedAt, setRefreshedAt] = useState<string | null>(null);
  const inFlight = useRef(false);
  useEffect(() => {
    const token = getAccessToken(); if (!token) { setLoadError("Sign in to view this report."); return; }
    const controller = new AbortController(); setLoadError(""); setWarning("");
    void Promise.allSettled([getSavedReport(token, id, controller.signal), listAccounts(token, controller.signal), listCategories(token, controller.signal)]).then(([saved, accountRows, categoryRows]) => {
      if (controller.signal.aborted) return;
      if (saved.status === "rejected") { setLoadError(saved.reason instanceof Error ? saved.reason.message : "This report is unavailable."); return; }
      setDefinition(saved.value);
      setView(current => current ?? (new URLSearchParams(window.location.search).get("view") === "account_statement" ? "account_statement" : new URLSearchParams(window.location.search).get("view") === "analysis" ? "analysis" : saved.value.report_view));
      if (accountRows.status === "fulfilled") setAccounts(accountRows.value);
      if (categoryRows.status === "fulfilled") setCategories(categoryRows.value);
      if (accountRows.status === "rejected" || categoryRows.status === "rejected") setWarning("Some account or category labels could not be loaded. Report results still use the saved rules.");
    });
    return () => controller.abort();
  }, [id, definitionRevision]);
  useEffect(() => {
    const refresh = () => { invalidateReportCache(); setRevision(value => value + 1); };
    window.addEventListener("finance:transactions-changed", refresh); return () => window.removeEventListener("finance:transactions-changed", refresh);
  }, []);
  useEffect(() => {
    if (!definition) return;
    if (view === null) return;
    if (view === "account_statement") { setLoading(false); return; }
    const token = getAccessToken(); if (!token) return;
    const controller = new AbortController(); setLoading(true); setError("");
    void getPeriodReport(token, definition.start_date, definition.end_date, controller.signal, { saved_report: id }).then(value => { if (!controller.signal.aborted) { setReport(value); setRefreshedAt(new Date().toISOString()); } })
      .catch((reason: unknown) => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Could not run report."); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [id, definition, revision, view]);
  function changeView(value: SavedReport["report_view"]) {
    setView(value);
    const params = new URLSearchParams(window.location.search); params.set("view", value);
    window.history.replaceState(window.history.state, "", `${customReportPath(id)}?${params}`);
  }
  async function exportCsv() {
    const token = getAccessToken(); if (!token || !definition || exporting || loading) return;
    setExporting(true); setError("");
    try {
      const blob = await exportTransactionsCsv(token, { saved_report: id });
      const url = URL.createObjectURL(blob); const link = document.createElement("a"); link.href = url;
      link.download = `${definition.name.replace(/[^a-zA-Z0-9_-]+/g, "-").slice(0, 80) || "custom-report"}.csv`;
      link.click(); window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not export report."); }
    finally { setExporting(false); }
  }
  async function remove() {
    const token = getAccessToken(); if (!token || inFlight.current) return;
    inFlight.current = true; setDeleteBusy(true);
    try { await deleteSavedReport(token, id); router.push("/custom-reports"); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Could not delete report."); setDeleting(false); }
    finally { inFlight.current = false; setDeleteBusy(false); }
  }
  const drill = (extra: Record<string, string> = {}) => `/transactions?${new URLSearchParams({ saved_report: id, month: "", ...extra, report_return: `${customReportPath(id)}?view=analysis` })}`;
  const openDrill = (extra: Record<string, string>, label: string) => setSelection({ label, filters: { saved_report: id, ...extra } as TransactionFilters, href: drill(extra) });
  return <div className="workspace-grid report-workspace custom-report-detail">
    <nav aria-label="Report breadcrumb"><Link className="button button--ghost" href="/custom-reports">← All custom reports</Link></nav>
    {loadError ? <section className="panel"><div className="panel__body"><h1>Report unavailable</h1><p role="alert" className="form-error">{loadError}</p><button className="button button--ghost" onClick={() => setDefinitionRevision(value => value + 1)}>Retry loading report</button></div></section> : !definition ? <p role="status">Opening report…</p> : <>
      <header className="report-page-heading"><div><span className="report-eyebrow">Saved report</span><h1>{definition.name}</h1><p>{formatCalendarDate(definition.start_date)}–{formatCalendarDate(definition.end_date)} · {definition.currency}</p><small className="report-live-label"><CheckCircle size={14} aria-hidden="true" />Fixed dates · Results cached up to 5 min{refreshedAt && view === "analysis" ? ` · Loaded ${new Date(refreshedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : ""}</small></div><div className="report-actions"><button className="icon-button" aria-label="Refresh report" disabled={loading} onClick={() => { invalidateReportCache(); setDefinitionRevision(value => value + 1); if (view === "account_statement") setRevision(value => value + 1); }}><ArrowClockwise size={20} /></button><Link className="button button--ghost" href={customReportEditPath(id)}><PencilSimple size={16} aria-hidden="true" />Edit report</Link>{view === "analysis" ? <button className="button button--primary" disabled={loading || !report || exporting || !!error} onClick={() => void exportCsv()}><Export size={16} aria-hidden="true" />{exporting ? "Exporting…" : "Export CSV"}</button> : null}<details className="report-more-actions"><summary role="button" aria-label="More report actions">More</summary><div className="report-action-menu"><Link href={`/custom-reports/new?copy_from=${id}`}>Duplicate</Link><button type="button" onClick={() => setDeleting(true)}>Delete report</button></div></details></div></header>
      <div className="report-segmented report-view-toggle" role="group" aria-label="Report view"><button type="button" aria-pressed={view === "analysis"} onClick={() => changeView("analysis")}>Analysis</button><button type="button" aria-pressed={view === "account_statement"} onClick={() => changeView("account_statement")}>Account statements</button></div>
      <section className="report-scope-summary" aria-label="Report filters"><div className="report-panel-heading"><strong>Saved selection</strong><Link href={customReportEditPath(id)}>Edit filters <PencilSimple size={12} aria-hidden="true" /></Link></div><ReportScopeChips accountsOnly={view === "account_statement"} rules={view === "account_statement" ? { ...emptyReportRules(), accounts: savedReportRules(definition).accounts, excluded_accounts: savedReportRules(definition).excluded_accounts } : savedReportRules(definition)} accounts={accounts} categories={categories} /><p>{view === "analysis" ? "Matching transactions and manual choices are included." : "Full account movements in the saved date range."} <a href="#report-definition">View full definition</a> · Updated {formatTimestamp(definition.updated_at)}</p></section>
      <nav className="report-section-links" aria-label="Report sections">{view === "analysis" ? <><a href="#report-overview">Overview</a><a href="#report-breakdowns">Breakdowns</a><a href="#report-transactions">Transactions</a></> : <><a href="#account-statements">Balances</a><button type="button" className="report-text-button" onClick={() => window.dispatchEvent(new Event("finance:open-report-account"))}>Account transactions</button></>}<a href="#report-definition">Saved rules</a></nav>
      {warning ? <p className="muted-text" role="status">{warning}</p> : null}
      {view === "account_statement" ? <AccountReportStatements report={definition} revision={revision} onSaved={setDefinition} /> : <>{error ? <div role="alert" className="form-error"><p>{error}</p><button className="button button--ghost" onClick={() => setRevision(value => value + 1)}>Retry report</button></div> : null}
      {loading ? <p role="status">Updating report…{report ? " Previous results remain visible." : ""}</p> : null}
      {report ? <ReportResults report={report} enhanced loading={loading} onDrill={openDrill} drill={!error ? drill : undefined} cashDescription={savedReportRules(definition).accounts.length ? "Transfers crossing the selected account group count as cash flow; internal transfers are excluded." : undefined} /> : null}
      <div className="report-transactions-heading"><div><h2>Report transactions</h2><p className="muted-text">Inspect the entries behind these results. Manage the selection to add or remove individual transactions.</p></div><button className="button button--ghost" aria-pressed={managing} onClick={() => setManaging(value => !value)}>{managing ? "Done managing transactions" : "Manage transactions"}</button></div>
      <SavedReportTransactions report={definition} accounts={accounts} revision={revision} manage={managing} onInspect={transaction => setSelection({ label: "Report transactions", filters: { saved_report: id }, href: drill(), transaction })} onChange={() => setRevision(value => value + 1)} />
      </>}
      <CustomReportDefinition report={definition} accounts={accounts} categories={categories} />
    </>}
    {selection && definition ? <ReportTransactionModal selection={selection} accounts={accounts} categories={categories} currency={definition.currency} revision={revision} onClose={() => setSelection(null)} /> : null}
    {deleting && definition ? <ModalDialog labelledBy="delete-detail-report" busy={deleteBusy} onCancel={() => setDeleting(false)}><div className="panel__body"><h2 id="delete-detail-report">Delete {definition.name}?</h2><p>This deletes the saved report and manual report choices. Your ledger transactions stay unchanged.</p><div className="report-actions"><button className="button button--ghost" disabled={deleteBusy} onClick={() => setDeleting(false)}>Cancel</button><button className="button button--primary" disabled={deleteBusy} onClick={() => void remove()}>{deleteBusy ? "Deleting…" : "Delete report"}</button></div></div></ModalDialog> : null}
  </div>;
}
