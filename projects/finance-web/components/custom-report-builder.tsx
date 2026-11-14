"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { getSavedReport, listAccounts, listCategories, previewSavedReport, saveReport, type Account, type Category, type MonthlyReport, type SavedReport } from "@/lib/api";
import { getAccessToken } from "@/lib/auth-storage";
import { monthPeriod, dateRangeError, type DatePeriod } from "@/lib/date-period";
import { canonicalReportRules, emptyReportRules, savedReportRules, type ReportRules } from "@/lib/report-rules";
import { customReportPath, reportDraftKey, reportFiltersFromQuery } from "@/lib/report-navigation";
import { DatePeriodControls } from "@/components/date-period-controls";
import { ReportRulesEditor } from "@/components/report-rules-editor";
import { ReportResults } from "@/components/report-results";
import { ModalDialog } from "@/components/modal-dialog";
import { ReportScopeChips } from "@/components/report-scope-chips";
import { reportAmountError, reportDatePresets, reportPresetPeriod, reportStarter, reportStarters } from "@/lib/report-presentation";
import { formatCurrency } from "../../finance-contracts/presentation";

type Draft = { name: string; period: DatePeriod; currency: string; rules: ReportRules; report_view: SavedReport["report_view"]; opening_balances: SavedReport["opening_balances"] };
function reportDraft(report: SavedReport): Draft {
  return { name: report.name, period: { mode: report.date_view, start: report.start_date, end: report.end_date }, currency: report.currency, rules: savedReportRules(report), report_view: report.report_view, opening_balances: report.opening_balances };
}
function draftKey(draft: Draft) { return JSON.stringify({ ...draft, rules: canonicalReportRules(draft.rules) }); }

