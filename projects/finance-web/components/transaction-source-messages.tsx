"use client";

import Link from "next/link";
import { useEffect, useState, type Dispatch, type SetStateAction } from "react";

import { listTransactionSourceMessages, type TransactionSourceMessage } from "@/lib/api";
import { getAccessToken } from "@/lib/auth-storage";

type MessageState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; messages: TransactionSourceMessage[] };

const receivedTimeFormatter = new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

export function TransactionSourceMessages({ transactionId, expanded = false, showEmpty = false, loadOnExpand = false, onMessages, onLoadError }: { transactionId: string; expanded?: boolean; showEmpty?: boolean; loadOnExpand?: boolean; onMessages?: Dispatch<SetStateAction<TransactionSourceMessage[] | null>>; onLoadError?: Dispatch<SetStateAction<string>> }) {
  const [state, setState] = useState<MessageState>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  const [open, setOpen] = useState(expanded);
  const [requested, setRequested] = useState(!loadOnExpand || expanded);

  useEffect(() => {
    if (!requested) return;
    let active = true;
    setState({ status: "loading" });
    const accessToken = getAccessToken();
    if (!accessToken) {
      setState({ status: "error", message: "Sign in to view the original SMS." });
      return;
    }
    void listTransactionSourceMessages(accessToken, transactionId)
      .then((messages) => {
        if (active) { setState({ status: "ready", messages }); onMessages?.(messages); }
      })
      .catch((error: unknown) => {
        if (active) {
          const message = error instanceof Error ? error.message : "Could not load the original SMS.";
          setState({ status: "error", message }); onLoadError?.(message);
        }
      });
    return () => { active = false; };
  }, [transactionId, attempt, requested, onMessages, onLoadError]);

  if (state.status === "ready" && state.messages.length === 0 && !showEmpty) return null;

  return (
    <details className="raw-message field--wide transaction-source-messages" open={open} onToggle={event => { setOpen(event.currentTarget.open); if (event.currentTarget.open) setRequested(true); }}>
      <summary>Original SMS{state.status === "ready" && state.messages.length > 1 ? ` (${state.messages.length} linked messages)` : ""}</summary>
      {state.status === "loading" ? <p role="status">Loading original SMS…</p> : null}
      {state.status === "error" ? <div><p role="alert">{state.message}</p><button className="button button--ghost button--small" onClick={() => setAttempt((current) => current + 1)} type="button">Retry loading SMS</button></div> : null}
      {state.status === "ready" && state.messages.length === 0 ? <p>No SMS is attached to this transaction.</p> : null}
      {state.status === "ready" ? state.messages.map((message) => (
        <article key={message.id}>
          <p><strong>{message.sender}</strong> · Received <time dateTime={message.received_at}>{receivedTimeFormatter.format(new Date(message.received_at))}</time></p>
          {message.parsed ? <p className="inline-note">SMS parsed amount: {message.parsed.amount ?? "Unknown"} · Reported balance after: {message.parsed.balance_after ?? "Not reported"}{message.parsed.reference ? ` · Reference: ${message.parsed.reference}` : ""}</p> : null}
          <p className="transaction-source-messages__body">{message.body ?? (message.status === "redacted" ? "Original SMS was redacted and is no longer available." : "Original SMS was removed or excluded and is no longer available.")}</p>
        </article>
      )) : null}
      {state.status === "ready" && state.messages.some((message) => message.status === "redacted") ? <p className="inline-note">For an older redacted transaction SMS, choose Keep in <Link href="/sms-settings">SMS settings</Link>, then use the mobile History scan with Refresh previous imports. The original can return only if that exact SMS is still on your phone; manually redacted messages also require the explicit restore choice.</p> : null}
    </details>
  );
}
