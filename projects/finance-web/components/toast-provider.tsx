"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

type Tone = "success" | "error";
type NoticeAction = { label: string; onClick: () => void };
type NoticeOptions = { actions?: NoticeAction[]; durationMs?: number };
type Notice = { id: number; message: string; tone: Tone } & NoticeOptions;
type ToastContextValue = {
  dismiss: () => void;
  notify: (message: string, tone?: Tone, options?: NoticeOptions) => void;
  registerModal: (element: HTMLElement) => () => void;
};
const ToastContext = createContext<ToastContextValue | null>(null);

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) throw new Error("ToastProvider is required.");
  return context;
}

// Keep inline feedback while also announcing each action near the viewport edge.
export function useFeedbackMessage(tone: Tone) {
  const [message, setMessage] = useState<string | null>(null);
  const { notify } = useToast();
  const update = useCallback((value: string | null) => {
    setMessage(value);
    if (value) notify(value, tone);
  }, [notify, tone]);
  return [message, update] as const;
}

function ToastNotice({ notice, onDismiss }: { notice: Notice; onDismiss: () => void }) {
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  useEffect(() => {
    if (notice.tone === "error" || hovered || focused) return;
    const timeout = window.setTimeout(onDismiss, notice.durationMs ?? (notice.actions?.length ? 15000 : 6000));
    return () => window.clearTimeout(timeout);
  }, [notice.tone, notice.durationMs, notice.actions?.length, hovered, focused, onDismiss]);
  return (
    <div className={`toast action-toast action-toast--${notice.tone}`} role={notice.tone === "error" ? "alert" : "status"} aria-atomic="true"
      onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}
      onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}>
      <span aria-hidden="true" className="toast__icon">{notice.tone === "error" ? "!" : "✓"}</span>
      <span className="toast__content"><span>{notice.message}</span>{notice.actions?.length ? <span className="toast__actions">{notice.actions.map(action => <button key={action.label} type="button" onClick={action.onClick}>{action.label}</button>)}</span> : null}</span>
      <button aria-label="Dismiss notification" onClick={onDismiss} type="button">×</button>
    </div>
  );
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [mounted, setMounted] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [modals, setModals] = useState<HTMLElement[]>([]);
  const nextId = useRef(0);
  useEffect(() => setMounted(true), []);
  const notify = useCallback((message: string, tone: Tone = "success", options: NoticeOptions = {}) => {
    setNotice({ id: ++nextId.current, message, tone, ...options });
  }, []);
  const registerModal = useCallback((element: HTMLElement) => {
    setModals((current) => [...current, element]);
    return () => setModals((current) => current.filter((item) => item !== element));
  }, []);
  const dismiss = useCallback(() => setNotice(null), []);
  const value = useMemo(() => ({ dismiss, notify, registerModal }), [dismiss, notify, registerModal]);
  return (
    <ToastContext.Provider value={value}>
      {children}
      {mounted && notice ? createPortal(
        <ToastNotice key={notice.id} notice={notice} onDismiss={dismiss} />,
        modals[modals.length - 1] ?? document.body
      ) : null}
    </ToastContext.Provider>
  );
}
