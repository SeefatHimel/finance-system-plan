"use client";

import { useState } from "react";
import { formatCalendarDate } from "../../finance-contracts/presentation";
import { DocumentPasswordField } from "@/components/document-password-field";
import { LoadingState } from "@/components/loading-state";
import { useTransactionRecovery } from "@/components/transaction-recovery";
import { getAccessToken } from "@/lib/auth-storage";
import { recheckStatementDirections, reviewStatementSourceDirection, type StatementDirectionRecheck } from "@/lib/api";

export function StatementDirectionRecheck({ importId, hasOriginal, accountName, onReviewRow }: {
  importId: string; hasOriginal: boolean; accountName: string; onReviewRow: (id: string) => void;
}) {
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<StatementDirectionRecheck | null>(null);
  const [visible, setVisible] = useState(25);
  const [chosen, setChosen] = useState<Record<string, "debit" | "credit">>({});
  const [confirmed, setConfirmed] = useState<Record<string, boolean>>({});
  const [alignDraft, setAlignDraft] = useState<Record<string, boolean>>({});
  const [saving, setSaving] = useState<string | null>(null);
  const [saved, setSaved] = useState<Record<string, string>>({});
  const { revalidate } = useTransactionRecovery();

  async function run() {
    const token = getAccessToken();
    if (!token || busy) return;
    setBusy(true); setError(""); setResult(null); setVisible(25);
    setChosen({}); setConfirmed({}); setAlignDraft({}); setSaved({});
    const unlock = password;
    setPassword("");
    try { setResult(await recheckStatementDirections(token, importId, unlock)); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Could not recheck this statement. Try again."); }
    finally { setBusy(false); }
  }

  async function reviewSource(rowId: string, version: number) {
    const token = getAccessToken();
    const direction = chosen[rowId];
    if (!token || !direction || !confirmed[rowId] || saving) return;
    setSaving(rowId); setError("");
    try {
      const updated = await reviewStatementSourceDirection(token, rowId, version, direction, alignDraft[rowId] ?? false);
      setResult(current => current && ({ ...current, issues: current.issues.map(issue => issue.row_id === rowId ? { ...issue, version: updated.version, reviewed_direction: updated.reviewed_direction, draft_direction: updated.draft_direction } : issue) }));
      setSaved(current => ({ ...current, [rowId]: `Reviewed PDF direction saved as ${updated.reviewed_direction}.${alignDraft[rowId] ? " Saved draft aligned." : " Saved draft unchanged."} Ledger unchanged. Recheck to refresh the findings.` }));
      setConfirmed(current => ({ ...current, [rowId]: false }));
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not save the reviewed direction."); }
    finally { setSaving(null); }
  }

  return <section className="statement-direction-recheck" aria-labelledby="statement-direction-recheck-title">
    <h3 id="statement-direction-recheck-title">Check saved debit and credit</h3>
    <p>Re-read this bKash PDF with the current parser and compare it with the original saved extraction, your draft, and any linked ledger entry. This check changes nothing.</p>
    {hasOriginal ? <form className="statement-actions" autoComplete="off" onSubmit={event => { event.preventDefault(); void run(); }}>
      <button className="button" type="submit" disabled={busy}>{busy ? "Checking statement…" : "Recheck saved directions"}</button>
      <DocumentPasswordField id="direction-recheck-pdf-password" value={password} onChange={setPassword} disabled={busy} />
    </form> : <p role="status" className="inline-note">The original PDF is missing. Re-upload the identical file under {accountName}; the existing import will reopen without adding duplicate rows or transactions. Then run this check.</p>}
    {busy ? <LoadingState compact label="Checking saved statement" detail="Comparing the PDF, saved rows and linked entries" /> : null}
    {error ? <p role="alert" className="form-error">{error}</p> : null}
    {result ? <div className="statement-direction-recheck__results">
      <p role="status"><strong>{result.issues.length ? `${result.issues.length} row${result.issues.length === 1 ? "" : "s"} need review` : "No direction disagreements found"}</strong> · {result.checked_rows} principal rows checked with parser {result.parser_version}.</p>
      <p>This is a comparison, not proof that every PDF column was read correctly. Check the original PDF where a row is uncertain. Nothing in the ledger has been changed.</p>
      {result.issues.slice(0, visible).map(issue => <article className="statement-direction-recheck__issue" key={issue.row_id}>
        <strong>Page {issue.page ?? "?"}, row {issue.source_row ?? "?"} · {formatCalendarDate(issue.date)} · BDT {issue.amount ?? "unknown"}</strong>
        <p>Original saved: {issue.original_direction ?? "unknown"} → Current parser: {issue.fresh_direction ?? "unverified"} → Reviewed PDF: {issue.reviewed_direction ?? "not yet reviewed"} → Saved draft: {issue.draft_direction}{issue.ledger_direction ? ` → Ledger: ${issue.ledger_direction}` : ""}</p>
        <ul>{issue.reasons.map(reason => <li key={reason}>{reason}</li>)}</ul>
        <div className="statement-direction-recheck__confirm">
          <label className="field"><span className="field__label">Which PDF column contains this amount?</span><select className="field__control" value={chosen[issue.row_id] ?? ""} onChange={event => setChosen(current => ({ ...current, [issue.row_id]: event.target.value as "debit" | "credit" }))}><option value="">Choose after checking the PDF</option><option value="debit">Out → debit</option><option value="credit">In → credit</option></select></label>
          <label className="review-remember"><input type="checkbox" checked={confirmed[issue.row_id] ?? false} onChange={event => setConfirmed(current => ({ ...current, [issue.row_id]: event.target.checked }))} /><span>I checked this exact row in the original PDF.</span></label>
          <label className="review-remember"><input type="checkbox" checked={alignDraft[issue.row_id] ?? false} onChange={event => setAlignDraft(current => ({ ...current, [issue.row_id]: event.target.checked }))} /><span>Also change the saved draft to this direction. For a linked entry, this works only if the ledger already agrees. It never changes the ledger.</span></label>
          <button className="button button--small" type="button" disabled={!chosen[issue.row_id] || !confirmed[issue.row_id] || Boolean(saving)} onClick={() => void reviewSource(issue.row_id, issue.version)}>{saving === issue.row_id ? "Saving reviewed source…" : "Save verified PDF direction"}</button>
          {saved[issue.row_id] ? <p role="status">{saved[issue.row_id]}</p> : null}
        </div>
        <div className="statement-actions"><button className="button button--small" type="button" onClick={() => onReviewRow(issue.row_id)}>Review statement row</button>{issue.transaction_id ? <button className="button button--small" type="button" onClick={() => revalidate(issue.transaction_id!)}>Compare linked ledger entry</button> : null}</div>
      </article>)}
      {visible < result.issues.length ? <button className="button" type="button" onClick={() => setVisible(count => count + 25)}>Show 25 more issues</button> : null}
    </div> : null}
  </section>;
}
