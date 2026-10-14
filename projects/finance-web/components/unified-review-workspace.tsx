"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ModalDialog } from "@/components/modal-dialog";
import { StatementRowDialog } from "@/components/statement-row-dialog";
import { DatePeriodControls } from "@/components/date-period-controls";
import { useToast } from "@/components/toast-provider";
import { getAccessToken } from "@/lib/auth-storage";
import { allDates, periodBounds, type DatePeriod } from "@/lib/date-period";
import { confirmUnifiedPair, getUnifiedPair, listAccounts, listCategories, listUnifiedPending, type Account, type Category, type UnifiedPair, type UnifiedPendingPage } from "@/lib/api";
import { statementBalanceDifference } from "@/lib/statement-review";

function PairDialog({ pair, onCancel, onSaved, onEdit, accounts }: { accounts: Account[]; pair: UnifiedPair; onCancel: () => void; onSaved: () => void; onEdit: () => void }) {
  const { notify } = useToast();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [ackMatch, setAckMatch] = useState(false);
  const [ackConflict, setAckConflict] = useState(false);
  const [ackIssues, setAckIssues] = useState(false);
  const [remember, setRemember] = useState(false);
  const [ledger, setLedger] = useState("");
  const [balance, setBalance] = useState<"sms" | "statement">(pair.sms.balance_after !== null ? "sms" : "statement");
  const row = pair.row;
  const sourceIssues = [
    ...row.extracted.issues,
    ...pair.batch.checks.filter(check => check.passed === false).map(check =>
      `${check.label}: expected ${check.expected ?? "unknown"}, observed ${check.observed ?? "unknown"}.`),
    ...(!row.transaction && ["posted", "linked"].includes(row.state) ? ["The previous ledger entry was deleted. Verify this source before recording it again."] : []),
  ];
  const ledgerMatch = row.review.matches.find(match => match.id === ledger);
  const smsLedgerDifference = statementBalanceDifference(pair.sms.balance_after, ledgerMatch?.effective_balance_after ?? null);
  const needsConflict = pair.match.conflict || Boolean(ledgerMatch?.conflict) || (smsLedgerDifference !== null && smsLedgerDifference !== "0.00");
  const accountName = (id: string | null) => accounts.find(account => account.id === id)?.name ?? "Account unknown";
  const otherName = accountName(row.other_account);
  const statementPath = row.type === "transfer" ? (row.direction === "credit" ? `${otherName} → ${pair.batch.account_name}` : `${pair.batch.account_name} → ${otherName}`) : pair.batch.account_name;
  const smsPath = pair.sms.destination_account ? `${accountName(pair.sms.account)} → ${accountName(pair.sms.destination_account)}` : pair.batch.account_name;
  const blocked = busy || !ackMatch || (needsConflict && !ackConflict) || (row.review.requires_acknowledgement && !ackIssues) || (row.review.matches.length > 0 && !ledgerMatch?.can_link) || (!ledger && row.review.issues.length > 0) || row.review.matching_truncated;
  async function confirm() {
    const token = getAccessToken(); if (!token || blocked) return;
    setBusy(true); setError("");
    try {
      await confirmUnifiedPair(token, { statement: row.id, sms: pair.sms.id, statement_version: row.version, sms_updated_at: pair.sms.updated_at, transaction: ledger || null, balance_source: ledger ? "existing" : balance, acknowledge_match: ackMatch, acknowledge_conflict: ackConflict, acknowledge_issues: ackIssues, remember_choices: remember });
      notify("SMS and statement linked to one transaction. Both sources are kept.");
      window.dispatchEvent(new Event("finance:transactions-changed"));
      onSaved();
    } catch (reason) { const message = reason instanceof Error ? reason.message : "Could not match these sources."; setError(message); notify(message, "error"); }
    finally { setBusy(false); }
  }
  const received = new Date(pair.sms.raw_message.received_at).toLocaleString();
  const difference = statementBalanceDifference(row.balance_after, pair.sms.balance_after);
  return <ModalDialog labelledBy="unified-pair-title" className="form-drawer statement-row-dialog" busy={busy} onCancel={onCancel}>
    <div className="form-drawer__header"><div><h2 id="unified-pair-title">Review SMS + statement</h2><p>{pair.batch.account_name} · {pair.batch.currency} {row.amount}</p></div><button className="icon-button" type="button" disabled={busy} onClick={onCancel} aria-label="Close combined review">×</button></div>
    <div className="statement-row-body">
      <p className="inline-note">Confirm one movement using the saved statement classification, date and time. Both original sources remain available.</p>
      <div className="statement-match-comparison">
        <section aria-label="Statement source"><h3>Statement</h3><dl>
          <div><dt>Date / time</dt><dd>{row.date} · {row.time || "Time unknown"}</dd></div><div><dt>Amount / direction</dt><dd>{pair.batch.currency} {row.amount} · {row.direction}</dd></div>
          <div><dt>Account / path</dt><dd>{statementPath}</dd></div><div><dt>Type</dt><dd>{row.type.replaceAll("_", " ")}</dd></div><div><dt>Description</dt><dd>{row.counterparty_text || row.note}</dd></div><div><dt>Reference</dt><dd>{row.reference || "Not reported"}</dd></div>
          <div className={pair.match.conflict ? "statement-balance-value--conflict" : undefined}><dt>Reported balance after</dt><dd>{row.balance_after ?? "Not reported"}</dd></div>
        </dl><details className="statement-match-reasons"><summary>Original PDF row · page {row.extracted.page}</summary><p className="statement-evidence-text">{row.extracted.description}</p></details>
        <button className="button" type="button" disabled={busy} onClick={onEdit}>Edit statement draft</button></section>
        <section aria-label="SMS source"><h3>SMS</h3><dl>
          <div><dt>Received date / time</dt><dd>{received}</dd></div><div><dt>Amount / direction</dt><dd>{pair.batch.currency} {pair.sms.amount} · {row.direction}</dd></div><div><dt>Account / path</dt><dd>{smsPath}</dd></div><div><dt>Parsed type</dt><dd>{pair.sms.transaction_type.replaceAll("_", " ")}</dd></div>
          <div><dt>Description</dt><dd>{pair.sms.counterparty_text || pair.sms.message_kind.replaceAll("_", " ")}</dd></div><div><dt>Reference</dt><dd>{pair.sms.reference || "Not reported"}</dd></div>
          <div className={pair.match.conflict ? "statement-balance-value--conflict" : undefined}><dt>Reported balance after</dt><dd>{pair.sms.balance_after ?? "Not reported"}</dd></div>
        </dl><details className="statement-match-reasons"><summary>Original SMS</summary><p className="statement-evidence-text">{pair.sms.raw_message.body ?? "Original SMS unavailable under retention settings."}</p></details>
        <Link className="button" href={`/messages/review?candidate=${pair.sms.id}`}>Correct SMS separately</Link></section>
      </div>
      <details className="raw-message"><summary>{pair.match.strength === "strong" ? "Strong" : "Possible"} match · evidence</summary><ul>{pair.match.reasons.map(reason => <li key={reason}>{reason}</li>)}</ul></details>
      {row.review.matches.length ? <section className="raw-message"><h3>Already in the ledger?</h3><p>A ledger suggestion exists. Choose it to keep that transaction and attach both sources.</p><label className="field"><span className="field__label">Existing transaction</span><select className="field__control" disabled={busy} value={ledger} onChange={event => { setLedger(event.target.value); setAckConflict(false); }}><option value="">Choose a verified ledger match</option>{row.review.matches.map(match => <option key={match.id} value={match.id} disabled={!match.can_link}>{match.date} · {match.amount} · {match.note || match.type}</option>)}</select></label>{ledgerMatch ? <p>Existing reported balance: {ledgerMatch.effective_balance_after ?? "Not reported"}. Linking keeps this ledger entry unchanged.</p> : null}</section> : <label className="field"><span className="field__label">Balance to use in the ledger</span><select className="field__control" value={balance} disabled={busy} onChange={event => { setBalance(event.target.value as "sms" | "statement"); setAckConflict(false); }}><option value="sms">SMS · {pair.sms.balance_after ?? "Not reported"}</option><option value="statement">Statement · {row.balance_after ?? "Not reported"}</option></select><span className="field__hint">Both reported balances stay in their source records.</span></label>}
      {needsConflict ? <section className="statement-match-conflict"><strong>Review balance differences{pair.match.conflict && difference !== null ? ` · ${pair.batch.currency} ${difference}` : ""}</strong>{smsLedgerDifference !== null && smsLedgerDifference !== "0.00" ? <p>SMS minus existing ledger balance: {pair.batch.currency} {smsLedgerDifference}.</p> : null}{ledgerMatch?.conflict ? <ul>{ledgerMatch.reasons.filter(reason => reason.includes("balance")).map(reason => <li key={reason}>{reason}</li>)}</ul> : null}<label className="review-remember"><input type="checkbox" disabled={busy} checked={ackConflict} onChange={event => setAckConflict(event.target.checked)} /><span>I reviewed the differing balances and the balance choice.</span></label></section> : null}
      {row.review.issues.length ? <ul className="statement-error">{row.review.issues.map(issue => <li key={issue}>{issue}</li>)}</ul> : null}
      {row.review.requires_acknowledgement ? <section className="raw-message" aria-label="Source and draft discrepancies">
        <h3>Source and draft discrepancies</h3>
        {sourceIssues.length ? <><strong>Original statement checks</strong><ul>{sourceIssues.map((issue, index) => <li key={index}>{issue}</li>)}</ul></> : null}
        {row.review.draft_issues.length ? <><strong>Saved draft checks</strong><ul>{row.review.draft_issues.map((issue, index) => <li key={index}>{issue}</li>)}</ul></> : null}
        <label className="review-remember"><input type="checkbox" disabled={busy} checked={ackIssues} onChange={event => setAckIssues(event.target.checked)} /><span>I reviewed the source and draft discrepancies.</span></label></section> : null}
      <label className="review-remember"><input type="checkbox" disabled={busy} checked={ackMatch} onChange={event => setAckMatch(event.target.checked)} /><span>These sources describe the same money movement.</span></label>
      <label className="review-remember"><input type="checkbox" disabled={busy} checked={remember} onChange={event => setRemember(event.target.checked)} /><span>Remember statement category and transfer choices.</span></label>
      {error ? <p className="form-error" role="alert">{error} Close and refresh the queue if either source changed.</p> : null}
    </div>
    <footer className="statement-row-footer"><div className="statement-actions"><button className="button button--ghost" type="button" disabled={busy} onClick={onCancel}>Cancel</button><button className="button button--primary" type="button" disabled={blocked} onClick={() => void confirm()}>{busy ? "Confirming…" : "Confirm both · count once"}</button></div></footer>
  </ModalDialog>;
}

