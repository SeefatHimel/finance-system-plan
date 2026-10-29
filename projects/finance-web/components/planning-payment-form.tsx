"use client";
import { useEffect, useRef, useState } from "react";
import { CalendarDateInput } from "@/components/calendar-date-input";
import { useToast } from "@/components/toast-provider";
import { ButtonBusy } from "@/components/loading-state";
import { getAccessToken } from "@/lib/auth-storage";
import { type Account, type LedgerPaymentInput, type PlanningPaymentKind, getPlanningPayments, listAccounts, recordPlanningPayment, unlinkPlanningPayment } from "@/lib/api";
import { formatCalendarDate, formatCurrency } from "../../finance-contracts/presentation";

type Parent = { id: string; label: string; account?: string; open: boolean };
export function PlanningPaymentForm({ kind, parents, onChange, selectedParent }: { selectedParent?: { id: string; version: number } | null; kind: PlanningPaymentKind; parents: Parent[]; onChange: () => Promise<void> }) {
  const { notify } = useToast();
  const details = useRef<HTMLDetailsElement>(null);
  useEffect(() => { if (selectedParent && details.current) { setParentId(selectedParent.id); details.current.open = true; details.current.scrollIntoView({ block: "start", behavior: "smooth" }); details.current.querySelector<HTMLSelectElement>("select")?.focus({ preventScroll: true }); } }, [selectedParent]);
  const [parentId, setParentId] = useState("");
  const parent = parents.find(row => row.id === parentId);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [mode, setMode] = useState<LedgerPaymentInput["ledger_action"]>("link");
  const [amount, setAmount] = useState("");
  const [paidAt, setPaidAt] = useState(() => { const now = new Date(); return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`; });
  const [note, setNote] = useState("");
  const [funding, setFunding] = useState("");
  const [selected, setSelected] = useState("");
  const [options, setOptions] = useState<Awaited<ReturnType<typeof getPlanningPayments>> | null>(null);
  const [revision, setRevision] = useState(0);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const request = useRef<{ payload: string; id: string } | null>(null);
  useEffect(() => { const token = getAccessToken(); if (token) void listAccounts(token).then(setAccounts).catch(() => {}); }, []);
  useEffect(() => {
    setOptions(null); setSelected(""); setError("");
    if (!parentId || !paidAt) return;
    const token = getAccessToken(); if (!token) return;
    const controller = new AbortController(); setLoading(true);
    void getPlanningPayments(token, kind, parentId, paidAt, controller.signal).then(result => { if (!controller.signal.aborted) setOptions(result); })
      .catch((reason: unknown) => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Could not load payment links."); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [kind, parentId, paidAt, revision]);
  const currency = kind === "debt" ? "BDT" : accounts.find(row => row.id === parent?.account)?.currency ?? "BDT";
  const eligible = options?.eligible.filter(row => !amount || Number(row.amount) === Number(amount)) ?? [];
  async function refresh() { setRevision(value => value + 1); window.dispatchEvent(new Event("finance:transactions-changed")); await onChange(); }
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); const token = getAccessToken(); if (!token || !parent) return;
    setBusy(true); setError("");
    const payload = JSON.stringify({ parentId, mode, amount, paidAt, note, funding, selected });
    if (request.current?.payload !== payload) request.current = { payload, id: crypto.randomUUID() };
    try {
      const result = await recordPlanningPayment(token, kind, parentId, { amount, paid_at: paidAt, note, ledger_action: mode, request_id: request.current.id, ...(mode === "create" && kind !== "recurring" ? { funding_account: funding } : {}), ...(mode === "link" ? { transaction: selected } : {}) });
      setAmount(""); setNote(""); setSelected(""); request.current = null;
      notify(result.transaction ? "Payment recorded and linked to the ledger." : "Planning record updated. Account balances were not changed.");
      await refresh();
    } catch (reason) { const message = reason instanceof Error ? reason.message : "Could not record payment."; setError(message); notify(message, "error"); }
    finally { setBusy(false); }
  }
  async function unlink(id: string) {
    const token = getAccessToken(); if (!token) return;
    setBusy(true);
    try { await unlinkPlanningPayment(token, kind, parentId, id); notify("Payment record removed. Its ledger transaction was kept."); await refresh(); }
    catch (reason) { notify(reason instanceof Error ? reason.message : "Could not unlink payment.", "error"); }
    finally { setBusy(false); }
  }
  return <section className="panel"><div className="panel__body"><details ref={details}><summary><strong>Payments & ledger links</strong></summary>
    <p className="muted-text">Link an imported payment first to avoid recording the same money twice. Removing a payment record keeps its ledger transaction.</p>
    <label className="field"><span className="field__label">{kind === "debt" ? "Person or business" : "Bill"}</span><select className="field__control" value={parentId} onChange={event => setParentId(event.target.value)} disabled={busy}><option value="">Choose a record</option>{parents.map(row => <option key={row.id} value={row.id}>{row.label}{row.open ? "" : " · Closed / paid"}</option>)}</select></label>
    {parent ? <>
      {parent.open ? <form className="transaction-form" onSubmit={submit}>
        <label className="field field--wide"><span className="field__label">How should this payment affect your accounts?</span><select className="field__control" value={mode} onChange={event => { setMode(event.target.value as LedgerPaymentInput["ledger_action"]); setSelected(""); }} disabled={busy}><option value="link">Link an existing ledger transaction</option><option value="create">Create a new ledger transaction</option><option value="record_only">Update planning record only</option></select></label>
        <label className="field"><span className="field__label">Amount ({currency})</span><input className="field__control" type="number" step="0.01" min="0.01" required value={amount} onChange={event => setAmount(event.target.value)} disabled={busy} /></label>
        <label className="field"><span className="field__label">Payment date</span><CalendarDateInput value={paidAt} required onChange={setPaidAt} disabled={busy} /></label>
        {mode === "link" ? <label className="field field--wide"><span className="field__label">Existing movement · same date, amount and payment type</span><select className="field__control" value={selected} required onChange={event => { setSelected(event.target.value); const row = eligible.find(item => item.id === event.target.value); if (row) setAmount(row.amount); }} disabled={loading || busy}><option value="">{loading ? "Loading movements…" : "Choose a movement"}</option>{eligible.map(row => <option key={row.id} value={row.id}>{row.counterparty_text || row.note || row.type.replaceAll("_", " ")} · {formatCurrency(row.amount, currency)} · {accounts.find(item => item.id === row.account)?.name ?? "Account"}</option>)}</select>{!loading && !eligible.length ? <small>No compatible movements on this date. Check the date or review your imports before creating a new transaction.</small> : null}{options && options.eligible_count > 100 ? <small>Showing the latest 100. Narrow the payment date.</small> : null}</label> : null}
        {mode === "create" && kind !== "recurring" ? <label className="field field--wide"><span className="field__label">{kind === "debt" ? "Account where money moved" : "Pay from account"}</span><select className="field__control" value={funding} required onChange={event => setFunding(event.target.value)} disabled={busy}><option value="">Choose account</option>{accounts.filter(row => row.is_active && row.currency === currency && (kind !== "card" || row.id !== parent.account)).map(row => <option key={row.id} value={row.id}>{row.name}</option>)}</select></label> : null}
        {mode === "create" ? <p className="field--wide muted-text">{kind === "card" ? "Creates a transfer into the card account. It is not counted as spending again." : kind === "recurring" ? "Creates an expense in the bill's account and advances its due date." : "Creates a principal repayment, shown separately from earned income and spending."} No transaction time is invented.</p> : mode === "record_only" ? <p className="field--wide form-error">This only updates the debt or bill schedule. It does not change any account balance or spending total.</p> : null}
        <label className="field field--wide"><span className="field__label">Note (optional)</span><input className="field__control" value={note} onChange={event => setNote(event.target.value)} disabled={busy} /></label>
        {error ? <p className="field--wide form-error">{error}</p> : null}
        <button className="button button--primary" disabled={busy || loading || (mode === "link" && !selected)}>{busy ? <ButtonBusy label="Recording" /> : mode === "link" ? "Link payment" : mode === "create" ? "Record payment & transaction" : "Update planning record"}</button>
      </form> : <p className="muted-text">This record is closed. Its payment history is below.</p>}
      <h3>Payment history</h3>{options?.payments.length ? <div className="list-stack">{options.payments.map(row => <div className="list-row" key={row.id}><span>{formatCalendarDate(row.paid_at)} · {formatCurrency(row.amount, currency)}<small className="muted-text"> · {row.transaction ? "Linked to ledger" : "Planning only"}</small></span><button className="button button--ghost" disabled={busy} onClick={() => void unlink(row.id)} type="button">Remove payment record</button></div>)}</div> : <p className="muted-text">{loading ? "Loading payment history…" : "No payments recorded."}</p>}
    </> : null}
  </details></div></section>;
}
