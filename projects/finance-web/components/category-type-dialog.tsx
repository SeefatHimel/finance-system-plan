"use client";

import { useState } from "react";
import type { TransactionType } from "@/lib/api";
import { type CategoryTypeProposal, typeImpact } from "@/lib/category-type";
import { ModalDialog } from "@/components/modal-dialog";

type Props = { proposal: CategoryTypeProposal; onCancel: () => void; onKeepType: () => void; onChangeType: (type: TransactionType) => void };

export function CategoryTypeDialog({ proposal, onCancel, onKeepType, onChangeType }: Props) {
  const [nextType, setNextType] = useState<TransactionType | "">(proposal.options.length === 1 ? proposal.options[0] : "");
  return <ModalDialog labelledBy="category-type-title" className="decision-modal category-type-dialog" onCancel={onCancel}>
    <h2 id="category-type-title">Change transaction type?</h2>
    <p>“{proposal.categoryName}” is normally used for {proposal.options.length > 1 ? "debt" : proposal.options[0]} entries. This entry is marked as {proposal.currentType.replaceAll("_", " ")}. Choose how to apply it.</p>
    <form onSubmit={(event) => { event.preventDefault(); if (nextType) onChangeType(nextType); }}>
      {proposal.options.length > 1 ? <label className="field"><span className="field__label">New transaction type</span><select className="field__control" required value={nextType} onChange={(event) => setNextType(event.target.value as TransactionType)}><option value="">Choose debt movement</option>{proposal.options.map((type) => <option key={type} value={type}>{type.replaceAll("_", " ")}</option>)}</select></label> : <p>Change type to <strong>{nextType}</strong>?</p>}
      {nextType ? <p>{typeImpact(nextType)} This affects balances and reports after saving.</p> : <p>A debt category can mean lending, borrowing, or repayment. Choose the movement explicitly.</p>}
      {proposal.currentType === "transfer" ? <p>Changing type removes the other transfer account from this draft and clears its reported balance. Linked messages remain as history; linked-transfer corrections still require acknowledgement when saving.</p> : <p>A type change resets debit/credit to its default and clears the reported balance. For a transfer, choose the other account before saving.</p>}
      <p>No ledger changes are saved until you submit the entry.</p>
      <div className="decision-modal__actions"><button className="button button--ghost" onClick={onCancel} type="button">Cancel</button><button className="button button--ghost" onClick={onKeepType} type="button">Keep current type</button><button className="button button--primary" disabled={!nextType} type="submit">Change category and type</button></div>
    </form>
  </ModalDialog>;
}
