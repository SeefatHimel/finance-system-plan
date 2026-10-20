"use client";

import { useEffect, useState } from "react";

import { formatCalendarDate } from "../../finance-contracts/presentation";
import { getAccessToken } from "@/lib/auth-storage";
import { scanTransactionIssues, type TransactionIssuePage } from "@/lib/api";

type Finding = TransactionIssuePage["results"][number];

export function TransactionIssueAudit({ onEdit, onRevalidate }: { onEdit: (id: string) => void; onRevalidate: (id: string) => void }) {
  const [findings, setFindings] = useState<Finding[]>([]);
  const [scanned, setScanned] = useState(0);
  const [total, setTotal] = useState(0);
  const [nextOffset, setNextOffset] = useState<number | null>(null);
  const [open, setOpen] = useState(false);
  const [stale, setStale] = useState(false);
  const [hasResult, setHasResult] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const changed = () => setStale(true);
    window.addEventListener("finance:transactions-changed", changed);
    return () => window.removeEventListener("finance:transactions-changed", changed);
  }, []);

  async function run(offset: number) {
    const token = getAccessToken();
    if (!token) { setError("Sign in before checking transactions."); return; }
    if (offset === 0) {
      setFindings([]); setScanned(0); setTotal(0); setNextOffset(null); setHasResult(false); setStale(false);
    }
    setLoading(true); setError(""); setOpen(true);
    try {
      const page = await scanTransactionIssues(token, offset);
      setFindings(current => offset === 0 ? page.results : [...current, ...page.results]);
      setScanned(offset + page.scanned);
      setTotal(page.total);
      setNextOffset(page.next_offset);
      setHasResult(true);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Could not check transactions.");
    } finally { setLoading(false); }
  }

  return <div className="transaction-issue-audit">
    <button className="button button--ghost" disabled={loading} onClick={() => void run(0)} type="button">
      {loading ? "Checking…" : "Check transactions"}
    </button>
    {open ? <section className="transaction-issue-audit__results" aria-label="Transaction issue check results">
      <div className="transaction-issue-audit__heading">
        <div><strong>Transaction check</strong><p>Check saved evidence and current rules. Revalidate an entry to preview corrections before applying them.</p></div>
        <button className="button button--ghost button--small" onClick={() => setOpen(false)} type="button">Hide</button>
      </div>
      {error ? <p role="alert">{error}</p> : null}
      {stale ? <p role="status">Transactions changed. Run Check transactions again to refresh these findings.</p> : null}
      <p role="status">Checked {scanned} of {total} transactions · {findings.length} with findings{nextOffset !== null ? " so far" : ""}.</p>
      {findings.map(finding => <article className="transaction-issue-audit__item" key={finding.transaction}>
        <div><strong>{finding.account} · BDT {finding.amount}</strong><span>{formatCalendarDate(finding.date)}</span></div>
        <ul>{finding.issues.map(issue => <li key={issue.code}>{issue.level === "suggestion" ? "Suggestion: " : "Check: "}{issue.text}</li>)}</ul>
        <button className="button button--ghost button--small" onClick={() => onRevalidate(finding.transaction)} type="button">Revalidate</button>
        <button className="button button--ghost button--small" onClick={() => onEdit(finding.transaction)} type="button">Review entry</button>
      </article>)}
      {!loading && !error && hasResult && scanned === total && findings.length === 0 ? <p>No issues found by these checks. This does not verify every transaction detail.</p> : null}
      {nextOffset !== null ? <button className="button button--ghost" disabled={loading} onClick={() => void run(nextOffset)} type="button">Check next 50</button> : null}
    </section> : null}
  </div>;
}