export function UnifiedReviewWorkspace() {
  const { notify } = useToast();
  const [page, setPage] = useState<UnifiedPendingPage | null>(null);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [account, setAccount] = useState("");
  const [period, setPeriod] = useState<DatePeriod>(allDates);
  const [search, setSearch] = useState(""), [query, setQuery] = useState("");
  const [offset, setOffset] = useState(0), [epoch, setEpoch] = useState(0);
  const [loading, setLoading] = useState(true), [error, setError] = useState("");
  const [selection, setSelection] = useState<{ statement: string; sms: string } | null>(null);
  const [pair, setPair] = useState<UnifiedPair | null>(null), [pairLoading, setPairLoading] = useState(false);
  const [editPair, setEditPair] = useState<UnifiedPair | null>(null);
  useEffect(() => {
    const token = getAccessToken(); if (!token) return;
    const controller = new AbortController();
    void Promise.all([listAccounts(token), listCategories(token)]).then(([a, c]) => { if (!controller.signal.aborted) { setAccounts(a); setCategories(c); } }).catch(reason => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Could not load account settings."); });
    return () => controller.abort();
  }, []);
  useEffect(() => {
    const token = getAccessToken(); if (!token) return;
    const controller = new AbortController(); setLoading(true); setError("");
    const filters: Record<string, string> = { search: query, offset: String(offset), limit: "50" };
    const bounds = periodBounds(period);
    if (bounds.start_date && bounds.end_date) { filters.start_date = bounds.start_date; filters.end_date = bounds.end_date; }
    if (account) filters.account = account;
    const timer = setTimeout(() => { void listUnifiedPending(token, filters, controller.signal).then(result => { if (!controller.signal.aborted) { setPage(result); if (offset >= result.count && offset) setOffset(0); } }).catch(reason => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Could not load pending sources."); }).finally(() => { if (!controller.signal.aborted) setLoading(false); }); }, 250);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [account, query, offset, period, epoch]);
  useEffect(() => {
    setPair(null); setPairLoading(false); if (!selection) return;
    const token = getAccessToken(); if (!token) return;
    const controller = new AbortController(); setPairLoading(true);
    void getUnifiedPair(token, selection.statement, selection.sms, controller.signal).then(result => { if (!controller.signal.aborted) setPair(result); }).catch(reason => { if (!controller.signal.aborted) { notify(reason instanceof Error ? reason.message : "Could not load both sources.", "error"); setSelection(null); } }).finally(() => { if (!controller.signal.aborted) setPairLoading(false); });
    return () => controller.abort();
  }, [selection, notify]);
  function select(statement: string, sms: string) {
    setSelection({ statement, sms });
  }
  function refresh() { setSelection(null); setPair(null); setPairLoading(false); setEpoch(value => value + 1); }
  function returnToPair() {
    if (!editPair) return;
    setSelection({ statement: editPair.row.id, sms: editPair.sms.id });
    setEditPair(null);
    setEpoch(value => value + 1);
  }
  return <div className="workspace-grid"><section className="panel"><div className="panel__body">
    <div className="unified-review-heading"><div><h2 className="section-title">Matched SMS + statement review</h2><p className="section-subtitle">Each item is one unique pre-matched movement. Review it once, keep both sources, and count it once.</p></div><button className="button" type="button" onClick={refresh}>Refresh matches</button></div>
    <DatePeriodControls value={period} label="Matched transaction dates" description="Uses the statement transaction date · local timezone" onChange={value => { setPeriod(value); setOffset(0); }} />
    <div className="unified-review-filters">
      <label className="field"><span className="field__label">Account</span><select className="field__control" value={account} onChange={event => { setAccount(event.target.value); setOffset(0); }}><option value="">All accounts</option>{accounts.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
      <form onSubmit={event => { event.preventDefault(); setQuery(search); setOffset(0); }} className="unified-review-search"><label className="field"><span className="field__label">Search matched sources</span><input className="field__control" type="search" maxLength={255} value={search} onChange={event => setSearch(event.target.value)} /></label><button className="button" type="submit">Search</button></form>
    </div>
    <p className="inline-note">{loading ? "Finding unique matches…" : `${page?.count ?? 0} matched ${page?.count === 1 ? "item" : "items"}`} · Matching only prepares this queue; nothing is added until you confirm.</p>
    {error ? <p className="form-error" role="alert">{error}</p> : null}{pairLoading ? <p role="status">Loading both sources…</p> : null}
    {!loading && !error && page?.count === 0 ? <p>No unique SMS + statement matches were found for these filters. Unmatched and ambiguous sources remain in their individual review pages.</p> : null}
    <div className="unified-review-list" aria-busy={loading}>{page?.results.map(item => <article className="unified-review-item" key={item.id}>
      <header><strong>SMS + statement · {item.statement.account_name}</strong><span>{item.statement.amount === null ? "Amount needed" : `${item.statement.currency} ${item.statement.amount}`} · {item.statement.direction}</span></header>
      <p>{item.statement.date ?? "Date needed"}{item.statement.time ? ` · ${item.statement.time}` : ""} · {item.statement.description || item.sms.description}</p>
      <div className="unified-review-source-summary"><span>Statement: {item.statement.description || "No description"}</span><span>SMS: {item.sms.description || "No description"}</span></div>
      <div className="unified-review-matches"><button className="button button--primary" type="button" disabled={loading || pairLoading} onClick={() => select(item.statement.id, item.sms.id)}>Review matched item · {item.match.conflict ? "Balance differs" : item.match.strength === "strong" ? "Strong match" : "Possible match"}</button></div>
    </article>)}</div>
    <div className="statement-actions"><button className="button" type="button" disabled={loading || offset === 0} onClick={() => setOffset(value => Math.max(0, value - 50))}>Previous page</button><button className="button" type="button" disabled={loading || !page || offset + 50 >= page.count} onClick={() => setOffset(value => value + 50)}>Next page</button></div>
  </div></section>
  {pair ? <PairDialog key={`${pair.row.id}:${pair.sms.id}:${pair.row.version}`} pair={pair} accounts={accounts} onCancel={() => { setSelection(null); setPair(null); }} onSaved={refresh} onEdit={() => { setEditPair(pair); setSelection(null); setPair(null); }} /> : null}
  {editPair ? <StatementRowDialog editOnly key={editPair.row.id} row={editPair.row} batch={editPair.batch} accounts={accounts} categories={categories} onCancel={returnToPair} onReload={returnToPair} onNext={async () => returnToPair()} onChange={returnToPair} /> : null}
  </div>;
}
