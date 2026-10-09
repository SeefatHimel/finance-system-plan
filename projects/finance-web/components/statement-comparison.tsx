"use client";

import { DatePeriodControls } from "@/components/date-period-controls";
import { allDates, periodBounds, type DatePeriod } from "@/lib/date-period";

import { useEffect, useState } from "react";
import { getStatementComparison, type StatementComparison } from "@/lib/api";
import { getAccessToken } from "@/lib/auth-storage";

export function StatementLedgerComparison({ id, epoch, currency }: { id: string; epoch: number; currency: string }) {
  const [period, setPeriod] = useState<DatePeriod>(allDates);
  const [offset, setOffset] = useState(0);
  const [data, setData] = useState<StatementComparison | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [retry, setRetry] = useState(0);
  const [expanded, setExpanded] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    const token = getAccessToken();
    setData(null); setError(null);
    if (!token) return;
    setLoading(true);
    const timer = window.setTimeout(() => {
      void getStatementComparison(token, id, offset, controller.signal, periodBounds(period)).then(result => {
        if (!controller.signal.aborted) {
          setData(result);
          if (offset && offset >= result.count) setOffset(Math.max(0, Math.floor((result.count - 1) / 50) * 50));
        }
      }).catch((reason: unknown) => {
        if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Could not compare the ledger.");
      }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    }, 250);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [id, epoch, offset, retry, period]);
  const labels: Record<string, string> = { matched: "Confirmed matches", needs_review: "Possible matches / needs review", statement_only: "Statement only", ledger_only: "Ledger only", skipped: "Skipped statement rows" };
  return <section className="raw-message" aria-label="Statement and ledger comparison" aria-busy={loading}>
    <h3>Statement vs ledger</h3>
    <p>Compare this account only, within the printed statement period. Suggested matches need your confirmation; linking keeps the PDF date, time, description and balance as evidence without adding the movement again.</p>
    <DatePeriodControls label="Ledger-only dates" description="Filters the table within the printed statement period; comparison totals cover the whole statement" value={period} onChange={value => { setPeriod(value); setOffset(0); }} />
    {loading ? <p role="status">Comparing statement and ledger…</p> : null}
    {error ? <><p role="alert" className="form-error">{error}</p><button type="button" className="button" onClick={() => setRetry(n => n + 1)}>Retry comparison</button></> : null}
    {data ? <>
      <p>{data.period_start ?? "Unknown start"} – {data.period_end ?? "Unknown end"} · {data.complete ? "Comparison completed" : "Provisional comparison: verify the warnings below"}</p>
      <div className="metric-row">{Object.entries(labels).map(([name, label]) => <div key={name} className="metric"><span className="metric__label">{label}</span><strong className="metric__value">{name === "ledger_only" && !data.ledger_only_available ? "Unavailable" : data.counts[name] ?? 0}</strong></div>)}</div>
      {data.warnings.length ? <ul>{data.warnings.map(warning => <li key={warning}>{warning}</li>)}</ul> : null}
      {data.ledger_only_available ? <details open={expanded} onToggle={event => setExpanded(event.currentTarget.open)}><summary>Ledger only: {data.count} entries matching these dates</summary>
        <p>These may be missing from the PDF, recorded incorrectly, or posted on a different date. Entries with an unresolved match suggestion are excluded here. Nothing is removed from your ledger. Counts refer to principal and fee components separately.</p>
        <div className="statement-table-wrap" tabIndex={0} role="region" aria-label="Ledger-only transactions"><table className="statement-summary-table"><thead><tr>{["Date / time", "Description", "Direction / source", `Amount (${currency})`, "Balance after"].map(label => <th key={label} scope="col">{label}</th>)}</tr></thead><tbody>{data.results.map(row => <tr key={row.id}><td>{row.date}<br />{row.time ?? "Time not reported"}</td><td>{row.description || "Ledger movement"}</td><td>{row.direction} · {row.source}</td><td>{row.amount}</td><td>{row.balance_after ?? "Not reported"}</td></tr>)}</tbody></table></div>
        {!data.count ? <p>No ledger-only entries match these dates within the statement period.</p> : null}
        <div className="statement-actions"><button type="button" className="button" disabled={loading || offset === 0} onClick={() => setOffset(Math.max(0, offset - 50))}>Previous ledger page</button><button type="button" className="button" disabled={loading || offset + 50 >= data.count} onClick={() => setOffset(offset + 50)}>Next ledger page</button></div>
      </details> : <p>Ledger-only results are unavailable until statement coverage and matching limits can be verified.</p>}
    </> : null}
  </section>;
}
