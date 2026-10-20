"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { X } from "@phosphor-icons/react";
import { formatCalendarDate } from "../../finance-contracts/presentation";
import { ModalDialog } from "@/components/modal-dialog";
import { HelpTooltip } from "@/components/help-tooltip";
import { useToast } from "@/components/toast-provider";
import { useTransactionRecovery } from "@/components/transaction-recovery";
import { useAuth } from "@/components/auth-provider";
import { getAccessToken } from "@/lib/auth-storage";
import { applyBulkRevalidation, scanTransactionRevalidation, type BulkRevalidationEntry, type TransactionAction } from "@/lib/api";
import { correctionGroups, selectedCorrections, type RevalidationSelection } from "@/lib/bulk-revalidation";

type Phase = "scanning" | "paused" | "complete" | "error";
const PAGE_SIZE = 20;
const initialScan = { phase: "scanning" as Phase, cursor: "", scanned: 0, total: 0 };

export function BulkTransactionRevalidationDialog({ onClose }: { onClose: () => void }) {
  const [scan, setScan] = useState(initialScan);
  const [entries, setEntries] = useState<BulkRevalidationEntry[]>([]);
  const [selection, setSelection] = useState<RevalidationSelection>({});
  const [applied, setApplied] = useState<Set<string>>(new Set());
  const [mode, setMode] = useState("corrections");
  const [page, setPage] = useState(0);
  const [busy, setBusy] = useState(false);
  const [needsRescan, setNeedsRescan] = useState(false);
  const [error, setError] = useState("");
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const applying = useRef(false);
  const bodyRef = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const { session } = useAuth();
  const owner = session.status === "signed-in" ? session.user.id : null;
  const ownerRef = useRef(owner); ownerRef.current = owner;
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const { notify, dismiss } = useToast();
  const recovery = useTransactionRecovery();

  useEffect(() => {
    const changed = () => {
      if (applying.current) return;
      setSelection({}); setApplied(new Set()); setNeedsRescan(true);
      setError("The ledger changed. Rescan and review fresh suggestions before applying corrections.");
      setScan(current => ({ ...current, phase: current.phase === "scanning" ? "paused" : current.phase }));
    };
    window.addEventListener("finance:transactions-changed", changed);
    return () => window.removeEventListener("finance:transactions-changed", changed);
  }, []);

  useEffect(() => {
    if (scan.phase !== "scanning") return;
    const controller = new AbortController();
    const token = getAccessToken();
    if (!token || owner === null) { setError("Sign in before scanning transactions."); setScan(current => ({ ...current, phase: "error" })); return; }
    void scanTransactionRevalidation(token, scan.cursor, controller.signal).then(result => {
      if (controller.signal.aborted) return;
      setEntries(current => {
        const known = new Map(current.map(entry => [entry.preview.transaction, entry]));
        result.results.forEach(entry => known.set(entry.preview.transaction, entry));
        return [...known.values()];
      });
      setScan({ phase: result.next_cursor ? "scanning" : "complete", cursor: result.next_cursor ?? "", scanned: result.scanned, total: result.total });
    }).catch(failure => {
      if (!controller.signal.aborted) {
        setError(failure instanceof Error ? failure.message : "Could not scan transactions.");
        if (failure && typeof failure === "object" && "status" in failure && [400, 409].includes(Number(failure.status))) {
          setSelection({}); setNeedsRescan(true);
        }
        setScan(current => ({ ...current, phase: "error" }));
      }
    });
    return () => controller.abort();
  }, [scan.phase, scan.cursor, owner]);

  const selected = useMemo(() => selectedCorrections(entries, selection, applied), [entries, selection, applied]);
  const correctionCount = selected.reduce((count, item) => count + item.selected.length, 0);
  const withCorrections = entries.filter(entry => entry.preview.suggestions.length > 0).length;
  const warningsOnly = entries.filter(entry => !entry.preview.suggestions.length && entry.preview.warnings.length > 0).length;
  const filtered = useMemo(() => entries.filter(entry => mode === "all" || (mode === "warnings" ? !entry.preview.suggestions.length : entry.preview.suggestions.length > 0)), [entries, mode]);
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, pages - 1);
  const shown = filtered.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE);

  function goToPage(next: number) {
    setPage(next);
    titleRef.current?.focus({ preventScroll: true });
    bodyRef.current?.scrollTo({ top: 0 });
  }

  function rescan() {
    dismiss();
    setEntries([]); setSelection({}); setApplied(new Set()); setNeedsRescan(false); setError(""); setPage(0); setProgress({ done: 0, total: 0 });
    setScan({ ...initialScan });
  }

  async function apply() {
    const token = getAccessToken();
    if (!token || !selected.length || applying.current || needsRescan || scan.phase === "scanning") return;
    dismiss();
    applying.current = true; setBusy(true); setError(""); setProgress({ done: 0, total: selected.length });
    let done = 0;
    let lastUndo: TransactionAction | null = null;
    const startedOwner = owner;
    const stillOwned = () => mounted.current && ownerRef.current === startedOwner;
    try {
      for (const group of correctionGroups(selected)) {
        if (!stillOwned() || getAccessToken() !== token) throw new Error("Your session changed. Review again before continuing.");
        const result = await applyBulkRevalidation(token, group);
        if (!stillOwned()) return;
        lastUndo = result.undo_action;
        done += result.applied.length;
        setApplied(current => new Set([...current, ...result.applied]));
        setSelection(current => Object.fromEntries(Object.entries(current).filter(([id]) => !result.applied.includes(id))));
        setProgress({ done, total: selected.length });
      }
      notify(`Corrections applied to ${done} transaction${done === 1 ? "" : "s"}. Original evidence kept.`, "success", {
        actions: lastUndo?.can_undo ? [{ label: "Undo last group", onClick: () => recovery.undo(lastUndo!) }] : [],
      });
    } catch (failure) {
      if (!stillOwned()) return;
      const status = failure && typeof failure === "object" && "status" in failure ? Number(failure.status) : 0;
      const outcome = status >= 400 && status < 500 ? "The failed group was not applied." : "The last group's result could not be confirmed.";
      setError(`${done} transaction(s) confirmed applied. ${outcome} ${failure instanceof Error ? failure.message : "Could not apply corrections."} Rescan and review again before continuing.`);
      setSelection({}); setNeedsRescan(true);
      notify(`Stopped after ${done} confirmed transaction(s). Rescan before continuing.`, "error", {
        actions: lastUndo?.can_undo ? [{ label: "Undo last group", onClick: () => recovery.undo(lastUndo!) }] : [],
      });
    } finally {
      if (stillOwned()) {
        window.dispatchEvent(new Event("finance:transactions-changed"));
        setBusy(false);
      }
      applying.current = false;
    }
  }

  return <ModalDialog className="form-drawer transaction-revalidation bulk-revalidation" labelledBy="bulk-revalidation-title" busy={busy} onCancel={onClose}>
    <div className="form-drawer__header"><div><h2 id="bulk-revalidation-title" ref={titleRef} tabIndex={-1}>Bulk revalidation</h2><p>All confirmed transactions · review and select corrections before applying.</p></div><button type="button" className="icon-button" disabled={busy} aria-label="Close bulk revalidation" onClick={onClose}><X size={20} aria-hidden="true" /></button></div>
    <div className="transaction-revalidation__body" ref={bodyRef}>
      <div className="bulk-revalidation__toolbar">
        <p role="status">{scan.phase === "scanning" ? "Scanning" : scan.phase === "complete" ? "Scan complete" : "Scan paused"} · {scan.scanned} checked of {scan.total} initially · {withCorrections} with corrections · {warningsOnly} with warnings only.</p>
        <div className="list-row__actions">
          {scan.phase === "scanning" ? <button type="button" className="button button--ghost button--small" onClick={() => setScan(current => ({ ...current, phase: "paused" }))}>Pause scan</button> : scan.phase !== "complete" ? <button type="button" className="button button--ghost button--small" disabled={busy || needsRescan} onClick={() => { setError(""); setScan(current => ({ ...current, phase: "scanning" })); }}>Continue scan</button> : null}
          <button type="button" className="button button--ghost button--small" disabled={busy || scan.phase === "scanning"} onClick={rescan}>Rescan</button>
          <HelpTooltip label="About bulk revalidation">Scans all saved ledger entries, independently of the list filters. New entries after scanning starts are checked on the next scan. Previews expire after 15 minutes; rescanning clears selections. Each group of up to 25 applies together. Undo restores only the latest successful group, while unchanged. Originals stay intact.</HelpTooltip>
        </div>
      </div>
      {error ? <p className="form-error" role="alert">{error}</p> : null}
      <div className="bulk-revalidation__controls">
        <label className="field"><span className="field__label">Show findings</span><select className="field__control" aria-label="Show findings" value={mode} disabled={busy} onChange={event => { setMode(event.target.value); setPage(0); }}><option value="corrections">Suggested corrections</option><option value="warnings">Warnings only</option><option value="all">All findings</option></select></label>
        <button type="button" className="button button--ghost button--small" disabled={busy || needsRescan || !withCorrections} onClick={() => setSelection(Object.fromEntries(entries.filter(entry => !applied.has(entry.preview.transaction)).map(entry => [entry.preview.transaction, entry.preview.suggestions.map(item => item.key)])))}>Select all suggestions</button>
        <button type="button" className="button button--ghost button--small" disabled={busy || !selected.length} onClick={() => setSelection({})}>Clear selection</button>
      </div>
      <p className="inline-note">{correctionCount} correction(s) selected across {selected.length} transactions. Selections stay across pages; nothing is selected automatically.</p>
      {shown.map(({ preview, account_name, date, amount, description }) => <article className="bulk-revalidation__entry" key={preview.transaction} aria-label={`${account_name} ${date} ${amount}`}>
        <div className="bulk-revalidation__entry-header"><div><strong>{account_name} · {preview.currency} {amount}</strong><span>{formatCalendarDate(date)} · {description}</span></div>{applied.has(preview.transaction) ? <span className="status-badge">Applied</span> : null}</div>
        {preview.suggestions.length ? <fieldset disabled={busy || needsRescan || applied.has(preview.transaction)} className="bulk-revalidation__choices"><legend className="sr-only">Suggested corrections for {account_name} {date} {amount}</legend>{preview.suggestions.map(item => <label key={item.key} className="bulk-revalidation__choice"><input type="checkbox" checked={(selection[preview.transaction] ?? []).includes(item.key)} onChange={event => setSelection(current => ({ ...current, [preview.transaction]: event.target.checked ? [...(current[preview.transaction] ?? []), item.key] : (current[preview.transaction] ?? []).filter(key => key !== item.key) }))} /><span>{item.label}</span><span className="bulk-revalidation__value">{item.current ?? "Not reported"} → <strong>{item.proposed}</strong></span></label>)}</fieldset> : <p className="inline-note">No eligible corrections. Review the warnings manually.</p>}
        <details><summary>Sources and review notes · {preview.sources.length} source(s){preview.warnings.length ? ` · ${preview.warnings.length} warning(s)` : ""}</summary>
          {preview.suggestions.map(item => <p className="inline-note" key={item.key}>{item.label}: {item.reason}</p>)}
          {preview.warnings.length ? <ul>{preview.warnings.map(warning => <li key={warning}>{warning}</li>)}</ul> : null}
          <div className="transaction-revalidation__sources">{preview.sources.map(source => <article key={`${source.kind}-${source.id}`}><strong>{source.kind} · {source.account_name}</strong><span>Amount: {source.amount ?? "Not reported"} · Balance after: {source.balance_after ?? "Not reported"}</span></article>)}</div>
        </details>
      </article>)}
      {!shown.length ? <p>{scan.phase === "scanning" ? "Checking for suggestions…" : "No findings in this view. Check Warnings only for entries that need manual review."}</p> : null}
      {pages > 1 ? <nav className="bulk-revalidation__pagination" aria-label="Revalidation result pages"><button type="button" className="button button--ghost button--small" disabled={currentPage === 0 || busy} onClick={() => goToPage(currentPage - 1)}>Previous results</button><span>Page {currentPage + 1} of {pages}</span><button type="button" className="button button--ghost button--small" disabled={currentPage >= pages - 1 || busy} onClick={() => goToPage(currentPage + 1)}>Next results</button></nav> : null}
    </div>
    <div className="form-drawer__footer"><span className="inline-note" role="status">{busy ? `Applying ${progress.done} of ${progress.total} transactions…` : applied.size ? `${applied.size} transaction(s) applied. Undo covers the latest group.` : "No changes applied. Undo covers the latest group."}</span><button type="button" className="button button--ghost" disabled={busy} onClick={onClose}>Close</button><button type="button" className="button button--primary" disabled={busy || needsRescan || scan.phase === "scanning" || !selected.length} onClick={() => void apply()}>{busy ? "Applying…" : `Apply selected${selected.length ? ` (${selected.length} transactions)` : ""}`}</button></div>
  </ModalDialog>;
}
