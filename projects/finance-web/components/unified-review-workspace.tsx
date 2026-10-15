"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { DatePeriodControls } from "@/components/date-period-controls";
import { ModalDialog } from "@/components/modal-dialog";
import { StatementRowDialog } from "@/components/statement-row-dialog";
import { UnifiedPairEditor, initialPairDraft, savedPairDraft, type PairTypeChoice } from "@/components/unified-pair-editor";
import { useToast } from "@/components/toast-provider";
import { getAccessToken } from "@/lib/auth-storage";
import { allDates, periodBounds, type DatePeriod } from "@/lib/date-period";
import { displayedStatementText } from "@/lib/statement-citytouch";
import {
  confirmUnifiedPair,
  getUnifiedPair,
  listAccounts,
  listCategories,
  listUnifiedPending,
  type Account,
  type Category,
  type UnifiedPair,
  type UnifiedPendingPage,
} from "@/lib/api";
import { reportedBalanceNeedsAcknowledgment, statementBalanceDifference, suggestedBalanceSource } from "@/lib/statement-review";

type BalanceChoice = "" | "sms" | "statement";

const dateTimeFormatter = new Intl.DateTimeFormat("en-BD", { dateStyle: "medium", timeStyle: "short" });

function formatStatementDateTime(date: string | null, time: string | null) {
  if (!date) return "Date unknown";
  if (!time) return `${date} · time not reported`;
  const value = new Date(`${date}T${time || "00:00:00"}`);
  return Number.isNaN(value.getTime()) ? `${date}${time ? ` · ${time}` : ""}` : dateTimeFormatter.format(value);
}

