"use client";

import Link from "next/link";
import { useState } from "react";
import { formatCalendarDate, formatClockTime } from "../../finance-contracts/presentation";
import { ModalDialog } from "@/components/modal-dialog";
import type { SmsStatementMatch } from "@/lib/api";

export function SmsStatementMatchDialog({ matches, busy, error, onCancel, onReview, onSeparate, onRefresh }: {
  matches: SmsStatementMatch[];
  busy: boolean;
  error: string | null;
  onCancel: () => void;
  onReview: (match: SmsStatementMatch) => void;
  onSeparate: (ids: string[]) => void;
  onRefresh: () => void;
}) {
  const [different, setDifferent] = useState<string[]>([]);
  const [acknowledged, setAcknowledged] = useState(false);
  const allReviewed = matches.every(match => different.includes(match.statement.id));
  return <ModalDialog labelledBy="sms-statement-match-title" className="decision-modal sms-statement-match-dialog" busy={busy} onCancel={onCancel}>
    <h2 id="sms-statement-match-title">A statement may describe this SMS</h2>
    <p>Compare the original sources before adding money to the ledger. A matching SMS and statement should become one transaction with both sources attached. Pair review starts from saved SMS values; review any unsaved form edits there before confirming.</p>
    <div className="sms-statement-match-list">
      {matches.map(match => <article className="sms-statement-match-card" key={match.statement.id}>
        <div className="sms-statement-match-card__heading"><strong>{match.statement.account_name} · {match.statement.currency} {match.statement.amount}</strong><span className="status-badge status-badge--warning">{match.signals.strength === "strong" ? "Strong match" : "Possible match"}</span></div>
        <p><strong>Statement</strong> · {formatCalendarDate(match.statement.date)}{match.statement.time ? ` · ${formatClockTime(match.statement.time)}` : ""} · {match.statement.direction} · {match.statement.type.replaceAll("_", " ")}</p>
        <p>{match.statement.description || "No statement description"}</p>
        <p className="field__hint">Reference: {match.statement.reference || "Not reported"} · Balance after: {match.statement.balance_after ?? "Not reported"}</p>
        <details><summary>Why suggested</summary><ul>{match.signals.reasons.map((reason, index) => <li key={index}>{reason}</li>)}</ul></details>
        <div className="statement-actions">
          {match.unique ? <button className="button button--primary" type="button" disabled={busy} onClick={() => onReview(match)}>Review both sources · count once</button> : <span className="inline-note">More than one source may claim this movement. Resolve the statement matches first.</span>}
          <Link className="button button--ghost" href={`/statements?import=${match.statement.batch}&row=${match.statement.id}`} target="_blank" rel="noopener noreferrer">Open saved statement in new tab</Link>
        </div>
        <label className="review-remember"><input type="checkbox" checked={different.includes(match.statement.id)} disabled={busy} onChange={event => {
          setDifferent(current => event.target.checked ? [...current, match.statement.id] : current.filter(id => id !== match.statement.id));
          setAcknowledged(false);
        }} /><span>This statement row is a different money movement.</span></label>
      </article>)}
    </div>
    {allReviewed ? <label className="review-remember"><input type="checkbox" checked={acknowledged} disabled={busy} onChange={event => setAcknowledged(event.target.checked)} /><span>I compared every suggested statement row and confirm this SMS is a separate transaction.</span></label> : null}
    {busy ? <p role="status">Checking current statement evidence…</p> : null}
    {error ? <p className="form-error" role="alert">{error}</p> : null}
    <div className="decision-modal__actions"><button className="button" type="button" disabled={busy} onClick={onCancel}>Back to SMS</button><button className="button button--ghost" type="button" disabled={busy} onClick={onRefresh}>Refresh suggestions</button><button className="button button--danger" type="button" disabled={busy || !allReviewed || !acknowledged} onClick={() => onSeparate(different)}>Add as separate transaction</button></div>
  </ModalDialog>;
}
