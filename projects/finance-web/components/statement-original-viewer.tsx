"use client";

import { useEffect, useRef, useState } from "react";

import { downloadStatementOriginal } from "@/lib/api";
import { getAccessToken } from "@/lib/auth-storage";

export function StatementOriginalViewer({ batchId }: { batchId: string }) {
  const [url, setUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const request = useRef<AbortController | null>(null);

  useEffect(() => () => { if (url) URL.revokeObjectURL(url); }, [url]);
  useEffect(() => () => request.current?.abort(), []);

  async function load(mode: "view" | "download") {
    const token = getAccessToken();
    if (!token || loading) return;
    const controller = new AbortController();
    request.current = controller;
    setLoading(true);
    setError(null);
    try {
      const pdf = await downloadStatementOriginal(token, batchId, controller.signal);
      if (controller.signal.aborted) return;
      const nextUrl = URL.createObjectURL(pdf);
      if (mode === "view") {
        setUrl(nextUrl);
      } else {
        const link = document.createElement("a");
        link.href = nextUrl;
        link.download = `statement-${batchId}.pdf`;
        document.body.appendChild(link);
        link.click();
        link.remove();
        window.setTimeout(() => URL.revokeObjectURL(nextUrl), 60_000);
      }
    } catch (reason) {
      if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Could not open the original PDF.");
    } finally {
      if (request.current === controller) { request.current = null; if (!controller.signal.aborted) setLoading(false); }
    }
  }

  return <div className="statement-original-viewer">
    {!url ? <div className="statement-original-viewer__actions">
      <button className="button button--small" type="button" disabled={loading} onClick={() => void load("view")}>{loading ? "Loading PDF…" : "View original PDF"}</button>
      <button className="button button--small" type="button" disabled={loading} onClick={() => void load("download")}>Download PDF</button>
    </div> : <>
      <div className="statement-original-viewer__actions">
        <a className="button button--small" href={url} download={`statement-${batchId}.pdf`}>Download PDF</a>
        <button className="button button--small" type="button" onClick={() => setUrl(null)}>Close PDF</button>
      </div>
      <iframe className="statement-original-viewer__frame" src={url} title="Original statement PDF" />
      <p className="inline-note">If the PDF viewer is unavailable on this device, use Download PDF above.</p>
    </>}
    {error ? <p role="alert" className="form-error">{error}</p> : null}
  </div>;
}
