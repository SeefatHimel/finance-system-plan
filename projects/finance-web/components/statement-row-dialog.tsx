"use client";
import { AccountLabel } from "@/components/account-avatar";

import { formatCalendarDate } from "../../finance-contracts/presentation";
import { CalendarDateInput } from "@/components/calendar-date-input";
import { useState, type KeyboardEvent } from "react";
import Link from "next/link";
import { HelpTooltip } from "@/components/help-tooltip";
import { statementDraftCategory, statementSuggestionAlreadyApplied } from "@/lib/statement-draft-category";
import { StatementMatchComparison } from "@/components/statement-match-comparison";
import { StatementDetailChoices } from "@/components/statement-detail-choices";
import { statementAddBlockers, statementLinkBlockReason, reportedBalanceNeedsAcknowledgment } from "@/lib/statement-review";
import { currentStatementBalanceChoice, type StatementBalanceSelection } from "@/lib/statement-balance-choice";
import { selectedStatementDetails, type DetailSelections } from "@/lib/statement-details";
import { displayedStatementText } from "@/lib/statement-citytouch";
import { statementSmsMatchCount, type StatementReviewSection } from "@/lib/statement-row-summary";
import { ModalDialog } from "@/components/modal-dialog";
import { useCategoryTypeChoice } from "@/components/use-category-type-choice";
import { useToast } from "@/components/toast-provider";
import { getAccessToken } from "@/lib/auth-storage";
import { transactionTypes } from "@/lib/category-type";
import { decideStatementRow, updateStatementRow, type Account, type Category, type SavedStatement, type SavedStatementRow, type StatementCategoryChoice, type StatementDecision, type StatementRowEdit, type TransactionType } from "@/lib/api";

function editable(row: SavedStatementRow): StatementRowEdit {
  return { version: row.version, date: row.date, time: row.time, value_date: row.value_date, direction: row.direction, amount: row.amount, balance_after: row.balance_after, type: row.type, other_account: row.other_account, category: row.category, reference: row.reference, counterparty_text: row.counterparty_text, note: row.note, classification_confirmed: row.classification_confirmed };
}

