"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { ArrowClockwise, Plus } from "@phosphor-icons/react";
import { listSavedReports, deleteSavedReport, type SavedReport } from "@/lib/api";
import { getAccessToken } from "@/lib/auth-storage";
import { customReportListKey, customReportPath, customReportEditPath } from "@/lib/report-navigation";
import { filterReportLibrary, reportListQuery, reportListState, reportScopeSummary, type ReportListSort } from "@/lib/custom-report-library";
import { formatCalendarDate, formatTimestamp } from "../../finance-contracts/presentation";
import { ModalDialog } from "@/components/modal-dialog";

export function CustomReportLibrary() {
  const [reports, setReports] = useState<SavedReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<ReportListSort>("updated");
  const [ready, setReady] = useState(false);
  const [deleting, setDeleting] = useState<SavedReport | null>(null);
  const [busy, setBusy] = useState(false);
  const mutation = useRef(false);
  const [message, setMessage] = useState("");
  useEffect(() => {
    const restore = () => {
      let query = window.location.search;
      if (!query) { try { query = sessionStorage.getItem(customReportListKey) ?? ""; } catch {} }
      const state = reportListState(query); setSearch(state.search); setSort(state.sort); setReady(true);
    };
    restore(); window.addEventListener("popstate", restore); return () => window.removeEventListener("popstate", restore);
  }, []);
  useEffect(() => {
    if (!ready) return;
    const query = reportListQuery(search, sort);
    window.history.replaceState(window.history.state, "", `/custom-reports${query ? `?${query}` : ""}`);
    try { sessionStorage.setItem(customReportListKey, query); } catch {}
  }, [ready, search, sort]);
  useEffect(() => {
    const token = getAccessToken(); if (!token) { setError("Sign in to view your reports."); setLoading(false); return; }
    const controller = new AbortController(); setLoading(true); setError("");
    void listSavedReports(token, controller.signal).then(result => { if (!controller.signal.aborted) setReports(result); })
      .catch((reason: unknown) => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Could not load reports."); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [revision]);
  async function remove() {
    const token = getAccessToken(); if (!token || !deleting || mutation.current) return;
    mutation.current = true; setBusy(true); setError("");
    try { await deleteSavedReport(token, deleting.id); setReports(current => current.filter(row => row.id !== deleting.id)); setMessage(`Deleted ${deleting.name}. Your transactions are unchanged.`); setDeleting(null); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Could not delete report."); setDeleting(null); }
    finally { mutation.current = false; setBusy(false); }
  }
  const visible = filterReportLibrary(reports, search, sort);
  return <div className="workspace-grid report-workspace">
    <header className="report-page-heading"><div><h1>Custom reports</h1><p>Find a saved report, open its results, or create a new one.</p></div><div className="report-actions"><button className="icon-button" aria-label="Refresh report list" disabled={loading} onClick={() => setRevision(value => value + 1)}><ArrowClockwise size={20} /></button><Link className="button button--primary" href="/custom-reports/new"><Plus size={18} /> New report</Link></div></header>
    <section className="panel"><div className="panel__body">
      <div className="report-library-toolbar"><label className="field"><span className="field__label">Search reports</span><input type="search" className="field__control" value={search} maxLength={256} placeholder="Search by report name or currency" onChange={event => setSearch(event.target.value)} /></label><label className="field"><span className="field__label">Sort reports</span><select aria-label="Sort reports" className="field__control" value={sort} onChange={event => setSort(event.target.value as ReportListSort)}><option value="updated">Recently updated</option><option value="name">Report name</option><option value="period">Newest reporting period</option></select></label></div>
      {error ? <div role="alert" className="form-error"><p>{error}</p><button className="button button--ghost" onClick={() => setRevision(value => value + 1)}>Retry loading reports</button></div> : null}
      {message ? <p role="status">{message}</p> : null}
      {loading ? <p role="status">Loading your saved reports…</p> : null}
      {!loading && !error ? <>
        <p className="muted-text">{visible.length} {visible.length === 1 ? "report" : "reports"}{search ? ` matching “${search}”` : " saved"}</p>
        <div className="report-library-list">{visible.map(row => <article className="report-library-row" key={row.id} aria-labelledby={`report-${row.id}`}>
          <div className="report-library-title"><h2 id={`report-${row.id}`}><Link href={customReportPath(row.id)}>{row.name}</Link></h2><span className="report-currency-label">{row.currency}</span></div>
          <div><small className="field__label">Period</small><p>{formatCalendarDate(row.start_date)}–{formatCalendarDate(row.end_date)}</p></div>
          <div><small className="field__label">Scope</small><p>{reportScopeSummary(row)}</p></div>
          <div><small className="field__label">Updated</small><p>{formatTimestamp(row.updated_at)}</p></div>
          <div className="report-library-row-actions"><Link className="button button--primary" href={customReportPath(row.id)}>View report</Link><Link className="button button--ghost" href={customReportEditPath(row.id)}>Edit</Link><Link className="button button--ghost" href={`/custom-reports/new?copy_from=${row.id}`}>Duplicate</Link><button className="button button--ghost" onClick={() => setDeleting(row)}>Delete</button></div>
        </article>)}</div>
        {!visible.length ? <div className="report-library-empty"><h2>{search ? "No matching reports" : "Create your first custom report"}</h2><p>{search ? "Try another name or clear the search." : "Choose accounts, categories and exclusions, then save a report you can run again."}</p>{search ? <button className="button button--ghost" onClick={() => setSearch("")}>Clear search</button> : <Link className="button button--primary" href="/custom-reports/new">Create report</Link>}</div> : null}
      </> : null}
    </div></section>
    {deleting ? <ModalDialog labelledBy="delete-library-report" busy={busy} onCancel={() => setDeleting(null)}><div className="panel__body"><h2 id="delete-library-report">Delete {deleting.name}?</h2><p>The saved definition and its manual transaction choices will be deleted. Your ledger transactions stay unchanged.</p><div className="report-actions"><button className="button button--ghost" disabled={busy} onClick={() => setDeleting(null)}>Cancel</button><button className="button button--primary" disabled={busy} onClick={() => void remove()}>{busy ? "Deleting…" : "Delete report"}</button></div></div></ModalDialog> : null}
  </div>;
}
