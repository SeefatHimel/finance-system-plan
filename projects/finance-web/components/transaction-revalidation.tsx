"use client";

import { useEffect, useState } from "react";
import { ArrowRight, WarningCircle, X } from "@phosphor-icons/react";
import { formatCalendarDate } from "../../finance-contracts/presentation";
import { ModalDialog } from "@/components/modal-dialog";
import { useToast } from "@/components/toast-provider";
import { getAccessToken } from "@/lib/auth-storage";
import { applyTransactionRevalidation, previewTransactionRevalidation, type TransactionRevalidation } from "@/lib/api";

type Props = { transactionId: string; onClose: () => void; onEdit: () => void };
type Source = TransactionRevalidation["sources"][number];

function formattedMoney(value: string | null, currency: string | null) {
  if (value === null) return "Not reported";
  const amount = Number(value);
  return `${currency ?? ""} ${Number.isFinite(amount) ? amount.toLocaleString("en-BD", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : value}`.trim();
}

function SourceRow({ source, currency }: { source: Source; currency: string }) {
  return <article className={`revalidation-source${source.usable ? "" : " revalidation-source--conflict"}`}>
    <div className="revalidation-source__heading">
      <strong>{source.kind}</strong>
      <span className={`revalidation-source__badge${source.usable ? "" : " revalidation-source__badge--conflict"}`}>{source.usable ? "Ledger path matches" : "Check source"}</span>
    </div>
    <dl className="revalidation-source__values">
      <div><dt>Direction</dt><dd>{source.direction || "Unknown"}</dd></div>
      <div><dt>Date</dt><dd>{source.date ? formatCalendarDate(source.date) : "Unknown"}</dd></div>
      <div><dt>Amount</dt><dd>{formattedMoney(source.amount, source.currency ?? currency)}</dd></div>
      <div><dt>Balance after</dt><dd>{formattedMoney(source.balance_after, source.currency ?? currency)}</dd></div>
    </dl>
    {source.issues.length ? <ul className="revalidation-source__issues">{source.issues.map(issue => <li key={issue}>{issue}</li>)}</ul> : null}
  </article>;
}

