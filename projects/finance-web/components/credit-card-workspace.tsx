"use client";

import type React from "react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import {
  type Account,
  type CreditCardBill,
  createCreditCardBill,
  createCreditCardPayment,
  listAccounts,
  listCreditCardBills
} from "@/lib/api";
import { getAccessToken } from "@/lib/auth-storage";

type CreditCardState =
  | { status: "loading" }
  | { message: string; status: "error" }
  | { accounts: Account[]; bills: CreditCardBill[]; status: "ready" };

const moneyFormatter = new Intl.NumberFormat("en-BD", {
  currency: "BDT",
  style: "currency"
});

function today() {
  return new Date().toISOString().slice(0, 10);
}

function formatMoney(value: string) {
  return moneyFormatter.format(Number(value));
}

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
  if (bill.status === "paid") {
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
  const [state, setState] = useState<CreditCardState>({ status: "loading" });
  const [formError, setFormError] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [paymentBillId, setPaymentBillId] = useState("");
  const [paymentAmount, setPaymentAmount] = useState("");
  const [paymentDate, setPaymentDate] = useState(today());
  const [paymentNote, setPaymentNote] = useState("");
  const [isPaying, setIsPaying] = useState(false);

  async function loadCreditCards() {
    const accessToken = getAccessToken();

    if (!accessToken) {
      setState({ message: "Sign in before managing credit card bills.", status: "error" });
      return;
    }

    setState({ status: "loading" });

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
        if (bill.status === "paid") {
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
      await loadCreditCards();
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "Could not create credit card bill.");
    } finally {
      setIsCreating(false);
    }
  }

  async function handleCreatePayment(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const accessToken = getAccessToken();

    if (!accessToken) {
      setFormError("Sign in before recording a bill payment.");
      return;
    }
    if (!paymentBillId || !paymentAmount || !paymentDate) {
      setFormError("Bill, amount, and paid date are required.");
      return;
    }

    setFormError(null);
    setIsPaying(true);

    try {
      await createCreditCardPayment(accessToken, paymentBillId, {
        amount: paymentAmount,
        note: paymentNote,
        paid_at: paymentDate
      });
      setPaymentAmount("");
      setPaymentNote("");
      await loadCreditCards();
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "Could not record bill payment.");
    } finally {
      setIsPaying(false);
    }
  }

  if (state.status === "loading") {
    return (
      <section className="panel">
        <div className="panel__body">
          <span className="status-badge status-badge--idle">Loading credit cards</span>
        </div>
      </section>
    );
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

  const openBills = state.bills.filter((bill) => bill.status !== "paid");

  return (
    <div className="workspace-grid">
      <section className="panel">
        <div className="panel__body">
          <h1 className="section-title">Credit card bills</h1>
          <p className="section-subtitle">
            Track statement balances, due dates, minimum dues, and payments without mixing card liability into cash.
          </p>

          <div className="metric-row">
            <div className="metric">
              <span className="metric__label">Open balance</span>
              <span className="metric__value">{moneyFormatter.format(totals.openBalance)}</span>
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
          <h2 className="section-title">Add card bill</h2>
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
                <input className="field__control" defaultValue={today()} name="statement_date" required type="date" />
              </label>
              <label className="field">
                <span className="field__label">Due date</span>
                <input className="field__control" name="due_date" required type="date" />
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
                {isCreating ? "Saving..." : "Save bill"}
              </button>
            </form>
          )}
        </div>
      </section>

      <section className="panel">
        <div className="panel__body">
          <h2 className="section-title">Record payment</h2>
          <form className="transaction-form" onSubmit={handleCreatePayment}>
            <label className="field field--wide">
              <span className="field__label">Bill</span>
              <select
                className="field__control"
                onChange={(event) => setPaymentBillId(event.target.value)}
                required
                value={paymentBillId}
              >
                <option value="">Select open bill</option>
                {openBills.map((bill) => (
                  <option key={bill.id} value={bill.id}>
                    {accountNames.get(bill.account) ?? bill.account} | {bill.due_date} | {formatMoney(bill.remaining_balance)}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span className="field__label">Amount</span>
              <input
                className="field__control"
                min="0.01"
                onChange={(event) => setPaymentAmount(event.target.value)}
                required
                step="0.01"
                type="number"
                value={paymentAmount}
              />
            </label>
            <label className="field">
              <span className="field__label">Paid date</span>
              <input
                className="field__control"
                onChange={(event) => setPaymentDate(event.target.value)}
                required
                type="date"
                value={paymentDate}
              />
            </label>
            <label className="field field--wide">
              <span className="field__label">Note</span>
              <input
                className="field__control"
                onChange={(event) => setPaymentNote(event.target.value)}
                value={paymentNote}
              />
            </label>
            <button className="button button--primary field--wide" disabled={isPaying || openBills.length === 0} type="submit">
              {isPaying ? "Recording..." : "Record payment"}
            </button>
          </form>
        </div>
      </section>

      <section className="panel">
        <div className="panel__body">
          <h2 className="section-title">Bill history</h2>
          {state.bills.length === 0 ? (
            <div className="empty-state">
              <p>No credit card bills yet.</p>
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
                    <th>Note</th>
                  </tr>
                </thead>
                <tbody>
                  {state.bills.map((bill) => (
                    <tr key={bill.id}>
                      <td>{accountNames.get(bill.account) ?? bill.account}</td>
                      <td>{bill.statement_date}</td>
                      <td>{dueLabel(bill)}</td>
                      <td>{formatMoney(bill.statement_balance)}</td>
                      <td>{formatMoney(bill.minimum_due)}</td>
                      <td>{formatMoney(bill.paid_amount)}</td>
                      <td>{formatMoney(bill.remaining_balance)}</td>
                      <td>
                        <span className={statusBadgeClass(bill.status)}>{formatLabel(bill.status)}</span>
                      </td>
                      <td>{bill.reference || "-"}</td>
                      <td>{bill.note || "-"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
