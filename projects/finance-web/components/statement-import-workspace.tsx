"use client";
import { AccountLabel } from "@/components/account-avatar";

import { formatCalendarDate, formatTimestamp } from "../../finance-contracts/presentation";
import { DatePeriodControls } from "@/components/date-period-controls";
import { allDates, periodBounds, type DatePeriod } from "@/lib/date-period";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { identifyStatementAccount, type StatementIdentification, createStatementImport, refreshStatementIdentifiers, getStatementImport, getStatementSummary, reviewSelectedStatementRows, getStatementRow, listAccounts, listCategories, listStatementImports, listStatementRows, type Account, type Category, type SavedStatement, type SavedStatementRow, type StatementHistory, type StatementSummary, type StatementRowPage } from "@/lib/api";
import { getAccessToken } from "@/lib/auth-storage";
import { transactionTypes } from "@/lib/category-type";
import { LoadingState } from "@/components/loading-state";
import { ModalDialog } from "@/components/modal-dialog";
import { StatementLedgerComparison } from "@/components/statement-comparison";
import { StatementImportSummary } from "@/components/statement-summary";
import { StatementRowDialog } from "@/components/statement-row-dialog";
import { DocumentPasswordField } from "@/components/document-password-field";
import { StatementOriginalViewer } from "@/components/statement-original-viewer";
import { StatementDirectionRecheck } from "@/components/statement-direction-recheck";
import { displayedStatementText } from "@/lib/statement-citytouch";
import { useToast } from "@/components/toast-provider";

const labels: Record<string, string> = { ebl_bank: "EBL bank", ebl_credit_card: "EBL credit card", city_bank: "City Bank", bkash: "bKash", new: "New · review to add", possible_match: "Match available", needs_correction: "Fix needed", posted: "Done · added", linked: "Done · linked", skipped: "Skipped", pending: "Pending" };
const emptyFilters = { state: "", sms_status: "", direction: "", type: "", category: "", search: "", date_from: "", date_to: "", ordering: "source" };

function StatementDescriptionCell({ row }: { row: SavedStatementRow }) {
  const source = row.extracted.description;
  const primary = displayedStatementText(row.counterparty_text || row.extracted.provider_type || "Statement movement", source, row.citytouch_printed_code);
  const note = displayedStatementText(row.note, source, row.citytouch_printed_code);
  const showCode = row.citytouch_printed_code && !`${primary} ${note}`.includes(row.citytouch_printed_code);
  return <td><strong>{primary}</strong><div>{note}</div>{showCode ? <small>Citytouch code: {row.citytouch_printed_code}</small> : null}{row.reference ? <small>Reference: {row.reference}</small> : null}{row.extracted.printed_direction_marker ? <small>Printed card {row.extracted.printed_direction_marker === "D" ? "debit (charge)" : "credit (payment or credit)"} · Source {row.extracted.source_currency} {row.extracted.source_amount} · Settlement {row.extracted.settlement_currency} {row.extracted.amount}</small> : null}</td>;
}

function StatementLedgerCell({ row }: { row: SavedStatementRow }) {
  if (row.transaction) return <td><strong>{row.review.review_state === "needs_correction" ? "Linked entry needs review" : "Confirmed match"}</strong><br /><small>Evidence attached to ledger entry</small></td>;
  const pairId = row.review.unified_pending_sms_pair_id;
  return <td>
    {row.review.matches.map(match => <div key={match.id}><strong>{match.rounding_correction ? "Small rounding difference" : match.strength === "strong" ? "Strong ledger suggestion" : "Possible ledger match"}</strong><br />{formatCalendarDate(match.date)} {match.time ?? ""}<br />{match.source} · {match.amount}<br />Balance: {match.balance_after ?? "Not reported"}<br /><small>{match.note || match.reference || "Ledger movement"}</small>{match.rounding_correction ? <p>Amount difference: {match.rounding_correction.difference} · higher value used automatically</p> : null}{match.conflict ? <p>Balance conflict</p> : null}</div>)}
    {pairId ? <div><strong>SMS + statement pair available</strong><br /><small>Review both sources once before recording this row.</small><br /><Link href={`/review?statement=${encodeURIComponent(row.id)}&sms=${encodeURIComponent(pairId)}`}>Review both sources</Link></div> : null}
    {row.review.unified_pending_sms_status === "ambiguous" ? <div><strong>Pending SMS sources need review</strong><br /><small>More than one source could describe this movement. Open the row before adding separately.</small></div> : null}
    {row.review.unified_pending_sms_status === "unavailable" ? <div><strong>SMS pairing unavailable</strong><br /><small>The pending queue is too large to verify safely. Resolve other pending sources first.</small></div> : null}
    {row.review.unified_pending_sms_status === "none" && row.review.pending_sms_match_count === null ? <div><strong>SMS match count unavailable</strong><br /><small>Open the row to check pending SMS before adding.</small></div> : row.review.unified_pending_sms_status === "none" && row.review.pending_sms_match_count ? <div><strong>Pending SMS match</strong><br /><small>{row.review.pending_sms_match_count} message{row.review.pending_sms_match_count === 1 ? "" : "s"} to compare in review</small></div> : null}
    {!row.review.matches.length && row.review.unified_pending_sms_status === "none" && row.review.pending_sms_match_count === 0 ? <span>No ledger suggestion</span> : null}
  </td>;
}

