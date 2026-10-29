"use client";
import { useEffect, useState } from "react";
import { ArrowDown, ArrowUp, ArrowClockwise, X } from "@phosphor-icons/react";
import { ModalDialog } from "@/components/modal-dialog";
import { useToast } from "@/components/toast-provider";
import { getAccessToken } from "@/lib/auth-storage";
import { type Account, type TimelineOrderPreview, getTimelineOrderPreview, saveTimelineOrder } from "@/lib/api";
import { formatCurrency, formatCalendarDate, formatClockTime } from "../../finance-contracts/presentation";

export function TimelineOrderDialog({ date, accounts, initialAccount, onClose, onChange }: { date: string; accounts: Account[]; initialAccount?: string; onClose: () => void; onChange: () => void }) {
  const { notify } = useToast();
  const [account, setAccount] = useState(initialAccount ?? accounts[0]?.id ?? "");
  const [preview, setPreview] = useState<TimelineOrderPreview | null>(null);
  const [ids, setIds] = useState<string[]>([]);
  const [revision, setRevision] = useState(0);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    const token = getAccessToken(); if (!token || !account) return;
    const controller = new AbortController(); setLoading(true); setPreview(null); setError("");
    void getTimelineOrderPreview(token, account, date, controller.signal).then(result => { if (!controller.signal.aborted) { setPreview(result); setIds(result.ordered_ids); } })
      .catch((reason: unknown) => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Could not load placement preview."); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [account, date, revision]);
  async function save(action: "apply" | "clear" | "undo") {
    const token = getAccessToken(); if (!token || !preview) return;
    setBusy(true); setError("");
    try { const result = await saveTimelineOrder(token, preview, action, ids); setPreview(result); setIds(result.ordered_ids); onChange(); notify(action === "apply" ? "Timeline order saved. Actual transaction times stay unchanged." : action === "undo" ? "Previous timeline order restored." : "Saved timeline placement cleared."); }
    catch (reason) { const message = reason instanceof Error ? reason.message : "Could not save placement."; setError(message); notify(message, "error"); }
    finally { setBusy(false); }
  }
  function move(index: number, step: number) { setIds(current => { const next = [...current]; [next[index], next[index + step]] = [next[index + step], next[index]]; return next; }); }
  return <ModalDialog className="form-drawer timeline-order-dialog" labelledBy="timeline-order-title" busy={busy} onCancel={() => { if (!busy) onClose(); }}>
    <div className="form-drawer__header"><div><h2 id="timeline-order-title">Place untimed movements</h2><p>{formatCalendarDate(date)} · Display order only</p></div><button className="icon-button" type="button" aria-label="Close placement" disabled={busy} onClick={onClose}><X size={20} /></button></div>
    <div className="timeline-order-body"><p className="muted-text">Choose where these movements belong relative to known activity. No clock time, transaction date, amount or account balance will be changed. You can insert more movements later without squeezing them into artificial seconds.</p>
      <label className="field"><span className="field__label">Account</span><select className="field__control" value={account} disabled={busy} onChange={event => setAccount(event.target.value)}>{accounts.map(row => <option key={row.id} value={row.id}>{row.name}</option>)}</select></label>
      <button className="button button--ghost" disabled={busy || loading} type="button" onClick={() => setRevision(value => value + 1)}><ArrowClockwise size={18} />Refresh preview</button>
      {loading ? <p role="status">Checking the complete recorded account day…</p> : null}
      {error ? <p className="form-error" role="alert">{error}</p> : null}
      {preview ? <>
        {preview.saved_status === "stale" ? <p className="form-error">Activity or source evidence changed. The old placement is not being used. Review and save a new order.</p> : null}
        <div className="timeline-order-reason"><strong>{preview.suggested_ids ? "Balance-supported suggestion" : "Manual review needed"}</strong><p>{preview.reason}</p>{preview.suggested_ids ? <button className="button button--ghost" disabled={busy} onClick={() => setIds(preview.suggested_ids!)} type="button">Preview suggested order</button> : null}</div>
        <p className="muted-text">Known times remain fixed relative to each other. Move the untimed items up or down; the saved positions will be marked {preview.basis === "balance" ? "balance-supported" : "reviewed order"}.</p>
        <ol className="timeline-order-list">{ids.map((id, index) => { const row = preview.rows.find(item => item.id === id)!; return <li key={id}>
          <div><strong>{row.label}</strong><small>{row.time ? `${formatClockTime(row.time)} · Reported time` : "Time not reported · order only"}</small><span>{row.direction === "credit" ? "+" : "−"}{formatCurrency(row.amount, preview.currency)} · Balance {row.balance_after === null ? "not reported" : formatCurrency(row.balance_after, preview.currency)}</span>{row.posting_context ? <small>Posting date context · verify against statement</small> : null}</div>
          {!row.time ? <div className="timeline-order-move"><button className="icon-button" type="button" aria-label={`Move ${row.label} earlier`} disabled={busy || index === 0} onClick={() => move(index, -1)}><ArrowUp size={18} /></button><button className="icon-button" type="button" aria-label={`Move ${row.label} later`} disabled={busy || index === ids.length - 1} onClick={() => move(index, 1)}><ArrowDown size={18} /></button></div> : <span className="badge">Known time</span>}
        </li>; })}</ol>
        {!preview.rows.length ? <p>No movements in this account on this date.</p> : null}
      </> : null}
    </div>
    <div className="transaction-editor-actions">{preview ? <><button className="button button--ghost" type="button" disabled={busy || !preview.can_undo} onClick={() => void save("undo")}>Undo placement</button><button className="button button--ghost" type="button" disabled={busy || preview.saved_status === "none"} onClick={() => void save("clear")}>Clear placement</button></> : null}<button className="button button--primary" type="button" disabled={busy || loading || !preview?.rows.some(row => !row.time)} onClick={() => void save("apply")}>{busy ? "Saving…" : "Apply reviewed order"}</button></div>
  </ModalDialog>;
}
