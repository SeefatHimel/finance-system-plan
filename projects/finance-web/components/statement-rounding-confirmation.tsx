"use client";

import { useState } from "react";
import { ModalDialog } from "@/components/modal-dialog";
import type { SavedStatementRow, StatementDecision, StatementMatch } from "@/lib/api";

export function StatementRoundingConfirmation({ row, match, currency, balanceChoice, busy, onCancel, onConfirm }: {
  row: SavedStatementRow; match: StatementMatch; currency: string;
  balanceChoice: StatementDecision["balance_choice"]; busy: boolean;
  onCancel: () => void; onConfirm: () => void;
}) {
  const [verified, setVerified] = useState(false);
  const correction = match.rounding_correction!;
  const chosenBalance = balanceChoice?.keep === "statement" ? row.balance_after : match.effective_balance_after;
  return <ModalDialog className="decision-modal statement-rounding-dialog" labelledBy="statement-rounding-title" busy={busy} onCancel={onCancel}>
    <h2 id="statement-rounding-title">Correct this transaction and link the statement?</h2>
    <p>A small difference can still be a different movement. Check the original sources before confirming.</p>
    <table className="statement-rounding-values"><caption>Exact values being reviewed</caption><thead><tr><th>Field</th><th>Saved transaction</th><th>Statement draft</th></tr></thead><tbody>
      <tr><th>Amount</th><td>{currency} {match.amount}</td><td>{currency} {row.amount}</td></tr>
      <tr><th>Reported balance after</th><td>{match.effective_balance_after === null ? "Not reported" : `${currency} ${match.effective_balance_after}`}</td><td>{row.balance_after === null ? "Not reported" : `${currency} ${row.balance_after}`}</td></tr>
    </tbody></table>
    <p>Will change the saved amount from {currency} {correction.existing_amount} to {currency} {correction.statement_amount} and attach this PDF source to that transaction. It remains one ledger entry.</p>
    <p>Ledger balance to use: {chosenBalance === null ? "Not reported" : `${currency} ${chosenBalance}`}. Original SMS and PDF values stay available; the correction is recorded in audit history.</p>
    <p>If the saved amount is correct, cancel and correct the statement draft instead, then save it to refresh matches.</p>
    <label className="review-remember"><input type="checkbox" checked={verified} disabled={busy} onChange={event => setVerified(event.target.checked)} /><span>I checked both sources and confirm this is the same movement.</span></label>
    <div className="decision-modal__actions"><button className="button" disabled={busy} type="button" onClick={onCancel}>Cancel correction</button><button className="button button--primary" type="button" disabled={busy || !verified || !correction.can_correct || (match.conflict && !balanceChoice)} onClick={onConfirm}>{busy ? "Correcting and linking…" : "Confirm correction & link"}</button></div>
  </ModalDialog>;
}