export function TransactionRevalidationDialog({ transactionId, onClose, onEdit }: Props) {
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
      const saved = await applyTransactionRevalidation(token, transactionId, preview.token, selected);
      window.dispatchEvent(new CustomEvent("finance:transaction-saved", { detail: saved }));
      window.dispatchEvent(new Event("finance:transactions-changed"));
      notify("Selected corrections applied. Original SMS and statement evidence kept.");
      onClose();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Could not apply corrections. Refresh the preview before trying again.");
      setSelected([]); setPreview(null);
    } finally { setBusy(false); }
  }

  const selectedChanges = preview?.suggestions.filter(item => selected.includes(item.key)) ?? [];
  const sourceConflicts = preview?.sources.filter(source => !source.usable) ?? [];
  const genericWarnings = new Set([
    "An attached source has a different account, direction, currency or date. Review it manually.",
    "Current SMS rules do not identify the same reporting account. Review the account manually.",
  ]);
  const remainingWarnings = preview?.warnings.filter(warning => !sourceConflicts.length || !genericWarnings.has(warning)) ?? [];

  return <ModalDialog className="form-drawer transaction-revalidation" labelledBy="revalidation-title" busy={busy} onCancel={onClose}>
    <div className="form-drawer__header">
      <div><h2 id="revalidation-title">Review ledger corrections</h2><p>Compare what is saved with each attached source before changing this entry.</p></div>
      <button type="button" className="icon-button" aria-label="Close revalidation" disabled={busy} onClick={onClose}><X size={20} aria-hidden="true" /></button>
    </div>
    <div className="transaction-revalidation__body" aria-busy={loading}>
      {loading ? <p className="revalidation-loading" role="status"><span className="evidence-spinner" aria-hidden="true" />Checking saved sources…</p> : null}
      {error ? <p className="form-error" role="alert">{error}</p> : null}
      {preview ? <>
        <section className="revalidation-ledger" aria-label="Current ledger entry">
          <div><span className="revalidation-eyebrow">Current ledger entry</span><h3>{preview.ledger.type} · {formattedMoney(preview.ledger.amount, preview.currency)}</h3><p>{formatCalendarDate(preview.ledger.date)} · No changes have been applied.</p></div>
          <div className="revalidation-ledger__accounts">{preview.ledger.accounts.map(account => <div key={account.id}><strong>{account.name}</strong><span>{account.direction} · Balance after {formattedMoney(account.balance_after, account.currency)}</span></div>)}</div>
        </section>

        {preview.suggestions.length ? <fieldset className="transaction-revalidation__choices">
          <legend>Available corrections</legend>
          <p>Each choice changes only the field shown. Leave it unchecked to keep the current ledger value.</p>
          {preview.suggestions.map(item => <label className="transaction-revalidation__choice" key={item.key}>
            <input type="checkbox" checked={selected.includes(item.key)} disabled={busy} onChange={event => setSelected(current => event.target.checked ? [...current, item.key] : current.filter(key => key !== item.key))} />
            <span><strong>{item.label}</strong><span className="revalidation-change"><span>{item.current ?? "Not reported"}</span><ArrowRight size={18} aria-hidden="true" /><strong>{item.proposed}</strong></span><small>{item.reason}</small></span>
          </label>)}
        </fieldset> : sourceConflicts.length || remainingWarnings.length ? <section className="revalidation-blocked" aria-label="No automatic correction available">
          <WarningCircle size={22} weight="fill" aria-hidden="true" />
          <div><h3>No automatic correction is safe yet</h3><p>Compare the account, direction and date of each source below. You can correct a verified ledger value in the editor.</p><button className="button button--ghost button--small" type="button" disabled={busy} onClick={onEdit}>Review ledger entry</button></div>
        </section> : <section className="revalidation-no-change" role="status"><h3>No changes suggested</h3><p>The attached sources do not offer a safe correction to this ledger entry.</p></section>}

        <section className="revalidation-comparison" aria-labelledby="revalidation-sources-heading">
          <div><h3 id="revalidation-sources-heading">What the evidence says</h3><p>Sources are grouped by reporting account. A linked report is a saved review decision; check the original SMS or statement before changing the ledger.</p></div>
          {preview.ledger.accounts.map(account => {
            const sources = preview.sources.filter(source => source.account === account.id);
            if (!sources.length) return null;
            return <section className="revalidation-account" key={account.id} aria-label={`${account.name} evidence`}>
              <header><div><strong>{account.name}</strong><span>Ledger balance after: {formattedMoney(account.balance_after, account.currency)}</span></div><span>{sources.length} source{sources.length === 1 ? "" : "s"}</span></header>
              <div className="revalidation-account__sources">{sources.map(source => <SourceRow key={`${source.kind}-${source.id}`} source={source} currency={preview.currency} />)}</div>
            </section>;
          })}
          {preview.sources.filter(source => !source.account || !preview.ledger.accounts.some(account => account.id === source.account)).map(source => <section className="revalidation-account revalidation-account--unmatched" key={`${source.kind}-${source.id}`} aria-label={`${source.account_name} unmatched evidence`}><header><strong>{source.account_name} · outside this ledger path</strong></header><SourceRow source={source} currency={preview.currency} /></section>)}
          {!preview.sources.length ? <p>No attached source observations were found.</p> : null}
        </section>

        {remainingWarnings.length ? <section className="revalidation-warnings" aria-label="Other review notes"><h3>Other review notes</h3><ul>{remainingWarnings.map(warning => <li key={warning}>{warning}</li>)}</ul></section> : null}
        {selectedChanges.length ? <section className="revalidation-confirm" aria-label="Selected ledger changes"><h3>Changes you selected</h3><ul>{selectedChanges.map(item => <li key={item.key}><strong>{item.label}</strong><span>{item.current ?? "Not reported"} → {item.proposed}</span></li>)}</ul></section> : null}
        <p className="revalidation-footnote">Only the ledger entry changes. Original sources and links stay saved. The preview expires in 15 minutes; applied changes appear in History and can be undone using the latest action.</p>
      </> : null}
    </div>
    <div className="form-drawer__footer">
      <button type="button" className="button button--ghost" disabled={busy} onClick={onClose}>Close</button>
      <button type="button" className="button button--ghost" disabled={busy || loading} onClick={() => { setSelected([]); setPreview(null); setLoading(true); setRevision(value => value + 1); }}>Refresh comparison</button>
      {preview?.suggestions.length ? <button type="button" className="button button--primary" disabled={busy || loading || !selected.length} onClick={() => void apply()}>{busy ? "Applying…" : `Apply ${selected.length} selected change${selected.length === 1 ? "" : "s"}`}</button> : null}
    </div>
  </ModalDialog>;
}
