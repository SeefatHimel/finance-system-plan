"use client";

import { useEffect, useRef, useState } from "react";
import { changeReportMembership, listReportTransactions, type Account, type SavedReport, type TransactionActivityPage } from "@/lib/api";
import { getAccessToken } from "@/lib/auth-storage";
import { formatCalendarDate, formatCurrency } from "../../finance-contracts/presentation";

export function SavedReportTransactions({ report, accounts, revision, onChange }: { report: SavedReport; accounts: Account[]; revision: number; onChange: () => void }) {
  const [scope, setScope] = useState<"included" | "available" | "excluded">("included");
  const [search, setSearch] = useState("");
  const [offset, setOffset] = useState(0);
  const [page, setPage] = useState<TransactionActivityPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  useEffect(() => {
    const token = getAccessToken();
    if (!token) return;
    const controller = new AbortController();
    setLoading(true); setError("");
    const timer = window.setTimeout(() => {
      void listReportTransactions(token, report.id, scope, search, offset, controller.signal).then(result => {
        if (!controller.signal.aborted) {
          if (!result.results.length && offset > 0) setOffset(Math.max(0, offset - 25));
          else setPage(result);
        }
      }).catch((reason: unknown) => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Could not load transactions."); })
        .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    }, 200);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [report.id, revision, scope, search, offset]);

  async function change(id: string, action: "include" | "exclude" | "reset") {
    const token = getAccessToken();
    if (!token || inFlight.current) return;
    inFlight.current = true; setBusy(true); setError(""); setMessage("");
    try {
      await changeReportMembership(token, report.id, id, action);
      setMessage(action === "exclude" ? "Transaction removed from this report." : action === "reset" ? "Transaction follows the saved filters again." : "Transaction added to this report.");
      onChange();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not update report."); }
    finally { inFlight.current = false; setBusy(false); }
  }

  return <section className="panel" id="report-transactions"><div className="panel__body">
    <h2 className="section-title">Transactions in {report.name}</h2>
    <p className="muted-text">Matching transactions are included automatically. You can add other {report.currency} transactions or remove individual entries. These changes affect this report only.</p>
    <div className="transaction-form">
      <label className="field"><span className="field__label">Show transactions</span><select aria-label="Show transactions" className="field__control" value={scope} disabled={busy} onChange={event => { setScope(event.target.value as typeof scope); setOffset(0); setMessage(""); }}><option value="included">In this report</option><option value="available">Available to add</option><option value="excluded">Removed from report</option></select></label>
      <label className="field"><span className="field__label">Search transactions</span><input className="field__control" type="search" value={search} maxLength={256} onChange={event => { setSearch(event.target.value); setOffset(0); }} /></label>
    </div>
    {error ? <p role="alert" className="form-error">{error}</p> : null}
    <p role="status">{loading ? "Loading transactions…" : message || `${page?.count ?? 0} transactions`}</p>
    {!loading && !error && page ? <>
      <div className="table-wrap"><table className="data-table"><thead><tr><th>Date</th><th>Transaction</th><th>Amount</th><th>Report action</th></tr></thead><tbody>{page.results.map(row => <tr key={row.id}><td>{formatCalendarDate(row.date)}</td><td>{row.counterparty_text || row.note || row.type}<small className="report-comparison">{accounts.find(account => account.id === row.account)?.name ?? "Account"} · {row.type}</small></td><td>{formatCurrency(row.amount, report.currency)}</td><td>{scope === "included" ? <button className="button button--ghost" disabled={busy} onClick={() => void change(row.id, "exclude")}>Remove from report</button> : <button className="button button--ghost" disabled={busy} onClick={() => void change(row.id, "include")}>Add to report</button>}{scope === "excluded" ? <button className="button button--ghost" disabled={busy} onClick={() => void change(row.id, "reset")}>Use saved filters</button> : null}</td></tr>)}</tbody></table></div>
      {!page.results.length ? <p>{scope === "included" ? "No transactions in this report." : scope === "excluded" ? "No transactions have been removed." : "No matching transactions available to add."}</p> : null}
      <div className="report-actions"><button className="button button--ghost" disabled={busy || offset === 0} onClick={() => setOffset(Math.max(0, offset - 25))}>Previous</button><span>{page.count ? `${offset + 1}–${Math.min(offset + 25, page.count)} of ${page.count}` : "0 results"}</span><button className="button button--ghost" disabled={busy || page.next_offset === null} onClick={() => setOffset(page.next_offset!)}>Next</button></div>
    </> : null}
  </div></section>;
}
