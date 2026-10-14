"use client";

import { useState, type KeyboardEvent } from "react";
import Link from "next/link";
import { StatementMatchComparison } from "@/components/statement-match-comparison";
import { StatementDetailChoices } from "@/components/statement-detail-choices";
import { statementLinkBlockReason } from "@/lib/statement-review";
import { currentStatementBalanceChoice, type StatementBalanceSelection } from "@/lib/statement-balance-choice";
import { selectedStatementDetails, type DetailSelections } from "@/lib/statement-details";
import { ModalDialog } from "@/components/modal-dialog";
import { useCategoryTypeChoice } from "@/components/use-category-type-choice";
import { useToast } from "@/components/toast-provider";
import { getAccessToken } from "@/lib/auth-storage";
import { directionForType, transactionTypes } from "@/lib/category-type";
import { decideStatementRow, updateStatementRow, type Account, type Category, type SavedStatement, type SavedStatementRow, type StatementDecision, type StatementRowEdit, type TransactionType } from "@/lib/api";

function editable(row: SavedStatementRow): StatementRowEdit {
  return { version: row.version, date: row.date, time: row.time, value_date: row.value_date, direction: row.direction, amount: row.amount, balance_after: row.balance_after, type: row.type, other_account: row.other_account, category: row.category, reference: row.reference, counterparty_text: row.counterparty_text, note: row.note, classification_confirmed: row.classification_confirmed };
}

