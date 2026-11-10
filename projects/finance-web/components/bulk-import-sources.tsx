"use client";
import { useEffect, useState } from "react";
import { listBulkSources, type BulkSource } from "@/lib/bulk-import-api";
import { getAccessToken } from "@/lib/auth-storage";
import { useToast } from "./toast-provider";

export function BulkSourceRows({ rows }: { rows: BulkSource[] }) {
  if (!rows.length) return null;
  return (
    <details className="bulk-import-disclosure field--wide">
      <summary>
        Spreadsheet evidence · {rows.length === 100 ? "first 100" : rows.length}{" "}
        {rows.length === 1 ? "row" : "rows"}
      </summary>
      {rows.length === 100 ? (
        <p className="muted-text">
          Showing the first 100 linked rows. Open Import entries → Recent
          imports to inspect the complete saved tables.
        </p>
      ) : null}
      {rows.map((row) => (
        <article key={`${row.batch}:${row.number}`}>
          <h4>
            {row.filename} · source row {row.number}
          </h4>
          <p className="muted-text">
            Original values are preserved. Linking this row did not replace an
            existing transaction’s saved values.
          </p>
          <dl className="bulk-import-original">
            {Object.entries(row.original).map(([key, value]) => (
              <div key={key}>
                <dt>{key}</dt>
                <dd>{value || "—"}</dd>
              </div>
            ))}
          </dl>
        </article>
      ))}
    </details>
  );
}
export function BulkImportSources({
  transactionId,
}: {
  transactionId: string;
}) {
  const [rows, setRows] = useState<BulkSource[]>([]);
  const [retry, setRetry] = useState(0);
  const [error, setError] = useState(false);
  const { notify } = useToast();
  useEffect(() => {
    const controller = new AbortController();
    const token = getAccessToken();
    setRows([]);
    setError(false);
    if (token)
      void listBulkSources(token, transactionId, controller.signal)
        .then((value) => {
          if (!controller.signal.aborted) setRows(value);
        })
        .catch((reason) => {
          if (!controller.signal.aborted) {
            setError(true);
            notify(
              reason instanceof Error
                ? reason.message
                : "Spreadsheet evidence is unavailable.",
              "error",
            );
          }
        });
    return () => controller.abort();
  }, [transactionId, retry, notify]);
  return error ? (
    <button
      className="button button--ghost"
      type="button"
      onClick={() => setRetry((v) => v + 1)}
    >
      Retry spreadsheet evidence
    </button>
  ) : (
    <BulkSourceRows rows={rows} />
  );
}
