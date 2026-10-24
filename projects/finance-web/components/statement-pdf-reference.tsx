"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ModalDialog } from "@/components/modal-dialog";
import { StatementOriginalViewer } from "@/components/statement-original-viewer";
import { getStatementRow } from "@/lib/api";
import { getAccessToken } from "@/lib/auth-storage";

type SourceLocation = { page: number; row: number };

export function StatementPdfReference({ batchId, rowId, page, sourceRow }: { batchId: string | null; rowId: string; page?: number; sourceRow?: number }) {
  const [open, setOpen] = useState(false);
  const [location, setLocation] = useState<SourceLocation | null>(page && sourceRow ? { page, row: sourceRow } : null);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    if (!open || location) return;
    const token = getAccessToken();
    if (!token) { setError("Sign in again to find this PDF row."); return; }
    const controller = new AbortController();
    setError("");
    void getStatementRow(token, rowId, controller.signal).then(row => {
      if (!controller.signal.aborted) setLocation({ page: row.extracted.page, row: row.extracted.row });
    }).catch(reason => {
      if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Could not find the source row.");
    });
    return () => controller.abort();
  }, [open, location, rowId, retry]);

  if (!batchId) return null;
  return <>
    <button className="button button--ghost button--small" type="button" onClick={() => setOpen(true)}>{location ? `View PDF · page ${location.page}, row ${location.row}` : "View original PDF row"}</button>
    {open ? <ModalDialog labelledBy="statement-pdf-reference-title" className="decision-modal statement-pdf-reference-dialog" onCancel={() => setOpen(false)}>
      <div className="statement-pdf-reference-dialog__heading"><div><h2 id="statement-pdf-reference-title">Original statement PDF</h2><p>{location ? `Page ${location.page}, source row ${location.row}` : "Finding the saved source row…"}</p></div><button className="icon-button" type="button" onClick={() => setOpen(false)} aria-label="Close original PDF">×</button></div>
      {error ? <p role="alert" className="form-error">{error} <button className="button button--small" type="button" onClick={() => setRetry(value => value + 1)}>Retry</button></p> : null}
      {!location && !error ? <p role="status">Finding the saved PDF page and row…</p> : null}
      {location ? <StatementOriginalViewer batchId={batchId} page={location.page} autoLoad /> : null}
      <p className="field__hint">The page is positioned using the PDF viewer. If your device ignores the page number, use the page and row shown above.</p>
      <Link className="button button--ghost button--small" href={`/statements?import=${encodeURIComponent(batchId)}&row=${encodeURIComponent(rowId)}`} target="_blank" rel="noopener noreferrer">Open saved statement review in a new tab</Link>
    </ModalDialog> : null}
  </>;
}
