"use client";

import { useState } from "react";
import { formatCalendarDate, formatClockTime, formatTimestamp } from "../../finance-contracts/presentation";
import { ModalDialog } from "@/components/modal-dialog";
import { SourceAttention } from "@/components/source-attention";
import { SourceEvidenceLegend, SourceEvidenceText } from "@/components/source-evidence-text";
import { StatementPdfReference } from "@/components/statement-pdf-reference";
import { localDate } from "@/lib/date-period";
import { agreeingSmsStatementEvidence, compareSmsStatementReports } from "@/lib/sms-statement-evidence";
import type { ConfirmMessageCandidateInput, ParsedMessageCandidate, SmsStatementMatch } from "@/lib/api";

export function SmsStatementMatchDialog({ candidate, input, accountName, matches, busy, onCancel, onReview, onSeparate, onRefresh }: {
  candidate: ParsedMessageCandidate;
  input: ConfirmMessageCandidateInput;
  accountName: string;
  matches: SmsStatementMatch[];
  busy: boolean;
  onCancel: () => void;
  onReview: (match: SmsStatementMatch) => void;
  onSeparate: (ids: string[]) => void;
  onRefresh: () => void;
}) {
  const [different, setDifferent] = useState<string[]>([]);
  const [acknowledged, setAcknowledged] = useState(false);
  const allReviewed = matches.every(match => different.includes(match.statement.id));
  const smsFacts = { amount: candidate.amount, balanceAfter: candidate.balance_after, date: localDate(new Date(candidate.raw_message.received_at)), reference: candidate.reference, identifiers: [candidate.sender_account_identifier, candidate.sender_card_identifier, candidate.receiver_account_identifier, candidate.receiver_card_identifier], direction: candidate.source_direction };
  return <ModalDialog labelledBy="sms-statement-match-title" className="decision-modal sms-statement-match-dialog" busy={busy} onCancel={onCancel}>
    <h2 id="sms-statement-match-title">Choose how this SMS matches a statement</h2>
    <p>Compare the sources here. Pairing creates one transaction with both sources attached; you do not need to add the SMS first.</p>
    <div className="sms-statement-match-comparison">
    <section className="sms-statement-selected" aria-label="SMS being reviewed">
      <div className="sms-statement-selected__heading"><strong>SMS you are reviewing</strong><span>{candidate.raw_message.sender} · {formatTimestamp(candidate.raw_message.received_at)}</span></div>
      <p className="statement-evidence-text">{candidate.raw_message.body ? <SourceEvidenceText text={candidate.raw_message.body} facts={smsFacts} /> : "Original SMS unavailable under retention settings."}</p>
      {candidate.raw_message.body ? <SourceEvidenceLegend text={candidate.raw_message.body} facts={smsFacts} /> : null}
      <p className="field__hint">Your current form: {accountName} · {input.type?.replaceAll("_", " ") ?? candidate.transaction_type.replaceAll("_", " ")} · {input.direction || candidate.source_direction || "Direction to review"} · {input.amount ?? candidate.amount ?? "Amount needed"} · balance after {input.balance_after ?? "Not reported"}{input.note ? ` · note: ${input.note}` : ""}</p>
    </section>
    <div className="sms-statement-match-list">
      {matches.map(match => {
        const evidence = agreeingSmsStatementEvidence(match.statement, candidate, match.signals);
        const comparison = compareSmsStatementReports(match.statement, {
          date: localDate(new Date(candidate.raw_message.received_at)),
          balance_after: candidate.balance_after,
        }, match.signals.late_posting);
        const statementFacts = { amount: match.statement.amount, balanceAfter: match.statement.balance_after, date: match.statement.date, valueDate: match.statement.value_date, reference: match.statement.reference, identifiers: [candidate.sender_account_identifier, candidate.sender_card_identifier], direction: match.statement.direction };
        return <article className="sms-statement-match-card" key={match.statement.id}>
        <div className="sms-statement-match-card__heading"><strong>{match.statement.account_name} · {match.statement.currency} {match.statement.amount}</strong><span className={`status-badge ${match.unique && match.signals.strength === "strong" ? "status-badge--ok" : "status-badge--warning"}`}>{match.unique && match.signals.strength === "strong" ? "Strong match" : "Needs your decision"}</span></div>
        <SourceAttention statement={match.statement} sms={{ account: candidate.account, direction: candidate.source_direction, amount: candidate.amount, date: smsFacts.date, balance_after: candidate.balance_after }} latePosting={match.signals.late_posting} />
        <p><strong>Statement</strong> · {match.statement.direction} · {match.statement.type.replaceAll("_", " ")}</p>
        <p className="statement-evidence-text">{match.statement.description ? <SourceEvidenceText text={match.statement.description} facts={statementFacts} /> : "No statement description"}</p>
        {match.statement.description ? <SourceEvidenceLegend text={match.statement.description} facts={statementFacts} /> : null}
        <p className="field__hint">Reference: {match.statement.reference || "Not reported"}</p>
        <StatementPdfReference batchId={match.statement.batch} rowId={match.statement.id} />
        <div className="sms-statement-report-comparison" aria-label="Date and reported balance comparison">
          <div className={`sms-statement-report-comparison__item sms-statement-report-comparison__item--${comparison.date === "match" ? "match" : comparison.date === "unknown" ? "unknown" : "review"}`}>
            <strong>Date</strong>
            <span>SMS: {formatTimestamp(candidate.raw_message.received_at)}</span>
            <span>Statement posted: {formatCalendarDate(match.statement.date)}{match.statement.time ? ` · ${formatClockTime(match.statement.time)}` : ""}</span>
            {match.statement.value_date ? <span>Statement value date: {formatCalendarDate(match.statement.value_date)}</span> : null}
            <b>{comparison.date === "match" ? "Dates match" : comparison.date === "value_date_match" ? "Value date matches SMS; posting date differs" : comparison.date === "different" ? "Dates differ · check the timing" : "Date not available for comparison"}</b>
          </div>
          <div className={`sms-statement-report-comparison__item sms-statement-report-comparison__item--${comparison.balance === "match" ? "match" : comparison.balance === "unknown" ? "unknown" : "review"}`}>
            <strong>Reported balance after</strong>
            <span>SMS: {candidate.balance_after ?? "Not reported"}</span>
            <span>Statement: {match.statement.balance_after ?? "Not reported"}</span>
            <b>{comparison.balance === "match" ? "Balances match" : comparison.balance === "different_reporting_times" ? "Different reporting times · compare separately" : comparison.balance === "different" ? "Balances differ · review before pairing" : "One balance is not reported"}</b>
          </div>
        </div>
        {evidence.length ? <div className="sms-statement-agreement" aria-label="Source details that agree"><strong>Details that agree</strong><ul>{evidence.map(item => <li key={item.label}><span>{item.label}</span><strong>{item.value}</strong></li>)}</ul><span className="field__hint">These clues support review; they do not confirm the pair.</span></div> : null}
        <details><summary>Why suggested</summary><ul>{match.signals.reasons.map((reason, index) => <li key={index}>{reason}</li>)}</ul></details>
        {!match.unique ? <p className="form-warning">Other pending sources may also match. Review them before the final confirmation.</p> : null}
        <div className="statement-actions"><button className="button button--primary" type="button" disabled={busy || different.includes(match.statement.id)} onClick={() => onReview(match)}>Review as one transaction</button><span className="field__hint">Opens the final comparison; nothing is recorded yet.</span></div>
        <label className="review-remember"><input type="checkbox" checked={different.includes(match.statement.id)} disabled={busy} onChange={event => {
          setDifferent(current => event.target.checked ? [...current, match.statement.id] : current.filter(id => id !== match.statement.id));
          setAcknowledged(false);
        }} /><span>This statement is a different transaction. Only select this to add the SMS separately.</span></label>
      </article>})}
    </div>
    </div>
    {allReviewed ? <label className="review-remember"><input type="checkbox" checked={acknowledged} disabled={busy} onChange={event => setAcknowledged(event.target.checked)} /><span>I compared every suggested statement row and confirm this SMS is a separate transaction.</span></label> : null}
    {busy ? <p role="status">Checking current statement evidence…</p> : null}
    <div className="decision-modal__actions"><button className="button" type="button" disabled={busy} onClick={onCancel}>Back to SMS</button><button className="button button--ghost" type="button" disabled={busy} onClick={onRefresh}>Refresh suggestions</button><button className="button button--danger" type="button" disabled={busy || !allReviewed || !acknowledged} onClick={() => onSeparate(different)}>Add as separate transaction</button></div>
  </ModalDialog>;
}
