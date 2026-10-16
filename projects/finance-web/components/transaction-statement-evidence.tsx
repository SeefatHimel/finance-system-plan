"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { getStatementImport, listTransactionStatementEvidence, type SavedStatementRow } from "@/lib/api";
import { getAccessToken } from "@/lib/auth-storage";
import { StatementOriginalViewer } from "@/components/statement-original-viewer";

export function TransactionStatementEvidence({ transactionId }: { transactionId: string }) {
  const [rows, setRows] = useState<SavedStatementRow[] | null>(null);
  const [pdfAvailability, setPdfAvailability] = useState<Record<string, boolean | null>>({});
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController(); const token = getAccessToken(); setRows(null); setPdfAvailability({}); setError(null);
    if (!token) { setError("Sign in to view statement evidence."); return; }
    void listTransactionStatementEvidence(token, transactionId, controller.signal).then(async (result) => {
      if (controller.signal.aborted) return;
      setRows(result);
      const batchIds = [...new Set(result.map((row) => row.batch))];
      const availability = await Promise.all(batchIds.map(async (id) => {
        try { return [id, (await getStatementImport(token, id, controller.signal)).has_original_file] as const; }
        catch { return [id, null] as const; }
      }));
      if (!controller.signal.aborted) setPdfAvailability(Object.fromEntries(availability));
    }).catch((reason: unknown) => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Could not load statement evidence."); });
    return () => controller.abort();
  }, [transactionId, retry]);
  if (rows?.length === 0) return null;
  const batchIds = [...new Set(rows?.map((row) => row.batch) ?? [])];
  return <details className="raw-message field--wide" open><summary>Statement evidence{rows ? ` (${rows.length})` : ""}</summary>
    {!rows && !error ? <p role="status">Loading statement evidence…</p> : null}
    {error ? <><p role="alert">{error}</p><button className="button button--small" type="button" onClick={() => setRetry((n) => n + 1)}>Retry statement evidence</button></> : null}
    {batchIds.map((id) => <div className="statement-original-source" key={id}>
      <strong>Original statement PDF</strong>
      {pdfAvailability[id] === true ? <StatementOriginalViewer batchId={id} /> : pdfAvailability[id] === false ? <p className="inline-note">This earlier import has no saved PDF. <Link href={`/statements?import=${id}`}>Re-upload the identical PDF under the same account</Link> to attach it without changing these rows or recording money again.</p> : pdfAvailability[id] === null ? <p className="inline-note">Could not check the PDF archive. <Link href={`/statements?import=${id}`}>Open the saved import</Link> to retry.</p> : <p className="inline-note">Checking whether the PDF is available…</p>}
    </div>)}
    {rows?.map((row) => <article key={row.id}><p><strong>{row.component === "fee" ? "Inline fee" : "Statement transaction"}</strong> · Page {row.extracted.page}, row {row.extracted.row} · {row.extracted.date}{row.extracted.time ? ` · ${row.extracted.time}` : ""}</p><p className="statement-evidence-text">{row.extracted.description}</p>{row.citytouch_printed_code ? <p>Citytouch code printed in PDF: {row.citytouch_printed_code}</p> : null}<p>Source principal: {row.extracted.amount ?? "Unreadable"} · Signed fee: {row.extracted.signed_fee} · Reported final balance: {row.extracted.balance_after ?? "Unreadable"}</p><Link href={`/statements?import=${row.batch}`}>Open saved statement review</Link></article>)}
  </details>;
}
