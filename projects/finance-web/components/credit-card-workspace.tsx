"use client";
import { sumMoneyByCurrency } from "@/lib/financial-totals";
import { formatCurrency } from "../../finance-contracts/presentation";
import { AccountLabel } from "@/components/account-avatar";

import { formatCalendarDate } from "../../finance-contracts/presentation";
import { PlanningPaymentForm } from "@/components/planning-payment-form";
import { DatedList } from "@/components/dated-list";
import { CalendarDateInput } from "@/components/calendar-date-input";

import { useFeedbackMessage, useToast } from "@/components/toast-provider";

import type React from "react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import {
  type Account,
  type CreditCardBill,
  createCreditCardBill,
  listAccounts,
  listCreditCardBills
} from "@/lib/api";
import { getAccessToken } from "@/lib/auth-storage";
import { ButtonBusy, LoadingState } from "@/components/loading-state";

type CreditCardState =
  | { status: "loading" }
  | { message: string; status: "error" }
  | { accounts: Account[]; bills: CreditCardBill[]; status: "ready" };

function today() {
  return new Date().toISOString().slice(0, 10);
}

function formatMoney(value: string, currency = "BDT") { return formatCurrency(value, currency); }

function formatLabel(value: string) {
  return value.replaceAll("_", " ");
}

function statusBadgeClass(status: string) {
  if (status === "paid") {
    return "status-badge status-badge--ok";
  }
  if (status === "partially_paid") {
    return "status-badge status-badge--idle";
  }
  return "status-badge status-badge--error";
}

function daysUntilDue(dueDate: string) {
  const todayDate = new Date(today());
  const due = new Date(dueDate);
  return Math.ceil((due.getTime() - todayDate.getTime()) / 86_400_000);
}

function dueLabel(bill: CreditCardBill) {
  if (["paid", "waived"].includes(bill.status)) {
    return "Paid";
  }

  const days = daysUntilDue(bill.due_date);
  if (days < 0) {
    return `${Math.abs(days)} day${Math.abs(days) === 1 ? "" : "s"} overdue`;
  }
  if (days === 0) {
    return "Due today";
  }
  return `Due in ${days} day${days === 1 ? "" : "s"}`;
}