export function CustomReportBuilder({ id }: { id?: string }) {
  const router = useRouter();
  const [draft, setDraft] = useState<Draft>(() => ({ name: "", period: monthPeriod(), currency: "BDT", rules: emptyReportRules(), report_view: "analysis", opening_balances: {} }));
  const [original, setOriginal] = useState<Draft | null>(null);
  const [source, setSource] = useState<SavedReport | null>(null);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [ready, setReady] = useState(false);
  const [revision, setRevision] = useState(0);
  const [loadError, setLoadError] = useState("");
  const [preview, setPreview] = useState<MonthlyReport | null>(null);
  const [previewLoading, setPreviewLoading] = useState(true);
  const [previewError, setPreviewError] = useState("");
  const [saveError, setSaveError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [leaveTarget, setLeaveTarget] = useState<string | null>(null);
  const inFlight = useRef(false);
  const finished = useRef(false);
  const storageKey = reportDraftKey(id);
  const dirty = ready && !!original && draftKey(draft) !== draftKey(original);
  const backPath = id ? customReportPath(id) : "/custom-reports";
  const rulesKey = JSON.stringify(canonicalReportRules(draft.rules));
  const validationError = dateRangeError(draft.period.start, draft.period.end) || (draft.report_view === "analysis" ? reportAmountError(draft.rules.min_amount, draft.rules.max_amount) : "");
  useEffect(() => {
    const token = getAccessToken(); if (!token) { setLoadError("Sign in to build a report."); return; }
    const controller = new AbortController(); setReady(false); setLoadError("");
    const params = new URLSearchParams(window.location.search);
    const copyFrom = id ? null : params.get("copy_from");
    void Promise.all([listAccounts(token, controller.signal), listCategories(token, controller.signal), id || copyFrom ? getSavedReport(token, (id ?? copyFrom)!, controller.signal) : Promise.resolve(null)]).then(([accountRows, categoryRows, saved]) => {
      if (controller.signal.aborted) return;
      setAccounts(accountRows); setCategories(categoryRows); setSource(saved);
      const filters = reportFiltersFromQuery(window.location.search);
      const starter = reportStarter(params.get("template"));
      const initial: Draft = saved ? { ...reportDraft(saved), name: copyFrom ? `${saved.name.slice(0, 150)} (copy)` : saved.name } : { name: starter?.name ?? "", period: filters.period, currency: filters.currency, report_view: starter?.report_view ?? "analysis", opening_balances: {}, rules: filters.rules ?? { ...(starter?.rules ?? emptyReportRules()), accounts: filters.account ? [filters.account] : [] } };
      setOriginal(initial);
      let restored = initial;
      if (!copyFrom && !params.has("template") && !params.has("start_date") && !params.has("month") && !params.has("rules")) {
        try {
          const stored = JSON.parse(sessionStorage.getItem(storageKey) ?? "null") as { version?: number; draft?: Draft } | null;
          if (stored?.version === 1 && stored.draft && typeof stored.draft.name === "string" && typeof stored.draft.currency === "string" && stored.draft.period) {
            restored = { ...initial, ...stored.draft, rules: canonicalReportRules(stored.draft.rules) };
            setMessage("Restored your unsaved draft. Save it to update the report.");
          }
        } catch {}
      }
      setDraft(restored); setReady(true);
    }).catch((reason: unknown) => { if (!controller.signal.aborted) setLoadError(reason instanceof Error ? reason.message : "Could not load the report builder."); });
    return () => controller.abort();
  }, [id, revision, storageKey]);
  useEffect(() => {
    if (!ready || finished.current) return;
    try { if (dirty) sessionStorage.setItem(storageKey, JSON.stringify({ version: 1, draft })); else sessionStorage.removeItem(storageKey); } catch {}
  }, [ready, dirty, draft, storageKey]);
  useEffect(() => {
    if (!ready) return;
    if (validationError) { setPreviewError(""); setPreviewLoading(false); return; }
    const token = getAccessToken(); if (!token) return;
    const controller = new AbortController(); setPreviewLoading(true); setPreviewError("");
    const timer = window.setTimeout(() => {
      const rules = JSON.parse(rulesKey) as ReportRules;
      void previewSavedReport(token, { name: "Report preview", start_date: draft.period.start, end_date: draft.period.end, date_view: draft.period.mode === "all" ? "custom" : draft.period.mode, account: null, currency: draft.currency, filters: draft.report_view === "account_statement" ? { ...emptyReportRules(), accounts: rules.accounts, excluded_accounts: rules.excluded_accounts } : rules }, draft.report_view === "analysis" ? id : undefined, controller.signal)
        .then(value => { if (!controller.signal.aborted) setPreview(value); })
        .catch((reason: unknown) => { if (!controller.signal.aborted) setPreviewError(reason instanceof Error ? reason.message : "Could not preview report."); })
        .finally(() => { if (!controller.signal.aborted) setPreviewLoading(false); });
    }, 300);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [ready, id, draft.period.start, draft.period.end, draft.period.mode, draft.currency, draft.report_view, rulesKey, validationError]);
  useEffect(() => {
    const unload = (event: BeforeUnloadEvent) => { if (dirty && !finished.current) { event.preventDefault(); event.returnValue = ""; } };
    const navigate = (event: MouseEvent) => {
      if (!dirty || finished.current || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const anchor = event.target instanceof Element ? event.target.closest("a") : null;
      if (!anchor || anchor.target === "_blank" || anchor.hasAttribute("download")) return;
      const url = new URL(anchor.href);
      if (url.origin !== window.location.origin || (url.pathname === window.location.pathname && url.search === window.location.search)) return;
      event.preventDefault(); event.stopPropagation(); setLeaveTarget(`${url.pathname}${url.search}${url.hash}`);
    };
    window.addEventListener("beforeunload", unload); document.addEventListener("click", navigate, true);
    return () => { window.removeEventListener("beforeunload", unload); document.removeEventListener("click", navigate, true); };
  }, [dirty]);
  function cancel() { if (dirty) setLeaveTarget(backPath); else router.push(backPath); }
  function discard() {
    try { sessionStorage.removeItem(storageKey); } catch {}
    finished.current = true; router.push(leaveTarget ?? backPath);
  }
  async function persist(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); const token = getAccessToken(); if (!token || inFlight.current || !ready || draft.period.mode === "all" || validationError) return;
    inFlight.current = true; setBusy(true); setSaveError("");
    try {
      const saved = await saveReport(token, { name: draft.name.trim(), start_date: draft.period.start, end_date: draft.period.end, date_view: draft.period.mode, account: null, currency: draft.currency, filters: canonicalReportRules(draft.rules), report_view: draft.report_view, opening_balances: draft.opening_balances }, id);
      finished.current = true; try { sessionStorage.removeItem(storageKey); } catch {}
      router.push(customReportPath(saved.id));
    } catch (reason) { setSaveError(reason instanceof Error ? reason.message : "Could not save report."); }
    finally { inFlight.current = false; setBusy(false); }
  }
  return <div className="workspace-grid report-workspace custom-report-builder">
    <nav aria-label="Report breadcrumb"><Link className="button button--ghost" href={backPath}>← {id ? "Back to report" : "All custom reports"}</Link></nav>
    <header className="report-page-heading"><div><span className="report-eyebrow">Report builder</span><h1>{id ? "Edit report" : "Create custom report"}</h1><p>{id ? `Update the saved rules for ${source?.name ?? "this report"}.` : "Define the question. Choose the selection. Make it yours."}</p></div></header>
    {loadError ? <section className="panel"><div className="panel__body"><p role="alert" className="form-error">{loadError}</p><button className="button button--ghost" onClick={() => setRevision(value => value + 1)}>Retry builder</button></div></section> : !ready ? <p role="status">Loading report builder…</p> : <>
      {message ? <p role="status" className="muted-text">{message}</p> : null}
      <a className="report-mobile-preview-link" href="#builder-preview">Live preview · {previewLoading ? "Updating…" : preview ? `${preview.transaction_count} transactions · ${formatCurrency(preview.expense_total, preview.currency)} net spending` : "Choose your filters"}<span>View preview ↓</span></a>
      <div className="report-builder-layout">
        <section className="panel" id="builder-settings"><div className="panel__body"><form onSubmit={persist}>
          <fieldset className="report-filter-fields" disabled={busy}>
            {!id && !source ? <details className="report-builder-starters"><summary>Start from a template (optional)</summary><div className="report-preset-buttons">{reportStarters.map(starter => <button type="button" className="button button--ghost" key={starter.id} onClick={() => { const value = reportStarter(starter.id)!; setDraft(current => ({ ...current, name: current.name || value.name, rules: value.rules, report_view: value.report_view })); }}>{starter.name}</button>)}</div></details> : null}
            <div className="report-form-section-heading"><span>1</span><div><h2>Name and period</h2><p>Give this report a purpose and a fixed date range.</p></div></div>
            <label className="field"><span className="field__label">Report name</span><input className="field__control" required maxLength={160} value={draft.name} onChange={event => setDraft(current => ({ ...current, name: event.target.value }))} placeholder="e.g. Household spending across bank and cash" /></label>
            <label className="field"><span className="field__label">Default report view</span><select className="field__control" aria-label="Default report view" value={draft.report_view} onChange={event => setDraft(current => ({ ...current, report_view: event.target.value as Draft["report_view"] }))}><option value="analysis">Analysis: income, spending and breakdowns</option><option value="account_statement">Account statements: opening, transactions and closing</option></select></label>
            <div className="report-preset-buttons" role="group" aria-label="Date shortcuts">{reportDatePresets.map(preset => <button type="button" className="button button--ghost" key={preset.id} onClick={() => setDraft(current => ({ ...current, period: reportPresetPeriod(preset.id) }))}>{preset.label}</button>)}</div>
            <DatePeriodControls label="Report dates" allowAll={false} value={draft.period} onChange={period => setDraft(current => ({ ...current, period }))} />
            <label className="field"><span className="field__label">Currency</span><select className="field__control" aria-label="Currency" value={draft.currency} onChange={event => { const currency = event.target.value; setDraft(current => ({ ...current, currency, opening_balances: Object.fromEntries(Object.entries(current.opening_balances).filter(([id]) => accounts.find(row => row.id === id)?.currency === currency)), rules: { ...current.rules, accounts: current.rules.accounts.filter(value => accounts.find(row => row.id === value)?.currency === currency), excluded_accounts: current.rules.excluded_accounts.filter(value => accounts.find(row => row.id === value)?.currency === currency) } })); }}>{Array.from(new Set(["BDT", draft.currency, ...accounts.map(row => row.currency)])).map(value => <option key={value}>{value}</option>)}</select></label>
            <p className="report-chart-note">One currency per report. Currency changes clear incompatible account selections and opening settings. Saved dates stay fixed; matching activity stays live.</p>
            <div className="report-form-section-heading"><span>2</span><div><h2>{draft.report_view === "account_statement" ? "Choose accounts" : "Choose transactions"}</h2><p>{draft.report_view === "account_statement" ? "Statements show all movements. Set each account’s starting balance after saving." : "Include the accounts and categories you need, then apply exclusions."}</p></div></div>
            <ReportRulesEditor accountsOnly={draft.report_view === "account_statement"} value={draft.rules} onChange={rules => setDraft(current => ({ ...current, rules }))} currency={draft.currency} accounts={accounts} categories={categories} />
          </fieldset>
          {validationError ? <p role="alert" className="form-error">{validationError}</p> : null}
          {saveError ? <p role="alert" className="form-error">{saveError}</p> : null}
          <div className="report-builder-footer"><span className="muted-text">{dirty ? "Unsaved changes" : id ? "No changes yet" : "Save to create a report"}</span><div className="report-actions"><button className="button button--ghost" type="button" disabled={busy} onClick={cancel}>Cancel</button><button className="button button--primary" disabled={busy || !!validationError || !draft.name.trim() || (!!id && !dirty)}>{busy ? "Saving…" : id ? "Save changes" : "Save report"}</button></div></div>
        </form></div></section>
        <aside className="report-builder-preview" aria-label="Report preview" id="builder-preview">
          <a className="report-mobile-preview-link" href="#builder-settings">Back to report settings ↑</a>
          {previewError ? <p role="alert" className="form-error">{previewError}</p> : null}
          {previewLoading ? <p role="status">Updating preview…</p> : null}
          {preview ? <ReportResults report={preview} compact enhanced loading={previewLoading || !!validationError} /> : null}
          <section className="report-preview-selection"><h3>Current selection</h3><ReportScopeChips accountsOnly={draft.report_view === "account_statement"} rules={draft.report_view === "account_statement" ? { ...emptyReportRules(), accounts: draft.rules.accounts, excluded_accounts: draft.rules.excluded_accounts } : draft.rules} accounts={accounts} categories={categories} onChange={rules => setDraft(current => ({ ...current, rules: draft.report_view === "account_statement" ? { ...current.rules, accounts: rules.accounts, excluded_accounts: rules.excluded_accounts } : rules }))} /></section>
          <p className="muted-text">{draft.report_view === "account_statement" ? "Preview shows full account activity. Save to view opening/closing balances, choose a starting balance and inspect running balances." : `${id ? "Preview includes the report’s manual additions and removals." : "Only the filter definition is saved. Matching activity stays live."} Saving opens the full report with breakdowns, transactions and export.`}</p>
        </aside>
      </div>
    </>}
    {leaveTarget ? <ModalDialog labelledBy="discard-report-changes" busy={busy} onCancel={() => setLeaveTarget(null)}><div className="panel__body"><h2 id="discard-report-changes">Discard unsaved report changes?</h2><p>Your saved report has not changed. Leaving will discard this draft.</p><div className="report-actions"><button className="button button--ghost" disabled={busy} onClick={() => setLeaveTarget(null)}>Keep editing</button><button className="button button--primary" disabled={busy} onClick={discard}>Discard changes and leave</button></div></div></ModalDialog> : null}
  </div>;
}
