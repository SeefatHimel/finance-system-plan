"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowRight, CaretDown, CaretLeft, CaretRight, ClockCounterClockwise, FileText, ChatText, PencilSimple, X, WarningCircle } from "@phosphor-icons/react";
import { CompactReportedBalances } from "@/components/compact-reported-balances";
import { transactionBalanceReports } from "@/lib/balance-reports";
import { AccountAvatar, AccountLabel } from "@/components/account-avatar";
import { ModalDialog } from "@/components/modal-dialog";
import { LoadingState } from "@/components/loading-state";
import { SourceEvidenceText } from "@/components/source-evidence-text";
import { MessageChoiceLearning } from "@/components/message-choice-learning";
import { useToast } from "@/components/toast-provider";
import { getAccessToken } from "@/lib/auth-storage";
import { detailAmount, detailBalances, detailDifferences, detailSourceCount, type DetailObservation } from "@/lib/transaction-detail";
import { getTransaction, listTransactionSourceMessages, listTransactionStatementEvidence, getStatementImport, listAuditLogs, type Account, type Category, type Transaction, type TransactionSourceMessage, type SavedStatementRow, type SavedStatement, type AuditLogEntry } from "@/lib/api";
import { displayLabel, formatCurrency, formatCalendarDate, formatClockTime, formatTimestamp, timestampFields } from "../../finance-contracts/presentation";

type Props = { transactionId: string; orderedIds: string[]; accounts: Account[]; categories: Category[]; selectedAccount?: string; onNavigate: (id: string) => void; onClose: () => void; onEdit: (id: string) => void };
type Detail = { record: Transaction; messages: TransactionSourceMessage[] | null; rows: SavedStatementRow[] | null; batches: Record<string, SavedStatement>; incomplete: boolean };
function errorMessage(reason: unknown) { return reason instanceof Error ? reason.message : "Could not load transaction details."; }
function sourceMoney(value: string | null, currency: string | null) { return value === null ? "Not reported" : currency ? formatCurrency(value, currency) : `${value} (currency unavailable)`; }

function History({ id }: { id: string }) {
  const [requested, setRequested] = useState(false);
  const [revision, setRevision] = useState(0);
  const [entries, setEntries] = useState<AuditLogEntry[] | null>(null);
  const [failed, setFailed] = useState(false);
  const { notify } = useToast();
  useEffect(() => {
    if (!requested) return;
    const token = getAccessToken(); if (!token) return;
    const controller = new AbortController(); setEntries(null); setFailed(false);
    void listAuditLogs(token, { entity_type: "transactions.transaction", entity_id: id }, controller.signal)
      .then(rows => { if (!controller.signal.aborted) setEntries(rows); })
      .catch(reason => { if (!controller.signal.aborted) { setFailed(true); notify(errorMessage(reason), "error"); } });
    return () => controller.abort();
  }, [id, requested, revision, notify]);
  return <details className="transaction-view-disclosure" onToggle={event => { if (event.currentTarget.open) setRequested(true); }}><summary><ClockCounterClockwise size={20} aria-hidden="true" />History<CaretDown className="transaction-view-disclosure__caret" size={16} aria-hidden="true" /></summary>
    {requested ? <div className="transaction-view-history">{failed ? <p>History unavailable. <button type="button" className="text-button" onClick={() => setRevision(value => value + 1)}>Retry history</button></p> : entries === null ? <p role="status">Loading history…</p> : entries.length ? <ol>{entries.slice(0, 8).map(entry => <li key={entry.id}><strong>{displayLabel(entry.action)}</strong><time dateTime={entry.created_at}>{formatTimestamp(entry.created_at)}</time></li>)}</ol> : <p>No history entries were found for this transaction.</p>}<Link href={`/audit-logs?entity_type=transactions.transaction&entity_id=${id}`}>Open full history <ArrowRight size={14} /></Link></div> : null}
  </details>;
}