function PairDialog({ pair, onCancel, onSaved, onEdit, accounts, categories }: { accounts: Account[]; categories: Category[]; pair: UnifiedPair; onCancel: () => void; onSaved: () => void; onEdit: () => void }) {
  const { notify } = useToast();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [ackMatch, setAckMatch] = useState(false);
  const [ackConflict, setAckConflict] = useState(false);
  const [ackIssues, setAckIssues] = useState(false);
  const [checksOpen, setChecksOpen] = useState(true);
  const [remember, setRemember] = useState(false);
  const [ledger, setLedger] = useState("");
  const [ledgerCleared, setLedgerCleared] = useState(false);
  const [balance, setBalance] = useState<BalanceChoice>(() => suggestedBalanceSource(pair.row.balance_after, pair.sms.balance_after, Number(pair.row.extracted.signed_fee) !== 0));
  const [draft, setDraft] = useState(() => initialPairDraft(pair, categories));
  const [typeChoice, setTypeChoice] = useState<PairTypeChoice>(() => pair.row.type === pair.sms.transaction_type ? "statement" : "");
  const row = pair.row;
  const statementIncludesSeparateFee = Number(row.extracted.signed_fee) !== 0;
  const typeDiffers = row.type !== pair.sms.transaction_type;
  const draftChanged = JSON.stringify(draft) !== JSON.stringify(savedPairDraft(pair));
  const needsDraftReview = row.review.requires_acknowledgement || draftChanged;
  function updateDraft(value: typeof draft) {
    if (value.balance_after !== draft.balance_after) setBalance(suggestedBalanceSource(value.balance_after, pair.sms.balance_after, statementIncludesSeparateFee));
    if (ledger) setLedgerCleared(true);
    setDraft(value); setLedger(""); setAckMatch(false); setAckConflict(false); setAckIssues(false);
  }
  const sourceIssues = [
    ...row.extracted.issues,
    ...pair.batch.checks.filter(check => check.passed === false).map(check => `${check.label}: expected ${check.expected ?? "unknown"}, observed ${check.observed ?? "unknown"}.`),
    ...(!row.transaction && ["posted", "linked"].includes(row.state) ? ["The previous ledger entry was deleted. Verify this source before recording it again."] : []),
  ];
  const linkableLedgerMatches = row.review.matches.filter(match => match.can_link);
  const ledgerMatch = row.review.matches.find(match => match.id === ledger);
  const smsLedgerDifference = statementBalanceDifference(pair.sms.balance_after, ledgerMatch?.effective_balance_after ?? null);
  const originalBalanceDifference = statementBalanceDifference(row.balance_after, pair.sms.balance_after);
  const originalBalanceNeedsReview = pair.match.conflict && reportedBalanceNeedsAcknowledgment(row.balance_after, pair.sms.balance_after, pair.batch.currency);
  const editedBalanceNeedsReview = reportedBalanceNeedsAcknowledgment(draft.balance_after, pair.sms.balance_after, pair.batch.currency);
  const needsConflict = originalBalanceNeedsReview || editedBalanceNeedsReview || Boolean(ledgerMatch?.conflict) || (smsLedgerDifference !== null && smsLedgerDifference !== "0.00");
  const accountNames = useMemo(() => new Map(accounts.map(account => [account.id, account.name])), [accounts]);
  const accountName = (id: string | null) => id ? accountNames.get(id) ?? "Account unknown" : "Account unknown";
  const otherName = accountName(row.other_account);
  const statementPath = row.type === "transfer" ? (row.direction === "credit" ? `${otherName} → ${pair.batch.account_name}` : `${pair.batch.account_name} → ${otherName}`) : pair.batch.account_name;
  const smsPath = pair.sms.destination_account ? `${accountName(pair.sms.account)} → ${accountName(pair.sms.destination_account)}` : pair.sms_summary.account_name;
  const balanceHint = statementIncludesSeparateFee
    ? "The statement includes a separate fee, so use the SMS balance or review the fee separately."
    : draft.balance_after !== null && pair.sms.balance_after !== null
      ? "The higher report is selected initially. You can choose the other."
      : "The available report is selected initially when there is one.";
  const requirements = [
    ...(typeDiffers && !typeChoice ? ["Choose whether the final type follows the statement, SMS, or your correction."] : []),
    ...(typeDiffers && typeChoice === "custom" && (draft.type === row.type || draft.type === pair.sms.transaction_type) ? ["Choose a different type, or select Statement or SMS above."] : []),
    ...(!draft.date ? ["Choose a transaction date."] : []),
    ...(draft.type === "transfer" && !draft.other_account ? ["Choose the other owned account for this transfer."] : []),
    ...(!draft.classification_confirmed ? ["Review the transaction type and account path."] : []),
    ...(!ledger && statementIncludesSeparateFee && pair.sms.balance_after === null && draft.balance_after !== null ? ["The statement includes a separate fee and SMS has no balance. Review the fee separately."] : !ledger && !balance ? ["Choose which reported balance the ledger should use."] : []),
    ...(!ackMatch ? ["Confirm that the SMS and statement describe the same movement."] : []),
    ...(needsConflict && !ackConflict ? ["Review and acknowledge the reported-balance difference."] : []),
    ...(needsDraftReview && !ackIssues ? ["Review the edited result against the original sources."] : []),
    ...(linkableLedgerMatches.length > 0 && !ledgerMatch?.can_link ? ["Choose a verified existing ledger transaction, or review the statement separately."] : []),
    ...(row.review.matches.length > 0 && linkableLedgerMatches.length === 0 ? ["Resolve the unavailable ledger suggestions in statement review first."] : []),
    ...(!draftChanged && !ledger && row.review.issues.length > 0 ? ["Correct the blocking statement issues before confirming."] : []),
    ...(row.review.matching_truncated ? ["Narrow the statement ledger search before confirming."] : []),
  ];
  const blocked = busy || requirements.length > 0;

  async function confirm() {
    const token = getAccessToken();
    if (!token || blocked || (!balance && !ledger)) return;
    const balanceSource = ledger ? "existing" : balance;
    if (!balanceSource) return;
    setBusy(true); setError("");
    try {
      await confirmUnifiedPair(token, {
        statement: row.id, sms: pair.sms.id, statement_version: row.version, sms_updated_at: pair.sms.updated_at,
        transaction: ledger || null, balance_source: balanceSource,
        type_choice: typeChoice || undefined, draft,
        acknowledge_match: ackMatch, acknowledge_conflict: ackConflict, acknowledge_issues: ackIssues, remember_choices: remember,
      });
      notify("SMS and statement linked to one transaction. Both sources are kept.");
      window.dispatchEvent(new Event("finance:transactions-changed"));
      onSaved();
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : "Could not match these sources.";
      setError(message); notify(message, "error");
    } finally { setBusy(false); }
  }

  return <ModalDialog labelledBy="unified-pair-title" initialFocus="#unified-pair-summary" className="form-drawer statement-row-dialog unified-pair-dialog" busy={busy} onCancel={onCancel}>
    <div className="form-drawer__header"><div><h2 id="unified-pair-title">Review SMS + statement</h2><p>{pair.batch.account_name} · {pair.batch.currency} {row.amount}</p></div><button className="icon-button" type="button" disabled={busy} onClick={onCancel} aria-label="Close combined review">×</button></div>
    <div className="statement-row-body unified-pair-body">
      <div className="unified-pair-grid">
      <div className="unified-pair-main">
      <section id="unified-pair-summary" tabIndex={-1} className="unified-pair-summary" aria-label="Source comparison">
        <strong>Same account, direction and amount</strong>
        <span>Statement {formatStatementDateTime(row.date, row.time)} · SMS {dateTimeFormatter.format(new Date(pair.sms.raw_message.received_at))}</span>
        {typeDiffers ? <span className="unified-pair-summary__difference">Type differs</span> : null}
        {originalBalanceNeedsReview ? <span className="unified-pair-summary__difference">Balances differ</span> : null}
      </section>
      <UnifiedPairEditor pair={pair} accounts={accounts} categories={categories} draft={draft} onDraftChange={updateDraft} typeChoice={typeChoice} onTypeChoice={choice => { setTypeChoice(choice); setAckMatch(false); }} busy={busy} />
      <details className="unified-source-evidence"><summary>Compare original sources and parsed values</summary>
      <div className="statement-match-comparison">
        <section aria-label="Statement source"><h3>Statement</h3><dl>
          <div><dt>Date / time</dt><dd>{formatStatementDateTime(row.date, row.time)}</dd></div><div><dt>Amount / direction</dt><dd>{pair.batch.currency} {row.amount} · {row.direction}</dd></div>
          <div><dt>Account / path</dt><dd>{statementPath}</dd></div><div><dt>Type</dt><dd>{row.type.replaceAll("_", " ")}</dd></div><div><dt>Description</dt><dd>{displayedStatementText(row.counterparty_text || row.note, row.extracted.description, row.citytouch_printed_code)}</dd></div><div><dt>Reference</dt><dd>{row.reference || "Not reported"}</dd></div>
          <div className={originalBalanceNeedsReview ? "statement-balance-value--conflict" : undefined}><dt>Reported balance after</dt><dd>{row.balance_after ?? "Not reported"}</dd></div>
        </dl><details className="statement-match-reasons"><summary>Original PDF row · page {row.extracted.page}</summary><p className="statement-evidence-text">{row.extracted.description}</p>{row.citytouch_printed_code ? <p>Citytouch code printed in PDF: {row.citytouch_printed_code}</p> : null}</details><button className="button" type="button" disabled={busy} onClick={onEdit}>Edit statement draft</button></section>
        <section aria-label="SMS source"><h3>SMS</h3><dl>
          <div><dt>Date / time</dt><dd>{dateTimeFormatter.format(new Date(pair.sms.raw_message.received_at))}</dd></div><div><dt>Amount / direction</dt><dd>{pair.sms_summary.currency} {pair.sms_summary.amount} · {pair.sms_summary.direction}</dd></div><div><dt>Account / path</dt><dd>{smsPath}</dd></div><div><dt>Parsed type</dt><dd>{pair.sms.transaction_type.replaceAll("_", " ")}</dd></div>
          <div><dt>Description</dt><dd>{pair.sms.counterparty_text || pair.sms.message_kind.replaceAll("_", " ")}</dd></div><div><dt>Reference</dt><dd>{pair.sms.reference || "Not reported"}</dd></div><div className={originalBalanceNeedsReview ? "statement-balance-value--conflict" : undefined}><dt>Reported balance after</dt><dd>{pair.sms.balance_after ?? "Not reported"}</dd></div>
        </dl><details className="statement-match-reasons"><summary>Original SMS</summary><p className="statement-evidence-text">{pair.sms.raw_message.body ?? "Original SMS unavailable under retention settings."}</p></details><Link className="button" href={`/messages/review?candidate=${pair.sms.id}&return=%2Freview`}>Correct SMS separately</Link></section>
      </div></details>
      <details className="raw-message"><summary>{pair.match.strength === "strong" ? "Strong" : "Possible"} match · evidence</summary><ul>{pair.match.reasons.map(reason => <li key={reason}>{reason}</li>)}</ul></details>
      </div>
      <section className="unified-pair-decisions" aria-label="Finish review">
      <h3>Finish review</h3>
      {row.review.matches.length ? <section className="raw-message"><h3>Already in the ledger?</h3><p>{linkableLedgerMatches.length ? "Choose the matching ledger transaction to keep it and attach both sources." : "These ledger suggestions cannot currently accept another statement source. Resolve them in statement review before confirming this pair."}</p>{ledgerCleared ? <p role="status" className="inline-note">Your edit cleared the existing transaction choice. Verify the match and select it again before recording.</p> : null}<label className="field"><span className="field__label">Existing transaction</span><select className="field__control" disabled={busy || linkableLedgerMatches.length === 0} value={ledger} onChange={event => { setLedger(event.target.value); setLedgerCleared(false); setAckConflict(false); }}><option value="">{linkableLedgerMatches.length ? "Choose a verified ledger match" : "No linkable ledger matches"}</option>{row.review.matches.map(match => <option key={match.id} value={match.id} disabled={!match.can_link}>{match.date} · {match.amount} · {match.note || match.type}{!match.can_link ? " · unavailable" : ""}</option>)}</select></label>{ledgerMatch ? <p>Existing reported balance: {ledgerMatch.effective_balance_after ?? "Not reported"}. Linking keeps this ledger entry unchanged.</p> : null}<Link className="button button--ghost" href={`/statements?import=${pair.batch.id}&row=${row.id}`}>Review statement separately</Link></section> : <fieldset className="statement-balance-choice">
        <legend>Balance to use in the ledger</legend>
        <div className="statement-balance-options">
          <label><input type="radio" name="unified-balance" value="sms" checked={balance === "sms"} disabled={busy || (pair.sms.balance_after === null && draft.balance_after !== null)} onChange={() => { setBalance("sms"); setAckConflict(false); }} /><span>SMS<strong>{pair.sms.balance_after ?? "Not reported"}</strong></span></label>
          <label><input type="radio" name="unified-balance" value="statement" checked={balance === "statement"} disabled={busy || statementIncludesSeparateFee || (draft.balance_after === null && pair.sms.balance_after !== null)} onChange={() => { setBalance("statement"); setAckConflict(false); }} /><span>Statement draft<strong>{draft.balance_after ?? "Not reported"}</strong></span></label>
        </div>
        <span className="field__hint">{balanceHint} Edit the statement draft in More transaction details. Both originals remain attached.</span>
        {statementIncludesSeparateFee && pair.sms.balance_after === null && draft.balance_after !== null ? <Link className="button button--ghost" href={`/statements?import=${pair.batch.id}&row=${row.id}`}>Review fee separately</Link> : null}
      </fieldset>}
      {needsConflict ? <section className="statement-match-conflict"><strong>Review balance differences{originalBalanceNeedsReview && originalBalanceDifference !== null ? ` · original reports differ by ${pair.batch.currency} ${originalBalanceDifference}` : ""}</strong><p>Saved statement: {row.balance_after ?? "Not reported"} · SMS: {pair.sms.balance_after ?? "Not reported"}{draft.balance_after !== row.balance_after ? ` · edited statement draft: ${draft.balance_after ?? "Not reported"}` : ""}.</p>{smsLedgerDifference !== null && smsLedgerDifference !== "0.00" ? <p>SMS minus existing ledger balance: {pair.batch.currency} {smsLedgerDifference}.</p> : null}{ledgerMatch?.conflict ? <ul>{ledgerMatch.reasons.filter(reason => reason.includes("balance")).map(reason => <li key={reason}>{reason}</li>)}</ul> : null}<label className="review-remember"><input type="checkbox" disabled={busy} checked={ackConflict} onChange={event => setAckConflict(event.target.checked)} /><span>I reviewed the differing balances and my balance choice.</span></label></section> : null}
      {!draftChanged && row.review.issues.length ? <ul className="statement-error">{row.review.issues.map(issue => <li key={issue}>{issue}</li>)}</ul> : null}
      {needsDraftReview ? <section className="raw-message" aria-label="Source and draft discrepancies"><h3>Edited result and source checks</h3>{draftChanged ? <p className="inline-note">The server will recheck the match and statement draft together before recording anything.</p> : null}{sourceIssues.length || (!draftChanged && row.review.draft_issues.length) ? <details className="unified-check-details" open={checksOpen} onToggle={event => setChecksOpen(event.currentTarget.open)}><summary>Source checks ({sourceIssues.length + (draftChanged ? 0 : row.review.draft_issues.length)})</summary>{sourceIssues.length ? <><strong>Original statement checks</strong><ul>{sourceIssues.map((issue, index) => <li key={index}>{issue}</li>)}</ul></> : null}{!draftChanged && row.review.draft_issues.length ? <><strong>Saved draft checks</strong><ul>{row.review.draft_issues.map((issue, index) => <li key={index}>{issue}</li>)}</ul></> : null}</details> : null}<label className="review-remember"><input type="checkbox" disabled={busy} checked={ackIssues} onChange={event => setAckIssues(event.target.checked)} /><span>I reviewed the edited result against both original sources.</span></label></section> : null}
      <label className="review-remember"><input type="checkbox" disabled={busy} checked={ackMatch} onChange={event => setAckMatch(event.target.checked)} /><span>These sources describe the same money movement.</span></label>
      <label className="review-remember"><input type="checkbox" disabled={busy} checked={remember} onChange={event => setRemember(event.target.checked)} /><span>Remember statement category and transfer choices.</span></label>
      </section>
      </div>
      {error ? <p className="form-error" role="alert">{error} Close and refresh the queue if either source changed.</p> : null}
    </div>
    <footer className="statement-row-footer">
      <div id="unified-confirm-requirements" className="unified-confirm-requirements" aria-live="polite">
        {requirements.length ? <>
          <strong>{requirements.length} step{requirements.length === 1 ? "" : "s"} remaining</strong>
          <span className="unified-confirm-requirements__first">{requirements[0]}</span>
          {requirements.length > 1 ? <details><summary>View all steps</summary><ul>{requirements.map(item => <li key={item}>{item}</li>)}</ul></details> : null}
        </> : <span>Ready to record the edited transaction with both sources.</span>}
      </div>
      <div className="statement-actions"><button className="button button--ghost" type="button" disabled={busy} onClick={onCancel}>Cancel</button><button className="button button--primary" type="button" aria-describedby="unified-confirm-requirements" disabled={blocked} onClick={() => void confirm()}>{busy ? "Confirming…" : ledger ? "Link both to existing" : "Record one transaction"}</button></div>
    </footer>
  </ModalDialog>;
}

