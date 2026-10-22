"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import dynamic from "next/dynamic";
import { usePathname } from "next/navigation";
import { recentTransactionAction, undoTransactionAction, type TransactionAction } from "@/lib/api";
import { getAccessToken } from "@/lib/auth-storage";
import { useAuth } from "@/components/auth-provider";
import { useToast } from "@/components/toast-provider";
import { HelpTooltip } from "@/components/help-tooltip";

const Context = createContext<{
  latest: TransactionAction | null; busy: boolean;
  announce: (action?: TransactionAction | null) => void;
  undo: (action: TransactionAction) => void;
  edit: (id: string) => void;
  revalidate: (id: string) => void;
  create: () => void;
  editId: string | null;
  revalidationId: string | null;
  createOpen: boolean;
  closeEdit: () => void;
  closeRevalidation: () => void;
} | null>(null);
const TransactionEditor = dynamic(() => import("@/components/transaction-workspace").then(module => module.TransactionWorkspace));
const TransactionRevalidationDialog = dynamic(() => import("@/components/transaction-revalidation").then(module => module.TransactionRevalidationDialog));
export function useTransactionRecovery() {
  const value = useContext(Context);
  if (!value) throw new Error("TransactionRecoveryProvider is required.");
  return value;
}

export function TransactionRecoveryProvider({ children }: { children: ReactNode }) {
  const { session } = useAuth();
  const owner = session.status === "signed-in" ? session.user.id : null;
  const ownerRef = useRef(owner); ownerRef.current = owner;
  const pathname = usePathname();
  const { notify, dismiss } = useToast();
  const [latest, setLatest] = useState<TransactionAction | null>(null);
  const [busy, setBusy] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [revalidationId, setRevalidationId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const pending = useRef(false);
  const version = useRef(0);
  const refresh = useCallback(async () => {
    const token = getAccessToken(); const ticket = ++version.current;
    if (owner === null || !token) return null;
    try {
      const result = await recentTransactionAction(token);
      if (ownerRef.current === owner && version.current === ticket) setLatest(result);
      return result;
    } catch { return null; }
  }, [owner]);
  const previousOwner = useRef<number | null>(null);
  useEffect(() => {
    if (previousOwner.current !== owner) { setLatest(null); setBusy(false); dismiss(); version.current++; previousOwner.current = owner; }
    if (owner !== null) void refresh();
  }, [dismiss, owner, pathname, refresh]);
  useEffect(() => {
    const recheck = () => { if (!pending.current) void refresh(); };
    window.addEventListener("focus", recheck);
    window.addEventListener("finance:transactions-changed", recheck);
    return () => { window.removeEventListener("focus", recheck); window.removeEventListener("finance:transactions-changed", recheck); };
  }, [refresh]);
  useEffect(() => {
    if (!latest?.can_undo) return;
    const timer = window.setTimeout(() => setLatest(current => current?.id === latest.id ? { ...current, can_undo: false } : current), Math.max(0, new Date(latest.expires_at).getTime() - Date.now()));
    return () => window.clearTimeout(timer);
  }, [latest]);

  const edit = useCallback((id: string) => {
    dismiss();
    setCreateOpen(false); setRevalidationId(null);
    setEditId(id);
  }, [dismiss]);
  const revalidate = useCallback((id: string) => {
    dismiss();
    setCreateOpen(false); setEditId(null);
    setRevalidationId(id);
  }, [dismiss]);
  const create = useCallback(() => {
    dismiss(); setEditId(null); setRevalidationId(null); setCreateOpen(true);
  }, [dismiss]);
  useEffect(() => { setEditId(null); setRevalidationId(null); setCreateOpen(false); }, [pathname]);

  const undo = useCallback(async (action: TransactionAction) => {
    const token = getAccessToken();
    if (!token || owner === null || ownerRef.current !== owner || pending.current) return;
    pending.current = true; setBusy(true); version.current++;
    notify("Undoing…", "success");
    try {
      await undoTransactionAction(token, action.id);
      if (ownerRef.current !== owner) return;
      await refresh();
      window.dispatchEvent(new Event("finance:transactions-changed"));
      notify("Action undone.", "success");
    } catch (error) {
      if (ownerRef.current !== owner) return;
      const recovered = await refresh();
      if (recovered?.id === action.id && recovered.undone) {
        window.dispatchEvent(new Event("finance:transactions-changed")); notify("Action undone.");
      } else notify(error instanceof Error ? error.message : "Could not undo this action.", "error", {
        actions: action.transaction ? [{ label: "Edit", onClick: () => edit(action.transaction!) }] : []
      });
    } finally { pending.current = false; if (ownerRef.current === owner) setBusy(false); }
  }, [edit, notify, owner, refresh]);

  const announce = useCallback((action?: TransactionAction | null) => {
    if (!action || owner === null || ownerRef.current !== owner) return;
    version.current++; setLatest(action);
    const actions = [];
    if (action.transaction) actions.push({ label: "Edit", onClick: () => edit(action.transaction!) });
    if (action.can_undo) actions.push({ label: "Undo", onClick: () => void undo(action) });
    notify(action.label, "success", { actions, durationMs: 15000 });
  }, [edit, notify, owner, undo]);

  return <Context.Provider value={{ latest, busy, announce, undo: action => void undo(action), edit, revalidate, create,
    editId, revalidationId, createOpen, closeEdit: () => { setEditId(null); setCreateOpen(false); }, closeRevalidation: () => setRevalidationId(null) }}>{children}</Context.Provider>;
}

// Mount inside QuickAddProvider so the shared editor can read account drafts
// without replacing the page underneath the modal.
export function TransactionOverlayHost() {
  const { editId, revalidationId, createOpen, closeEdit, closeRevalidation } = useTransactionRecovery();
  return <>
    {editId ? <TransactionEditor key={editId} embeddedEditId={editId} onEmbeddedClose={closeEdit} onEmbeddedSaved={transaction => window.dispatchEvent(new CustomEvent("finance:transaction-saved", { detail: transaction }))} /> : null}
    {createOpen ? <TransactionEditor key="full-entry" embeddedCreate onEmbeddedClose={closeEdit} onEmbeddedSaved={transaction => window.dispatchEvent(new CustomEvent("finance:transaction-saved", { detail: transaction }))} /> : null}
    {revalidationId ? <TransactionRevalidationDialog key={revalidationId} transactionId={revalidationId} onClose={closeRevalidation} /> : null}
  </>;
}

export function RecentTransactionAction() {
  const { latest, busy, edit, undo } = useTransactionRecovery();
  if (!latest || latest.undone || (!latest.transaction && !latest.can_undo)) return null;
  return <div className="recent-action" aria-label="Last transaction action">
    <span>Last action · <strong>{latest.label}</strong></span>
    <div className="recent-action__buttons">
      {latest.transaction ? <button className="button button--ghost" type="button" disabled={busy} onClick={() => edit(latest.transaction!)}>Edit</button> : null}
      <button className="button button--ghost" type="button" disabled={busy || !latest.can_undo} onClick={() => undo(latest)}>{busy ? "Undoing…" : "Undo"}</button>
      <HelpTooltip label="About undo">Undo is available for the latest action for 24 hours, while its transaction and linked reports remain unchanged. It reverses that action; original SMS already removed by your retention policy cannot be restored.</HelpTooltip>
    </div>
  </div>;
}