export function CreditCardWorkspace() {
  const { notify } = useToast();
  const [paymentRequest, setPaymentRequest] = useState<{ id: string; version: number } | null>(null);
  const [state, setState] = useState<CreditCardState>({ status: "loading" });
  const [formError, setFormError] = useFeedbackMessage("error");
  const [isCreating, setIsCreating] = useState(false);

  async function loadCreditCards(showLoading = true) {
    const accessToken = getAccessToken();

    if (!accessToken) {
      setState({ message: "Sign in before managing credit card bills.", status: "error" });
      return;
    }

    if (showLoading) {
      setState({ status: "loading" });
    }

    try {
      const [accounts, bills] = await Promise.all([
        listAccounts(accessToken),
        listCreditCardBills(accessToken)
      ]);
      setState({
        accounts: accounts.filter((account) => account.type === "credit_card"),
        bills,
        status: "ready"
      });
    } catch (error) {
      setState({
        message: error instanceof Error ? error.message : "Could not load credit card bills.",
        status: "error"
      });
    }
  }

  useEffect(() => {
    void loadCreditCards();
  }, []);

  const accountNames = useMemo(() => {
    if (state.status !== "ready") {
      return new Map<string, string>();
    }
    return new Map(state.accounts.map((account) => [account.id, account.name]));
  }, [state]);

  const totals = useMemo(() => {
    if (state.status !== "ready") {
      return {
        dueSoon: 0,
        openBalance: 0,
        overdue: 0
      };
    }

    return state.bills.reduce(
      (summary, bill) => {
        if (["paid", "waived"].includes(bill.status)) {
          return summary;
        }

        const dueIn = daysUntilDue(bill.due_date);
        summary.openBalance += Number(bill.remaining_balance);
        if (dueIn < 0) {
          summary.overdue += 1;
        }
        if (dueIn >= 0 && dueIn <= 7) {
          summary.dueSoon += 1;
        }
        return summary;
      },
      {
        dueSoon: 0,
        openBalance: 0,
        overdue: 0
      }
    );
  }, [state]);

  async function handleCreateBill(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const accessToken = getAccessToken();

    if (!accessToken) {
      setFormError("Sign in before creating a credit card bill.");
      return;
    }

    const form = event.currentTarget;
    const formData = new FormData(form);
    setFormError(null);
    setIsCreating(true);

    try {
      await createCreditCardBill(accessToken, {
        account: String(formData.get("account") ?? ""),
        due_date: String(formData.get("due_date") ?? ""),
        minimum_due: String(formData.get("minimum_due") ?? "") || "0.00",
        note: String(formData.get("note") ?? ""),
        reference: String(formData.get("reference") ?? ""),
        statement_balance: String(formData.get("statement_balance") ?? ""),
        statement_date: String(formData.get("statement_date") ?? "")
      });
      form.reset();
      await loadCreditCards(false);
      notify("Credit card bill added.");
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "Could not create credit card bill.");
    } finally {
      setIsCreating(false);
    }
  }


  if (state.status === "loading") {
    return <LoadingState detail="Checking statements, dues, and recorded payments" label="Loading credit cards" />;
  }

  if (state.status === "error") {
    return (
      <section className="panel">
        <div className="panel__body empty-state">
          <h1 className="section-title">Credit card bills</h1>
          <p className="section-subtitle">{state.message}</p>
          <Link className="button button--primary" href="/login">
            Sign in
          </Link>
        </div>
      </section>
    );
  }


  const currencyByAccount = new Map(state.accounts.map(account => [account.id, account.currency]));
  const dueTotals = sumMoneyByCurrency(state.bills.filter(bill => !["paid", "waived"].includes(bill.status)).map(bill => ({ currency: currencyByAccount.get(bill.account) ?? "BDT", amount: bill.remaining_balance })));
  const currentLiabilities = sumMoneyByCurrency(state.accounts.map(account => ({ currency: account.currency, amount: account.ledger_balance.startsWith("-") ? account.ledger_balance.slice(1) : "0" })));
  return (
    <div className="workspace-grid">
      <section className="panel">
        <div className="panel__body">
          <h1 className="section-title">Credit card bills</h1>
          <p className="section-subtitle">
            Track statement balances, due dates, minimum dues, and payments without mixing card liability into cash.
          </p>

          <p className="muted-text">Current card liability: {currentLiabilities.map(row => formatMoney(row.amount, row.currency)).join(" · ") || "No card accounts"}. Statement dues below cover their billing cycles; later purchases and refunds can make the current liability different. These are two views of the card, not amounts to add together.</p>
          <div className="metric-row">
            <div className="metric">
              <span className="metric__label">Remaining statement dues</span>
              <span className="metric__value">{dueTotals.map(row => <span key={row.currency}>{formatMoney(row.amount, row.currency)}<br /></span>)}</span>
            </div>
            <div className="metric">
              <span className="metric__label">Due soon</span>
              <span className="metric__value">{totals.dueSoon}</span>
            </div>
            <div className="metric">
              <span className="metric__label">Overdue</span>
              <span className="metric__value">{totals.overdue}</span>
            </div>
          </div>
        </div>
      </section>

      {formError ? <p className="form-error">{formError}</p> : null}





      <section className="panel">
        <div className="panel__body">
          <h2 className="section-title">Bill history</h2>
          <DatedList items={state.bills} fields={[{ label: "Statement date", date: bill => bill.statement_date }, { label: "Due date", date: bill => bill.due_date }]} label="Card bill history">{bills => <>
          {bills.length === 0 ? (
            <div className="empty-state">
              <p>No card bills match these dates.</p>
            </div>
          ) : (
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Card</th>
                    <th>Statement</th>
                    <th>Due</th>
                    <th>Statement balance</th>
                    <th>Minimum due</th>
                    <th>Paid</th>
                    <th>Remaining</th>
                    <th>Status</th>
                    <th>Reference</th>
                    <th>Note</th><th>Payments</th>
                  </tr>
                </thead>
                <tbody>
                  {bills.map((bill) => (
                    <tr key={bill.id}>
                      <td><AccountLabel account={state.status === "ready" ? state.accounts.find(account => account.id === bill.account) : undefined} fallback={accountNames.get(bill.account) ?? "Credit card"} /></td>
                      <td>{formatCalendarDate(bill.statement_date)}</td>
                      <td>{dueLabel(bill)}</td>
                      <td>{formatMoney(bill.statement_balance, currencyByAccount.get(bill.account))}</td>
                      <td>{formatMoney(bill.minimum_due, currencyByAccount.get(bill.account))}</td>
                      <td>{formatMoney(bill.paid_amount, currencyByAccount.get(bill.account))}</td>
                      <td>{formatMoney(bill.remaining_balance, currencyByAccount.get(bill.account))}</td>
                      <td>
                        <span className={statusBadgeClass(bill.status)}>{formatLabel(bill.status)}</span>
                      </td>
                      <td>{bill.reference || "-"}</td>
                      <td>{bill.note || "-"}</td><td><button className="button button--ghost" type="button" onClick={() => setPaymentRequest(previous => ({ id: bill.id, version: (previous?.version ?? 0) + 1 }))}>Payments</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          </>}</DatedList>
        </div>
      </section>
      <PlanningPaymentForm selectedParent={paymentRequest} kind="card" parents={state.bills.map(row => ({ id: row.id, label: `${accountNames.get(row.account) ?? "Card"} · ${formatCalendarDate(row.due_date)}`, open: row.status !== "paid" && row.status !== "waived", account: row.account }))} onChange={() => loadCreditCards(false)} />
      <section className="panel">
        <div className="panel__body">
          <details><summary><strong>Add card bill</strong></summary>
          {state.accounts.length === 0 ? (
            <div className="empty-state">
              <p>Create a credit card account before adding card bills.</p>
              <Link className="button button--primary" href="/accounts">
                Open accounts
              </Link>
            </div>
          ) : (
            <form className="transaction-form" onSubmit={handleCreateBill}>
              <label className="field">
                <span className="field__label">Card account</span>
                <select className="field__control" name="account" required>
                  <option value="">Select card</option>
                  {state.accounts.map((account) => (
                    <option key={account.id} value={account.id}>
                      {account.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span className="field__label">Statement balance</span>
                <input className="field__control" min="0.01" name="statement_balance" required step="0.01" type="number" />
              </label>
              <label className="field">
                <span className="field__label">Minimum due</span>
                <input className="field__control" min="0" name="minimum_due" step="0.01" type="number" />
              </label>
              <label className="field">
                <span className="field__label">Statement date</span>
                <CalendarDateInput defaultValue={today()} name="statement_date" required />
              </label>
              <label className="field">
                <span className="field__label">Due date</span>
                <CalendarDateInput name="due_date" required />
              </label>
              <label className="field">
                <span className="field__label">Reference</span>
                <input className="field__control" name="reference" />
              </label>
              <label className="field field--wide">
                <span className="field__label">Note</span>
                <input className="field__control" name="note" />
              </label>
              <button className="button button--primary field--wide" disabled={isCreating} type="submit">
                {isCreating ? <ButtonBusy label="Saving" /> : "Save bill"}
              </button>
            </form>
          )}
          </details>
        </div>
      </section>
    </div>
  );
}
