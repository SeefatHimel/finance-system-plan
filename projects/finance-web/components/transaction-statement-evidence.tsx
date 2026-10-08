"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { listTransactionStatementEvidence, type SavedStatementRow } from "@/lib/api";
import { getAccessToken } from "@/lib/auth-storage";

export function TransactionStatementEvidence({ transactionId }: { transactionId: string }) {
  const [rows, setRows] = useState<SavedStatementRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController(); const token = getAccessToken(); setRows(null); setError(null);
    if (!token) return;
    void listTransactionStatementEvidence(token, transactionId, controller.signal).then((result) => { if (!controller.signal.aborted) setRows(result); }).catch((reason: unknown) => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Could not load statement evidence."); });
    return () => controller.abort();
  }, [transactionId, retry]);
  if (rows?.length === 0) return null;
  return <details className="raw-message field--wide" open><summary>Statement evidence{rows ? ` (${rows.length})` : ""}</summary>
    {!rows && !error ? <p role="status">Loading statement evidence…</p> : null}
    {error ? <><p role="alert">{error}</p><button className="button button--small" type="button" onClick={() => setRetry((n) => n + 1)}>Retry statement evidence</button></> : null}
    {rows?.map((row) => <article key={row.id}><p><strong>{row.component === "fee" ? "Inline fee" : "Statement transaction"}</strong> · Page {row.extracted.page}, row {row.extracted.row} · {row.extracted.date}{row.extracted.time ? ` · ${row.extracted.time}` : ""}</p><p className="statement-evidence-text">{row.extracted.description}</p><p>Source principal: {row.extracted.amount ?? "Unreadable"} · Signed fee: {row.extracted.signed_fee} · Reported final balance: {row.extracted.balance_after ?? "Unreadable"}</p><Link href={`/statements?import=${row.batch}`}>Open saved statement review</Link></article>)}
  </details>;
}
