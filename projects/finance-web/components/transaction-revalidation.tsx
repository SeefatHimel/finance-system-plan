"use client";

import { useEffect, useState } from "react";
import { X } from "@phosphor-icons/react";
import { ModalDialog } from "@/components/modal-dialog";
import { useToast } from "@/components/toast-provider";
import { getAccessToken } from "@/lib/auth-storage";
import { applyTransactionRevalidation, previewTransactionRevalidation, type TransactionRevalidation } from "@/lib/api";

type Props = { transactionId: string; onClose: () => void };

export function TransactionRevalidationDialog({ transactionId, onClose }: Props) {
  const [preview, setPreview] = useState<TransactionRevalidation | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const { notify } = useToast();
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError(""); setPreview(null); setSelected([]);
    const token = getAccessToken();
    if (!token) { setError("Sign in before revalidating transactions."); setLoading(false); return; }
    void previewTransactionRevalidation(token, transactionId, controller.signal).then(result => {
      if (!controller.signal.aborted) setPreview(result);
    }).catch(failure => {
      if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : "Could not revalidate this transaction.");
    }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [transactionId, revision]);

  async function apply() {
    const token = getAccessToken();
    if (!token || !preview || !selected.length || busy) return;
    setBusy(true); setError("");
    try {
      await applyTransactionRevalidation(token, transactionId, preview.token, selected);
      window.dispatchEvent(new Event("finance:transactions-changed"));
      notify("Selected corrections applied. Original SMS and statement evidence kept.");
      onClose();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Could not apply corrections. Refresh the preview before trying again.");
      // An uncertain response or stale preview must never reuse the approval.
      setSelected([]); setPreview(null);
    } finally { setBusy(false); }
  }

  return <ModalDialog className="form-drawer transaction-revalidation" labelledBy="revalidation-title" busy={busy} onCancel={onClose}>
    <div className="form-drawer__header"><div><h2 id="revalidation-title">Revalidate transaction</h2><p>Review attached evidence and current SMS rules. Select only the corrections you want.</p></div><button type="button" className="icon-button" aria-label="Close revalidation" disabled={busy} onClick={onClose}><X size={20} aria-hidden="true" /></button></div>
    <div className="transaction-revalidation__body" aria-busy={loading}>
      {loading ? <p role="status">Checking saved sources…</p> : null}
      {error ? <p role="alert">{error}</p> : null}
      {preview ? <>
        <p className="inline-note">{preview.currency} · No changes have been applied. Preview expires in 15 minutes.</p>
        {preview.suggestions.length ? <fieldset className="transaction-revalidation__choices"><legend>Suggested corrections</legend>{preview.suggestions.map(item => <label className="transaction-revalidation__choice" key={item.key}>
          <input type="checkbox" checked={selected.includes(item.key)} disabled={busy} onChange={event => setSelected(current => event.target.checked ? [...current, item.key] : current.filter(key => key !== item.key))} />
          <span><strong>{item.label}</strong><span>{item.current ?? "Not reported"} → <strong>{item.proposed}</strong></span><small>{item.reason}</small></span>
        </label>)}</fieldset> : <p role="status">No eligible corrections found. Review any warnings below; this check does not verify every transaction detail.</p>}
        {preview.warnings.length ? <div className="inline-note"><strong>Needs review</strong><ul>{preview.warnings.map(warning => <li key={warning}>{warning}</li>)}</ul></div> : null}
        <details><summary>Compared source values ({preview.sources.length})</summary><div className="transaction-revalidation__sources">{preview.sources.map(source => <article key={`${source.kind}-${source.id}`}><strong>{source.kind} · {source.account_name}</strong><span>Amount: {source.amount ?? "Not reported"} · Balance after: {source.balance_after ?? "Not reported"}</span>{!source.usable ? <span>Account, date, direction or currency needs review</span> : null}</article>)}</div></details>
        <p className="inline-note">Corrections update this ledger entry only. Original source values and links stay saved; changes appear in History and can be undone using the latest action.</p>
      </> : null}
    </div>
    <div className="form-drawer__footer"><button type="button" className="button button--ghost" disabled={busy} onClick={onClose}>Cancel</button><button type="button" className="button button--ghost" disabled={busy || loading} onClick={() => { setSelected([]); setPreview(null); setLoading(true); setRevision(value => value + 1); }}>Refresh preview</button><button type="button" className="button button--primary" disabled={busy || loading || !selected.length || !preview} onClick={() => void apply()}>{busy ? "Applying…" : `Apply selected${selected.length ? ` (${selected.length})` : ""}`}</button></div>
  </ModalDialog>;
}
