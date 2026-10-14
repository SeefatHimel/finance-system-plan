"use client";

import { useCategoryTypeChoice } from "@/components/use-category-type-choice";
import { categoryTypeProposal, directionForType, transactionTypes } from "@/lib/category-type";
import { localDate } from "@/lib/date-period";
import type { Account, Category, StatementRowEdit, TransactionType, UnifiedPair } from "@/lib/api";

export type PairTypeChoice = "" | "statement" | "sms" | "custom";

export function savedPairDraft(pair: UnifiedPair): StatementRowEdit {
  const { row } = pair;
  return { version: row.version, date: row.date, time: row.time, value_date: row.value_date, direction: row.direction, amount: row.amount, balance_after: row.balance_after, type: row.type, other_account: row.other_account, category: row.category, reference: row.reference, counterparty_text: row.counterparty_text, note: row.note, classification_confirmed: row.classification_confirmed };
}

function receivedParts(pair: UnifiedPair) {
  const received = new Date(pair.sms.raw_message.received_at);
  return {
    date: localDate(received),
    time: `${String(received.getHours()).padStart(2, "0")}:${String(received.getMinutes()).padStart(2, "0")}:${String(received.getSeconds()).padStart(2, "0")}`,
  };
}

export function initialPairDraft(pair: UnifiedPair, categories: Category[]): StatementRowEdit {
  const { row, sms } = pair;
  const received = receivedParts(pair);
  const otherAccount = pair.sms_summary.direction === "credit" ? sms.account : sms.destination_account;
  const activeCategory = (id: string | null) => categories.some(category => category.id === id && category.is_active) ? id : null;
  return {
    ...savedPairDraft(pair),
    date: row.date ?? received.date,
    time: row.time,
    other_account: row.other_account ?? (row.type === "transfer" && otherAccount !== pair.batch.account ? otherAccount : null),
    category: activeCategory(row.category) ?? (row.type === sms.transaction_type ? activeCategory(sms.category) : null),
    reference: row.reference || sms.reference,
    counterparty_text: row.counterparty_text || sms.counterparty_text,
    note: row.note || sms.counterparty_text,
  };
}

function Suggestion({ label, value, onUse, disabled }: { label: string; value: string | null; onUse: () => void; disabled: boolean }) {
  if (!value) return null;
  return <button className="unified-suggestion" type="button" disabled={disabled} onClick={onUse} title={value}>Use {label}: {value}</button>;
}