function SourceSummary({ label, observation, record, balances, currency, subtitle }: { label: string; observation: DetailObservation; record: Transaction; balances: Record<string, string>; currency: string; subtitle?: string }) {
  const differences = detailDifferences(record, observation, balances, currency);
  const changed = (field: string) => differences.some(item => item.field === field) ? "transaction-view-difference" : "";
  const sourceCurrency = observation.currency || (observation.account && [record.account, record.transfer_account].includes(observation.account) ? currency : null);
  return <div className="transaction-view-source"><span className="transaction-view-source__icon" aria-hidden="true">{label === "SMS" ? <ChatText size={22} /> : <FileText size={22} />}</span><div className="transaction-view-source__text"><strong>{label}</strong>
    <span>{observation.dateKind === "received" ? "Received " : ""}<time className={changed("date")} dateTime={observation.date ?? undefined}>{observation.date ? formatCalendarDate(observation.date) : "Date not reported"}</time>{observation.time ? <span className={changed("time")}>{` · ${formatClockTime(observation.time)}`}</span> : " · Time not reported"}</span>{subtitle ? <small className={changed("account")}>{subtitle}</small> : null}
    {differences.length ? <span className="transaction-view-source__warnings">{differences.map(item => <span key={item.field}><WarningCircle size={13} aria-hidden="true" />{item.label}</span>)}</span> : null}
    </div><div className="transaction-view-source__money"><strong className={changed("amount")}>{sourceMoney(observation.amount, sourceCurrency)}</strong></div></div>;
}

function OriginalSources({ detail }: { detail: Detail }) {
  const { messages, rows, batches } = detail;
  const [learningCandidateId, setLearningCandidateId] = useState<string | null>(null);
  return <details className="transaction-view-disclosure"><summary><FileText size={20} aria-hidden="true" />Read original sources<CaretDown className="transaction-view-disclosure__caret" size={16} aria-hidden="true" /></summary><div className="transaction-view-originals">
    {messages?.map(message => <article key={message.id}><strong>SMS · {message.sender}</strong><p className="muted-text">Received {formatTimestamp(message.received_at)}</p><p className="transaction-view-original-text">{message.body ? <SourceEvidenceText text={message.body} facts={{ amount: message.parsed?.amount, balanceAfter: message.parsed?.balance_after, reference: message.parsed?.reference }} /> : "Original SMS text is unavailable or redacted. Saved observations remain visible above."}</p>{message.parsed?.can_remember_cash_route && message.parsed.candidate_id ? learningCandidateId === message.parsed.candidate_id ? <MessageChoiceLearning candidateId={message.parsed.candidate_id} messageKind="cash_out" onDone={() => setLearningCandidateId(null)} previouslySaved /> : <button type="button" className="button button--ghost button--small" onClick={() => setLearningCandidateId(message.parsed?.candidate_id ?? null)}>Remember this cash withdrawal route</button> : null}</article>)}
    {rows?.map(row => <article key={row.id}><strong>Statement · Page {row.extracted.page}, row {row.extracted.row}{row.component === "fee" ? " · Inline fee" : ""}</strong><p className="transaction-view-original-text"><SourceEvidenceText text={row.extracted.description} facts={{ amount: row.extracted.amount, balanceAfter: row.extracted.balance_after, date: row.extracted.date, reference: row.extracted.reference, direction: row.extracted.direction }} /></p><Link href={`/statements?import=${row.batch}`} target="_blank" rel="noopener noreferrer">Open saved statement{batches[row.batch]?.has_original_file ? " & PDF" : ""} in new tab <ArrowRight size={14} /></Link>{batches[row.batch]?.has_original_file === false ? <p className="muted-text">This import has no archived PDF.</p> : null}</article>)}
    {messages?.length === 0 && rows?.length === 0 ? <p>No original SMS or statement is attached. This entry was recorded from {displayLabel(detail.record.source)}.</p> : null}
    {messages === null || rows === null ? <p>Some originals could not be checked. Retry the source check above.</p> : null}
  </div></details>;
}

