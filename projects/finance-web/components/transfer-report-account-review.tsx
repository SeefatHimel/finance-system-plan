"use client";

import { useEffect, useState } from "react";
import { formatCalendarDate, formatClockTime } from "../../finance-contracts/presentation";
import { useToast } from "@/components/toast-provider";
import { getAccessToken } from "@/lib/auth-storage";
import { correctTransactionSmsEvidence, listTransactionSourceMessages, previewTransactionRevalidation, type TransactionRevalidation, type TransactionSourceMessage } from "@/lib/api";
import { linkedSmsReports, reportAccountChoices } from "@/lib/transfer-report-review";

type Props = { transactionId: string; busy: boolean; onBusyChange: (value: boolean) => void; onChanged: () => void };

export function TransferReportAccountReview({ transactionId, busy, onBusyChange, onChanged }: Props) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [revision, setRevision] = useState(0);
  const [preview, setPreview] = useState<TransactionRevalidation | null>(null);
  const [messages, setMessages] = useState<TransactionSourceMessage[]>([]);
  const [choice, setChoice] = useState<{ candidate: string; account: string } | null>(null);
  const [reviewed, setReviewed] = useState(false);
  const { notify } = useToast();

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    setLoading(true); setFailed(false); setPreview(null); setMessages([]); setChoice(null); setReviewed(false);
    const token = getAccessToken();
    if (!token) { setLoading(false); setFailed(true); return; }
    void Promise.all([
      previewTransactionRevalidation(token, transactionId, controller.signal),
      listTransactionSourceMessages(token, transactionId, controller.signal),
    ]).then(([result, originals]) => {
      if (!controller.signal.aborted) { setPreview(result); setMessages(originals); }
    }).catch(error => {
      if (!controller.signal.aborted) { setFailed(true); notify(error instanceof Error ? error.message : "Could not load saved report accounts.", "error"); }
    }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [open, transactionId, revision, notify]);

  async function correct() {
    const token = getAccessToken();
    if (!token || !preview || !choice || !reviewed || busy) return;
    onBusyChange(true);
    try {
      await correctTransactionSmsEvidence(token, transactionId, preview.token, choice.candidate, "move", choice.account);
      notify("SMS report account corrected. The transfer and original balance amounts are kept.");
      setRevision(value => value + 1);
      onChanged();
    } catch (error) {
      notify(error instanceof Error ? error.message : "Could not correct the report account. Reload and try again.", "error");
      setRevision(value => value + 1);
    } finally { onBusyChange(false); }
  }

  return <div className="transfer-report-review">
    <button className="button button--ghost button--small" type="button" aria-expanded={open} aria-controls={`report-accounts-${transactionId}`} disabled={busy} onClick={() => setOpen(value => !value)}>{open ? "Close report account review" : "Review report accounts"}</button>
    {open ? <section id={`report-accounts-${transactionId}`} aria-label="Saved transfer report accounts" aria-busy={loading}>
      <h4>Which account does each SMS report?</h4>
      <p>Bank and credit-card balances belong to separate accounts. Check the original SMS, then correct its account assignment here. Balance amounts and the money movement stay saved.</p>
      {loading ? <p role="status"><span className="transfer-report-review__spinner" aria-hidden="true" /> Loading saved reports and original SMS…</p> : null}
      {failed ? <button className="button button--ghost button--small" type="button" onClick={() => setRevision(value => value + 1)}>Retry loading reports</button> : null}
      {preview ? <>
        <dl className="transfer-report-review__balances">{preview.ledger.accounts.map(account => <div key={account.id}><dt>{account.name} · {account.direction}</dt><dd>{account.balance_after === null ? "No reported balance" : `${account.currency} ${account.balance_after}`}</dd></div>)}</dl>
        {preview.sources.filter(source => source.kind === "Saved SMS").map(source => {
          const original = messages.find(message => message.id === source.raw_message);
          const reports = linkedSmsReports(preview, source);
          const choices = reportAccountChoices(preview, source);
          return <article className="transfer-report-review__source" key={source.id}>
            <strong>Saved SMS · {source.direction ?? "Direction unknown"} · {formatCalendarDate(source.date)} · {formatClockTime(source.time)}</strong>
            <p>Saved SMS account: {source.account_name} · reported balance: {source.balance_after ?? "Not reported"}</p>
            {reports.map(report => <p key={report.id}>Attached balance report: <strong>{report.account_name}</strong> · {report.direction ?? "Unknown direction"} · {report.balance_after ?? "Not reported"}</p>)}
            {reports.length === 0 ? <p className="inline-note">This older SMS has no separate saved report yet.</p> : null}
            <details><summary>Original SMS</summary><p className="transfer-report-review__original">{original?.body ?? "Original text is unavailable or has been redacted. No source text will be rewritten."}</p></details>
            {choices.length ? <fieldset><legend>This SMS reports</legend>{choices.map(account => <label className="review-remember" key={account.id}><input type="radio" name={`report-account-${transactionId}`} checked={choice?.candidate === source.id && choice.account === account.id} disabled={busy} onChange={() => { setChoice({ candidate: source.id, account: account.id }); setReviewed(false); }} /><span>{account.name} · {account.direction}</span></label>)}</fieldset> : <p className="inline-note">{source.direction === "credit" || source.direction === "debit" ? "No account reassignment is needed for this SMS." : "Review the unknown SMS direction before assigning its reporting account."}</p>}
          </article>;
        })}
        {preview.sources.every(source => source.kind !== "Saved SMS") ? <p>No saved SMS interpretation is available for an account correction. Review this entry in Transactions.</p> : null}
        {choice ? <div className="transfer-report-review__confirm"><label className="review-remember"><input type="checkbox" checked={reviewed} disabled={busy} onChange={event => setReviewed(event.target.checked)} /><span>I checked the original SMS and confirm its reporting account.</span></label><button className="button button--primary button--small" type="button" disabled={busy || !reviewed} onClick={() => void correct()}>{busy ? "Saving account correction…" : "Correct report account"}</button></div> : null}
        <small className="field__hint">This corrects one saved SMS and its balance report. Changes appear in History and can be undone using the latest action. Refreshing the suggestions keeps your pair draft.</small>
      </> : null}
    </section> : null}
  </div>;
}
