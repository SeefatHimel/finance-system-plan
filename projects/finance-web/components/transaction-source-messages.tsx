"use client";

import { useEffect, useState } from "react";

import { listTransactionSourceMessages, type TransactionSourceMessage } from "@/lib/api";
import { getAccessToken } from "@/lib/auth-storage";

type MessageState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; messages: TransactionSourceMessage[] };

const receivedTimeFormatter = new Intl.DateTimeFormat("en-BD", { dateStyle: "medium", timeStyle: "short" });

export function TransactionSourceMessages({ transactionId }: { transactionId: string }) {
  const [state, setState] = useState<MessageState>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    setState({ status: "loading" });
    const accessToken = getAccessToken();
    if (!accessToken) {
      setState({ status: "error", message: "Sign in to view the original SMS." });
      return;
    }
    void listTransactionSourceMessages(accessToken, transactionId)
      .then((messages) => {
        if (active) setState({ status: "ready", messages });
      })
      .catch((error: unknown) => {
        if (active) setState({ status: "error", message: error instanceof Error ? error.message : "Could not load the original SMS." });
      });
    return () => { active = false; };
  }, [transactionId, attempt]);

  return (
    <details className="raw-message field--wide transaction-source-messages" open>
      <summary>Original SMS{state.status === "ready" && state.messages.length > 1 ? ` (${state.messages.length} linked messages)` : ""}</summary>
      {state.status === "loading" ? <p role="status">Loading original SMS…</p> : null}
      {state.status === "error" ? <div><p role="alert">{state.message}</p><button className="button button--ghost button--small" onClick={() => setAttempt((current) => current + 1)} type="button">Retry loading SMS</button></div> : null}
      {state.status === "ready" && state.messages.length === 0 ? <p>No original SMS is linked to this transaction.</p> : null}
      {state.status === "ready" ? state.messages.map((message) => (
        <article key={message.id}>
          <p><strong>{message.sender}</strong> · Received <time dateTime={message.received_at}>{receivedTimeFormatter.format(new Date(message.received_at))}</time></p>
          <p className="transaction-source-messages__body">{message.body ?? (message.status === "redacted" ? "Original SMS was redacted and is no longer available." : "Original SMS was removed or excluded and is no longer available.")}</p>
        </article>
      )) : null}
    </details>
  );
}
