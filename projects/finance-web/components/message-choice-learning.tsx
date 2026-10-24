"use client";

import { useState } from "react";
import { getAccessToken } from "@/lib/auth-storage";
import { rememberConfirmedMessageChoice } from "@/lib/api";

/** Learning is a separate, optional decision after the transaction is saved. */
export function MessageChoiceLearning({ candidateId, messageKind, onDone, titleId, previouslySaved = false }: { candidateId: string; messageKind: string; onDone: () => void; titleId?: string; previouslySaved?: boolean }) {
  const [busy, setBusy] = useState(false);
  const [conflict, setConflict] = useState("");
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);

  async function remember(replaceExisting = false) {
    const token = getAccessToken();
    if (!token) { setError("Sign in again before saving a rule."); return; }
    setBusy(true);
    setError("");
    try {
      await rememberConfirmedMessageChoice(token, candidateId, replaceExisting);
      setConflict("");
      setSaved(true);
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : "Could not save this rule.";
      if (reason instanceof Error && "status" in reason && reason.status === 409 && message.includes("already saved")) setConflict(message);
      else if (reason instanceof Error && "status" in reason && typeof reason.status === "number" && reason.status >= 500)
        setError("The transaction is saved, but the rule was not. The server could not save it. Try again here later; retrying will not record another transaction.");
      else setError(message);
    } finally { setBusy(false); }
  }

  return <section className="message-learning" aria-label="Optional learning after review">
    <div><h2 id={titleId}>{saved ? "Choice saved for similar SMS" : previouslySaved ? "Remember this cash withdrawal route" : "Transaction saved"}</h2>
      <p>{saved ? "Future suggestions can use this choice. Each message still needs review." : messageKind === "cash_out" ? `Want future withdrawals from this SMS source to suggest the same cash destination? This does not change the transaction you ${previouslySaved ? "recorded" : "just saved"}.` : "You can save this choice for similar messages from this SMS source. This does not change the transaction you just saved."}</p></div>
    {conflict ? <p className="form-warning" role="alert">{conflict}</p> : null}
    {error ? <p className="form-error" role="alert">{error}</p> : null}
    <div className="message-learning__actions">
      {!saved && !conflict ? <button className="button button--ghost" type="button" disabled={busy} onClick={() => void remember()}>{busy ? "Saving rule…" : "Save for similar SMS"}</button> : null}
      {conflict ? <button className="button button--ghost" type="button" disabled={busy} onClick={() => void remember(true)}>{busy ? "Replacing rule…" : "Replace saved rule"}</button> : null}
      <button className="button button--primary" type="button" disabled={busy} onClick={onDone}>{saved ? "Done" : previouslySaved ? "Close" : "Continue without saving a rule"}</button>
    </div>
  </section>;
}