function StatementReviewCell({ row }: { row: SavedStatementRow }) {
  const smsStatus = row.review.unified_pending_sms_status;
  return <td><strong>{smsStatus === "unique" ? "SMS pair available" : smsStatus === "ambiguous" ? "SMS sources need review" : smsStatus === "unavailable" ? "SMS pairing unavailable" : labels[row.review.review_state] ?? row.review.review_state}</strong>{row.review.matches.some(match => match.strength === "strong") ? <div>Strong ledger match found</div> : null}{row.review.suggestion ? <small>Review suggestion available</small> : null}{row.review.matches.length ? <div>{row.review.matches.length} ledger suggestion{row.review.matches.length === 1 ? "" : "s"}</div> : null}{smsStatus === "none" && row.review.pending_sms_match_count === null ? <div>SMS count unavailable</div> : smsStatus === "none" && row.review.pending_sms_match_count ? <div>{row.review.pending_sms_match_count} pending SMS</div> : null}{row.review.issues.length ? <small>{row.review.issues[0]}</small> : null}{row.review.requires_acknowledgement ? <small>Source or draft discrepancy · review required</small> : null}</td>;
}

export function StatementImportWorkspace({ initialImportId, initialRowId }: { initialImportId?: string; initialRowId?: string }) {
  const router = useRouter();
  const initialRowOpened = useRef(false);
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
  const identityRequest = useRef<AbortController | null>(null);
  const [identifying, setIdentifying] = useState(false);
  const [identification, setIdentification] = useState<StatementIdentification | null>(null);
  const [identityError, setIdentityError] = useState<string | null>(null);
  const rowRequest = useRef<AbortController | null>(null);
  const [historyPeriod, setHistoryPeriod] = useState<DatePeriod>(allDates);
  const [historyDateField, setHistoryDateField] = useState<"updated_at" | "created_at">("updated_at");
  const [historyLoading, setHistoryLoading] = useState(true);
  const [rowPeriod, setRowPeriod] = useState<DatePeriod>(allDates);
  const [history, setHistory] = useState<StatementHistory | null>(null);
  const [historyOffset, setHistoryOffset] = useState(0);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [batchId, setBatchId] = useState(initialImportId ?? "");
  const [libraryOpen, setLibraryOpen] = useState(!initialImportId);
  const [checksOpen, setChecksOpen] = useState(false);
  const checksRef = useRef<HTMLDetailsElement>(null);
  const [batch, setBatch] = useState<SavedStatement | null>(null);
  const [batchError, setBatchError] = useState<string | null>(null);
  const [summaryError, setSummaryError] = useState<string | null>(null);
  const [refreshPassword, setRefreshPassword] = useState("");
  const [refreshingIdentifiers, setRefreshingIdentifiers] = useState(false);
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

  useEffect(() => { setBatchId(initialImportId ?? ""); setLibraryOpen(!initialImportId); }, [initialImportId]);
  useEffect(() => () => { uploadRequest.current?.abort(); rowRequest.current?.abort(); identityRequest.current?.abort(); }, []);
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
    setHistoryError(null); setHistoryLoading(true);
    const timer = window.setTimeout(() => {
      void listStatementImports(token, historyOffset, controller.signal, { ...periodBounds(historyPeriod), date_field: historyDateField }).then((result) => {
        if (!controller.signal.aborted) setHistory(result);
      }).catch((reason: unknown) => {
        if (!controller.signal.aborted) setHistoryError(reason instanceof Error ? reason.message : "Could not load import history.");
      }).finally(() => { if (!controller.signal.aborted) setHistoryLoading(false); });
    }, 250);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [historyOffset, historyPeriod, historyDateField, epoch, retry]);
  useEffect(() => {
    const controller = new AbortController(); const token = getAccessToken();
    setBatchError(null); setSummaryError(null);
    if (!token || !batchId) { setBatch(null); setSummary(null); return; }
    setBatch(current => current?.id === batchId ? current : null);
    setSummary(null);
    void getStatementImport(token, batchId, controller.signal).then(result => {
      if (!controller.signal.aborted) setBatch(result);
    }).catch((reason: unknown) => {
      if (!controller.signal.aborted) setBatchError(reason instanceof Error ? reason.message : "Could not load this statement.");
    });
    void getStatementSummary(token, batchId, controller.signal).then(analysis => {
      if (!controller.signal.aborted) setSummary(analysis);
    }).catch((reason: unknown) => {
      if (!controller.signal.aborted) setSummaryError(reason instanceof Error ? reason.message : "Could not load reconciliation details.");
    });
    return () => controller.abort();
  }, [batchId, epoch, retry]);
  useEffect(() => {
    const controller = new AbortController(); const token = getAccessToken(); setRowsError(null);
    if (!token || !batchId) { setRows(null); return; }
    setRows(null); setRowsLoading(true);
    void listStatementRows(token, batchId, appliedFilters, offset, controller.signal).then((result) => {
      if (!controller.signal.aborted) {
        setRows(result);
        if (offset > 0 && offset >= result.count) setOffset(result.count === 0 ? 0 : Math.floor((result.count - 1) / 50) * 50);
      }
    }).catch((reason: unknown) => { if (!controller.signal.aborted) setRowsError(reason instanceof Error ? reason.message : "Could not load statement rows."); }).finally(() => { if (!controller.signal.aborted) setRowsLoading(false); });
    return () => controller.abort();
  }, [batchId, appliedFilters, offset, epoch, retry]);

  useEffect(() => { setSelectedIds([]); }, [batchId, offset, appliedFilters]);

  function openBatch(id: string) {
    rowRequest.current?.abort(); setSelectedRow(null); setRowLoading(false); setBatch(null); setSummary(null); setRows(null);
    setRowPeriod(allDates); setFilters(emptyFilters); setAppliedFilters(emptyFilters); setOffset(0); setBatchId(id);
    setRefreshPassword(""); setLibraryOpen(!id); setChecksOpen(false);
    router.replace(id ? `/statements?import=${id}` : "/statements", { scroll: false });
  }
  async function refreshIdentifiers() {
    const token = getAccessToken();
    if (!token || !batch || refreshingIdentifiers) return;
    setRefreshingIdentifiers(true);
    const unlock = refreshPassword;
    setRefreshPassword("");
    try {
      const updated = await refreshStatementIdentifiers(token, batch.id, unlock);
      setEpoch((value) => value + 1);
      notify(updated ? `Updated identifier metadata on ${updated} archived rows. Reviewed financial values were not changed.` : "Identifier metadata is unchanged. Reviewed financial values were not changed.");
    } catch (reason) { fail(reason, "Could not refresh archived identifiers."); }
    finally { setRefreshingIdentifiers(false); }
  }
  function fail(reason: unknown, fallback: string) { const message = reason instanceof Error ? reason.message : fallback; notify(message, "error"); return message; }
  async function identifyFile(selected: File | null, unlock: string) {
    identityRequest.current?.abort(); identityRequest.current = null;
    setIdentification(null); setIdentityError(null); setIdentifying(false);
    const token = getAccessToken(); if (!selected || !token) return;
    if (selected.size > 4 * 1024 * 1024 || !selected.name.toLowerCase().endsWith(".pdf")) { setIdentityError("Choose a statement PDF no larger than 4 MiB."); return; }
    const controller = new AbortController(); identityRequest.current = controller; setIdentifying(true);
    try {
      const result = await identifyStatementAccount(token, selected, unlock, controller.signal);
      if (!controller.signal.aborted) setIdentification(result);
    } catch (reason) {
      if (!controller.signal.aborted) setIdentityError(reason instanceof Error ? reason.message : "Could not identify the statement account. Choose it manually.");
    } finally {
      if (identityRequest.current === controller) { identityRequest.current = null; setIdentifying(false); }
    }
  }
  async function upload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const token = getAccessToken(); if (!token || !account || !file || uploading || identifying) return;
    if (file.size > 4 * 1024 * 1024 || !file.name.toLowerCase().endsWith(".pdf")) { setUploadError(fail(new Error("Choose a statement PDF no larger than 4 MiB."), "Invalid file.")); return; }
    if (!uploadAccounts.some(a => a.id === account)) { setUploadError("Choose an account of the statement's recognized type."); return; }
    const controller = new AbortController(); uploadRequest.current = controller;
    const unlock = password; setPassword(""); setUploading(true); setUploadError(null);
    try {
      const result = await createStatementImport(token, account, file, unlock, controller.signal);
      if (!controller.signal.aborted) { openBatch(result.id); setEpoch((n) => n + 1); setHistoryOffset(0); notify(`Statement draft ready: ${result.counts.total} review rows. Nothing added to the ledger yet.`); }
    } catch (reason) { if (!controller.signal.aborted) setUploadError(fail(reason, "Could not read the statement.")); }
    finally { if (uploadRequest.current === controller) { uploadRequest.current = null; setUploading(false); } }
  }
  const reviewRow = useCallback(async (id: string) => {
    const token = getAccessToken(); if (!token) return;
    rowRequest.current?.abort(); const controller = new AbortController(); rowRequest.current = controller; setRowLoading(true); setSelectedRow(null);
    try { const result = await getStatementRow(token, id, controller.signal); if (!controller.signal.aborted) { if (result.batch !== batchId) throw new Error("This row belongs to another statement import."); setSelectedRow(result); } }
    catch (reason) { if (!controller.signal.aborted) notify(reason instanceof Error ? reason.message : "Could not load this row.", "error"); }
    finally { if (rowRequest.current === controller) { rowRequest.current = null; setRowLoading(false); } }
  }, [batchId, notify]);
  useEffect(() => {
    if (batch?.id === initialImportId && initialRowId && !initialRowOpened.current) {
      initialRowOpened.current = true;
      void reviewRow(initialRowId);
    }
  }, [batch, initialImportId, initialRowId, reviewRow]);
  const eligible = rows?.results.filter((row) => row.review.review_state === "new" && row.review.unified_pending_sms_status === "none" && !row.review.issues.length && !row.review.requires_acknowledgement) ?? [];
  const selectedEligible = eligible.filter(row => selectedIds.includes(row.id));
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
  const eligibleTypes = identification?.profile === "ebl_credit_card" ? ["credit_card"] : identification?.profile === "bkash" ? ["mobile_wallet"] : identification?.profile ? ["bank", "savings"] : ["bank", "savings", "mobile_wallet", "credit_card"];
  const uploadAccounts = accounts.filter((a) => a.is_active && a.currency === "BDT" && eligibleTypes.includes(a.type));
  return <div className="workspace-grid statement-preview">
    <details className="panel statement-library" open={libraryOpen} onToggle={event => setLibraryOpen(event.currentTarget.open)}><summary>{batchId ? "Upload or choose another statement" : "Statement library"}</summary><div className="workspace-grid">

    <section className="panel"><div className="panel__body"><h2 className="section-title">Import history</h2><p className="section-subtitle">Resume saved reviews. Uploading the same file for the same account reopens its draft and preserves your decisions.</p>
      <DatePeriodControls label="Statement import dates" description="Activity calendar days use Asia/Dhaka" value={historyPeriod} onChange={period => { setHistoryPeriod(period); setHistoryOffset(0); }}>
        <label className="field"><span className="field__label">Filter date</span><select aria-label="Filter date" className="field__control" value={historyDateField} onChange={event => { setHistoryDateField(event.target.value as typeof historyDateField); setHistoryOffset(0); }}><option value="updated_at">Updated date</option><option value="created_at">Imported date</option></select></label>
      </DatePeriodControls>
      {historyLoading ? <p role="status">Updating import history…</p> : null}
      {historyError ? <p role="alert" className="form-error">{historyError}</p> : null}
      {!history && !historyError ? <p role="status">Loading import history…</p> : null}
      {history && !history.results.length ? <p>No statement imports match these dates.</p> : null}
      <div className="statement-history">{history?.results.map((entry) => <button className={`statement-history-item${entry.id === batchId ? " statement-history-item--active" : ""}`} aria-current={entry.id === batchId ? "true" : undefined} type="button" key={entry.id} onClick={() => openBatch(entry.id)}><strong><AccountLabel account={accounts.find(account => account.id === entry.account)} fallback={entry.account_name} /> · {labels[entry.profile] ?? entry.profile}</strong><span>{entry.period_start ? formatCalendarDate(entry.period_start) : "Unknown"} → {entry.period_end ? formatCalendarDate(entry.period_end) : "Unknown"}</span><small>{entry.counts.pending} pending · {entry.counts.posted} added · {entry.counts.linked} linked · {entry.counts.skipped} skipped</small><small>Updated {formatTimestamp(entry.updated_at)}</small></button>)}</div>
      <div className="statement-actions"><button className="button" type="button" disabled={historyLoading || !historyOffset} onClick={() => setHistoryOffset(Math.max(0, historyOffset - 20))}>Newer imports</button><button className="button" type="button" disabled={historyLoading || !history?.next} onClick={() => setHistoryOffset(historyOffset + 20)}>Older imports</button><button className="button button--ghost" type="button" onClick={() => setRetry((n) => n + 1)}>Reload import list</button></div>
    </div></section>
    <section className="panel"><div className="panel__body">
      <details open={!history?.results.length}><summary><strong>Import a statement PDF</strong></summary><p className="section-subtitle">Upload an EBL bank or credit-card, City Bank savings, or bKash digital statement, then review matches and approve new movements.</p>
      <p><Link href="/statement-counterparties">Identify recurring statement codes</Link></p>
      <p className="inline-note">Uploads save a draft and an encrypted copy of the original PDF, without adding transactions. Passwords are never stored.</p>
      {setupError ? <p role="alert" className="form-error">{setupError}</p> : null}
      <form className="form-grid" autoComplete="off" onSubmit={upload}>
        <label className="field"><span className="field__label">Statement account</span><select className="field__control" required disabled={setupLoading || uploading} value={uploadAccounts.some(a => a.id === account) ? account : ""} onChange={(e) => setAccount(e.target.value)}><option value="">{setupLoading ? "Loading accounts…" : "Choose the reporting account"}</option>{uploadAccounts.map((a) => <option key={a.id} value={a.id}>{a.name} · {a.type.replaceAll("_", " ")}</option>)}</select></label>
        <label className="field"><span className="field__label">Statement PDF</span><input className="field__control" type="file" accept=".pdf,application/pdf" required disabled={uploading} onChange={(e) => { const selected = e.target.files?.[0] ?? null; setFile(selected); setPassword(""); setUploadError(null); void identifyFile(selected, ""); }} /><span className="field__hint">Up to 4 MiB and 30 pages. Digital EBL credit-card statements are supported; scans still need OCR.</span></label>
        <DocumentPasswordField id="statement-document-unlock" disabled={uploading} value={password} onChange={value => { setPassword(value); identityRequest.current?.abort(); identityRequest.current = null; setIdentifying(false); setIdentification(null); setIdentityError(null); }} />
        {file ? <div className="field--wide" aria-live="polite">
          {identifying ? <p className="inline-note">Checking the statement account…</p> : null}
          {identityError ? <p className="form-error">{identityError} You can retry recognition or choose the account manually.</p> : null}
          {identification ? <p className="inline-note">Statement identifier: {identification.account_hint || "Unavailable"}. {(identification.account_suggestion?.ambiguous || identification.account_suggestion?.requires_review) ? identification.account_suggestion.reason : identification.account_suggestion ? `Suggested account: ${identification.account_suggestion.name}. Verify the statement header.` : "No saved account match. Choose manually, or save its account number in Accounts for future suggestions."}{identification.account_suggestion?.account && account && account !== identification.account_suggestion.account ? " Your selected account differs from this suggestion; check it before importing." : ""}</p> : null}
          {identification?.account_suggestion?.choices.map(choice => <button key={choice.account} className="button button--ghost" type="button" disabled={uploading || identifying || setupLoading} onClick={() => setAccount(choice.account)} aria-pressed={account === choice.account}>Choose {choice.name}</button>)}
          <div className="statement-actions">
            <button className="button" type="button" disabled={uploading || identifying || setupLoading} onClick={() => void identifyFile(file, password)}>Check account suggestion</button>
            {identifying ? <button className="button" type="button" onClick={() => { identityRequest.current?.abort(); identityRequest.current = null; setIdentifying(false); setIdentityError("Account check cancelled. Choose the account manually or retry."); }}>Cancel account check</button> : null}
            {identification?.account_suggestion?.account && identification.account_suggestion.account !== account ? <button className="button" type="button" disabled={uploading || setupLoading} onClick={() => setAccount(identification.account_suggestion?.account ?? "")}>Use suggested account</button> : null}
          </div>
        </div> : null}
        <div className="statement-actions"><button className="button button--primary" type="submit" disabled={setupLoading || uploading || identifying || !uploadAccounts.some(a => a.id === account) || !file}>{uploading ? "Reading statement…" : "Upload & review"}</button>{uploading ? <button className="button" type="button" onClick={() => { uploadRequest.current?.abort(); uploadRequest.current = null; setUploading(false); notify("Preview request cancelled. If a draft finishes saving, it will appear in import history."); }}>Cancel upload</button> : null}</div>
      </form>
      {!setupLoading && !setupError && !uploadAccounts.length ? <p>Add an active BDT account of the selected statement type in Accounts first.</p> : null}
      {uploading ? <p role="status">Extracting rows and checking balances. You can keep navigating.</p> : null}
      {uploadError ? <p role="alert" className="form-error">{uploadError}</p> : null}
      </details>
    </div></section>
    </div></details>
    {batchError ? <div role="alert" className="form-error">Could not refresh statement details: {batchError} <button className="button button--small" type="button" onClick={() => setRetry(n => n + 1)}>Retry</button></div> : null}
    {batchId && !batch && !batchError ? <LoadingState compact label="Loading statement" detail="Retrieving your saved review" /> : null}
    {batch ? <>
      {summaryError ? <div role="alert" className="form-error">Could not refresh reconciliation details: {summaryError} Review rows remain available. <button className="button button--small" type="button" onClick={() => setRetry(n => n + 1)}>Retry</button></div> : null}
      <section className="panel statement-selected-heading" aria-label="Selected statement"><div><h2 className="section-title"><AccountLabel account={accounts.find(account => account.id === batch.account)} fallback={batch.account_name} /> · {labels[batch.profile] ?? batch.profile}</h2><p>{batch.period_start ? formatCalendarDate(batch.period_start) : "Unknown"} → {batch.period_end ? formatCalendarDate(batch.period_end) : "Unknown"} · {batch.counts.pending} pending of {batch.counts.total} rows</p></div><div className="statement-actions">{batch.profile === "bkash" ? <button className="button button--ghost button--small" type="button" onClick={() => { setChecksOpen(true); requestAnimationFrame(() => document.getElementById("statement-direction-recheck-title")?.scrollIntoView({ block: "start" })); }}>Check debit / credit</button> : null}<button className="button button--ghost button--small" type="button" aria-label="View checks & PDF" onClick={() => { setChecksOpen(true); requestAnimationFrame(() => checksRef.current?.scrollIntoView({ block: "start" })); }}>Checks & PDF</button><button className="button button--ghost button--small" type="button" aria-label="Back to import library" onClick={() => openBatch("")}>Import library</button></div>
        <div className="statement-review-health">
          <span className={`status-badge ${batch.checks.some(check => check.passed === false) ? "status-badge--warning" : "status-badge--idle"}`}>{!batch.checks.length ? "Source checks unavailable" : batch.checks.some(check => check.passed === false) ? `${batch.checks.filter(check => check.passed === false).length} source checks need review` : batch.checks.some(check => check.passed === null) ? `${batch.checks.filter(check => check.passed === null).length} source checks unavailable` : "Source checks passed"}</span>
          {summary?.discrepancy_count ? <span className="status-badge status-badge--warning">{summary.discrepancy_count} draft discrepancies</span> : null}
          {batch.warnings.length ? <span className="status-badge status-badge--warning">{batch.warnings.length} source warnings</span> : null}
          {summary?.incomplete_count ? <span className="status-badge status-badge--idle">{summary.incomplete_count} draft checks unavailable</span> : null}
        </div>
      </section>
      <section className="panel statement-review-panel"><div className="panel__body"><div className="statement-row-heading"><h2 className="section-title">Statement review</h2>
        <DatePeriodControls compact label="Statement row dates" description="Saved row date · Unknown dates under All dates" value={rowPeriod} onChange={period => { setRowPeriod(period); setFilters(old => ({ ...old, date_from: period.start, date_to: period.end })); }} /></div>
        <div className="statement-filter-primary">
          <form role="search" className="field" autoComplete="off" onSubmit={event => event.preventDefault()}>
            <label className="field__label" htmlFor="statement-row-search">Search rows</label>
            <input id="statement-row-search" name="statement-row-query" className="field__control" type="search"
              autoComplete="off" autoCorrect="off" spellCheck={false} data-1p-ignore="true" data-lpignore="true"
              value={filters.search} onChange={event => {
                if (document.activeElement !== event.currentTarget) {
                  event.currentTarget.value = filters.search;
                  return;
                }
                filter("search", event.target.value);
              }} placeholder="Merchant, note, amount, date, code…" />
          </form>
          <label className="field"><span className="field__label">Review state</span><select className="field__control" value={filters.state} onChange={(e) => filter("state", e.target.value)}><option value="">All rows</option>{["pending", "new", "possible_match", "needs_correction", "posted", "linked", "skipped"].map((state) => <option key={state} value={state}>{labels[state]}</option>)}</select></label>
          <label className="field"><span className="field__label">Sort rows</span><select className="field__control" value={filters.ordering} onChange={(e) => filter("ordering", e.target.value)}><option value="source">Statement order</option><option value="date_desc">Newest date first</option><option value="date_asc">Oldest date first</option><option value="amount_desc">Highest amount first</option><option value="amount_asc">Lowest amount first</option></select></label>

        </div>
        <div className="statement-tool-options"><details className="statement-row-filters"><summary>More row filters{[filters.sms_status, filters.direction, filters.type, filters.category].filter(Boolean).length ? ` (${[filters.sms_status, filters.direction, filters.type, filters.category].filter(Boolean).length})` : ""}</summary><div className="statement-filter-secondary">
          <label className="field"><span className="field__label">SMS pairing</span><select className="field__control" value={filters.sms_status} onChange={event => filter("sms_status", event.target.value)}><option value="">All SMS statuses</option><option value="unique">SMS pair found</option><option value="ambiguous">Several SMS candidates</option><option value="possible">Possible SMS match</option><option value="none">No SMS suggestion</option><option value="unavailable">Pairing unavailable</option></select></label>
          <label className="field"><span className="field__label">Debit / credit</span><select className="field__control" value={filters.direction} onChange={(e) => filter("direction", e.target.value)}><option value="">All directions</option><option value="debit">Debit</option><option value="credit">Credit</option></select></label>
          <label className="field"><span className="field__label">Type</span><select className="field__control" value={filters.type} onChange={(e) => filter("type", e.target.value)}><option value="">All types</option>{transactionTypes.map((type) => <option key={type} value={type}>{type.replaceAll("_", " ")}</option>)}</select></label>
          <label className="field"><span className="field__label">Category</span><select className="field__control" value={filters.category} onChange={(e) => filter("category", e.target.value)}><option value="">All categories</option><option value="none">Uncategorized</option>{categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
        </div></details>
        <details className="statement-bulk-actions"><summary>Bulk actions{selectedIds.length ? ` · ${selectedIds.length} selected` : ""}</summary><div className="statement-actions"><button className="button button--ghost" type="button" onClick={() => { setFilters(emptyFilters); setRowPeriod(allDates); }}>Clear filters</button><button className="button button--primary" type="button" disabled={filtersPending || rowsLoading || rowsError !== null || !eligible.length || setupLoading || bulkBusy} onClick={() => confirmRows("create", eligible)}>Approve {eligible.length} new rows on this page</button><button className="button" type="button" disabled={rowsLoading || filtersPending || bulkBusy || !selectedEligible.length} onClick={() => confirmRows("create", selectedEligible)}>Approve selected new rows ({selectedEligible.length})</button><button className="button" type="button" disabled={rowsLoading || filtersPending || bulkBusy || !selectedIds.length} onClick={() => confirmRows("skip", rows?.results.filter(row => selectedIds.includes(row.id)) ?? [])}>Skip selected ({selectedIds.length})</button></div></details>
        <button className="button button--ghost button--small" type="button" onClick={() => { setFilters(emptyFilters); setRowPeriod(allDates); }}>Clear row filters</button></div>
        {rows ? <p>{rows.count} matching rows{rows.count ? ` · Page ${Math.floor(offset / 50) + 1} of ${Math.ceil(rows.count / 50)}` : ""}. Suggestions are checked again before every decision.</p> : null}
        {rowsError ? <div role="alert" className="form-error"><strong>Could not load statement rows.</strong> Your filters are still selected. {rowsError} <button className="button button--small" type="button" onClick={() => setRetry(n => n + 1)}>Retry</button></div> : null}
        {rowsLoading ? <p role="status">Loading matching rows…</p> : null}
        {rows?.count === 0 && !rowsLoading && !rowsError && !filtersPending ? <div className="empty-state empty-state--centered empty-state--compact" role="status"><strong>No rows match these filters</strong><span>Try another search or clear the row filters.</span><button className="button button--ghost" type="button" onClick={() => { setFilters(emptyFilters); setRowPeriod(allDates); }}>Clear filters</button></div> : null}
        {rows?.results.length ? <div className="statement-table-wrap" tabIndex={0} role="region" aria-label="Statement review rows" aria-busy={rowsLoading}>
          <table className="statement-table"><thead><tr><th scope="col"><input type="checkbox" aria-label="Select unresolved rows on this page" disabled={rowsLoading || filtersPending || bulkBusy} checked={Boolean(rows?.results.some(row => row.state === "pending")) && rows!.results.filter(row => row.state === "pending").every(row => selectedIds.includes(row.id))} onChange={event => setSelectedIds(event.target.checked ? rows?.results.filter(row => row.state === "pending" && !row.transaction).map(row => row.id) ?? [] : [])} /></th>{["Page / row", "Date / time", "Description", "Type / category", "Amount", "Balance after", "Ledger / SMS suggestions", "Review", "Actions"].map((name) => <th key={name} scope="col">{name}</th>)}</tr></thead><tbody>{rows?.results.map((row) => <tr key={row.id}>
            <td><input type="checkbox" aria-label={`Select source row ${row.position} ${row.component}`} checked={selectedIds.includes(row.id)} disabled={row.state !== "pending" || Boolean(row.transaction) || rowsLoading || filtersPending || bulkBusy} onChange={event => setSelectedIds(old => event.target.checked ? [...old, row.id] : old.filter(id => id !== row.id))} /></td><td>{row.extracted.page} / {row.extracted.row}<br /><small>{row.component}</small></td><td>{formatCalendarDate(row.date)}{row.time ? <><br />{row.time}</> : null}{row.value_date ? <><br /><small>Value: {formatCalendarDate(row.value_date)}</small></> : null}{row.extracted.statement_date ? <><br /><small>Statement: {formatCalendarDate(row.extracted.statement_date)}</small></> : null}</td>
            <StatementDescriptionCell row={row} />
            <td>{row.type.replaceAll("_", " ")}<br /><small>{row.direction} · {categories.find((c) => c.id === row.category)?.name ?? "Uncategorized"}</small></td><td>{batch.currency} {row.amount ?? "Missing"}</td><td>{row.balance_after ?? (batch.profile === "ebl_credit_card" ? "Not printed" : "Not reported")}</td>
            <StatementLedgerCell row={row} />
            <StatementReviewCell row={row} />
            <td><button className="button button--small" type="button" disabled={filtersPending || rowsLoading || rowLoading || bulkBusy || setupLoading || setupError !== null} onClick={() => void reviewRow(row.id)}>Review row</button></td>
          </tr>)}</tbody></table>
        </div> : null}
        {rows && rows.count > 0 ? <div className="statement-actions"><button className="button" type="button" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - 50))}>Previous page</button><button className="button" type="button" disabled={offset + 50 >= rows.count} onClick={() => setOffset(offset + 50)}>Next page</button></div> : null}
      </div></section>
      <details id="statement-checks" className="panel statement-review-checks" ref={checksRef} open={checksOpen} onToggle={event => setChecksOpen(event.currentTarget.open)}><summary>Statement details and reconciliation</summary><div className="panel__body"><h2 className="section-title"><AccountLabel account={accounts.find(account => account.id === batch.account)} fallback={batch.account_name} /> · {labels[batch.profile] ?? batch.profile}</h2><p>{batch.period_start ? formatCalendarDate(batch.period_start) : "Unknown"} → {batch.period_end ? formatCalendarDate(batch.period_end) : "Unknown"} · {batch.page_count} pages · Account ending {batch.account_hint || "unknown"}</p>{batch.has_original_file ? <StatementOriginalViewer key={`original-${batch.id}`} batchId={batch.id} /> : <p className="inline-note">Original PDF unavailable for this older import. Re-upload the identical file under {batch.account_name} to attach it without adding rows or transactions again.</p>}{["bkash", "ebl_bank"].includes(batch.profile) && batch.has_original_file ? <form className="statement-actions" autoComplete="off" onSubmit={event => { event.preventDefault(); if (!refreshingIdentifiers) void refreshIdentifiers(); }}><button className="button" type="submit" disabled={refreshingIdentifiers}>{refreshingIdentifiers ? "Refreshing…" : "Refresh identifiers from saved PDF"}</button><DocumentPasswordField id="archived-statement-document-unlock" disabled={refreshingIdentifiers} value={refreshPassword} onChange={setRefreshPassword} /><small>Recovers missing identifiers and corrects retired EBL reference metadata. Reviewed financial values and ledger entries stay unchanged.</small></form> : null}{batch.account_suggestion ? <p className="inline-note">{batch.account_suggestion.account ? `Saved identifier suggests ${batch.account_suggestion.name}. ` : ""}{batch.account_suggestion.reason}{batch.account_suggestion.account && batch.account_suggestion.account !== batch.account ? " This differs from the selected statement account; verify before approving." : ""}</p> : null}
        <p>Verify this statement belongs to the selected account. A suffix match is a hint; it does not prove ownership.</p>
        <div className="metric-row">{[["Review rows", batch.counts.total], ["Pending", batch.counts.pending], ["Added", batch.counts.posted], ["Linked", batch.counts.linked], ["Skipped", batch.counts.skipped]].map(([name, value]) => <div className="metric" key={name}><span className="metric__label">{name}</span><strong className="metric__value">{value}</strong></div>)}</div>
        <details className="raw-message"><summary>Original extraction checks</summary><ul className="statement-checks">{batch.checks.map((check) => <li key={check.label}><strong>{check.passed === null ? "Unavailable" : check.passed ? "Passed" : "Needs review"}</strong> — {check.label}{check.expected !== null ? ` · Reported ${check.expected}, extracted ${check.observed ?? "unknown"}` : " · Not printed or readable"}</li>)}</ul><ul className="statement-warnings">{batch.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul><p>These checks describe the original extraction. Draft corrections are saved separately; source discrepancies require explicit review.</p></details>
        {batch.profile === "bkash" ? <StatementDirectionRecheck key={`direction-${batch.id}`} importId={batch.id} hasOriginal={batch.has_original_file} accountName={batch.account_name} onReviewRow={id => void reviewRow(id)} /> : null}
        <StatementLedgerComparison key={`comparison-${batch.id}`} id={batch.id} epoch={epoch} currency={batch.currency} />
        {summary ? <StatementImportSummary summary={summary} currency={batch.currency} /> : null}
        <p className="inline-note">Opening balances are not imported as income. Fees are separate review movements. Unknown times remain empty.</p>
      </div></details>
    </> : null}
    {rowLoading ? <p role="status">Loading row and fresh suggestions…</p> : null}
    {selectedRow && batch ? <StatementRowDialog key={selectedRow.id} row={selectedRow} batch={batch} accounts={accounts} categories={categories} onCancel={() => setSelectedRow(null)} onNext={nextRow} onReload={() => void reviewRow(selectedRow.id)} onChange={(updated, close) => { setSelectedRow(close ? null : updated); setEpoch((n) => n + 1); }} /> : null}
    {confirmBulk && batch ? <ModalDialog labelledBy="statement-bulk-title" busy={bulkBusy} onCancel={() => setConfirmBulk(null)}><h2 id="statement-bulk-title">{confirmBulk.action === "skip" ? "Skip" : "Approve"} {confirmBulk.rows.length} selected rows?</h2><p>{confirmBulk.action === "skip" ? "This skips the selected unresolved rows without deleting ledger transactions." : `This adds only validated new rows to ${batch.account_name}.`} Matches, source discrepancies and stale rows stay unresolved for individual review. Fees count as separate movements.</p>{bulkError ? <p role="alert" className="form-error">{bulkError}</p> : null}<div className="decision-modal__actions"><button className="button" type="button" disabled={bulkBusy} onClick={() => setConfirmBulk(null)}>Cancel</button><button className="button button--primary" type="button" disabled={bulkBusy || !confirmBulk.rows.length} onClick={() => void approveBulk()}>{bulkBusy ? "Saving…" : confirmBulk.action === "skip" ? "Confirm & skip rows" : "Confirm & add new rows"}</button></div></ModalDialog> : null}
  </div>;
}