export function UnifiedPairEditor({ pair, accounts, categories, draft, onDraftChange, typeChoice, onTypeChoice, busy }: {
  pair: UnifiedPair;
  accounts: Account[];
  categories: Category[];
  draft: StatementRowEdit;
  onDraftChange: (draft: StatementRowEdit) => void;
  typeChoice: PairTypeChoice;
  onTypeChoice: (choice: PairTypeChoice) => void;
  busy: boolean;
}) {
  const categoryChoice = useCategoryTypeChoice(categories);
  const received = receivedParts(pair);
  const typeDiffers = pair.row.type !== pair.sms.transaction_type;
  const accountName = (id: string | null) => accounts.find(account => account.id === id)?.name ?? "Choose the other account";
  const categoryName = (id: string | null) => categories.find(category => category.id === id && category.is_active)?.name ?? null;
  const smsOther = pair.sms_summary.direction === "credit" ? pair.sms.account : pair.sms.destination_account;

  function setField<K extends keyof StatementRowEdit>(field: K, value: StatementRowEdit[K]) {
    onDraftChange({ ...draft, [field]: value });
  }

  function applyType(type: TransactionType, choice: PairTypeChoice = "custom") {
    const suggestedCategory = choice === "statement" ? pair.row.category : choice === "sms" ? pair.sms.category : draft.category;
    const activeSuggestedCategory = categories.find(item => item.id === suggestedCategory && item.is_active);
    const category = activeSuggestedCategory && !categoryTypeProposal(activeSuggestedCategory, type) ? activeSuggestedCategory.id : null;
    onDraftChange({
      ...draft,
      type,
      direction: type === "transfer" || type === "adjustment" ? pair.row.direction : directionForType(type),
      category,
      other_account: type === "transfer" ? draft.other_account ?? (smsOther !== pair.batch.account ? smsOther : null) : null,
      classification_confirmed: true,
    });
    onTypeChoice(choice === "custom" && typeDiffers ? type === pair.row.type ? "statement" : type === pair.sms.transaction_type ? "sms" : "custom" : choice);
  }

  return <section className="unified-result-editor" aria-labelledby="unified-result-title">
    <header><div><h3 id="unified-result-title">Transaction to record</h3><p>Edit the result here. One transaction will keep both original sources as evidence.</p></div><span className="status-badge status-badge--idle">Draft until confirmed</span></header>
    {typeDiffers ? <fieldset className="unified-type-choice" aria-describedby="unified-type-help"><legend>Type differs — choose what this movement is</legend><p id="unified-type-help">The statement says {pair.row.type.replaceAll("_", " ")}; the SMS says {pair.sms.transaction_type.replaceAll("_", " ")}. This choice changes how the movement is counted.</p><div className="unified-type-options"><label><input type="radio" name="pair-type-choice" checked={typeChoice === "statement"} disabled={busy} onChange={() => applyType(pair.row.type, "statement")} /> Statement · {pair.row.type.replaceAll("_", " ")}</label><label><input type="radio" name="pair-type-choice" checked={typeChoice === "sms"} disabled={busy} onChange={() => applyType(pair.sms.transaction_type as TransactionType, "sms")} /> SMS · {pair.sms.transaction_type.replaceAll("_", " ")}</label><label><input type="radio" name="pair-type-choice" checked={typeChoice === "custom"} disabled={busy} onChange={() => onTypeChoice("custom")} /> Decide manually</label></div></fieldset> : null}
    <fieldset className="statement-edit-fields" disabled={busy}><legend className="visually-hidden">Final transaction fields</legend>
      <label className="field"><span className="field__label">Type</span><select className="field__control" value={draft.type} onChange={event => applyType(event.target.value as TransactionType)}>{transactionTypes.map(type => <option key={type} value={type}>{type.replaceAll("_", " ")}</option>)}</select></label>
      <label className="field"><span className="field__label">Debit / credit for {pair.batch.account_name}</span><select className="field__control" value={draft.direction} onChange={event => setField("direction", event.target.value as "debit" | "credit")}><option value="debit">Debit</option><option value="credit">Credit</option></select></label>
      {draft.type === "transfer" ? <label className="field"><span className="field__label">Other owned account</span><select className="field__control" value={draft.other_account ?? ""} onChange={event => setField("other_account", event.target.value || null)}><option value="">Choose the other account</option>{accounts.filter(account => account.id !== pair.batch.account && account.is_active && account.currency === pair.batch.currency).map(account => <option key={account.id} value={account.id}>{account.name}</option>)}</select></label> : null}
      <div className="field"><label className="field__label" htmlFor="unified-category">Category</label><select id="unified-category" className="field__control" value={draft.category ?? ""} onChange={event => categoryChoice.choose(event.target.value, draft.type, (id, type) => { if (type !== draft.type) { onDraftChange({ ...draft, category: id || null, type, direction: type === "transfer" || type === "adjustment" ? draft.direction : directionForType(type), other_account: type === "transfer" ? draft.other_account : null, classification_confirmed: true }); onTypeChoice(typeDiffers ? type === pair.row.type ? "statement" : type === pair.sms.transaction_type ? "sms" : "custom" : "custom"); } else setField("category", id || null); })}><option value="">Uncategorized</option>{categories.filter(category => category.is_active).map(category => <option key={category.id} value={category.id}>{category.name}</option>)}</select>{pair.row.category && !categoryName(pair.row.category) ? <small className="field__hint">The saved category is inactive. Choose an active category or leave this uncategorized.</small> : null}{pair.row.category !== pair.sms.category && pair.sms.category && pair.row.type === pair.sms.transaction_type ? <div className="unified-suggestions"><Suggestion label="SMS category" value={categoryName(pair.sms.category)} disabled={busy} onUse={() => setField("category", pair.sms.category)} /><Suggestion label="statement category" value={categoryName(pair.row.category)} disabled={busy} onUse={() => setField("category", pair.row.category)} /></div> : null}</div>
      <div className="field"><label className="field__label" htmlFor="unified-date">Date</label><input id="unified-date" className="field__control" type="date" value={draft.date ?? ""} onChange={event => setField("date", event.target.value || null)} />{pair.row.date !== received.date ? <div className="unified-suggestions"><Suggestion label="statement" value={pair.row.date} disabled={busy} onUse={() => setField("date", pair.row.date)} /><Suggestion label="SMS received date" value={received.date} disabled={busy} onUse={() => setField("date", received.date)} /></div> : null}</div>
      <div className="field"><label className="field__label" htmlFor="unified-time">Time (if known)</label><input id="unified-time" className="field__control" type="time" step="1" value={draft.time ?? ""} onChange={event => setField("time", event.target.value || null)} /><div className="unified-suggestions"><Suggestion label="SMS received time" value={received.time} disabled={busy} onUse={() => setField("time", received.time)} />{pair.row.time && pair.row.time !== received.time ? <Suggestion label="statement" value={pair.row.time} disabled={busy} onUse={() => setField("time", pair.row.time)} /> : null}</div></div>
      <label className="field"><span className="field__label">Amount ({pair.batch.currency})</span><input className="field__control" value={draft.amount ?? ""} readOnly aria-describedby="unified-amount-help" /><small id="unified-amount-help" className="statement-choice-help">Both sources agree. Correct an amount in its source review before combining.</small></label>
      <label className="field"><span className="field__label">Statement draft balance after</span><input className="field__control" type="number" step="0.01" value={draft.balance_after ?? ""} onChange={event => setField("balance_after", event.target.value || null)} /><small className="statement-choice-help">The original PDF amount remains in source evidence below.</small></label>
      <label className="field"><span className="field__label">Value date (if printed)</span><input className="field__control" type="date" value={draft.value_date ?? ""} onChange={event => setField("value_date", event.target.value || null)} /></label>
      <div className="field"><label className="field__label" htmlFor="unified-reference">Reference</label><input id="unified-reference" className="field__control" maxLength={120} value={draft.reference} onChange={event => setField("reference", event.target.value)} />{pair.sms.reference && pair.sms.reference !== pair.row.reference ? <div className="unified-suggestions"><Suggestion label="SMS" value={pair.sms.reference} disabled={busy} onUse={() => setField("reference", pair.sms.reference)} /></div> : null}</div>
      <div className="field field--wide"><label className="field__label" htmlFor="unified-counterparty">Counterparty / merchant</label><input id="unified-counterparty" className="field__control" maxLength={255} value={draft.counterparty_text} onChange={event => setField("counterparty_text", event.target.value)} />{pair.sms.counterparty_text && pair.sms.counterparty_text !== pair.row.counterparty_text ? <div className="unified-suggestions"><Suggestion label="SMS" value={pair.sms.counterparty_text} disabled={busy} onUse={() => setField("counterparty_text", pair.sms.counterparty_text)} /><Suggestion label="statement" value={pair.row.counterparty_text} disabled={busy} onUse={() => setField("counterparty_text", pair.row.counterparty_text)} /></div> : null}</div>
      <div className="field field--wide"><label className="field__label" htmlFor="unified-note">Note</label><textarea id="unified-note" className="field__control" maxLength={4000} rows={2} value={draft.note} onChange={event => setField("note", event.target.value)} />{pair.sms.counterparty_text && pair.sms.counterparty_text !== pair.row.note ? <div className="unified-suggestions"><Suggestion label="SMS description" value={pair.sms.counterparty_text} disabled={busy} onUse={() => setField("note", pair.sms.counterparty_text)} /><Suggestion label="statement note" value={pair.row.note} disabled={busy} onUse={() => setField("note", pair.row.note)} /></div> : null}</div>
      <label className="review-remember field--wide"><input type="checkbox" checked={draft.classification_confirmed} onChange={event => setField("classification_confirmed", event.target.checked)} /><span>I reviewed the transaction type and account path.</span></label>
    </fieldset>
    {draft.type === "transfer" ? <p className="unified-path-preview">Money moves: {draft.direction === "credit" ? `${accountName(draft.other_account)} → ${pair.batch.account_name}` : `${pair.batch.account_name} → ${accountName(draft.other_account)}`}</p> : null}
    {categoryChoice.confirmation}
  </section>;
}
