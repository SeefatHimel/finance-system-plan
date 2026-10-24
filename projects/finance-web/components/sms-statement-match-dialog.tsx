"use client";

import { useState } from "react";
import { formatCalendarDate, formatClockTime, formatTimestamp } from "../../finance-contracts/presentation";
import { ModalDialog } from "@/components/modal-dialog";
import type { ConfirmMessageCandidateInput, ParsedMessageCandidate, SmsStatementMatch } from "@/lib/api";

export function SmsStatementMatchDialog({ candidate, input, accountName, matches, busy, error, onCancel, onReview, onSeparate, onRefresh }: {
  candidate: ParsedMessageCandidate;
  input: ConfirmMessageCandidateInput;
  accountName: string;
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
    <h2 id="sms-statement-match-title">Choose how this SMS matches a statement</h2>
    <p>Compare the sources here. Pairing creates one transaction with both sources attached; you do not need to add the SMS first.</p>
    <div className="sms-statement-match-comparison">
    <section className="sms-statement-selected" aria-label="SMS being reviewed">
      <div className="sms-statement-selected__heading"><strong>SMS you are reviewing</strong><span>{candidate.raw_message.sender} · {formatTimestamp(candidate.raw_message.received_at)}</span></div>
      <p className="statement-evidence-text">{candidate.raw_message.body || "Original SMS unavailable under retention settings."}</p>
      <p className="field__hint">Your current form: {accountName} · {input.type?.replaceAll("_", " ") ?? candidate.transaction_type.replaceAll("_", " ")} · {input.direction || candidate.source_direction || "Direction to review"} · {input.amount ?? candidate.amount ?? "Amount needed"} · balance after {input.balance_after ?? "Not reported"}{input.note ? ` · note: ${input.note}` : ""}</p>
    </section>
    <div className="sms-statement-match-list">
      {matches.map(match => <article className="sms-statement-match-card" key={match.statement.id}>
        <div className="sms-statement-match-card__heading"><strong>{match.statement.account_name} · {match.statement.currency} {match.statement.amount}</strong><span className={`status-badge ${match.unique && match.signals.strength === "strong" ? "status-badge--ok" : "status-badge--warning"}`}>{match.unique && match.signals.strength === "strong" ? "Strong match" : "Needs your decision"}</span></div>
        <p><strong>Statement</strong> · {formatCalendarDate(match.statement.date)}{match.statement.time ? ` · ${formatClockTime(match.statement.time)}` : ""} · {match.statement.direction} · {match.statement.type.replaceAll("_", " ")}</p>
        <p>{match.statement.description || "No statement description"}</p>
        <p className="field__hint">Reference: {match.statement.reference || "Not reported"} · Balance after: {match.statement.balance_after ?? "Not reported"}</p>
        <details><summary>Why suggested</summary><ul>{match.signals.reasons.map((reason, index) => <li key={index}>{reason}</li>)}</ul></details>
        {!match.unique ? <p className="form-warning">Other pending sources may also match. You can compare them in the next step and choose this pair explicitly.</p> : null}
        <div className="statement-actions"><button className="button button--primary" type="button" disabled={busy || different.includes(match.statement.id)} onClick={() => onReview(match)}>{match.unique ? "Review both sources · count once" : "Compare alternatives · choose this pair"}</button></div>
        <label className="review-remember"><input type="checkbox" checked={different.includes(match.statement.id)} disabled={busy} onChange={event => {
          setDifferent(current => event.target.checked ? [...current, match.statement.id] : current.filter(id => id !== match.statement.id));
          setAcknowledged(false);
        }} /><span>This statement row is a different money movement.</span></label>
      </article>)}
    </div>
    </div>
    {allReviewed ? <label className="review-remember"><input type="checkbox" checked={acknowledged} disabled={busy} onChange={event => setAcknowledged(event.target.checked)} /><span>I compared every suggested statement row and confirm this SMS is a separate transaction.</span></label> : null}
    {busy ? <p role="status">Checking current statement evidence…</p> : null}
    {error ? <p className="form-error" role="alert">{error}</p> : null}
    <div className="decision-modal__actions"><button className="button" type="button" disabled={busy} onClick={onCancel}>Back to SMS</button><button className="button button--ghost" type="button" disabled={busy} onClick={onRefresh}>Refresh suggestions</button><button className="button button--danger" type="button" disabled={busy || !allReviewed || !acknowledged} onClick={() => onSeparate(different)}>Add as separate transaction</button></div>
  </ModalDialog>;
}
