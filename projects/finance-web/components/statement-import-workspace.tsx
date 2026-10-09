"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { createStatementImport, getStatementImport, getStatementSummary, reviewSelectedStatementRows, getStatementRow, listAccounts, listCategories, listStatementImports, listStatementRows, type Account, type Category, type SavedStatement, type SavedStatementRow, type StatementHistory, type StatementSummary, type StatementRowPage } from "@/lib/api";
import { getAccessToken } from "@/lib/auth-storage";
import { transactionTypes } from "@/lib/category-type";
import { LoadingState } from "@/components/loading-state";
import { ModalDialog } from "@/components/modal-dialog";
import { StatementLedgerComparison } from "@/components/statement-comparison";
import { StatementImportSummary } from "@/components/statement-summary";
import { StatementRowDialog } from "@/components/statement-row-dialog";
import { useToast } from "@/components/toast-provider";

const labels: Record<string, string> = { ebl_bank: "EBL bank", city_bank: "City Bank", bkash: "bKash", new: "Statement only", possible_match: "Possible match", needs_correction: "Needs review", posted: "Added", linked: "Linked", skipped: "Skipped", pending: "Pending" };
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
  const [summary, setSummary] = useState<StatementSummary | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [confirmBulk, setConfirmBulk] = useState<{ action: "create" | "skip"; rows: { id: string; version: number }[] } | null>(null);
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
    if (!token || !batchId) { setBatch(null); setSummary(null); return; }
    void Promise.all([getStatementImport(token, batchId, controller.signal), getStatementSummary(token, batchId, controller.signal)]).then(([result, analysis]) => { if (!controller.signal.aborted) { setBatch(result); setSummary(analysis); } }).catch((reason: unknown) => { if (!controller.signal.aborted) { setBatch(null); setBatchError(reason instanceof Error ? reason.message : "Could not load this statement."); } });
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

  useEffect(() => { setSelectedIds([]); }, [batchId, offset, appliedFilters]);

  function openBatch(id: string) {
    rowRequest.current?.abort(); setSelectedRow(null); setRowLoading(false); setBatch(null); setSummary(null); setRows(null);
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
    const token = getAccessToken(); if (!token || !batch || !confirmBulk || bulkBusy) return;
    setBulkBusy(true); setBulkError(null);
    try {
      const result = await reviewSelectedStatementRows(token, batch.id, confirmBulk.rows, confirmBulk.action);
      setEpoch((n) => n + 1); setConfirmBulk(null);
      setSelectedIds([]);
      notify(`${result.added} added, ${result.skipped} skipped, ${result.unchanged} already resolved, ${result.unresolved.length} left for individual review.`);
    } catch (reason) { setBulkError(fail(reason, "Could not approve these rows.")); } finally { setBulkBusy(false); }
  }
  function confirmRows(action: "create" | "skip", items: SavedStatementRow[]) {
    setBulkError(null); setConfirmBulk({ action, rows: items.map(({ id, version }) => ({ id, version })) });
  }
  async function nextRow() {
    if (!selectedRow || !rows) return;
    const index = rows.results.findIndex(row => row.id === selectedRow.id);
    const next = rows.results.slice(index + 1).find(row => row.state === "pending" && !row.transaction);
    if (next) { await reviewRow(next.id); return; }
    const token = getAccessToken();
    if (token) {
      try {
        for (let pageOffset = offset + 50; pageOffset < rows.count; pageOffset += 50) {
          const page = await listStatementRows(token, batchId, appliedFilters, pageOffset);
          const candidate = page.results.find(row => row.state === "pending" && !row.transaction);
          if (candidate) { setOffset(pageOffset); await reviewRow(candidate.id); return; }
        }
      } catch (reason) { fail(reason, "Could not load the next row."); return; }
    }
    setSelectedRow(null); notify("No more unresolved rows after this row in the current filters.");
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
        <StatementLedgerComparison key={batch.id} id={batch.id} epoch={epoch} currency={batch.currency} />
        {summary ? <StatementImportSummary summary={summary} currency={batch.currency} /> : null}
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
        <div className="statement-actions"><button className="button button--ghost" type="button" onClick={() => setFilters(emptyFilters)}>Clear filters</button><button className="button button--primary" type="button" disabled={filtersPending || rowsLoading || rowsError !== null || !eligible.length || setupLoading || bulkBusy} onClick={() => confirmRows("create", eligible)}>Approve {eligible.length} new rows on this page</button><button className="button" type="button" disabled={rowsLoading || filtersPending || bulkBusy || !selectedIds.length} onClick={() => confirmRows("create", rows?.results.filter(row => selectedIds.includes(row.id)) ?? [])}>Approve selected new rows ({selectedIds.length})</button><button className="button" type="button" disabled={rowsLoading || filtersPending || bulkBusy || !selectedIds.length} onClick={() => confirmRows("skip", rows?.results.filter(row => selectedIds.includes(row.id)) ?? [])}>Skip selected ({selectedIds.length})</button></div>
        <p>{rows?.count ?? 0} matching rows · Page {Math.floor(offset / 50) + 1} of {Math.max(1, Math.ceil((rows?.count ?? 0) / 50))}. Suggestions are checked again before every decision.</p>
        {rowsError ? <p role="alert" className="form-error">{rowsError}</p> : null}
        {rowsLoading ? <p role="status">Loading matching rows…</p> : null}
        <div className="statement-table-wrap" tabIndex={0} role="region" aria-label="Statement review rows" aria-busy={rowsLoading}>
          <table className="statement-table"><thead><tr><th scope="col"><input type="checkbox" aria-label="Select unresolved rows on this page" disabled={rowsLoading || filtersPending || bulkBusy} checked={Boolean(rows?.results.some(row => row.state === "pending")) && rows!.results.filter(row => row.state === "pending").every(row => selectedIds.includes(row.id))} onChange={event => setSelectedIds(event.target.checked ? rows?.results.filter(row => row.state === "pending" && !row.transaction).map(row => row.id) ?? [] : [])} /></th>{["Page / row", "Date / time", "Description", "Type / category", "Amount", "Balance after", "Ledger comparison", "Review", "Actions"].map((name) => <th key={name} scope="col">{name}</th>)}</tr></thead><tbody>{rows?.results.map((row) => <tr key={row.id}>
            <td><input type="checkbox" aria-label={`Select source row ${row.position} ${row.component}`} checked={selectedIds.includes(row.id)} disabled={row.state !== "pending" || Boolean(row.transaction) || rowsLoading || filtersPending || bulkBusy} onChange={event => setSelectedIds(old => event.target.checked ? [...old, row.id] : old.filter(id => id !== row.id))} /></td><td>{row.extracted.page} / {row.extracted.row}<br /><small>{row.component}</small></td><td>{row.date ?? "Unknown date"}{row.time ? <><br />{row.time}</> : null}{row.value_date ? <><br /><small>Value: {row.value_date}</small></> : null}</td>
            <td><strong>{row.counterparty_text || row.extracted.provider_type || "Statement movement"}</strong><div>{row.note}</div>{row.reference ? <small>Reference: {row.reference}</small> : null}</td>
            <td>{row.type.replaceAll("_", " ")}<br /><small>{row.direction} · {categories.find((c) => c.id === row.category)?.name ?? "Uncategorized"}</small></td><td>{batch.currency} {row.amount ?? "Missing"}</td><td>{row.balance_after ?? "Not reported"}</td>
            <td>{row.transaction ? <><strong>Confirmed match</strong><br /><small>Evidence attached to ledger entry</small></> : row.review.matches.length ? row.review.matches.map(match => <div key={match.id}><strong>{match.strength === "strong" ? "Strong suggestion" : "Possible match"}</strong><br />{match.date} {match.time ?? ""}<br />{match.source} · {match.amount}<br />Balance: {match.balance_after ?? "Not reported"}<br /><small>{match.note || match.reference || "Ledger movement"}</small>{match.conflict ? <p>Balance conflict</p> : null}</div>) : <span>{row.review.review_state === "new" ? "Statement only — confirm to add" : "No suggestion — review values"}</span>}</td>
            <td><strong>{labels[row.review.review_state] ?? row.review.review_state}</strong>{row.review.matches.some(match => match.strength === "strong") ? <div>Strong match found</div> : null}{row.review.suggestion ? <small>Remembered choices available</small> : null}{row.review.matches.length ? <div>{row.review.matches.length} suggestion{row.review.matches.length === 1 ? "" : "s"}</div> : null}{row.review.issues.length ? <small>{row.review.issues[0]}</small> : null}{row.review.requires_acknowledgement ? <small>Source or draft discrepancy · review required</small> : null}</td>
            <td><button className="button button--small" type="button" disabled={filtersPending || rowsLoading || rowLoading || bulkBusy || setupLoading || setupError !== null} onClick={() => void reviewRow(row.id)}>Review row</button></td>
          </tr>)}</tbody></table>
        </div>
        {rows && !rows.results.length && !rowsLoading ? <p>No rows match these filters.</p> : null}
        <div className="statement-actions"><button className="button" type="button" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - 50))}>Previous page</button><button className="button" type="button" disabled={!rows || offset + 50 >= rows.count} onClick={() => setOffset(offset + 50)}>Next page</button></div>
      </div></section>
    </> : null}
    {rowLoading ? <p role="status">Loading row and fresh suggestions…</p> : null}
    {selectedRow && batch ? <StatementRowDialog key={selectedRow.id} row={selectedRow} batch={batch} accounts={accounts} categories={categories} onCancel={() => setSelectedRow(null)} onNext={nextRow} onReload={() => void reviewRow(selectedRow.id)} onChange={(updated, close) => { setSelectedRow(close ? null : updated); setEpoch((n) => n + 1); }} /> : null}
    {confirmBulk && batch ? <ModalDialog labelledBy="statement-bulk-title" busy={bulkBusy} onCancel={() => setConfirmBulk(null)}><h2 id="statement-bulk-title">{confirmBulk.action === "skip" ? "Skip" : "Approve"} {confirmBulk.rows.length} selected rows?</h2><p>{confirmBulk.action === "skip" ? "This skips the selected unresolved rows without deleting ledger transactions." : `This adds only validated new rows to ${batch.account_name}.`} Matches, source discrepancies and stale rows stay unresolved for individual review. Fees count as separate movements.</p>{bulkError ? <p role="alert" className="form-error">{bulkError}</p> : null}<div className="decision-modal__actions"><button className="button" type="button" disabled={bulkBusy} onClick={() => setConfirmBulk(null)}>Cancel</button><button className="button button--primary" type="button" disabled={bulkBusy || !confirmBulk.rows.length} onClick={() => void approveBulk()}>{bulkBusy ? "Saving…" : confirmBulk.action === "skip" ? "Confirm & skip rows" : "Confirm & add new rows"}</button></div></ModalDialog> : null}
  </div>;
}
