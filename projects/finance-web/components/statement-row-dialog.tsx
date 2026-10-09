"use client";

import { useState } from "react";
import Link from "next/link";
import { ModalDialog } from "@/components/modal-dialog";
import { useCategoryTypeChoice } from "@/components/use-category-type-choice";
import { useToast } from "@/components/toast-provider";
import { getAccessToken } from "@/lib/auth-storage";
import { directionForType, transactionTypes } from "@/lib/category-type";
import { decideStatementRow, updateStatementRow, type Account, type Category, type SavedStatement, type SavedStatementRow, type StatementDecision, type StatementRowEdit, type TransactionType } from "@/lib/api";

function editable(row: SavedStatementRow): StatementRowEdit {
  return { version: row.version, date: row.date, time: row.time, value_date: row.value_date, direction: row.direction, amount: row.amount, balance_after: row.balance_after, type: row.type, other_account: row.other_account, category: row.category, reference: row.reference, counterparty_text: row.counterparty_text, note: row.note, classification_confirmed: row.classification_confirmed };
}

export function StatementRowDialog({ row, batch, accounts, categories, onChange, onCancel, onReload, onNext }: {
  row: SavedStatementRow; batch: SavedStatement; accounts: Account[]; categories: Category[];
  onChange: (row: SavedStatementRow, close: boolean) => void; onCancel: () => void; onReload: () => void; onNext: () => Promise<void>;
}) {
  const { notify, dismiss } = useToast();
  const categoryChoice = useCategoryTypeChoice(categories);
  const [draft, setDraft] = useState(() => editable(row));
  const [rememberChoices, setRememberChoices] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ackIssues, setAckIssues] = useState(false);
  const [ackConflict, setAckConflict] = useState(false);
  const [confirmSeparate, setConfirmSeparate] = useState(false);
  const [confirmUnlink, setConfirmUnlink] = useState(false);
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
    const token = getAccessToken(); if (!token || busy) return;
    setBusy(true); setError(null);
    try {
      const result = await updateStatementRow(token, row.id, draft);
      setDraft(editable(result)); setAckIssues(false); setAckConflict(false);
      onChange(result, false); if (next) await onNext(); notify("Draft saved. Match suggestions refreshed; no ledger changes yet.");
    } catch (reason) { showError(reason); } finally { setBusy(false); }
  }
  async function advance() {
    if (busy || dirty) return;
    setBusy(true);
    try { await onNext(); } finally { setBusy(false); }
  }
  async function decide(action: StatementDecision["action"], transaction?: string, separate = false) {
    const token = getAccessToken(); if (!token || busy) return;
    setBusy(true); setError(null);
    try {
      const result = await decideStatementRow(token, row.id, { action, version: row.version, transaction, remember_choices: rememberChoices, allow_separate: separate, acknowledge_issues: ackIssues, acknowledge_conflict: ackConflict });
      onChange(result, true);
      const messages = { create: "Transaction added from the statement.", link: "Statement evidence linked. The transaction is counted once.", skip: "Statement row skipped.", unlink: "Statement evidence unlinked. The ledger transaction was kept.", reopen: "Skipped row reopened for review." };
      notify(messages[action]);
    } catch (reason) { showError(reason); } finally { setBusy(false); setConfirmSeparate(false); setConfirmUnlink(false); }
  }
  return <>
    <ModalDialog labelledBy="statement-row-title" className="form-drawer statement-row-dialog" busy={busy} onCancel={onCancel}>
      <div className="form-drawer__header"><div><h2 id="statement-row-title">Review statement {row.component === "fee" ? "fee" : "transaction"}</h2><p>{batch.account_name} · Page {source.page}, source row {source.row}</p></div><button type="button" className="icon-button" aria-label="Close statement row" disabled={busy} onClick={onCancel}>×</button></div>
      <div className="statement-row-body" onKeyDown={(event) => {
        if (!event.altKey || busy || confirmSeparate || confirmUnlink) return;
        if (event.key.toLowerCase() === "s" && !isResolved && dirty) { event.preventDefault(); void save(event.shiftKey); }
        if (event.key === "ArrowRight") { event.preventDefault(); if (dirty) showError(new Error("Save your changes before moving to the next row.")); else void advance(); }
      }}>
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
            <label className="field"><span className="field__label">Other owned account</span><select className="field__control" value={draft.other_account ?? ""} disabled={draft.type !== "transfer" || busy || isResolved} onChange={(e) => setField("other_account", e.target.value || null)}><option value="">{draft.type === "transfer" ? "Choose the other account" : "Only for transfers"}</option>{accounts.filter((a) => a.id !== batch.account && a.is_active && a.currency === batch.currency).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></label>
            <label className="field"><span className="field__label">Category</span><select className="field__control" value={draft.category ?? ""} onChange={(e) => categoryChoice.choose(e.target.value, draft.type, (id, type) => applyType(type, id || null))}><option value="">Uncategorized</option>{categories.filter((c) => c.is_active).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
            <label className="field"><span className="field__label">Amount ({batch.currency})</span><input className="field__control" type="number" min="0.01" max="999999999999.99" step="0.01" value={draft.amount ?? ""} onChange={(e) => setField("amount", e.target.value || null)} /></label>
            <label className="field"><span className="field__label">Reported final balance after</span><input className="field__control" type="number" step="0.01" value={draft.balance_after ?? ""} onChange={(e) => setField("balance_after", e.target.value || null)} /></label>
            <label className="field"><span className="field__label">Value date (if printed)</span><input className="field__control" type="date" value={draft.value_date ?? ""} onChange={(e) => setField("value_date", e.target.value || null)} /></label>
            <label className="field"><span className="field__label">Reference</span><input className="field__control" maxLength={120} value={draft.reference} onChange={(e) => setField("reference", e.target.value)} /></label>
            <label className="field field--wide"><span className="field__label">Counterparty</span><input className="field__control" maxLength={255} value={draft.counterparty_text} onChange={(e) => setField("counterparty_text", e.target.value)} /></label>
            <label className="field field--wide"><span className="field__label">Note</span><textarea className="field__control" maxLength={4000} rows={3} value={draft.note} onChange={(e) => setField("note", e.target.value)} /></label>
            <label className="review-remember field--wide"><input type="checkbox" checked={draft.classification_confirmed} onChange={(e) => setField("classification_confirmed", e.target.checked)} /><span>I reviewed whether this movement is a transfer between my own accounts.</span></label>
          </fieldset>
          {draft.type === "transfer" ? <p>Transfer path: {draft.direction === "credit" ? `${accounts.find((a) => a.id === draft.other_account)?.name ?? "Other account"} → ${batch.account_name}` : `${batch.account_name} → ${accounts.find((a) => a.id === draft.other_account)?.name ?? "Other account"}`}</p> : null}
          {!isResolved ? <div className="statement-actions"><button className="button" type="submit" disabled={busy || !dirty}>Save draft & refresh matches</button><button className="button" type="button" disabled={busy || !dirty} onClick={() => void save(true)}>Save & next</button></div> : null}
        </form>
        <p className="inline-note">Shortcuts: Alt+S saves; Alt+Shift+S saves and moves next; Alt+Right opens the next unresolved row.</p>
        {!isResolved ? <label className="review-remember"><input type="checkbox" checked={rememberChoices} disabled={busy} onChange={e => setRememberChoices(e.target.checked)} /><span>Remember my category and transfer choices after I add or accept a match. Suggestions stay reviewable.</span></label> : null}
        {row.review.draft_issues.length ? <section className="raw-message"><strong>Saved draft reconciliation</strong><ul>{row.review.draft_issues.map(issue => <li key={issue}>{issue}</li>)}</ul><p>Original extraction checks remain unchanged.</p></section> : null}
        {dirty ? <p className="inline-note">Save your draft changes before accepting a match or adding the transaction.</p> : null}
        {row.review.issues.length ? <ul className="statement-error">{row.review.issues.map((issue) => <li key={issue}>{issue}</li>)}</ul> : null}
        {row.review.requires_acknowledgement && !isResolved ? <label className="review-remember"><input type="checkbox" checked={ackIssues} onChange={(e) => setAckIssues(e.target.checked)} /><span>I reviewed the source and saved draft discrepancies and confirm the values being recorded.</span></label> : null}
        {row.review.matches.some((match) => match.conflict) && !isResolved ? <label className="review-remember"><input type="checkbox" checked={ackConflict} onChange={(e) => setAckConflict(e.target.checked)} /><span>I reviewed the differing reported balances. Linking preserves the existing ledger balance and both observations.</span></label> : null}
        {!isResolved && row.review.matches.length ? <section><h3>Possible matches</h3><p>Verify the same money movement. Linking keeps the existing transaction and your corrections.</p><div className="transfer-match-list">{row.review.matches.map((match) => <article className="transfer-match-card" key={match.id}>
          <strong>{match.strength === "strong" ? "Strong match" : "Possible match"} · {match.account_name}{match.transfer_account_name ? ` → ${match.transfer_account_name}` : ""} · {match.type.replaceAll("_", " ")}</strong>
          <p>{batch.currency} {match.amount} · {match.date}{match.time ? ` · ${match.time}` : ""} · {match.source}</p>
          <p>{match.note}</p>{match.reference ? <p>Reference: {match.reference}</p> : null}{match.category_name ? <p>Category: {match.category_name}</p> : null}
          <ul>{match.reasons.map((reason) => <li key={reason}>{reason}</li>)}</ul>
          <button className="button button--primary" type="button" disabled={busy || dirty || !match.can_link} onClick={() => void decide("link", match.id)}>Accept match · count once</button>
        </article>)}</div></section> : null}
        {error ? <div><p role="alert" className="form-error">{error}</p><button className="button" type="button" disabled={busy} onClick={() => { dismiss(); onReload(); }}>Reload row · discard unsaved changes</button></div> : null}
        <div className="statement-actions">
          <button className="button button--ghost" type="button" disabled={busy} onClick={onCancel}>Close</button><button className="button" type="button" disabled={busy || dirty} onClick={() => void advance()}>Next unresolved row</button>
          {!isResolved ? <><button className="button" type="button" disabled={busy || dirty} onClick={() => void decide("skip")}>Skip this row</button><button className="button button--primary" type="button" disabled={busy || dirty || row.review.issues.length > 0 || (row.review.requires_acknowledgement && !ackIssues)} onClick={() => row.review.matches.length ? setConfirmSeparate(true) : void decide("create")}>Add {row.component === "fee" ? "fee" : "transaction"}{row.review.matches.length ? " as separate" : ""}</button></> : row.transaction ? <button className="button" type="button" disabled={busy} onClick={() => setConfirmUnlink(true)}>Unlink statement evidence</button> : <button className="button" type="button" disabled={busy} onClick={() => void decide("reopen")}>Reopen skipped row</button>}
        </div>
      </div>
    </ModalDialog>
    {categoryChoice.confirmation}
    {confirmSeparate ? <ModalDialog labelledBy="statement-separate-title" busy={busy} onCancel={() => setConfirmSeparate(false)}><h2 id="statement-separate-title">Add a separate movement?</h2><p>Possible matches already exist. Continue only if this source row represents another transaction, such as a genuine repeat purchase.</p><div className="decision-modal__actions"><button className="button" type="button" disabled={busy} onClick={() => setConfirmSeparate(false)}>Back to matches</button><button className="button button--primary" type="button" disabled={busy} onClick={() => void decide("create", undefined, true)}>Confirm separate movement</button></div></ModalDialog> : null}
    {confirmUnlink ? <ModalDialog labelledBy="statement-unlink-title" busy={busy} onCancel={() => setConfirmUnlink(false)}><h2 id="statement-unlink-title">Unlink this evidence?</h2><p>The transaction stays in your ledger. This row returns to review, where it may suggest that transaction again.</p><div className="decision-modal__actions"><button className="button" type="button" disabled={busy} onClick={() => setConfirmUnlink(false)}>Cancel</button><button className="button button--primary" type="button" disabled={busy} onClick={() => void decide("unlink")}>Unlink evidence only</button></div></ModalDialog> : null}
  </>;
}
