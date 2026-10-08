import type { StatementSummary } from "@/lib/api";

export function StatementImportSummary({ summary, currency }: { summary: StatementSummary; currency: string }) {
  const labels: Record<string, string> = { posted: "Added", linked: "Linked", skipped: "Skipped", unresolved: "Unresolved", principal: "Principal", fee: "Inline fees / refunds" };
  return <section className="raw-message"><h3>Import summary</h3><p>{summary.remaining_count} unresolved rows · {summary.discrepancy_count} saved draft discrepancies · {summary.incomplete_count} unavailable checks.</p>
    <div className="statement-table-wrap"><table className="statement-summary-table"><thead><tr><th scope="col">Decision / component</th><th scope="col">Rows</th><th scope="col">Debit ({currency})</th><th scope="col">Credit ({currency})</th></tr></thead><tbody>
      {Object.entries(summary.dispositions).map(([name, value]) => <tr key={name}><th scope="row">{labels[name] ?? name}</th><td>{value.count}</td><td>{value.debit}</td><td>{value.credit}</td></tr>)}
      {Object.entries(summary.totals).map(([name, value]) => <tr key={name}><th scope="row">{labels[name] ?? name}</th><td>All draft rows</td><td>{value.debit}</td><td>{value.credit}</td></tr>)}
    </tbody></table></div>
    <p>Source net movement: {summary.source_net ?? "Unavailable"} · Saved draft net movement: {summary.draft_net ?? "Incomplete"}. Skipped and unresolved rows remain part of statement arithmetic; decision totals use draft observation amounts; linked ledger records may have later corrections.</p>
    <details><summary>Saved draft balance and total checks</summary><p>These checks use every saved draft row in source order. {summary.opening_is_derived ? "The starting balance is derived from the original first row." : "The printed opening balance is used when available."} Original source checks are separate.</p><ul className="statement-checks">{summary.checks.filter(check => check.passed !== true).concat(summary.checks.filter(check => check.passed === true)).slice(0, 100).map(check => <li key={check.label}><strong>{check.passed === null ? "Unavailable" : check.passed ? "Passed" : "Discrepancy"}</strong> · {check.label} · Expected {check.expected ?? "unknown"}, observed {check.observed ?? "unknown"}</li>)}</ul>{summary.checks.length > 100 ? <p>Showing the first 100 checks, with discrepancies first. All checks contribute to the summary.</p> : null}</details>
  </section>;
}