export function StatementRowDialog({ row, batch, accounts, categories, onChange, onCancel, onReload, onNext, onReviewPair, editOnly = false, initialSection = "review" }: {
  editOnly?: boolean; initialSection?: StatementReviewSection; row: SavedStatementRow; batch: SavedStatement; accounts: Account[]; categories: Category[];
  onChange: (row: SavedStatementRow, close: boolean) => void; onCancel: () => void; onReload: () => void; onNext: () => Promise<void>;
  onReviewPair?: (statement: string, sms: string) => Promise<void>;
}) {
  const { notify, dismiss } = useToast();
  const categoryChoice = useCategoryTypeChoice(categories);
  const [draft, setDraft] = useState(() => ({ ...editable(row), category: row.transaction || row.state === "skipped" ? row.category : row.category ?? statementDraftCategory(row.type, null, categories) }));
  const [rememberChoices, setRememberChoices] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ackIssues, setAckIssues] = useState(false);
  const [balanceSelections, setBalanceSelections] = useState<Record<string, StatementBalanceSelection>>({});
  const [categorySelections, setCategorySelections] = useState<Record<string, { version: number; choice: StatementCategoryChoice }>>({});
  const [detailSelections, setDetailSelections] = useState<Record<string, { version: number; values: DetailSelections }>>({});
  const [confirmSeparate, setConfirmSeparate] = useState(false);
  const [confirmUnlink, setConfirmUnlink] = useState(false);
  const [verifiedSms, setVerifiedSms] = useState<string | null>(null);
  const [distinctLedgerMatches, setDistinctLedgerMatches] = useState(false);
  const isResolved = Boolean(row.transaction) || row.state === "skipped";
  const dirty = JSON.stringify(draft) !== JSON.stringify(editable(row));
  const addBlockers = statementAddBlockers({
    dirty, issues: row.review.issues, pendingSmsMatchCount: row.review.pending_sms_match_count,
    unifiedPendingSmsStatus: row.review.unified_pending_sms_status,
    requiresAcknowledgement: row.review.requires_acknowledgement,
    issuesAcknowledged: ackIssues, classificationConfirmed: draft.classification_confirmed,
  });
  const source = row.extracted;
  const verifiedDirection = row.reviewed_source_direction || source.direction;
  const bkashFundingSuggestion = batch.profile === "bkash" && row.component === "principal" && /^(?:card|bank)\s+to\s+bkash$/i.test(source.provider_type?.trim() ?? "") && row.review.suggestion?.type === "transfer" ? row.review.suggestion : null;
  const suggestedName = row.review.suggestion?.counterparty_text;
  const suggestedNote = row.review.suggestion?.note;
  const suggestionApplied = row.review.suggestion ? statementSuggestionAlreadyApplied(draft, row.review.suggestion, categories) : false;
  const suggestionSaved = row.review.suggestion ? statementSuggestionAlreadyApplied(editable(row), row.review.suggestion, categories) : false;
  function setField<K extends keyof StatementRowEdit>(key: K, value: StatementRowEdit[K]) { setDraft((old) => ({ ...old, [key]: value })); }
  function applyType(type: TransactionType, category = type === draft.type ? draft.category : statementDraftCategory(type, draft.category, categories)) {
    setDraft((old) => ({ ...old, category, type, other_account: type === "transfer" ? old.other_account : null, classification_confirmed: old.type === type ? old.classification_confirmed : false }));
  }
  function showError(reason: unknown) {
    const message = reason instanceof Error ? reason.message : "Could not save the statement row.";
    setError(message); notify(message, "error");
  }
  async function save(next = false) {
    const token = getAccessToken(); if (!token || busy || !dirty || isResolved) return;
    setBusy(true); setError(null);
    try {
      const result = await updateStatementRow(token, row.id, draft);
      setDraft(editable(result)); setAckIssues(false); setBalanceSelections({}); setCategorySelections({}); setDetailSelections({}); setDistinctLedgerMatches(false);
      onChange(result, false); if (next) await onNext(); notify("Draft saved. Match suggestions refreshed; no ledger changes yet.");
    } catch (reason) { showError(reason); } finally { setBusy(false); }
  }
  async function advance() {
    if (busy || dirty) return;
    setBusy(true);
    try { await onNext(); } finally { setBusy(false); }
  }
  async function decide(action: StatementDecision["action"], transaction?: string, separate = false, amountCorrection?: StatementDecision["amount_correction"]) {
    if (action === "combine_sms") return;
    const token = getAccessToken(); if (!token || busy) return;
    const match = row.review.matches.find((item) => item.id === transaction);
    const balanceChoice = match && !match.late_posting ? currentStatementBalanceChoice(balanceSelections[match.id], match, row.balance_after, row.version, batch.currency) : undefined;
    const categorySelection = match && categorySelections[match.id];
    const categoryChoice = match && categorySelection?.version === row.version
      && categorySelection.choice.existing_category === match.category_id
      && categorySelection.choice.statement_category === row.category
      ? categorySelection.choice : undefined;
    const categoryConflict = Boolean(match && row.category !== null && row.category !== match.category_id);
    const categoryChosen = Boolean(categoryChoice && (categoryChoice.keep !== "custom" || categoryChoice.category !== undefined));
    const selections = match && detailSelections[match.id]?.version === row.version ? detailSelections[match.id].values : {};
    const detailResult = match ? selectedStatementDetails(match.detail_suggestions, selections) : { choices: [], error: null };
    if (action === "link") {
      const blocked = match ? detailResult.error ?? statementLinkBlockReason({ dirty, canLink: match.can_link, requiresAcknowledgement: row.review.requires_acknowledgement, issuesAcknowledged: ackIssues, conflict: match.conflict, balanceChosen: Boolean(balanceChoice), categoryConflict, categoryChosen }) : "Refresh the match suggestions.";
      if (blocked) { showError(new Error(blocked)); return; }
    }
    setBusy(true); setError(null);
    try {
      const result = await decideStatementRow(token, row.id, { action, version: row.version, transaction, remember_choices: rememberChoices, allow_separate: separate, acknowledge_issues: ackIssues, acknowledge_conflict: Boolean(balanceChoice), balance_choice: action === "link" ? balanceChoice : undefined, amount_correction: action === "link" ? amountCorrection : undefined, category_choice: action === "link" ? categoryChoice : undefined, detail_choices: action === "link" ? detailResult.choices : undefined });
      onChange(result, true);
      const messages = { create: "Transaction added from the statement.", link: "Statement evidence linked. The transaction is counted once.", skip: "Statement row skipped.", unlink: "Statement evidence unlinked. The ledger transaction was kept.", reopen: "Skipped row reopened for review." };
      notify(messages[action]);
    } catch (reason) { showError(reason); } finally { setBusy(false); setConfirmSeparate(false); setConfirmUnlink(false); }
  }
  async function combineSms(candidateId: string) {
    const token = getAccessToken(); if (!token || busy || dirty) return;
    const match = row.review.pending_sms_matches.find((item) => item.id === candidateId);
    if (!match || verifiedSms !== candidateId) return;
    if (row.review.matches.length && !distinctLedgerMatches) { showError(new Error("Compare the ledger suggestions and confirm they are different movements first.")); return; }
    if (row.review.issues.length || (row.review.requires_acknowledgement && !ackIssues)) {
      showError(new Error("Resolve the statement issues and acknowledge source discrepancies first.")); return;
    }
    const balanceChoice = match.late_posting ? undefined : currentStatementBalanceChoice(
      balanceSelections[candidateId], { effective_balance_after: match.balance_after }, row.balance_after, row.version, batch.currency,
    );
    const selections = detailSelections[candidateId]?.version === row.version ? detailSelections[candidateId].values : {};
    const details = selectedStatementDetails(match.detail_suggestions, selections);
    if (details.error) { showError(new Error(details.error)); return; }
    if (!match.late_posting && match.balance_after !== null && row.balance_after !== null && match.balance_after !== row.balance_after && !balanceChoice) {
      showError(new Error("Choose which reported balance to keep.")); return;
    }
    setBusy(true); setError(null);
    try {
      const result = await decideStatementRow(token, row.id, {
        action: "combine_sms", version: row.version, candidate: candidateId,
        dismissed_ledger_matches: row.review.matches.map((item) => item.id),
        acknowledge_distinct_ledger_matches: distinctLedgerMatches,
        acknowledge_issues: ackIssues, remember_choices: rememberChoices,
        balance_choice: balanceChoice,
        detail_choices: details.choices,
      });
      onChange(result, true);
      notify("SMS and statement reviewed together. One transaction was added.");
    } catch (reason) { showError(reason); } finally { setBusy(false); }
  }
  function handleShortcuts(event: KeyboardEvent<HTMLElement>) {
    if (!event.altKey || busy || confirmSeparate || confirmUnlink) return;
    if (event.key.toLowerCase() === "s" && !isResolved && dirty) { event.preventDefault(); void save(!editOnly && event.shiftKey); }
    if (!editOnly && event.key === "ArrowRight") { event.preventDefault(); if (dirty) showError(new Error("Save your changes before moving to the next row.")); else void advance(); }
  }
  async function reviewPair() {
    if (!onReviewPair || !row.review.unified_pending_sms_pair_id || busy || dirty) return;
    setBusy(true);
    try { await onReviewPair(row.id, row.review.unified_pending_sms_pair_id); }
    finally { setBusy(false); }
  }
  return <>
    <ModalDialog labelledBy="statement-row-title" initialFocus={initialSection === "description" ? "#statement-source-details" : initialSection === "matches" ? "#statement-match-overview" : undefined} className="form-drawer statement-row-dialog" busy={busy} onCancel={onCancel}>
      <div className="form-drawer__header"><div><h2 id="statement-row-title">Review statement {row.component === "fee" ? "fee" : "transaction"}</h2><p><AccountLabel account={accounts.find(account => account.id === batch.account)} fallback={batch.account_name} /> · Page {source.page}, source row {source.row}</p></div><button type="button" className="icon-button" aria-label="Close statement row" disabled={busy} onClick={onCancel}>×</button></div>
      <div className="statement-row-body" onKeyDown={handleShortcuts}>
        <details id="statement-source-details" tabIndex={-1} className="raw-message statement-source-details" open={initialSection === "description" || batch.profile === "ebl_credit_card" ? true : undefined} onFocus={event => { if (event.target === event.currentTarget) event.currentTarget.scrollIntoView({ block: "start" }); }}><summary>Original extracted row · {source.amount ?? "Unreadable amount"} {batch.currency}</summary>
          {row.counterparty_text ? <p><strong>Saved counterparty:</strong> {row.counterparty_text}</p> : null}
          {row.note ? <p><strong>Saved note:</strong> {row.note}</p> : null}
          {row.reference ? <p><strong>Reference:</strong> {row.reference}</p> : null}
          <p>{source.date ?? "Unknown date"}{source.time ? ` · ${source.time}` : ""} · {source.provider_type || "Unknown source type"} · Original parser direction: {source.direction === "credit" ? "Credit" : source.direction === "debit" ? "Debit" : "Unknown"}{row.reviewed_source_direction ? ` · Reviewed PDF direction: ${row.reviewed_source_direction}` : ""}</p>
          <p className="statement-evidence-text">{source.description}</p>
          {row.citytouch_printed_code ? <p>Citytouch code printed in PDF: {row.citytouch_printed_code}</p> : null}
          {source.printed_direction_marker ? <p>Printed card column: {source.printed_direction_marker === "D" ? "D · debit charge" : "C · credit payment or adjustment"} · Source: {source.source_currency} {source.source_amount} · Settlement: {source.settlement_currency} {source.amount} · Statement date: {source.statement_date}</p> : null}
          <p>Principal: {source.amount ?? "Unreadable"} · Signed fee: {source.signed_fee} · Reported balance after this row: {source.balance_after ?? (batch.profile === "ebl_credit_card" ? "Not printed on card statement" : "Unreadable")}</p>
          {source.value_date ? <p>Printed value date: {source.value_date}</p> : null}
          {source.issues.length ? <ul>{source.issues.map((issue) => <li key={issue}>{issue}</li>)}</ul> : null}
          <p className="inline-note">This masked extraction stays unchanged as source evidence. Corrections below apply to the draft.</p>
        </details>
        {batch.profile === "ebl_credit_card" ? <p className="inline-note">The printed monthly outstanding is checked against all card movements. This PDF does not report a balance after each row. {source.provider_type === "Card payment" ? "This payment credit starts as a transfer; choose the account that paid the card." : source.provider_type === "Cash back" ? "This cash-back credit starts as Interest & Rewards income when that category is available." : "Check the printed card direction and choose the correct classification before adding."}</p> : null}
        {batch.profile === "city_bank" && /\bCT-FT-/i.test(source.description) ? <p className="inline-note">Citytouch fund transfer describes the bank operation. Verify whether this is an internal transfer or a payment. <Link href="/statement-counterparties">Manage recurring counterparty codes</Link>.</p> : null}
        {row.component === "fee" ? <p className="inline-note">This is the separate charge from the source row. Approving the principal does not approve this fee.</p> : source.signed_fee !== "0.00" ? <p className="inline-note">The inline fee has its own review row. The final reported balance is saved on the fee entry when you add new movements.</p> : null}
        {isResolved ? <p>This row is {row.state === "posted" ? "added" : row.state}. {row.transaction ? <>Ledger entry: {row.transaction}. Make ledger corrections in <Link href="/transactions">Transactions</Link>.</> : "You can reopen it below."}</p> : null}
        {row.component === "principal" && verifiedDirection !== row.direction ? <p className="inline-note" role="alert">The saved draft records {row.direction}, but the {row.reviewed_source_direction ? "reviewed PDF direction" : "original PDF extraction"} records {verifiedDirection}. Check the original PDF before linking or changing the ledger entry.</p> : null}
        {!row.transaction && ["posted", "linked"].includes(row.state) ? <p>The previous ledger entry was deleted. Review this source row before recording it again.</p> : null}
        {!isResolved && row.review.suggestion && !bkashFundingSuggestion ? (
          <section className="raw-message">
            <strong>Suggested choices</strong>
            <p>{row.review.suggestion.reason}</p>
            <p>{row.review.suggestion.type} · {categories.find(c => c.id === row.review.suggestion?.category)?.name ?? "Uncategorized"}{row.review.suggestion.other_account ? ` · ${accounts.find(a => a.id === row.review.suggestion?.other_account)?.name ?? "Other account"}` : ""}{suggestedName ? ` · ${suggestedName}` : ""}</p>
            {suggestionApplied ? (
              <span className="status-badge status-badge--ok" role="status">{suggestionSaved ? "Applied" : "Applied to draft · save to keep"}</span>
            ) : (
              <button className="button" type="button" disabled={busy || dirty} onClick={() => {
                const choice = row.review.suggestion;
                if (!choice) return;
                setDraft(old => ({
                  ...old,
                  type: choice.type,
                  category: statementDraftCategory(choice.type, choice.category, categories),
                  other_account: choice.other_account,
                  counterparty_text: choice.counterparty_text ?? old.counterparty_text,
                  classification_confirmed: old.type === choice.type && old.other_account === choice.other_account ? old.classification_confirmed : false,
                }));
              }}>Apply suggested choices</button>
            )}
          </section>
        ) : null}
        <form onSubmit={(event) => { event.preventDefault(); void save(); }}>
          <fieldset className="statement-edit-fields statement-draft-fields" disabled={busy || isResolved}>
            <legend className="visually-hidden">Transaction draft</legend>
            <label className="field"><span className="field__label">Amount ({batch.currency})</span><input className="field__control" type="number" min="0.01" max="999999999999.99" step="0.01" value={draft.amount ?? ""} onChange={(e) => setField("amount", e.target.value || null)} /></label>
            <div className="field field--wide"><label className="field__label" htmlFor="statement-note">Note</label><textarea id="statement-note" className="field__control" maxLength={4000} rows={3} value={draft.note} onChange={(e) => setField("note", e.target.value)} />{suggestedNote && suggestedNote !== draft.note ? <button className="unified-suggestion" type="button" onClick={() => setField("note", suggestedNote)}>Use suggested note: {suggestedNote}</button> : null}</div>
            <div className="statement-draft-datetime">
            <label className="field"><span className="field__label">Date</span><CalendarDateInput value={draft.date} onChange={value => setField("date", value || null)} /></label>
            <label className="field"><span className="field__label">Time (if known)</span><input className="field__control" type="time" step="1" value={draft.time ?? ""} onChange={(e) => setField("time", e.target.value || null)} /></label>
            </div>
            <div className="field"><label className="field__label" htmlFor="statement-draft-type">Type</label><select id="statement-draft-type" className="field__control" value={draft.type} onChange={(e) => applyType(e.target.value as TransactionType)}>{transactionTypes.map((type) => <option key={type} value={type}>{type.replaceAll("_", " ")}</option>)}</select></div>
            <div className="field"><label className="field__label" htmlFor="statement-draft-direction">Debit / credit for {batch.account_name}</label><select id="statement-draft-direction" className="field__control" value={draft.direction} onChange={(e) => setField("direction", e.target.value as "debit" | "credit")}><option value="debit">Debit</option><option value="credit">Credit</option></select><small className="field__hint">Changing type or category keeps this direction. Check the original PDF before changing it.</small></div>
            {row.component === "principal" && verifiedDirection !== draft.direction ? <p className="form-error field--wide" role="alert">The {row.reviewed_source_direction ? "reviewed PDF direction" : "original PDF extraction"} says {verifiedDirection}, while this draft says {draft.direction}. Verify the Out/In column and balance in the PDF before saving. If the original extraction is wrong, recheck the archived PDF in Statement details.</p> : null}
            {draft.type === "transfer" ? <div className="field">
              <label className="field__label" htmlFor="statement-other-account">Other owned account</label>
              <select id="statement-other-account" className="field__control" value={draft.other_account ?? ""} onChange={(e) => setField("other_account", e.target.value || null)}><option value="">Choose the other account</option>{accounts.filter((a) => a.id !== batch.account && a.is_active && a.currency === batch.currency).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select>
              {!isResolved && bkashFundingSuggestion ? <div className="statement-funding-help"><span>Choose the exact funding account</span><HelpTooltip label="About the funding account">{bkashFundingSuggestion.reason}</HelpTooltip></div> : null}
              {!isResolved && bkashFundingSuggestion?.other_account && draft.other_account !== bkashFundingSuggestion.other_account ? <button className="button button--ghost" type="button" onClick={() => setDraft(old => ({ ...old, other_account: bkashFundingSuggestion.other_account, classification_confirmed: false }))}>Use matched funding account</button> : null}
              {!isResolved && bkashFundingSuggestion?.account_candidates?.length ? <details className="statement-funding-options"><summary>Suggested funding accounts ({bkashFundingSuggestion.account_candidates.length})</summary><div className="statement-funding-buttons">{bkashFundingSuggestion.account_candidates.map(candidate => <button className="button button--ghost" key={candidate.account} type="button" aria-pressed={draft.other_account === candidate.account} onClick={() => setDraft(old => ({ ...old, other_account: candidate.account, classification_confirmed: false }))}>{candidate.name}</button>)}</div></details> : null}
            </div> : null}
            {!isResolved && bkashFundingSuggestion && draft.type !== "transfer" ? <div className="field"><button className="button" type="button" onClick={() => setDraft(old => ({ ...old, type: "transfer", category: statementDraftCategory("transfer", null, categories), other_account: bkashFundingSuggestion.other_account, classification_confirmed: false }))}>Use suggested transfer</button><HelpTooltip label="Why a transfer is suggested">{bkashFundingSuggestion.reason}</HelpTooltip></div> : null}
            <div className="field"><label className="field__label" htmlFor="statement-draft-category">Category</label><select id="statement-draft-category" className="field__control" value={draft.category ?? ""} onChange={(e) => categoryChoice.choose(e.target.value, draft.type, (id, type) => applyType(type, id || null))}><option value="">Uncategorized</option>{categories.filter((c) => c.is_active).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>{!row.category && draft.type === "transfer" && draft.category ? <small className="field__hint">Suggested transfer category · save draft to apply</small> : null}</div>
            <label className="field"><span className="field__label">Reported final balance after</span><input className="field__control" type="number" step="0.01" value={draft.balance_after ?? ""} onChange={(e) => setField("balance_after", e.target.value || null)} /></label>
            <div className="field"><label className="field__label" htmlFor="statement-counterparty">Counterparty</label><input id="statement-counterparty" className="field__control" maxLength={255} value={draft.counterparty_text} onChange={(e) => setField("counterparty_text", e.target.value)} />{suggestedName && suggestedName !== draft.counterparty_text ? <button className="unified-suggestion" type="button" onClick={() => setField("counterparty_text", suggestedName)}>Use verified name: {suggestedName}</button> : null}</div>
            <details className="statement-draft-more field--wide"><summary>More details <span>Reference, value date{draft.reference || draft.value_date ? " · contains saved values" : ""}</span></summary><div className="statement-draft-extra">
            <label className="field"><span className="field__label">Value date (if printed)</span><CalendarDateInput value={draft.value_date} onChange={value => setField("value_date", value || null)} /></label>
            <label className="field"><span className="field__label">Reference</span><input className="field__control" maxLength={120} value={draft.reference} onChange={(e) => setField("reference", e.target.value)} /></label>
            </div></details>
            <label className="review-remember field--wide"><input type="checkbox" checked={draft.classification_confirmed} onChange={(e) => setField("classification_confirmed", e.target.checked)} /><span>Reviewed transaction type <small className="statement-choice-help">Confirm whether this involves your own accounts; this checkbox does not change the type.</small></span></label>
          </fieldset>
          {draft.type === "transfer" ? <p className="account-path">Transfer path: <AccountLabel account={accounts.find(account => account.id === (draft.direction === "credit" ? draft.other_account : batch.account))} fallback="From account" /><span aria-label="to">→</span><AccountLabel account={accounts.find(account => account.id === (draft.direction === "credit" ? batch.account : draft.other_account))} fallback="To account" /></p> : null}
          {!editOnly && !isResolved ? <div className="statement-actions"><button className="button" type="submit" disabled={busy || !dirty}>Save draft & refresh matches</button><button className="button" type="button" disabled={busy || !dirty} onClick={() => void save(true)}>Save & next</button></div> : null}
        </form>
        <p className="inline-note">{editOnly ? "Alt+S saves the draft and returns to comparison." : "Shortcuts: Alt+S saves; Alt+Shift+S saves and moves next; Alt+Right opens the next unresolved row."}</p>
        {!editOnly && !isResolved ? <label className="review-remember"><input type="checkbox" checked={rememberChoices} disabled={busy} onChange={e => setRememberChoices(e.target.checked)} /><span>Remember these choices <small className="statement-choice-help">Suggest this category, transfer choice and edited note for similar rows after I add or link.</small></span></label> : null}
        {!editOnly && !isResolved ? <section id="statement-match-overview" className="statement-match-overview" tabIndex={-1} onFocus={event => { if (event.target === event.currentTarget) event.currentTarget.scrollIntoView({ block: "start" }); }} aria-label="Matches and review notes"><h3>Matches and review notes</h3><p>{row.review.matches.length}{row.review.matching_truncated ? "+" : ""} ledger suggestion{row.review.matches.length === 1 && !row.review.matching_truncated ? "" : "s"} · {statementSmsMatchCount(row) === null ? "SMS check unavailable" : `${statementSmsMatchCount(row)} pending SMS suggestion${statementSmsMatchCount(row) === 1 ? "" : "s"}`}. Compare the full source values below before accepting a match.</p></section> : null}
        {row.review.draft_issues.length ? <section className="raw-message"><strong>Saved draft reconciliation</strong><ul>{row.review.draft_issues.map(issue => <li key={issue}>{issue}</li>)}</ul><p>Original extraction checks remain unchanged.</p></section> : null}
        {dirty ? <p className="inline-note">Save your draft changes before accepting a match or adding the transaction.</p> : null}
        {row.review.issues.length ? <ul className="statement-error">{row.review.issues.map((issue) => <li key={issue}>{issue}</li>)}</ul> : null}
        {!editOnly && !isResolved && row.review.pending_sms_match_count === null ? <p className="form-warning" role="status">The pending SMS queue is too large to verify matches for this row. <Link href="/messages/review">Review pending SMS</Link>, then reopen this row before adding it.</p> : null}
        {!editOnly && !isResolved && row.review.unified_pending_sms_pair_id ? <div className="inline-note"><p>A unique SMS + statement pair is ready, including when parsed types differ.</p>{onReviewPair ? <button className="button button--small" type="button" disabled={busy || dirty} onClick={() => void reviewPair()}>{busy ? "Opening both sources…" : "Review both sources once"}</button> : <Link href={`/review?statement=${encodeURIComponent(row.id)}&sms=${encodeURIComponent(row.review.unified_pending_sms_pair_id)}`}>Review both sources once</Link>}<p>To record a different movement here, choose Add as separate below.</p></div> : null}
        {!editOnly && !isResolved && row.review.unified_pending_sms_status === "ambiguous" ? <p className="form-warning" role="status">Several pending sources could describe this movement. Compare them in <Link href="/review">Unified review</Link> and <Link href="/messages/review">SMS review</Link>; adding this row requires explicit separate-movement confirmation.</p> : null}
        {!editOnly && !isResolved && row.review.unified_pending_sms_status === "unavailable" ? <p className="form-warning" role="status">The pending queue is too large to verify unified pairing safely. Resolve other pending sources before adding this row.</p> : null}
        {!editOnly && row.review.requires_acknowledgement && !isResolved ? <label className="review-remember"><input type="checkbox" checked={ackIssues} disabled={busy || dirty} onChange={(e) => setAckIssues(e.target.checked)} /><span>I reviewed the source and saved draft discrepancies and confirm the values being recorded.</span></label> : null}
        {!editOnly && !isResolved && row.review.pending_sms_matches.length ? <section className="statement-matches" aria-labelledby="pending-sms-matches-title">
          <h3 id="pending-sms-matches-title">Pending SMS for this statement row</h3>
          <p className="inline-note">Review the same movement across both sources. This creates one SMS-dated transaction and links the statement; either queue can still be reviewed separately.</p>
          {row.review.matches.length ? <div className="raw-message"><strong>Existing ledger suggestions also need a decision</strong><p>Compare each ledger entry in the Possible matches section below before combining the SMS and statement.</p><ul>{row.review.matches.map((item) => <li key={item.id}>{formatCalendarDate(item.date)} · {item.amount} · {item.note || item.reference || item.source}</li>)}</ul><label className="review-remember"><input type="checkbox" checked={distinctLedgerMatches} disabled={busy || dirty} onChange={(event) => setDistinctLedgerMatches(event.target.checked)} /><span>I compared every listed ledger entry and confirmed each is a different movement.</span></label></div> : null}
          <div className="statement-match-list">{row.review.pending_sms_matches.map((match) => {
            const conflict = !match.late_posting && reportedBalanceNeedsAcknowledgment(match.balance_after, row.balance_after, batch.currency);
            const choice = match.late_posting ? undefined : currentStatementBalanceChoice(balanceSelections[match.id], { effective_balance_after: match.balance_after }, row.balance_after, row.version, batch.currency);
            return <article className="statement-match-card" key={match.id}>
              <header className="statement-match-heading"><h4>Pending SMS · {match.sender}</h4><span>{batch.currency} {match.amount}</span></header>
              <div className="statement-match-comparison">
                <section><h5>Statement</h5><p>{formatCalendarDate(row.date)}{row.time ? ` · ${row.time}` : ""}</p><p>{displayedStatementText(row.counterparty_text || source.description, source.description, row.citytouch_printed_code)}</p><p>Balance after: {row.balance_after ?? "Not reported"}</p></section>
                <section><h5>SMS</h5><p>{formatCalendarDate(match.date)} · {match.time}</p><p>{match.counterparty_text || "No counterparty parsed"}</p><p>Balance after: {match.balance_after ?? "Not reported"}</p><p>Parser confidence: {Math.round(Number(match.confidence) * 100)}%</p></section>
              </div>
              {match.late_posting ? <p className="inline-note" role="status">EBL posted this entry after its value date. The SMS balance belongs to the earlier transaction time; the statement balance belongs to posting order. Both reports stay attached. {match.balance_after !== null ? "The SMS balance remains in the ledger." : "The transaction-time balance stays unknown because the SMS did not report it."}</p> : null}
              {match.sms_text ? <details className="raw-message"><summary>Original SMS</summary><p className="statement-evidence-text">{match.sms_text}</p></details> : null}
              {conflict ? <fieldset className="statement-match-conflict" disabled={busy || dirty}>
                <legend>Which reported balance should this transaction use?</legend>
                {choice && !balanceSelections[match.id] ? <p>The higher balance is selected initially for a difference under BDT 1. You can choose the other.</p> : null}
                <div className="statement-balance-options">
                  <label><input type="radio" name={`pending-sms-balance-${match.id}`} checked={choice?.keep === "existing"} onChange={() => setBalanceSelections((old) => ({ ...old, [match.id]: { keep: "existing", version: row.version, existing_balance_after: match.balance_after, statement_balance_after: row.balance_after } }))} /><span>Keep SMS balance<strong>{match.balance_after}</strong></span></label>
                  <label><input type="radio" name={`pending-sms-balance-${match.id}`} checked={choice?.keep === "statement"} onChange={() => setBalanceSelections((old) => ({ ...old, [match.id]: { keep: "statement", version: row.version, existing_balance_after: match.balance_after, statement_balance_after: row.balance_after } }))} /><span>Use statement balance<strong>{row.balance_after}</strong></span></label>
                </div>
              </fieldset> : null}
              <StatementDetailChoices matchId={match.id} suggestions={match.detail_suggestions} selections={detailSelections[match.id]?.version === row.version ? detailSelections[match.id].values : {}} disabled={busy || dirty} onChange={(values) => setDetailSelections((old) => ({ ...old, [match.id]: { version: row.version, values } }))} />
              <label className="review-remember"><input type="checkbox" checked={verifiedSms === match.id} disabled={busy || dirty} onChange={(event) => setVerifiedSms(event.target.checked ? match.id : null)} /><span>I verified these are the same movement.</span></label>
              <button className="button button--primary" type="button" disabled={busy || dirty || verifiedSms !== match.id || (row.review.matches.length > 0 && !distinctLedgerMatches) || row.review.issues.length > 0 || (row.review.requires_acknowledgement && !ackIssues) || (conflict && !choice)} onClick={() => void combineSms(match.id)}>Review both · count once</button>
            </article>;
          })}</div>
        </section> : null}
        {!editOnly && !isResolved && row.review.matches.length ? <section className="statement-matches" aria-labelledby="statement-matches-title">
          <h3 id="statement-matches-title">Possible matches</h3>
          <p className="inline-note">Compare the same movement. Linking counts it once; selected balance and detail changes are reviewed before acceptance.</p>
          <div className="statement-match-list">{row.review.matches.map((match) => <StatementMatchComparison key={match.id}
            row={row} batch={batch} match={match} accounts={accounts} categories={categories}
            busy={busy} dirty={dirty} issuesAcknowledged={ackIssues}
            balanceChoice={match.late_posting ? undefined : currentStatementBalanceChoice(balanceSelections[match.id], match, row.balance_after, row.version, batch.currency)}
            balanceAutoSelected={balanceSelections[match.id] === undefined}
            categoryChoice={categorySelections[match.id]?.version === row.version && categorySelections[match.id]?.choice.existing_category === match.category_id && categorySelections[match.id]?.choice.statement_category === row.category ? categorySelections[match.id]?.choice : undefined}
            detailSelections={detailSelections[match.id]?.version === row.version ? detailSelections[match.id].values : {}}
            onBalanceChoice={(keep) => setBalanceSelections((old) => ({ ...old, [match.id]: { keep, version: row.version, existing_balance_after: match.effective_balance_after, statement_balance_after: row.balance_after } }))}
            onCategoryChoice={(choice) => setCategorySelections((old) => ({ ...old, [match.id]: { version: row.version, choice } }))}
            onDetailChange={(values) => setDetailSelections((old) => ({ ...old, [match.id]: { version: row.version, values } }))}
            onAccept={() => void decide("link", match.id, false, match.rounding_correction ? { existing_amount: match.rounding_correction.existing_amount, statement_amount: match.rounding_correction.statement_amount, transaction_updated_at: match.rounding_correction.transaction_updated_at } : undefined)} />)}</div>
        </section> : null}
        {error ? <div><p role="alert" className="form-error">{error}</p><button className="button" type="button" disabled={busy} onClick={() => { dismiss(); setDraft(editable(row)); setBalanceSelections({}); setCategorySelections({}); setDetailSelections({}); setAckIssues(false); setDistinctLedgerMatches(false); setError(null); onReload(); }}>Reload row · discard unsaved changes</button></div> : null}
      </div>
      <footer className="statement-row-footer" onKeyDown={handleShortcuts}>
        {!editOnly && !isResolved && addBlockers.length ? <div className="statement-add-status" id="statement-add-status" role="status">
          <strong>{addBlockers.length === 1 ? "To add this transaction:" : "Before adding this transaction:"}</strong>
          <ul>{addBlockers.map((reason) => <li key={reason}>{reason}</li>)}</ul>
        </div> : dirty ? <p className="inline-note" role="status">Save draft changes before deciding.</p> : null}
        {error ? <p className="form-error statement-footer-error">{error}</p> : null}
        <div className="statement-actions">
          <button className="button button--ghost" type="button" disabled={busy} onClick={onCancel}>{editOnly ? "Back to comparison" : "Close"}</button>{editOnly ? <button className="button button--primary" type="button" disabled={busy || !dirty || isResolved} onClick={() => void save()}>Save draft & compare</button> : <button className="button" type="button" disabled={busy || dirty} onClick={() => void advance()}>Next unresolved row</button>}
          {!editOnly && !isResolved ? <><button className="button" type="button" disabled={busy || dirty} onClick={() => void decide("skip")}>Skip this row</button><button className="button button--primary" type="button" disabled={busy || addBlockers.length > 0} aria-describedby={addBlockers.length ? "statement-add-status" : undefined} onClick={() => (row.review.matches.length || row.review.pending_sms_matches.length || row.review.unified_pending_sms_status === "unique" || row.review.unified_pending_sms_status === "ambiguous") ? setConfirmSeparate(true) : void decide("create")}>{busy ? "Working…" : `Add ${row.component === "fee" ? "fee" : "transaction"}${(row.review.matches.length || row.review.pending_sms_matches.length || row.review.unified_pending_sms_status === "unique" || row.review.unified_pending_sms_status === "ambiguous") ? " as separate" : ""}`}</button></> : !editOnly && row.transaction ? <button className="button" type="button" disabled={busy} onClick={() => setConfirmUnlink(true)}>Unlink statement evidence</button> : !editOnly && isResolved ? <button className="button" type="button" disabled={busy} onClick={() => void decide("reopen")}>Reopen skipped row</button> : null}
        </div>
      </footer>
    </ModalDialog>
    {categoryChoice.confirmation}
    {confirmSeparate ? <ModalDialog labelledBy="statement-separate-title" busy={busy} onCancel={() => setConfirmSeparate(false)}><h2 id="statement-separate-title">Add a separate movement?</h2><p>A ledger entry or pending SMS may describe this row. Continue only if you have checked that this is another transaction, such as a genuine repeat purchase.</p><div className="decision-modal__actions"><button className="button" type="button" disabled={busy} onClick={() => setConfirmSeparate(false)}>Back to matches</button><button className="button button--primary" type="button" disabled={busy} onClick={() => void decide("create", undefined, true)}>Confirm separate movement</button></div></ModalDialog> : null}
    {confirmUnlink ? <ModalDialog labelledBy="statement-unlink-title" busy={busy} onCancel={() => setConfirmUnlink(false)}><h2 id="statement-unlink-title">Unlink this evidence?</h2><p>The transaction stays in your ledger. This row returns to review, where it may suggest that transaction again.</p><div className="decision-modal__actions"><button className="button" type="button" disabled={busy} onClick={() => setConfirmUnlink(false)}>Cancel</button><button className="button button--primary" type="button" disabled={busy} onClick={() => void decide("unlink")}>Unlink evidence only</button></div></ModalDialog> : null}
  </>;
}
