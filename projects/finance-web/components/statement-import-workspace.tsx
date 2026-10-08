"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { approveNewStatementRows, createStatementImport, getStatementImport, getStatementRow, listAccounts, listCategories, listStatementImports, listStatementRows, type Account, type Category, type SavedStatement, type SavedStatementRow, type StatementHistory, type StatementRowPage } from "@/lib/api";
import { getAccessToken } from "@/lib/auth-storage";
import { transactionTypes } from "@/lib/category-type";
import { LoadingState } from "@/components/loading-state";
import { ModalDialog } from "@/components/modal-dialog";
import { StatementRowDialog } from "@/components/statement-row-dialog";
import { useToast } from "@/components/toast-provider";

const labels: Record<string, string> = { ebl_bank: "EBL bank", city_bank: "City Bank", bkash: "bKash", new: "New", possible_match: "Possible match", needs_correction: "Needs review", posted: "Added", linked: "Linked", skipped: "Skipped", pending: "Pending" };
const emptyFilters = { state: "", direction: "", type: "", category: "", search: "", date_from: "", date_to: "" };

export function StatementImportWorkspace({ initialImportId }: { initialImportId?: string }) {
  const router = useRouter();
  const { notify } = useToast();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [setupLoading, setSetupLoading] = useState(true);
  const [setupError, setSetupError] = useState<string | null>(null);
  const [account, setAccount] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [password, setPassword] = useState("");
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const uploadRequest = useRef<AbortController | null>(null);
  const rowRequest = useRef<AbortController | null>(null);
  const [history, setHistory] = useState<StatementHistory | null>(null);
  const [historyOffset, setHistoryOffset] = useState(0);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [batchId, setBatchId] = useState(initialImportId ?? "");
  const [batch, setBatch] = useState<SavedStatement | null>(null);
  const [batchError, setBatchError] = useState<string | null>(null);
  const [rows, setRows] = useState<StatementRowPage | null>(null);
  const [rowsLoading, setRowsLoading] = useState(false);
  const [rowsError, setRowsError] = useState<string | null>(null);
  const [filters, setFilters] = useState(emptyFilters);
  const [appliedFilters, setAppliedFilters] = useState(emptyFilters);
  const filtersPending = JSON.stringify(filters) !== JSON.stringify(appliedFilters);
  const [offset, setOffset] = useState(0);
  const [epoch, setEpoch] = useState(0);
  const [retry, setRetry] = useState(0);
  const [selectedRow, setSelectedRow] = useState<SavedStatementRow | null>(null);
  const [rowLoading, setRowLoading] = useState(false);
  const [confirmBulk, setConfirmBulk] = useState(false);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkError, setBulkError] = useState<string | null>(null);

  useEffect(() => { setBatchId(initialImportId ?? ""); }, [initialImportId]);
  useEffect(() => () => { uploadRequest.current?.abort(); rowRequest.current?.abort(); }, []);
  useEffect(() => {
    const timer = window.setTimeout(() => { setAppliedFilters(filters); setOffset(0); }, 250);
    return () => window.clearTimeout(timer);
  }, [filters]);
  useEffect(() => {
    const controller = new AbortController(); const token = getAccessToken();
    setSetupLoading(true); setSetupError(null);
    if (!token) { setSetupLoading(false); setSetupError("Sign in to import statements."); return; }
    void Promise.all([listAccounts(token, controller.signal), listCategories(token, controller.signal)]).then(([accountList, categoryList]) => {
      if (!controller.signal.aborted) { setAccounts(accountList); setCategories(categoryList); }
    }).catch((reason: unknown) => { if (!controller.signal.aborted) setSetupError(reason instanceof Error ? reason.message : "Could not load accounts and categories."); }).finally(() => { if (!controller.signal.aborted) setSetupLoading(false); });
    return () => controller.abort();
  }, [retry]);
  useEffect(() => {
    const controller = new AbortController(); const token = getAccessToken(); if (!token) return;
    setHistoryError(null);
    void listStatementImports(token, historyOffset, controller.signal).then((result) => { if (!controller.signal.aborted) setHistory(result); }).catch((reason: unknown) => { if (!controller.signal.aborted) setHistoryError(reason instanceof Error ? reason.message : "Could not load import history."); });
    return () => controller.abort();
  }, [historyOffset, epoch, retry]);
  useEffect(() => {
    const controller = new AbortController(); const token = getAccessToken(); setBatchError(null);
    if (!token || !batchId) { setBatch(null); return; }
    void getStatementImport(token, batchId, controller.signal).then((result) => { if (!controller.signal.aborted) setBatch(result); }).catch((reason: unknown) => { if (!controller.signal.aborted) { setBatch(null); setBatchError(reason instanceof Error ? reason.message : "Could not load this statement."); } });
    return () => controller.abort();
  }, [batchId, epoch, retry]);
  useEffect(() => {
    const controller = new AbortController(); const token = getAccessToken(); setRowsError(null);
    if (!token || !batchId) { setRows(null); return; }
    setRowsLoading(true);
    void listStatementRows(token, batchId, appliedFilters, offset, controller.signal).then((result) => {
      if (!controller.signal.aborted) { setRows(result); if (result.count && offset >= result.count) setOffset(Math.floor((result.count - 1) / 50) * 50); }
    }).catch((reason: unknown) => { if (!controller.signal.aborted) setRowsError(reason instanceof Error ? reason.message : "Could not load statement rows."); }).finally(() => { if (!controller.signal.aborted) setRowsLoading(false); });
    return () => controller.abort();
  }, [batchId, appliedFilters, offset, epoch, retry]);

  function openBatch(id: string) {
    rowRequest.current?.abort(); setSelectedRow(null); setRowLoading(false); setBatch(null); setRows(null);
    setFilters(emptyFilters); setAppliedFilters(emptyFilters); setOffset(0); setBatchId(id);
    router.replace(`/statements?import=${id}`, { scroll: false });
  }
  function fail(reason: unknown, fallback: string) { const message = reason instanceof Error ? reason.message : fallback; notify(message, "error"); return message; }
  async function upload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const token = getAccessToken(); if (!token || !account || !file || uploading) return;
    if (file.size > 4 * 1024 * 1024 || !file.name.toLowerCase().endsWith(".pdf")) { setUploadError(fail(new Error("Choose a statement PDF no larger than 4 MiB."), "Invalid file.")); return; }
    const controller = new AbortController(); uploadRequest.current = controller;
    const unlock = password; setPassword(""); setUploading(true); setUploadError(null);
    try {
      const result = await createStatementImport(token, account, file, unlock, controller.signal);
      if (!controller.signal.aborted) { openBatch(result.id); setEpoch((n) => n + 1); setHistoryOffset(0); notify(`Statement draft ready: ${result.counts.total} review rows. Nothing added to the ledger yet.`); }
    } catch (reason) { if (!controller.signal.aborted) setUploadError(fail(reason, "Could not read the statement.")); }
    finally { if (uploadRequest.current === controller) { uploadRequest.current = null; setUploading(false); } }
  }
  async function reviewRow(id: string) {
    const token = getAccessToken(); if (!token) return;
    rowRequest.current?.abort(); const controller = new AbortController(); rowRequest.current = controller; setRowLoading(true); setSelectedRow(null);
    try { const result = await getStatementRow(token, id, controller.signal); if (!controller.signal.aborted) setSelectedRow(result); }
    catch (reason) { if (!controller.signal.aborted) fail(reason, "Could not load this row."); }
    finally { if (rowRequest.current === controller) { rowRequest.current = null; setRowLoading(false); } }
  }
  const eligible = rows?.results.filter((row) => row.review.review_state === "new" && !row.review.issues.length && !row.review.requires_acknowledgement) ?? [];
  async function approveBulk() {
    const token = getAccessToken(); if (!token || !batch || bulkBusy) return;
    setBulkBusy(true); setBulkError(null);
    try {
      const result = await approveNewStatementRows(token, batch.id, eligible.map((row) => ({ id: row.id, version: row.version })));
      setEpoch((n) => n + 1); setConfirmBulk(false);
      notify(`${result.added} added, ${result.unchanged} already resolved, ${result.unresolved.length} left for individual review.`);
    } catch (reason) { setBulkError(fail(reason, "Could not approve these rows.")); } finally { setBulkBusy(false); }
  }
  function filter(key: keyof typeof emptyFilters, value: string) { setFilters((old) => ({ ...old, [key]: value })); }
  const uploadAccounts = accounts.filter((a) => a.is_active && a.currency === "BDT" && ["bank", "savings", "mobile_wallet"].includes(a.type));
  return <div className="workspace-grid statement-preview">
    <section className="panel"><div className="panel__body">
      <h2 className="section-title">Import a statement PDF</h2><p className="section-subtitle">Upload an EBL bank, City Bank savings, or bKash digital statement, then review matches and approve new movements.</p>
      <p className="inline-note">Uploads save a draft, without adding transactions. Original PDFs and passwords are discarded; masked rows are saved as evidence.</p>
      {setupError ? <p role="alert" className="form-error">{setupError}</p> : null}
      <form className="form-grid" onSubmit={upload}>
        <label className="field"><span className="field__label">Statement account</span><select className="field__control" required disabled={setupLoading || uploading} value={account} onChange={(e) => setAccount(e.target.value)}><option value="">{setupLoading ? "Loading accounts…" : "Choose the reporting account"}</option>{uploadAccounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></label>
        <label className="field"><span className="field__label">Statement PDF</span><input className="field__control" type="file" accept=".pdf,application/pdf" required disabled={uploading} onChange={(e) => { setFile(e.target.files?.[0] ?? null); setPassword(""); setUploadError(null); }} /><span className="field__hint">Up to 4 MiB and 30 pages. Digital bank/wallet statements; scans and card billing statements are unsupported.</span></label>
        <label className="field"><span className="field__label">PDF password (if locked)</span><input className="field__control" type="password" autoComplete="off" maxLength={256} disabled={uploading} value={password} onChange={(e) => setPassword(e.target.value)} /><span className="field__hint">Used transiently and cleared on submission.</span></label>
        <div className="statement-actions"><button className="button button--primary" type="submit" disabled={setupLoading || uploading || !account || !file}>{uploading ? "Reading statement…" : "Upload & review"}</button>{uploading ? <button className="button" type="button" onClick={() => { uploadRequest.current?.abort(); uploadRequest.current = null; setUploading(false); notify("Preview request cancelled. If a draft finishes saving, it will appear in import history."); }}>Cancel upload</button> : null}</div>
      </form>
      {!setupLoading && !setupError && !uploadAccounts.length ? <p>Add an active BDT bank or wallet account in Accounts first.</p> : null}
      {uploading ? <p role="status">Extracting rows and checking balances. You can keep navigating.</p> : null}
      {uploadError ? <p role="alert" className="form-error">{uploadError}</p> : null}
    </div></section>
    <section className="panel"><div className="panel__body"><h2 className="section-title">Import history</h2><p className="section-subtitle">Resume saved reviews. Uploading the same file for the same account reopens its draft and preserves your decisions.</p>
      {historyError ? <p role="alert" className="form-error">{historyError}</p> : null}
      {!history && !historyError ? <p role="status">Loading import history…</p> : null}
      {history && !history.results.length ? <p>No statement imports yet.</p> : null}
      <div className="statement-history">{history?.results.map((entry) => <button className={`statement-history-item${entry.id === batchId ? " statement-history-item--active" : ""}`} aria-current={entry.id === batchId ? "true" : undefined} type="button" key={entry.id} onClick={() => openBatch(entry.id)}><strong>{entry.account_name} · {labels[entry.profile] ?? entry.profile}</strong><span>{entry.period_start ?? "Unknown"} → {entry.period_end ?? "Unknown"}</span><small>{entry.counts.pending} pending · {entry.counts.posted} added · {entry.counts.linked} linked · {entry.counts.skipped} skipped</small><small>Updated {new Date(entry.updated_at).toLocaleString()}</small></button>)}</div>
      <div className="statement-actions"><button className="button" type="button" disabled={!historyOffset} onClick={() => setHistoryOffset(Math.max(0, historyOffset - 20))}>Newer imports</button><button className="button" type="button" disabled={!history?.next} onClick={() => setHistoryOffset(historyOffset + 20)}>Older imports</button><button className="button button--ghost" type="button" onClick={() => setRetry((n) => n + 1)}>Refresh statements</button></div>
    </div></section>
    {batchError ? <p role="alert" className="form-error">{batchError}</p> : null}
    {batchId && !batch && !batchError ? <LoadingState compact label="Loading statement" detail="Retrieving your saved review" /> : null}
    {batch ? <>
      <section className="panel"><div className="panel__body"><h2 className="section-title">{batch.account_name} · {labels[batch.profile] ?? batch.profile}</h2><p>{batch.period_start ?? "Unknown"} → {batch.period_end ?? "Unknown"} · {batch.page_count} pages · Account ending {batch.account_hint || "unknown"}</p>
        <p>Verify this statement belongs to the selected account. A suffix match is a hint; it does not prove ownership.</p>
        <div className="metric-row">{[["Review rows", batch.counts.total], ["Pending", batch.counts.pending], ["Added", batch.counts.posted], ["Linked", batch.counts.linked], ["Skipped", batch.counts.skipped]].map(([name, value]) => <div className="metric" key={name}><span className="metric__label">{name}</span><strong className="metric__value">{value}</strong></div>)}</div>
        <details className="raw-message"><summary>Original extraction checks</summary><ul className="statement-checks">{batch.checks.map((check) => <li key={check.label}><strong>{check.passed === null ? "Unavailable" : check.passed ? "Passed" : "Needs review"}</strong> — {check.label}{check.expected !== null ? ` · Reported ${check.expected}, extracted ${check.observed ?? "unknown"}` : " · Not printed or readable"}</li>)}</ul><ul className="statement-warnings">{batch.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul><p>These checks describe the original extraction. Draft corrections are saved separately; source discrepancies require explicit review.</p></details>
        <p className="inline-note">Opening balances are not imported as income. Fees are separate review movements. Unknown times remain empty.</p>
      </div></section>
      <section className="panel"><div className="panel__body"><h2 className="section-title">Statement review</h2>
        <div className="form-grid statement-filter-grid">
          <label className="field"><span className="field__label">Search rows</span><input className="field__control" type="search" value={filters.search} onChange={(e) => filter("search", e.target.value)} placeholder="Description, reference, counterparty" /></label>
          <label className="field"><span className="field__label">Review state</span><select className="field__control" value={filters.state} onChange={(e) => filter("state", e.target.value)}><option value="">All rows</option>{["pending", "new", "possible_match", "needs_correction", "posted", "linked", "skipped"].map((state) => <option key={state} value={state}>{labels[state]}</option>)}</select></label>
          <label className="field"><span className="field__label">Debit / credit</span><select className="field__control" value={filters.direction} onChange={(e) => filter("direction", e.target.value)}><option value="">All directions</option><option value="debit">Debit</option><option value="credit">Credit</option></select></label>
          <label className="field"><span className="field__label">Type</span><select className="field__control" value={filters.type} onChange={(e) => filter("type", e.target.value)}><option value="">All types</option>{transactionTypes.map((type) => <option key={type} value={type}>{type.replaceAll("_", " ")}</option>)}</select></label>
          <label className="field"><span className="field__label">Category</span><select className="field__control" value={filters.category} onChange={(e) => filter("category", e.target.value)}><option value="">All categories</option><option value="none">Uncategorized</option>{categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
          <div className="statement-date-range"><label className="field"><span className="field__label">From date</span><input className="field__control" type="date" value={filters.date_from} onChange={(e) => filter("date_from", e.target.value)} /></label><label className="field"><span className="field__label">To date</span><input className="field__control" type="date" value={filters.date_to} onChange={(e) => filter("date_to", e.target.value)} /></label></div>
        </div>
        <div className="statement-actions"><button className="button button--ghost" type="button" onClick={() => setFilters(emptyFilters)}>Clear filters</button><button className="button button--primary" type="button" disabled={filtersPending || rowsLoading || rowsError !== null || !eligible.length || setupLoading || bulkBusy} onClick={() => { setBulkError(null); setConfirmBulk(true); }}>Approve {eligible.length} new rows on this page</button></div>
        <p>{rows?.count ?? 0} matching rows · Page {Math.floor(offset / 50) + 1} of {Math.max(1, Math.ceil((rows?.count ?? 0) / 50))}. Suggestions are checked again before every decision.</p>
        {rowsError ? <p role="alert" className="form-error">{rowsError}</p> : null}
        {rowsLoading ? <p role="status">Loading matching rows…</p> : null}
        <div className="statement-table-wrap" tabIndex={0} role="region" aria-label="Statement review rows" aria-busy={rowsLoading}>
          <table className="statement-table"><thead><tr>{["Page / row", "Date / time", "Description", "Type / category", "Amount", "Balance after", "Review", "Actions"].map((name) => <th key={name} scope="col">{name}</th>)}</tr></thead><tbody>{rows?.results.map((row) => <tr key={row.id}>
            <td>{row.extracted.page} / {row.extracted.row}<br /><small>{row.component}</small></td><td>{row.date ?? "Unknown date"}{row.time ? <><br />{row.time}</> : null}{row.value_date ? <><br /><small>Value: {row.value_date}</small></> : null}</td>
            <td><strong>{row.counterparty_text || row.extracted.provider_type || "Statement movement"}</strong><div>{row.note}</div>{row.reference ? <small>Reference: {row.reference}</small> : null}</td>
            <td>{row.type.replaceAll("_", " ")}<br /><small>{row.direction} · {categories.find((c) => c.id === row.category)?.name ?? "Uncategorized"}</small></td><td>{batch.currency} {row.amount ?? "Missing"}</td><td>{row.balance_after ?? "Not reported"}</td>
            <td><strong>{labels[row.review.review_state] ?? row.review.review_state}</strong>{row.review.matches.length ? <div>{row.review.matches.length} suggestion{row.review.matches.length === 1 ? "" : "s"}</div> : null}{row.review.issues.length ? <small>{row.review.issues[0]}</small> : null}{row.review.requires_acknowledgement ? <small>Source discrepancy · review required</small> : null}</td>
            <td><button className="button button--small" type="button" disabled={filtersPending || rowsLoading || rowLoading || bulkBusy || setupLoading || setupError !== null} onClick={() => void reviewRow(row.id)}>Review row</button></td>
          </tr>)}</tbody></table>
        </div>
        {rows && !rows.results.length && !rowsLoading ? <p>No rows match these filters.</p> : null}
        <div className="statement-actions"><button className="button" type="button" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - 50))}>Previous page</button><button className="button" type="button" disabled={!rows || offset + 50 >= rows.count} onClick={() => setOffset(offset + 50)}>Next page</button></div>
      </div></section>
    </> : null}
    {rowLoading ? <p role="status">Loading row and fresh suggestions…</p> : null}
    {selectedRow && batch ? <StatementRowDialog key={selectedRow.id} row={selectedRow} batch={batch} accounts={accounts} categories={categories} onCancel={() => setSelectedRow(null)} onReload={() => void reviewRow(selectedRow.id)} onChange={(updated, close) => { setSelectedRow(close ? null : updated); setEpoch((n) => n + 1); }} /> : null}
    {confirmBulk && batch ? <ModalDialog labelledBy="statement-bulk-title" busy={bulkBusy} onCancel={() => setConfirmBulk(false)}><h2 id="statement-bulk-title">Approve {eligible.length} new rows?</h2><p>This adds only the validated new rows currently on this page to {batch.account_name}. Matches, source discrepancies and stale rows stay unresolved for individual review. Fees count as separate movements.</p>{bulkError ? <p role="alert" className="form-error">{bulkError}</p> : null}<div className="decision-modal__actions"><button className="button" type="button" disabled={bulkBusy} onClick={() => setConfirmBulk(false)}>Cancel</button><button className="button button--primary" type="button" disabled={bulkBusy || !eligible.length} onClick={() => void approveBulk()}>{bulkBusy ? "Approving…" : "Confirm & add new rows"}</button></div></ModalDialog> : null}
  </div>;
}