export function UnifiedReviewWorkspace() {
  const { notify } = useToast();
  const [page, setPage] = useState<UnifiedPendingPage | null>(null);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [settingsReady, setSettingsReady] = useState(false);
  const [settingsError, setSettingsError] = useState("");
  const [settingsEpoch, setSettingsEpoch] = useState(0);
  const [account, setAccount] = useState("");
  const [condition, setCondition] = useState("all");
  const [period, setPeriod] = useState<DatePeriod>(allDates);
  const [search, setSearch] = useState(""), [query, setQuery] = useState("");
  const [cursor, setCursor] = useState("");
  const [cursorHistory, setCursorHistory] = useState<string[]>([]);
  const [epoch, setEpoch] = useState(0);
  const [loading, setLoading] = useState(true), [error, setError] = useState("");
  const [selection, setSelection] = useState<{ statement: string; sms: string } | null>(null);
  const [pair, setPair] = useState<UnifiedPair | null>(null), [pairLoading, setPairLoading] = useState(false);
  const [editPair, setEditPair] = useState<UnifiedPair | null>(null);
  const resetPagination = () => { setCursor(""); setCursorHistory([]); };

  useEffect(() => {
    const token = getAccessToken(); if (!token) return;
    const controller = new AbortController();
    void Promise.all([listAccounts(token), listCategories(token)]).then(([a, c]) => { if (!controller.signal.aborted) { setAccounts(a); setCategories(c); setSettingsReady(true); setSettingsError(""); } }).catch(reason => { if (!controller.signal.aborted) setSettingsError(reason instanceof Error ? reason.message : "Could not load account settings."); });
    return () => controller.abort();
  }, [settingsEpoch]);
  useEffect(() => {
    const token = getAccessToken(); if (!token) return;
    const controller = new AbortController(); setLoading(true); setError("");
    const filters: Record<string, string> = { search: query, limit: "50" };
    if (cursor) filters.cursor = cursor;
    const bounds = periodBounds(period);
    if (bounds.start_date && bounds.end_date) { filters.start_date = bounds.start_date; filters.end_date = bounds.end_date; }
    if (account) filters.account = account;
    if (condition !== "all") filters.condition = condition;
    const timer = setTimeout(() => { void listUnifiedPending(token, filters, controller.signal).then(result => { if (!controller.signal.aborted) setPage(result); }).catch(reason => { if (!controller.signal.aborted) { setPage(null); setError(reason instanceof Error ? reason.message : "Could not load matched sources."); } }).finally(() => { if (!controller.signal.aborted) setLoading(false); }); }, 250);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [account, condition, query, cursor, period, epoch]);
  useEffect(() => {
    setPair(null); setPairLoading(false); if (!selection) return;
    const token = getAccessToken(); if (!token) return;
    const controller = new AbortController(); setPairLoading(true);
    void getUnifiedPair(token, selection.statement, selection.sms, controller.signal).then(result => { if (!controller.signal.aborted) setPair(result); }).catch(reason => { if (!controller.signal.aborted) { notify(reason instanceof Error ? reason.message : "Could not load both sources.", "error"); setSelection(null); setEpoch(value => value + 1); } }).finally(() => { if (!controller.signal.aborted) setPairLoading(false); });
    return () => controller.abort();
  }, [selection, notify]);

  function refresh() { setSelection(null); setPair(null); setPairLoading(false); setEpoch(value => value + 1); }
  function returnToPair() { if (!editPair) return; setSelection({ statement: editPair.row.id, sms: editPair.sms.id }); setEditPair(null); setEpoch(value => value + 1); }
  const showPagination = cursorHistory.length > 0 || Boolean(page?.next_cursor);

  return <div className="workspace-grid"><section className="panel"><div className="panel__body">
    <div className="unified-review-heading"><div><h2 className="section-title">Matched SMS + statement review</h2><p className="section-subtitle">Each row is one unique, independently corroborated movement. Review it once, keep both sources, and count it once.</p></div><button className="button" type="button" disabled={loading} onClick={refresh}>{loading ? "Refreshing…" : "Refresh matches"}</button></div>
    <DatePeriodControls value={period} label="Matched transaction dates" description="Uses the statement transaction date · local timezone" onChange={value => { setPeriod(value); resetPagination(); }} />
    <div className="unified-review-filters"><label className="field"><span className="field__label">Account</span><select className="field__control" value={account} onChange={event => { setAccount(event.target.value); resetPagination(); }}><option value="">All accounts</option>{accounts.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label className="field"><span className="field__label">Review condition</span><select className="field__control" value={condition} onChange={event => { setCondition(event.target.value); resetPagination(); }}><option value="all">All pairs</option><option value="strong">Strong matches</option><option value="possible">Possible matches</option><option value="balance_differs">Balance differs</option><option value="type_differs">Type differs</option><option value="needs_correction">Needs correction</option></select></label><form onSubmit={event => { event.preventDefault(); setQuery(search); resetPagination(); }} className="unified-review-search"><label className="field"><span className="field__label">Search matched sources</span><input className="field__control" type="search" maxLength={255} value={search} onChange={event => setSearch(event.target.value)} /></label><button className="button" type="submit">Search</button></form></div>
    {page ? <><div className="unified-review-overview" aria-label="Pending source overview"><span><strong>{page.overview.matched}</strong> matched</span><span><strong>{page.overview.ambiguous}</strong> ambiguous · <Link href="/statements">review statements</Link> or <Link href="/messages/review">SMS</Link></span><Link href="/statements"><strong>{page.overview.statement_only}</strong> statement-only</Link><Link href="/messages/review"><strong>{page.overview.sms_only}</strong> SMS-only</Link></div><p className="field__hint">Overview counts include all pending sources for the selected dates and account, before the review condition and search.</p></> : null}
    <p className="inline-note">{loading ? "Finding independently corroborated matches…" : `${page?.count ?? 0} matched ${page?.count === 1 ? "item" : "items"}`} · Nothing is added until you confirm.</p>
    {error ? <p className="form-error" role="alert">{error}</p> : null}{settingsError ? <p className="form-error" role="alert">Could not load accounts and categories: {settingsError} <button className="button" type="button" onClick={() => setSettingsEpoch(value => value + 1)}>Retry</button></p> : !settingsReady ? <p role="status">Loading accounts and categories…</p> : null}{pairLoading ? <p role="status">Loading matched sources…</p> : null}
    {!loading && !error && page?.count === 0 ? <div className="unified-review-empty"><h3>{condition === "all" && !query ? "No unique matches found" : "No pairs match these filters"}</h3><p>Ambiguous and unmatched sources stay in their individual review pages.</p><div className="statement-actions"><Link className="button" href="/messages/review">Review SMS</Link><Link className="button" href="/statements">Review statements</Link><button className="button" type="button" onClick={refresh}>Refresh matching</button></div></div> : null}
    <div className="unified-review-list" aria-busy={loading}>{loading && !page ? Array.from({ length: 3 }, (_, index) => <div className="unified-review-skeleton" key={index} />) : page?.results.map(item => <article className="unified-review-item" key={item.id}><div className="unified-review-item__main"><header><strong>{item.statement.account_name}</strong><span className="unified-review-amount">{item.statement.amount === null ? "Amount needed" : `${item.statement.currency} ${item.statement.amount}`} · {item.statement.direction}</span></header><p><time dateTime={`${item.statement.date ?? ""}${item.statement.time ? `T${item.statement.time}` : ""}`}>{formatStatementDateTime(item.statement.date, item.statement.time)}</time></p><div className="unified-review-source-summary"><span><small>Statement</small>{item.statement.description || "No description"}</span><span><small>SMS</small>{item.sms.description || "No description"}</span></div></div><div className="unified-review-item__actions"><div className="unified-review-badges"><span className={`status-badge ${item.match.strength === "strong" ? "status-badge--ok" : "status-badge--idle"}`}>{item.match.strength === "strong" ? "Strong match" : "Review match"}</span>{item.match.conflict ? <span className="status-badge status-badge--warning">Balance differs</span> : null}{item.statement.type !== item.sms.type ? <span className="status-badge status-badge--warning">Type differs</span> : null}{item.needs_correction ? <span className="status-badge status-badge--warning">Needs correction</span> : null}</div><button className="button button--primary" type="button" disabled={loading || pairLoading || !settingsReady} onClick={() => setSelection({ statement: item.statement.id, sms: item.sms.id })}>Review pair</button></div></article>)}</div>
    {showPagination ? <div className="statement-actions unified-review-pagination"><button className="button" type="button" disabled={loading || cursorHistory.length === 0} onClick={() => { const history = cursorHistory.slice(0, -1); setCursor(cursorHistory[cursorHistory.length - 1] ?? ""); setCursorHistory(history); }}>Previous page</button><button className="button" type="button" disabled={loading || !page?.next_cursor} onClick={() => { if (!page?.next_cursor) return; setCursorHistory(history => [...history, cursor]); setCursor(page.next_cursor ?? ""); }}>Next page</button></div> : null}
  </div></section>
  {pair ? <PairDialog key={`${pair.row.id}:${pair.sms.id}:${pair.row.version}`} pair={pair} accounts={accounts} categories={categories} onCancel={() => { setSelection(null); setPair(null); }} onSaved={refresh} onEdit={() => { setEditPair(pair); setSelection(null); setPair(null); }} /> : null}
  {editPair ? <StatementRowDialog editOnly key={editPair.row.id} row={editPair.row} batch={editPair.batch} accounts={accounts} categories={categories} onCancel={returnToPair} onReload={returnToPair} onNext={async () => returnToPair()} onChange={returnToPair} /> : null}
  </div>;
}