export function TransactionDetailDialog({ transactionId, orderedIds, accounts, categories, selectedAccount = "", onNavigate, onClose, onEdit }: Props) {
  const [detail, setDetail] = useState<Detail | null>(null);
  const [failure, setFailure] = useState("");
  const [revision, setRevision] = useState(0);
  const { notify } = useToast();
  const scrollBody = useRef<HTMLDivElement>(null);
  useEffect(() => { const refresh = () => setRevision(value => value + 1); window.addEventListener("finance:transactions-changed", refresh); return () => window.removeEventListener("finance:transactions-changed", refresh); }, []);
  useEffect(() => {
    const token = getAccessToken(); setDetail(null); setFailure(""); scrollBody.current?.scrollTo({ top: 0 });
    if (!token) { setFailure("Sign in to view this transaction."); return; }
    const controller = new AbortController();
    void (async () => {
      const [record, messages, rows] = await Promise.allSettled([getTransaction(token, transactionId, controller.signal), listTransactionSourceMessages(token, transactionId, controller.signal), listTransactionStatementEvidence(token, transactionId, controller.signal)]);
      if (controller.signal.aborted) return;
      if (record.status === "rejected") throw record.reason;
      const sourceRows = rows.status === "fulfilled" ? rows.value : null;
      const ids = [...new Set(sourceRows?.map(row => row.batch) ?? [])];
      const metadata = await Promise.allSettled(ids.map(id => getStatementImport(token, id, controller.signal)));
      if (controller.signal.aborted) return;
      const batches = Object.fromEntries(metadata.flatMap((item, index) => item.status === "fulfilled" ? [[ids[index], item.value]] : []));
      const incomplete = messages.status === "rejected" || rows.status === "rejected" || metadata.some(item => item.status === "rejected");
      setDetail({ record: record.value, messages: messages.status === "fulfilled" ? messages.value : null, rows: sourceRows, batches, incomplete });
      if (incomplete) notify("Some attached source details could not be loaded. You can retry without changing the transaction.", "error");
    })().catch(reason => { if (!controller.signal.aborted) { setFailure(errorMessage(reason)); notify(errorMessage(reason), "error"); } });
    return () => controller.abort();
  }, [transactionId, revision, notify]);
  const index = orderedIds.indexOf(transactionId);
  const record = detail?.record.id === transactionId ? detail.record : undefined;
  const account = accounts.find(item => item.id === record?.account);
  const currency = account?.currency ?? "BDT";
  const category = categories.find(item => item.id === record?.category)?.name ?? (record?.category ? "Category unavailable" : "Uncategorized");
  const balances = record ? detailBalances(record) : {};
  const amount = record ? detailAmount(record, selectedAccount) : null;
  const identifiers = record ? [
    ["Sender account", record.sender_account_identifier], ["Sender card", record.sender_card_identifier],
    ["Receiver account", record.receiver_account_identifier], ["Receiver card", record.receiver_card_identifier],
  ].filter(([, value]) => value) : [];
  return <ModalDialog className="transaction-detail-dialog" labelledBy="transaction-detail-title" initialFocus=".transaction-view-close" onCancel={onClose}>
    <header className="transaction-view-header"><h2 id="transaction-detail-title">Transaction details</h2><button className="icon-button transaction-view-close" type="button" onClick={onClose} aria-label="Close transaction details"><X size={22} /></button></header>
    <nav className="transaction-view-navigation" aria-label="Browse filtered transactions"><button className="icon-button" type="button" disabled={index <= 0} onClick={() => onNavigate(orderedIds[index - 1])} aria-label="Previous transaction"><CaretLeft size={18} /></button><span aria-live="polite">{index >= 0 ? `${index + 1} of ${orderedIds.length}` : "Saved transaction"}</span><button className="icon-button" type="button" disabled={index < 0 || index >= orderedIds.length - 1} onClick={() => onNavigate(orderedIds[index + 1])} aria-label="Next transaction"><CaretRight size={18} /></button></nav>
    <div className="transaction-view-body" ref={scrollBody} aria-busy={!record && !failure}>
      {failure ? <div className="empty-state"><h3>Transaction unavailable</h3><p>{failure}</p><button type="button" className="button button--ghost" onClick={() => setRevision(value => value + 1)}>Retry transaction details</button></div> : !detail || !record ? <LoadingState compact label="Opening transaction" detail="Checking the saved entry and attached sources" /> : <>
        <section className="transaction-view-hero"><AccountAvatar account={{ id: record.id, name: record.counterparty_text || displayLabel(record.type) }} size="large" /><div><h3>{record.counterparty_text || record.reference || displayLabel(record.type)}</h3><div className="transaction-badges"><span className="transaction-mini-badge">{displayLabel(record.type)}</span><span className="transaction-category">{category}</span>{record.needs_review ? <span className="transaction-mini-badge transaction-mini-badge--review">Needs review</span> : null}</div></div><strong className={`transaction-view-amount transaction-view-amount--${amount?.tone}`}>{amount?.sign}{formatCurrency(record.amount, currency)}</strong></section>
        <dl className="transaction-view-facts"><div><dt>{record.type === "transfer" ? "Account path" : "Account"}</dt><dd><AccountLabel account={account} />{record.type === "transfer" ? <><ArrowRight size={16} aria-label="to" /><AccountLabel account={accounts.find(item => item.id === record.transfer_account)} fallback="Destination unavailable" /></> : null}</dd></div><div><dt>Transaction date</dt><dd><time dateTime={record.date}>{formatCalendarDate(record.date)}</time><small>{record.time ? formatClockTime(record.time) : "Time not reported"}</small></dd></div><div><dt>Category</dt><dd><span className="transaction-category">{category}</span></dd></div><div><dt>Reported balance after</dt><dd><CompactReportedBalances record={record} accounts={accounts} reports={transactionBalanceReports(record, accounts, detail)} incomplete={detail.incomplete} /></dd></div><div><dt>Reference</dt><dd>{record.reference || "Not reported"}</dd></div>{record.note && record.note !== record.counterparty_text ? <div><dt>Note</dt><dd className="transaction-view-note">{record.note}</dd></div> : null}</dl>
        <section className="transaction-view-sources"><div className="transaction-view-section-title"><h3>Attached sources</h3><span>{detailSourceCount(detail.messages, detail.rows)}</span></div>
          {detail.incomplete ? <p className="muted-text">Some source details are unavailable. <button type="button" className="text-button" onClick={() => setRevision(value => value + 1)}>Retry source check</button></p> : null}
          {detail.messages?.map(message => { const observation = record.transfer_evidence.find(item => item.raw_message === message.id); const sourceAccount = observation?.account ?? message.parsed?.account ?? null; return <SourceSummary key={message.id} label="SMS" record={record} balances={balances} currency={currency} subtitle={observation ? accounts.find(item => item.id === observation.account)?.name ?? "Account unavailable" : "Received time; transaction time not established by this source"} observation={{ account: sourceAccount, date: observation?.date ?? timestampFields(message.received_at).date, time: observation ? observation.time : timestampFields(message.received_at).time, dateKind: observation ? "reported" : "received", amount: message.parsed?.amount ?? null, balance: message.parsed?.balance_after ?? observation?.balance_after ?? null, direction: observation?.direction, currency: observation ? accounts.find(item => item.id === observation.account)?.currency : message.parsed?.currency ?? null }} />; })}
          {detail.rows?.map(row => { const batch = detail.batches[row.batch]; const fee = row.component === "fee"; const sourceAmount = fee ? String(Math.abs(Number(row.extracted.signed_fee))) : row.extracted.amount; return <SourceSummary key={row.id} label={fee ? "Statement fee row" : "Statement"} record={record} balances={balances} currency={currency} subtitle={`${batch?.account_name ?? "Reporting account unavailable"} · Page ${row.extracted.page}, row ${row.extracted.row}`} observation={{ account: batch?.account ?? null, date: row.extracted.date, time: row.extracted.time, dateKind: "reported", amount: sourceAmount, balance: row.extracted.balance_after, direction: fee ? Number(row.extracted.signed_fee) < 0 ? "debit" : "credit" : row.reviewed_source_direction || row.extracted.direction, currency: batch?.currency, compareAmount: !fee || record.type === "fee" }} />; })}
          {detail.messages?.length === 0 && detail.rows?.length === 0 ? <p className="muted-text">No SMS or statement is attached. Recorded from {record.source === "web" ? "a manual entry" : displayLabel(record.source)}.</p> : null}
          {(detail.messages?.length || detail.rows?.length) ? <p className="transaction-view-source-note">Highlighted values differ from the saved ledger entry. A missing statement time is not a mismatch.</p> : null}
        </section>
        {identifiers.length ? <details className="transaction-view-disclosure"><summary><FileText size={20} aria-hidden="true" />Saved identifiers<CaretDown className="transaction-view-disclosure__caret" size={16} aria-hidden="true" /></summary><dl className="transaction-view-facts">{identifiers.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl></details> : null}
        <OriginalSources key={`original:${record.id}`} detail={detail} />
        <History key={`history:${record.id}`} id={record.id} />
      </>}
    </div><footer className="transaction-view-footer"><button className="button button--ghost" type="button" onClick={onClose}>Close</button><button className="button button--primary" type="button" disabled={!record} onClick={() => onEdit(transactionId)}><PencilSimple size={17} aria-hidden="true" />Edit transaction</button></footer>
  </ModalDialog>;
}
