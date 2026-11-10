"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { ArrowClockwise } from "@phosphor-icons/react";
import { getSavedReport, getPeriodReport, listAccounts, listCategories, deleteSavedReport, exportTransactionsCsv, type SavedReport, type MonthlyReport, type Account, type Category } from "@/lib/api";
import { getAccessToken } from "@/lib/auth-storage";
import { customReportPath, customReportEditPath } from "@/lib/report-navigation";
import { savedReportRules } from "@/lib/report-rules";
import { formatCalendarDate, formatTimestamp } from "../../finance-contracts/presentation";
import { ReportResults } from "@/components/report-results";
import { CustomReportDefinition } from "@/components/custom-report-definition";
import { SavedReportTransactions } from "@/components/saved-report-transactions";
import { ModalDialog } from "@/components/modal-dialog";

export function CustomReportDetail({ id }: { id: string }) {
  const router = useRouter();
  const [definition, setDefinition] = useState<SavedReport | null>(null);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [report, setReport] = useState<MonthlyReport | null>(null);
  const [loadError, setLoadError] = useState("");
  const [error, setError] = useState("");
  const [warning, setWarning] = useState("");
  const [loading, setLoading] = useState(true);
  const [definitionRevision, setDefinitionRevision] = useState(0);
  const [revision, setRevision] = useState(0);
  const [managing, setManaging] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const inFlight = useRef(false);
  useEffect(() => {
    const token = getAccessToken(); if (!token) { setLoadError("Sign in to view this report."); return; }
    const controller = new AbortController(); setLoadError(""); setWarning("");
    void Promise.allSettled([getSavedReport(token, id, controller.signal), listAccounts(token, controller.signal), listCategories(token, controller.signal)]).then(([saved, accountRows, categoryRows]) => {
      if (controller.signal.aborted) return;
      if (saved.status === "rejected") { setLoadError(saved.reason instanceof Error ? saved.reason.message : "This report is unavailable."); return; }
      setDefinition(saved.value);
      if (accountRows.status === "fulfilled") setAccounts(accountRows.value);
      if (categoryRows.status === "fulfilled") setCategories(categoryRows.value);
      if (accountRows.status === "rejected" || categoryRows.status === "rejected") setWarning("Some account or category labels could not be loaded. Report results still use the saved rules.");
    });
    return () => controller.abort();
  }, [id, definitionRevision]);
  useEffect(() => {
    const refresh = () => setRevision(value => value + 1);
    window.addEventListener("finance:transactions-changed", refresh); return () => window.removeEventListener("finance:transactions-changed", refresh);
  }, []);
  useEffect(() => {
    if (!definition) return;
    const token = getAccessToken(); if (!token) return;
    const controller = new AbortController(); setLoading(true); setError("");
    void getPeriodReport(token, definition.start_date, definition.end_date, controller.signal, { saved_report: id }).then(value => { if (!controller.signal.aborted) setReport(value); })
      .catch((reason: unknown) => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Could not run report."); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [id, definition, revision]);
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
  const drill = (extra: Record<string, string> = {}) => `/transactions?${new URLSearchParams({ saved_report: id, month: "", ...extra, report_return: customReportPath(id) })}`;
  return <div className="workspace-grid report-workspace">
    <nav aria-label="Report breadcrumb"><Link className="button button--ghost" href="/custom-reports">← All custom reports</Link></nav>
    {loadError ? <section className="panel"><div className="panel__body"><h1>Report unavailable</h1><p role="alert" className="form-error">{loadError}</p><button className="button button--ghost" onClick={() => setDefinitionRevision(value => value + 1)}>Retry loading report</button></div></section> : !definition ? <p role="status">Opening report…</p> : <>
      <header className="report-page-heading"><div><h1>{definition.name}</h1><p>{formatCalendarDate(definition.start_date)}–{formatCalendarDate(definition.end_date)} · {definition.currency} · Live report</p><small className="muted-text">Definition updated {formatTimestamp(definition.updated_at)}</small></div><div className="report-actions"><button className="icon-button" aria-label="Refresh report" disabled={loading} onClick={() => { setDefinitionRevision(value => value + 1); setRevision(value => value + 1); }}><ArrowClockwise size={20} /></button><Link className="button button--ghost" href={customReportEditPath(id)}>Edit report</Link><Link className="button button--ghost" href={`/custom-reports/new?copy_from=${id}`}>Duplicate</Link><button className="button button--primary" disabled={loading || !report || exporting || !!error} onClick={() => void exportCsv()}>{exporting ? "Exporting…" : "Export CSV"}</button><details className="report-more-actions"><summary>More</summary><button className="button button--ghost" onClick={() => setDeleting(true)}>Delete report</button></details></div></header>
      <nav className="report-section-links" aria-label="Report sections"><a href="#report-overview">Overview</a><a href="#report-breakdowns">Breakdowns</a><a href="#report-transactions">Transactions</a><a href="#report-definition">Saved rules</a></nav>
      {warning ? <p className="muted-text" role="status">{warning}</p> : null}
      {error ? <div role="alert" className="form-error"><p>{error}</p><button className="button button--ghost" onClick={() => setRevision(value => value + 1)}>Retry report</button></div> : null}
      {loading ? <p role="status">Updating report…{report ? " Previous results remain visible." : ""}</p> : null}
      {report ? <ReportResults report={report} loading={loading} drill={!error ? drill : undefined} cashDescription={savedReportRules(definition).accounts.length ? "Transfers crossing the selected account group count as cash flow; internal transfers are excluded." : undefined} /> : null}
      <div className="report-transactions-heading"><div><h2>Report transactions</h2><p className="muted-text">Inspect the entries behind these results. Manage the selection to add or remove individual transactions.</p></div><button className="button button--ghost" aria-pressed={managing} onClick={() => setManaging(value => !value)}>{managing ? "Done managing transactions" : "Manage transactions"}</button></div>
      <SavedReportTransactions report={definition} accounts={accounts} revision={revision} manage={managing} onChange={() => setRevision(value => value + 1)} />
      <CustomReportDefinition report={definition} accounts={accounts} categories={categories} />
    </>}
    {deleting && definition ? <ModalDialog labelledBy="delete-detail-report" busy={deleteBusy} onCancel={() => setDeleting(false)}><div className="panel__body"><h2 id="delete-detail-report">Delete {definition.name}?</h2><p>This deletes the saved report and manual report choices. Your ledger transactions stay unchanged.</p><div className="report-actions"><button className="button button--ghost" disabled={deleteBusy} onClick={() => setDeleting(false)}>Cancel</button><button className="button button--primary" disabled={deleteBusy} onClick={() => void remove()}>{deleteBusy ? "Deleting…" : "Delete report"}</button></div></div></ModalDialog> : null}
  </div>;
}