export function StatementRowDialog({ row, batch, accounts, categories, onChange, onCancel, onReload, onNext, editOnly = false }: {
  editOnly?: boolean; row: SavedStatementRow; batch: SavedStatement; accounts: Account[]; categories: Category[];
  onChange: (row: SavedStatementRow, close: boolean) => void; onCancel: () => void; onReload: () => void; onNext: () => Promise<void>;
}) {
  const { notify, dismiss } = useToast();
  const categoryChoice = useCategoryTypeChoice(categories);
  const [draft, setDraft] = useState(() => editable(row));
  const [rememberChoices, setRememberChoices] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ackIssues, setAckIssues] = useState(false);
  const [balanceSelections, setBalanceSelections] = useState<Record<string, StatementBalanceSelection>>({});
  const [detailSelections, setDetailSelections] = useState<Record<string, { version: number; values: DetailSelections }>>({});
  const [confirmSeparate, setConfirmSeparate] = useState(false);
  const [confirmUnlink, setConfirmUnlink] = useState(false);
  const [verifiedSms, setVerifiedSms] = useState<string | null>(null);
  const [distinctLedgerMatches, setDistinctLedgerMatches] = useState(false);
  const isResolved = Boolean(row.transaction) || row.state === "skipped";
  const dirty = JSON.stringify(draft) !== JSON.stringify(editable(row));
  const source = row.extracted;
  function setField<K extends keyof StatementRowEdit>(key: K, value: StatementRowEdit[K]) { setDraft((old) => ({ ...old, [key]: value })); }
  function applyType(type: TransactionType, category = draft.category) {
    setDraft((old) => ({ ...old, category, type, direction: type === "transfer" || type === "adjustment" ? old.direction : directionForType(type), other_account: type === "transfer" ? old.other_account : null }));
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
      setDraft(editable(result)); setAckIssues(false); setBalanceSelections({}); setDetailSelections({}); setDistinctLedgerMatches(false);
      onChange(result, false); if (next) await onNext(); notify("Draft saved. Match suggestions refreshed; no ledger changes yet.");
    } catch (reason) { showError(reason); } finally { setBusy(false); }
  }
  async function advance() {
    if (busy || dirty) return;
    setBusy(true);
    try { await onNext(); } finally { setBusy(false); }
  }
  async function decide(action: StatementDecision["action"], transaction?: string, separate = false) {
    if (action === "combine_sms") return;
    const token = getAccessToken(); if (!token || busy) return;
    const match = row.review.matches.find((item) => item.id === transaction);
    const balanceChoice = match ? currentStatementBalanceChoice(balanceSelections[match.id], match, row.balance_after, row.version) : undefined;
    const selections = match && detailSelections[match.id]?.version === row.version ? detailSelections[match.id].values : {};
    const detailResult = match ? selectedStatementDetails(match.detail_suggestions, selections) : { choices: [], error: null };
    if (action === "link") {
      const blocked = match ? detailResult.error ?? statementLinkBlockReason({ dirty, canLink: match.can_link, requiresAcknowledgement: row.review.requires_acknowledgement, issuesAcknowledged: ackIssues, conflict: match.conflict, balanceChosen: Boolean(balanceChoice) }) : "Refresh the match suggestions.";
      if (blocked) { showError(new Error(blocked)); return; }
    }
    setBusy(true); setError(null);
    try {
      const result = await decideStatementRow(token, row.id, { action, version: row.version, transaction, remember_choices: rememberChoices, allow_separate: separate, acknowledge_issues: ackIssues, acknowledge_conflict: Boolean(balanceChoice), balance_choice: action === "link" ? balanceChoice : undefined, detail_choices: action === "link" ? detailResult.choices : undefined });
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
    const balanceChoice = currentStatementBalanceChoice(
      balanceSelections[candidateId], { effective_balance_after: match.balance_after }, row.balance_after, row.version,
    );
    const selections = detailSelections[candidateId]?.version === row.version ? detailSelections[candidateId].values : {};
    const details = selectedStatementDetails(match.detail_suggestions, selections);
    if (details.error) { showError(new Error(details.error)); return; }
    if (match.balance_after !== null && row.balance_after !== null && match.balance_after !== row.balance_after && !balanceChoice) {
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
    if (event.key.toLowerCase() === "s" && !isResolved && dirty) { event.preventDefault(); void save(event.shiftKey); }
    if (event.key === "ArrowRight") { event.preventDefault(); if (dirty) showError(new Error("Save your changes before moving to the next row.")); else void advance(); }
  }
  return <>
    <ModalDialog labelledBy="statement-row-title" className="form-drawer statement-row-dialog" busy={busy} onCancel={onCancel}>
      <div className="form-drawer__header"><div><h2 id="statement-row-title">Review statement {row.component === "fee" ? "fee" : "transaction"}</h2><p>{batch.account_name} · Page {source.page}, source row {source.row}</p></div><button type="button" className="icon-button" aria-label="Close statement row" disabled={busy} onClick={onCancel}>×</button></div>
      <div className="statement-row-body" onKeyDown={handleShortcuts}>
        <details className="raw-message" open><summary>Original extracted row</summary>
          <p>{source.date ?? "Unknown date"}{source.time ? ` · ${source.time}` : ""} · {source.provider_type || source.direction}</p>
          <p className="statement-evidence-text">{source.description}</p>
          <p>Principal: {source.amount ?? "Unreadable"} · Signed fee: {source.signed_fee} · Reported final balance: {source.balance_after ?? "Unreadable"}</p>
          {source.value_date ? <p>Printed value date: {source.value_date}</p> : null}
          {source.issues.length ? <ul>{source.issues.map((issue) => <li key={issue}>{issue}</li>)}</ul> : null}
          <p className="inline-note">This masked extraction stays unchanged as source evidence. Corrections below apply to the draft.</p>
        </details>
        {row.component === "fee" ? <p className="inline-note">This is the separate charge from the source row. Approving the principal does not approve this fee.</p> : source.signed_fee !== "0.00" ? <p className="inline-note">The inline fee has its own review row. The final reported balance is saved on the fee entry when you add new movements.</p> : null}
        {isResolved ? <p>This row is {row.state === "posted" ? "added" : row.state}. {row.transaction ? <>Ledger entry: {row.transaction}. Make ledger corrections in <Link href="/transactions">Transactions</Link>.</> : "You can reopen it below."}</p> : null}
        {!row.transaction && ["posted", "linked"].includes(row.state) ? <p>The previous ledger entry was deleted. Review this source row before recording it again.</p> : null}
        {!isResolved && row.review.suggestion ? <section className="raw-message"><strong>Remembered choices</strong><p>{row.review.suggestion.reason}</p><p>{row.review.suggestion.type} · {categories.find(c => c.id === row.review.suggestion?.category)?.name ?? "Uncategorized"}{row.review.suggestion.other_account ? ` · ${accounts.find(a => a.id === row.review.suggestion?.other_account)?.name ?? "Other account"}` : ""}</p><button className="button" type="button" disabled={busy || dirty} onClick={() => { const choice = row.review.suggestion; if (choice) setDraft(old => ({ ...old, type: choice.type, category: choice.category, other_account: choice.other_account, classification_confirmed: true })); }}>Apply remembered choices</button></section> : null}
        <form onSubmit={(event) => { event.preventDefault(); void save(); }}>
          <fieldset className="statement-edit-fields" disabled={busy || isResolved}>
            <legend className="visually-hidden">Transaction draft</legend>
            <label className="field"><span className="field__label">Date</span><input className="field__control" type="date" value={draft.date ?? ""} onChange={(e) => setField("date", e.target.value || null)} /></label>
            <label className="field"><span className="field__label">Time (if known)</span><input className="field__control" type="time" step="1" value={draft.time ?? ""} onChange={(e) => setField("time", e.target.value || null)} /></label>
            <label className="field"><span className="field__label">Type</span><select className="field__control" value={draft.type} onChange={(e) => applyType(e.target.value as TransactionType)}>{transactionTypes.map((type) => <option key={type} value={type}>{type.replaceAll("_", " ")}</option>)}</select></label>
            <label className="field"><span className="field__label">Debit / credit for {batch.account_name}</span><select className="field__control" value={draft.direction} onChange={(e) => setField("direction", e.target.value as "debit" | "credit")}><option value="debit">Debit</option><option value="credit">Credit</option></select></label>
            {draft.type === "transfer" ? <label className="field"><span className="field__label">Other owned account</span><select className="field__control" value={draft.other_account ?? ""} disabled={busy || isResolved} onChange={(e) => setField("other_account", e.target.value || null)}><option value="">Choose the other account</option>{accounts.filter((a) => a.id !== batch.account && a.is_active && a.currency === batch.currency).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></label> : null}
            <label className="field"><span className="field__label">Category</span><select className="field__control" value={draft.category ?? ""} onChange={(e) => categoryChoice.choose(e.target.value, draft.type, (id, type) => applyType(type, id || null))}><option value="">Uncategorized</option>{categories.filter((c) => c.is_active).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
            <label className="field"><span className="field__label">Amount ({batch.currency})</span><input className="field__control" type="number" min="0.01" max="999999999999.99" step="0.01" value={draft.amount ?? ""} onChange={(e) => setField("amount", e.target.value || null)} /></label>
            <label className="field"><span className="field__label">Reported final balance after</span><input className="field__control" type="number" step="0.01" value={draft.balance_after ?? ""} onChange={(e) => setField("balance_after", e.target.value || null)} /></label>
            <label className="field"><span className="field__label">Value date (if printed)</span><input className="field__control" type="date" value={draft.value_date ?? ""} onChange={(e) => setField("value_date", e.target.value || null)} /></label>
            <label className="field"><span className="field__label">Reference</span><input className="field__control" maxLength={120} value={draft.reference} onChange={(e) => setField("reference", e.target.value)} /></label>
            <label className="field field--wide"><span className="field__label">Counterparty</span><input className="field__control" maxLength={255} value={draft.counterparty_text} onChange={(e) => setField("counterparty_text", e.target.value)} /></label>
            <label className="field field--wide"><span className="field__label">Note</span><textarea className="field__control" maxLength={4000} rows={3} value={draft.note} onChange={(e) => setField("note", e.target.value)} /></label>
            <label className="review-remember field--wide"><input type="checkbox" checked={draft.classification_confirmed} onChange={(e) => setField("classification_confirmed", e.target.checked)} /><span>Reviewed transaction type <small className="statement-choice-help">Confirm whether this involves your own accounts; this checkbox does not change the type.</small></span></label>
          </fieldset>
          {draft.type === "transfer" ? <p>Transfer path: {draft.direction === "credit" ? `${accounts.find((a) => a.id === draft.other_account)?.name ?? "Other account"} → ${batch.account_name}` : `${batch.account_name} → ${accounts.find((a) => a.id === draft.other_account)?.name ?? "Other account"}`}</p> : null}
          {!isResolved ? <div className="statement-actions"><button className="button" type="submit" disabled={busy || !dirty}>Save draft & refresh matches</button><button className="button" type="button" disabled={busy || !dirty} onClick={() => void save(true)}>Save & next</button></div> : null}
        </form>
        <p className="inline-note">Shortcuts: Alt+S saves; Alt+Shift+S saves and moves next; Alt+Right opens the next unresolved row.</p>
        {!isResolved ? <label className="review-remember"><input type="checkbox" checked={rememberChoices} disabled={busy} onChange={e => setRememberChoices(e.target.checked)} /><span>Remember these choices <small className="statement-choice-help">Suggest this category and transfer choice for similar rows after I add or link.</small></span></label> : null}
        {row.review.draft_issues.length ? <section className="raw-message"><strong>Saved draft reconciliation</strong><ul>{row.review.draft_issues.map(issue => <li key={issue}>{issue}</li>)}</ul><p>Original extraction checks remain unchanged.</p></section> : null}
        {dirty ? <p className="inline-note">Save your draft changes before accepting a match or adding the transaction.</p> : null}
        {row.review.issues.length ? <ul className="statement-error">{row.review.issues.map((issue) => <li key={issue}>{issue}</li>)}</ul> : null}
        {!editOnly && !isResolved && row.review.pending_sms_match_count === null ? <p className="form-warning" role="status">The pending SMS queue is too large to verify matches for this row. <Link href="/messages/review">Review pending SMS</Link>, then reopen this row before adding it.</p> : null}
        {row.review.requires_acknowledgement && !isResolved ? <label className="review-remember"><input type="checkbox" checked={ackIssues} disabled={busy || dirty} onChange={(e) => setAckIssues(e.target.checked)} /><span>I reviewed the source and saved draft discrepancies and confirm the values being recorded.</span></label> : null}
        {!editOnly && !isResolved && row.review.pending_sms_matches.length ? <section className="statement-matches" aria-labelledby="pending-sms-matches-title">
          <h3 id="pending-sms-matches-title">Pending SMS for this statement row</h3>
          <p className="inline-note">Review the same movement across both sources. This creates one SMS-dated transaction and links the statement; either queue can still be reviewed separately.</p>
          {row.review.matches.length ? <div className="raw-message"><strong>Existing ledger suggestions also need a decision</strong><p>Compare each ledger entry in the Possible matches section below before combining the SMS and statement.</p><ul>{row.review.matches.map((item) => <li key={item.id}>{item.date} · {item.amount} · {item.note || item.reference || item.source}</li>)}</ul><label className="review-remember"><input type="checkbox" checked={distinctLedgerMatches} disabled={busy || dirty} onChange={(event) => setDistinctLedgerMatches(event.target.checked)} /><span>I compared every listed ledger entry and confirmed each is a different movement.</span></label></div> : null}
          <div className="statement-match-list">{row.review.pending_sms_matches.map((match) => {
            const conflict = match.balance_after !== null && row.balance_after !== null && match.balance_after !== row.balance_after;
            const choice = currentStatementBalanceChoice(balanceSelections[match.id], { effective_balance_after: match.balance_after }, row.balance_after, row.version);
            return <article className="statement-match-card" key={match.id}>
              <header className="statement-match-heading"><h4>Pending SMS · {match.sender}</h4><span>{batch.currency} {match.amount}</span></header>
              <div className="statement-match-comparison">
                <section><h5>Statement</h5><p>{row.date}{row.time ? ` · ${row.time}` : ""}</p><p>{row.counterparty_text || source.description}</p><p>Balance after: {row.balance_after ?? "Not reported"}</p></section>
                <section><h5>SMS</h5><p>{match.date} · {match.time}</p><p>{match.counterparty_text || "No counterparty parsed"}</p><p>Balance after: {match.balance_after ?? "Not reported"}</p><p>Parser confidence: {Math.round(Number(match.confidence) * 100)}%</p></section>
              </div>
              {match.sms_text ? <details className="raw-message"><summary>Original SMS</summary><p className="statement-evidence-text">{match.sms_text}</p></details> : null}
              {conflict ? <fieldset className="statement-match-conflict" disabled={busy || dirty}>
                <legend>Which reported balance should this transaction use?</legend>
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
            balanceChoice={currentStatementBalanceChoice(balanceSelections[match.id], match, row.balance_after, row.version)}
            detailSelections={detailSelections[match.id]?.version === row.version ? detailSelections[match.id].values : {}}
            onBalanceChoice={(keep) => setBalanceSelections((old) => ({ ...old, [match.id]: { keep, version: row.version, existing_balance_after: match.effective_balance_after, statement_balance_after: row.balance_after } }))}
            onDetailChange={(values) => setDetailSelections((old) => ({ ...old, [match.id]: { version: row.version, values } }))}
            onAccept={() => void decide("link", match.id)} />)}</div>
        </section> : null}
        {error ? <div><p role="alert" className="form-error">{error}</p><button className="button" type="button" disabled={busy} onClick={() => { dismiss(); setDraft(editable(row)); setBalanceSelections({}); setDetailSelections({}); setAckIssues(false); setDistinctLedgerMatches(false); setError(null); onReload(); }}>Reload row · discard unsaved changes</button></div> : null}
      </div>
      <footer className="statement-row-footer" onKeyDown={handleShortcuts}>
        {dirty ? <p className="inline-note" role="status">Save draft changes before deciding.</p> : null}
        <div className="statement-actions">
          <button className="button button--ghost" type="button" disabled={busy} onClick={onCancel}>Close</button><button className="button" type="button" disabled={busy || dirty} onClick={() => void advance()}>Next unresolved row</button>
          {!editOnly && !isResolved ? <><button className="button" type="button" disabled={busy || dirty} onClick={() => void decide("skip")}>Skip this row</button><button className="button button--primary" type="button" disabled={busy || dirty || row.review.pending_sms_match_count === null || row.review.issues.length > 0 || (row.review.requires_acknowledgement && !ackIssues)} onClick={() => row.review.matches.length || row.review.pending_sms_matches.length ? setConfirmSeparate(true) : void decide("create")}>Add {row.component === "fee" ? "fee" : "transaction"}{row.review.matches.length || row.review.pending_sms_matches.length ? " as separate" : ""}</button></> : !editOnly && row.transaction ? <button className="button" type="button" disabled={busy} onClick={() => setConfirmUnlink(true)}>Unlink statement evidence</button> : !editOnly && isResolved ? <button className="button" type="button" disabled={busy} onClick={() => void decide("reopen")}>Reopen skipped row</button> : null}
        </div>
      </footer>
    </ModalDialog>
    {categoryChoice.confirmation}
    {confirmSeparate ? <ModalDialog labelledBy="statement-separate-title" busy={busy} onCancel={() => setConfirmSeparate(false)}><h2 id="statement-separate-title">Add a separate movement?</h2><p>Possible matches already exist. Continue only if this source row represents another transaction, such as a genuine repeat purchase.</p><div className="decision-modal__actions"><button className="button" type="button" disabled={busy} onClick={() => setConfirmSeparate(false)}>Back to matches</button><button className="button button--primary" type="button" disabled={busy} onClick={() => void decide("create", undefined, true)}>Confirm separate movement</button></div></ModalDialog> : null}
    {confirmUnlink ? <ModalDialog labelledBy="statement-unlink-title" busy={busy} onCancel={() => setConfirmUnlink(false)}><h2 id="statement-unlink-title">Unlink this evidence?</h2><p>The transaction stays in your ledger. This row returns to review, where it may suggest that transaction again.</p><div className="decision-modal__actions"><button className="button" type="button" disabled={busy} onClick={() => setConfirmUnlink(false)}>Cancel</button><button className="button button--primary" type="button" disabled={busy} onClick={() => void decide("unlink")}>Unlink evidence only</button></div></ModalDialog> : null}
  </>;
}
