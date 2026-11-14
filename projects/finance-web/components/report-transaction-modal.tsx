"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { ArrowLeft, X } from "@phosphor-icons/react";
import { ModalDialog } from "@/components/modal-dialog";
import { useTransactionRecovery } from "@/components/transaction-recovery";
import { reportDrillPage } from "@/lib/report-data";
import { getAccessToken } from "@/lib/auth-storage";
import { getTransaction, type Account, type Category, type Transaction, type TransactionActivityPage, type TransactionFilters } from "@/lib/api";
import { formatCalendarDate, formatCurrency, displayLabel } from "../../finance-contracts/presentation";

export type ReportSelection = { label: string; filters: TransactionFilters; href: string; transaction?: Transaction };
export function ReportTransactionModal({ selection, accounts, categories, currency, revision, onClose }: { selection: ReportSelection; accounts: Account[]; categories: Pick<Category, "id" | "name">[]; currency: string; revision: number; onClose: () => void }) {
  const { edit } = useTransactionRecovery();
  const [page, setPage] = useState<TransactionActivityPage | null>(null);
  const [number, setNumber] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const [transaction, setTransaction] = useState<Transaction | null>(selection.transaction ?? null);
  const [message, setMessage] = useState("");
  const savedRecord = useRef<Transaction | null>(null);
  const previousRevision = useRef(revision);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState("");
  useEffect(() => {
    const saved = (event: Event) => {
      const value = (event as CustomEvent<Transaction>).detail;
      savedRecord.current = value;
      setTransaction(current => current?.id === value.id ? value : current);
      setDetailLoading(false);
      setDetailError("");
      setMessage("Transaction saved. Changes to its date, account or category can move it out of this selection.");
    };
    window.addEventListener("finance:transaction-saved", saved);
    return () => window.removeEventListener("finance:transaction-saved", saved);
  }, []);
  const transactionId = transaction?.id;
  useEffect(() => {
    if (previousRevision.current === revision) return;
    previousRevision.current = revision;
    const justSaved = savedRecord.current;
    savedRecord.current = null;
    if (!transactionId) return;
    // The editor already returned the saved entry. Other changes, including
    // Undo, need an authoritative read of the entry still being inspected.
    if (justSaved?.id === transactionId) return;
    const token = getAccessToken(); if (!token) return;
    const controller = new AbortController(); setDetailLoading(true); setDetailError("");
    void getTransaction(token, transactionId, controller.signal).then(value => { if (!controller.signal.aborted) setTransaction(value); })
      .catch((reason: unknown) => { if (!controller.signal.aborted) setDetailError(reason instanceof Error ? reason.message : "Could not refresh this transaction."); })
      .finally(() => { if (!controller.signal.aborted) setDetailLoading(false); });
    return () => controller.abort();
  }, [revision, transactionId]);
  useEffect(() => { document.getElementById("report-drill-title")?.focus({ preventScroll: true }); }, [transaction]);
  useEffect(() => {
    if (selection.transaction) { setLoading(false); return; }
    let active = true; setLoading(true); setError("");
    const token = getAccessToken();
    if (!token) { setError("Sign in to inspect transactions."); setLoading(false); return; }
    void reportDrillPage(token, selection.filters, number).then(value => {
      if (!active) return;
      const lastPage = Math.max(1, Math.ceil(value.count / 25));
      if (number > lastPage) setNumber(lastPage);
      else setPage(value);
    })
      .catch((reason: unknown) => { if (active) setError(reason instanceof Error ? reason.message : "Could not load transactions."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [selection, number, retry, revision]);
  const accountName = (id: string | null) => accounts.find(row => row.id === id)?.name ?? "Account";
  const categoryName = (id: string | null) => id ? categories.find(row => row.id === id)?.name ?? "Category unavailable" : "Uncategorized";
  function inspect(value: Transaction | null) {
    setDetailError(""); setDetailLoading(false); setTransaction(value);
  }
  return <ModalDialog labelledBy="report-drill-title" initialFocus="#report-drill-title" fallbackFocus="#report-overview-title" className="report-detail-modal" onCancel={onClose}>
    <header className="report-modal-header"><div><span className="report-eyebrow">Report detail</span><h2 id="report-drill-title" tabIndex={-1}>{transaction ? "Transaction details" : selection.label}</h2><p>{transaction ? `${formatCalendarDate(transaction.date)} · ${displayLabel(transaction.type)}` : `${selection.filters.spending ? "Spending and refunds" : "Selected transactions"} · ${currency}`}</p></div><button className="icon-button" aria-label="Close report details" onClick={onClose}><X size={20} /></button></header>
    <div className="report-modal-body">
      {message ? <p role="status" className="report-chart-note">{message}</p> : null}
      {detailError ? <p role="alert" className="form-error">{detailError} Close and reopen this detail to retry.</p> : null}
      {transaction ? <>{!selection.transaction ? <button className="report-text-button" onClick={() => inspect(null)}><ArrowLeft size={16} />Back to {selection.label}</button> : null}{!detailError ? <dl className="report-transaction-facts" aria-busy={detailLoading} style={{ opacity: detailLoading ? 0.6 : 1 }}>
        <div><dt>Description</dt><dd>{transaction.counterparty_text || transaction.note || displayLabel(transaction.type)}</dd></div>
        <div><dt>Amount</dt><dd>{formatCurrency(transaction.amount, accounts.find(row => row.id === transaction.account)?.currency ?? currency)}</dd></div>
        <div><dt>Account</dt><dd>{accountName(transaction.account)}</dd></div>
        {transaction.transfer_account ? <div><dt>Transfer to</dt><dd>{accountName(transaction.transfer_account)}</dd></div> : null}
        <div><dt>Category</dt><dd>{categoryName(transaction.category)}</dd></div><div><dt>Source</dt><dd>{displayLabel(transaction.source)}</dd></div>
        <div><dt>Time</dt><dd>{transaction.time ?? "Time unknown"}</dd></div><div><dt>Notes</dt><dd>{transaction.note || "—"}</dd></div>
      </dl> : null}<p className="report-chart-note">Editing changes the ledger transaction and all affected reports.</p></> : <>
        <p className="report-chart-note">These entries use the same selection as this report breakdown. Closing this window keeps your report and chart settings in place.</p>
        {error ? <div role="alert" className="form-error"><p>{error}</p><button className="button button--ghost" onClick={() => setRetry(value => value + 1)}>Retry transactions</button></div> : null}
        <p role="status">{loading ? "Loading transactions…" : error ? "" : `${page?.count ?? 0} transactions`}</p>
        {!error && page ? <div aria-busy={loading} style={{ opacity: loading ? 0.6 : 1 }}><div className="table-wrap"><table className="data-table"><caption className="sr-only">Transactions for {selection.label}</caption><thead><tr><th scope="col">Date</th><th scope="col">Transaction</th><th scope="col">Type</th><th scope="col">Amount</th></tr></thead><tbody>{page.results.map(row => <tr key={row.id}><td>{formatCalendarDate(row.date)}</td><td><button type="button" className="report-text-button" disabled={loading} onClick={() => inspect(row)}>{row.counterparty_text || row.note || displayLabel(row.type)}</button><small className="report-comparison">{accountName(row.account)} · {categoryName(row.category)}</small></td><td>{displayLabel(row.type)}</td><td>{formatCurrency(row.amount, currency)}</td></tr>)}</tbody></table></div>
          {!page.results.length ? <p>No transactions match this selection.</p> : null}
          <div className="report-modal-pagination"><button className="button button--ghost" disabled={loading || number === 1} onClick={() => setNumber(value => value - 1)}>Previous transactions</button><span>{page.count ? `${(number - 1) * 25 + 1}–${Math.min(number * 25, page.count)} of ${page.count}` : "0 transactions"}</span><button className="button button--ghost" disabled={loading || page.next_offset === null} onClick={() => setNumber(value => value + 1)}>Next transactions</button></div>
        </div> : null}
      </>}
    </div>
    <footer className="report-modal-footer"><Link href={selection.href} className="report-text-button">Open in Transactions</Link>{transaction ? <button className="button button--ghost" disabled={detailLoading || !!detailError} onClick={() => edit(transaction.id)}>Edit transaction</button> : null}<button className="button button--primary" onClick={onClose}>Done</button></footer>
  </ModalDialog>;
}
