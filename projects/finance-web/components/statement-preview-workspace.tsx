"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { type Account, type StatementPreview, listAccounts, previewStatement } from "@/lib/api";
import { getAccessToken } from "@/lib/auth-storage";
import { useToast } from "@/components/toast-provider";

const maxFileBytes = 4 * 1024 * 1024;
const pageSize = 50;
const profileLabels: Record<string, string> = { ebl_bank: "EBL bank", city_bank: "City Bank", bkash: "bKash" };

export function StatementPreviewWorkspace() {
  const { notify } = useToast();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loadingAccounts, setLoadingAccounts] = useState(true);
  const [accountError, setAccountError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const [account, setAccount] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<StatementPreview | null>(null);
  const [search, setSearch] = useState("");
  const [stateFilter, setStateFilter] = useState("all");
  const [direction, setDirection] = useState("all");
  const [page, setPage] = useState(0);
  const pending = useRef<AbortController | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setLoadingAccounts(true);
    setAccountError(null);
    const accessToken = getAccessToken();
    if (!accessToken) {
      setAccountError("Sign in to preview a statement.");
      setLoadingAccounts(false);
      return;
    }
    void listAccounts(accessToken, controller.signal).then((items) => {
      if (!controller.signal.aborted) setAccounts(items.filter((a) => a.is_active && a.currency === "BDT" && ["bank", "savings", "mobile_wallet"].includes(a.type)));
    }).catch((reason: unknown) => {
      if (!controller.signal.aborted) setAccountError(reason instanceof Error ? reason.message : "Could not load accounts.");
    }).finally(() => {
      if (!controller.signal.aborted) setLoadingAccounts(false);
    });
    return () => controller.abort();
  }, [retry]);
  useEffect(() => () => pending.current?.abort(), []);

  function resetPreview() {
    pending.current?.abort();
    pending.current = null;
    setBusy(false);
    setPreview(null);
    setError(null);
    setPage(0);
    setSearch("");
    setStateFilter("all");
    setDirection("all");
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!file || !account) return;
    if (file.size > maxFileBytes || !file.name.toLowerCase().endsWith(".pdf")) {
      const message = "Choose a statement PDF no larger than 4 MiB.";
      setError(message); notify(message, "error"); return;
    }
    const accessToken = getAccessToken();
    if (!accessToken) { setError("Sign in to preview a statement."); return; }
    pending.current?.abort();
    const controller = new AbortController();
    pending.current = controller;
    const unlockPassword = password;
    setPassword("");
    setBusy(true); setError(null); setPreview(null); setPage(0);
    setSearch(""); setStateFilter("all"); setDirection("all");
    try {
      const result = await previewStatement(accessToken, account, file, unlockPassword, controller.signal);
      if (!controller.signal.aborted) {
        setPreview(result);
        notify(`Preview ready: ${result.rows.length} rows, ${result.needs_review_count} need correction. Nothing was added to the ledger.`);
      }
    } catch (reason) {
      if (!controller.signal.aborted) {
        const message = reason instanceof Error ? reason.message : "Could not preview this statement.";
        setError(message); notify(message, "error");
      }
    } finally {
      if (pending.current === controller) { pending.current = null; setBusy(false); }
    }
  }

  const query = search.trim().toLowerCase();
  const filtered = preview?.rows.filter((row) =>
    (stateFilter !== "issues" || row.issues.length > 0) && (direction === "all" || row.direction === direction) &&
    (!query || `${row.description} ${row.provider_type} ${row.reference} ${row.date ?? ""}`.toLowerCase().includes(query))
  ) ?? [];
  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const currentPage = Math.min(page, pageCount - 1);
  const visible = filtered.slice(currentPage * pageSize, (currentPage + 1) * pageSize);

  return <div className="workspace-grid statement-preview">
    <section className="panel"><div className="panel__body">
      <h2 className="section-title">Preview a statement PDF</h2>
      <p className="section-subtitle">Upload an EBL bank, City Bank savings, or bKash statement to check its transactions and balances.</p>
      <p className="inline-note">Preview only. Nothing is added to your ledger. Matching and approval will be available in the next stage.</p>
      {accountError ? <div role="alert"><p>{accountError}</p><button className="button" onClick={() => setRetry((n) => n + 1)} type="button">Retry loading accounts</button></div> : null}
      {!loadingAccounts && !accountError && !accounts.length ? <p>Add an active BDT bank or wallet account in Accounts first.</p> : null}
      <form className="form-grid" onSubmit={submit} aria-busy={busy}>
        <label className="field"><span className="field__label">Statement account</span>
          <select className="field__control" required value={account} disabled={loadingAccounts || busy} onChange={(e) => { resetPreview(); setAccount(e.target.value); }}>
            <option value="">{loadingAccounts ? "Loading accounts…" : "Choose the reporting account"}</option>
            {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </label>
        <label className="field"><span className="field__label">Statement PDF</span>
          <input className="field__control" accept=".pdf,application/pdf" required type="file" disabled={busy} aria-describedby="statement-file-help" onChange={(e) => { resetPreview(); setFile(e.target.files?.[0] ?? null); setPassword(""); }} />
          <span id="statement-file-help" className="field__hint">Up to 4 MiB and 30 pages. Scanned PDFs and credit-card statements are not supported yet.</span>
        </label>
        <label className="field"><span className="field__label">PDF password (if locked)</span>
          <input className="field__control" type="password" autoComplete="off" value={password} maxLength={256} disabled={busy} onChange={(e) => setPassword(e.target.value)} aria-describedby="statement-password-help" />
          <span id="statement-password-help" className="field__hint">Used only to unlock this preview. Enter it again if you retry.</span>
        </label>
        <div className="statement-actions">
          <button className="button button--primary" type="submit" disabled={busy || !file || !account}>{busy ? "Reading statement…" : "Preview statement"}</button>
          {busy ? <button className="button" type="button" onClick={resetPreview}>Cancel preview</button> : null}
        </div>
      </form>
      {busy ? <p role="status">Extracting rows and checking balances. You can keep navigating or cancel.</p> : null}
      {error ? <p className="statement-error" role="alert">{error}</p> : null}
    </div></section>
    {preview ? <>
      <section className="panel"><div className="panel__body">
        <h2 className="section-title">{profileLabels[preview.profile] ?? preview.profile} · {preview.currency}</h2>
        <p>Period: {preview.period_start ?? "Unknown"} → {preview.period_end ?? "Unknown"} · {preview.page_count} pages · Account ending {preview.account_hint || "unknown"}</p>
        <p>{preview.account_identity === "matched_suffix" ? "The suffix matches a saved payment method; verify the account before importing." : "Verify that this statement belongs to the selected account."}</p>
        <div className="metric-row">
          <div className="metric"><span className="metric__label">Extracted rows</span><strong className="metric__value">{preview.rows.length}</strong></div>
          <div className="metric"><span className="metric__label">Need correction</span><strong className="metric__value">{preview.needs_review_count}</strong></div>
          <div className="metric"><span className="metric__label">Balance checks</span><strong className="metric__value">{preview.balance_transitions_checked}</strong></div>
        </div>
        <ul className="statement-checks">{preview.checks.map((check) => <li key={check.label}>
          <strong>{check.passed === null ? "Unavailable" : check.passed ? "Passed" : "Needs review"}</strong> — {check.label}
          {check.expected !== null ? ` · Reported ${check.expected}, extracted ${check.observed ?? "unknown"}` : " · Not printed or not readable"}
        </li>)}</ul>
        {preview.warnings.length ? <ul className="statement-warnings">{preview.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul> : null}
      </div></section>
      <section className="panel"><div className="panel__body">
        <h2 className="section-title">Extracted transactions</h2>
        <div className="form-grid statement-filter-grid">
          <label className="field"><span className="field__label">Search rows</span><input className="field__control" type="search" value={search} onChange={(e) => { setSearch(e.target.value); setPage(0); }} placeholder="Description, reference, or date" /></label>
          <label className="field"><span className="field__label">Review state</span><select className="field__control" value={stateFilter} onChange={(e) => { setStateFilter(e.target.value); setPage(0); }}><option value="all">All rows</option><option value="issues">Need correction</option></select></label>
          <label className="field"><span className="field__label">Debit / credit</span><select className="field__control" value={direction} onChange={(e) => { setDirection(e.target.value); setPage(0); }}><option value="all">All directions</option><option value="debit">Debit</option><option value="credit">Credit</option></select></label>
        </div>
        <p>{filtered.length} matching rows · Page {currentPage + 1} of {pageCount}</p>
        <div className="statement-table-wrap" tabIndex={0} role="region" aria-label="Statement transaction rows">
          <table className="statement-table"><thead><tr>{["Page / row", "Date / time", "Description", "Debit / credit", "Principal", "Signed fee", "Balance after", "Validation"].map((label) => <th key={label} scope="col">{label}</th>)}</tr></thead>
          <tbody>{visible.map((row) => <tr key={row.id}>
            <td>{row.page} / {row.row}</td>
            <td>{row.date ?? "Unknown date"}{row.time ? <><br />{row.time}</> : null}{row.value_date ? <><br /><small>Value date: {row.value_date}</small></> : null}</td>
            <td><strong>{row.provider_type}</strong><div>{row.description}</div>{row.reference ? <small>Reference: {row.reference}</small> : null}</td>
            <td>{row.direction === "credit" ? "Credit" : "Debit"}</td><td>{row.amount ?? "Missing"}</td><td>{row.signed_fee}</td><td>{row.balance_after ?? "Missing"}</td>
            <td>{row.issues.length ? row.issues.join(" ") : "Checks passed"}</td>
          </tr>)}</tbody></table>
        </div>
        {!filtered.length ? <p>No rows match these filters.</p> : null}
        <div className="statement-actions"><button className="button" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)} type="button">Previous page</button><button className="button" disabled={currentPage + 1 >= pageCount} onClick={() => setPage(currentPage + 1)} type="button">Next page</button></div>
      </div></section>
    </> : null}
  </div>;
}
