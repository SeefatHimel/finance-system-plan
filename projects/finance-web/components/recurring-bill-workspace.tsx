"use client";
import { monthlyCommitments } from "@/lib/financial-totals";
import { formatCurrency } from "../../finance-contracts/presentation";

import { PlanningPaymentForm } from "@/components/planning-payment-form";
import { DatedList } from "@/components/dated-list";
import { CalendarDateInput } from "@/components/calendar-date-input";

import { useFeedbackMessage, useToast } from "@/components/toast-provider";

import type React from "react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import {
  type Account,
  type Category,
  type RecurringBill,
  type RecurringBillFrequency,
  createRecurringBill,
  listAccounts,
  listCategories,
  listRecurringBills
} from "@/lib/api";
import { getAccessToken } from "@/lib/auth-storage";
import { ButtonBusy, LoadingState } from "@/components/loading-state";

type RecurringBillState =
  | { status: "loading" }
  | { message: string; status: "error" }
  | { accounts: Account[]; bills: RecurringBill[]; categories: Category[]; status: "ready" };

function today() {
  return new Date().toISOString().slice(0, 10);
}

function formatMoney(value: string, currency = "BDT") { return formatCurrency(value, currency); }

function formatLabel(value: string) {
  return value.replaceAll("_", " ");
}

function daysUntilDue(dueDate: string) {
  const todayDate = new Date(today());
  const due = new Date(dueDate);
  return Math.ceil((due.getTime() - todayDate.getTime()) / 86_400_000);
}

function dueLabel(bill: RecurringBill) {
  if (bill.status !== "active") {
    return formatLabel(bill.status);
  }

  const days = daysUntilDue(bill.next_due_date);
  if (days < 0) {
    return `${Math.abs(days)} day${Math.abs(days) === 1 ? "" : "s"} overdue`;
  }
  if (days === 0) {
    return "Due today";
  }
  return `Due in ${days} day${days === 1 ? "" : "s"}`;
}

function statusBadgeClass(bill: RecurringBill) {
  if (bill.status !== "active") {
    return "status-badge status-badge--idle";
  }
  return daysUntilDue(bill.next_due_date) < 0
    ? "status-badge status-badge--error"
    : "status-badge status-badge--ok";
}

export function RecurringBillWorkspace() {
  const { notify } = useToast();
  const [paymentRequest, setPaymentRequest] = useState<{ id: string; version: number } | null>(null);
  const [state, setState] = useState<RecurringBillState>({ status: "loading" });
  const [formError, setFormError] = useFeedbackMessage("error");
  const [isCreating, setIsCreating] = useState(false);

  async function loadRecurringBills(showLoading = true) {
    const accessToken = getAccessToken();

    if (!accessToken) {
      setState({ message: "Sign in before managing recurring bills.", status: "error" });
      return;
    }

    if (showLoading) {
      setState({ status: "loading" });
    }

    try {
      const [accounts, categories, bills] = await Promise.all([
        listAccounts(accessToken),
        listCategories(accessToken),
        listRecurringBills(accessToken)
      ]);
      setState({ accounts, bills, categories, status: "ready" });
    } catch (error) {
      setState({
        message: error instanceof Error ? error.message : "Could not load recurring bills.",
        status: "error"
      });
    }
  }

  useEffect(() => {
    void loadRecurringBills();
  }, []);

  const accountNames = useMemo(() => {
    if (state.status !== "ready") {
      return new Map<string, string>();
    }
    return new Map(state.accounts.map((account) => [account.id, account.name]));
  }, [state]);

  const categoryNames = useMemo(() => {
    if (state.status !== "ready") {
      return new Map<string, string>();
    }
    return new Map(state.categories.map((category) => [category.id, category.name]));
  }, [state]);

  const totals = useMemo(() => {
    if (state.status !== "ready") {
      return {
        activeCount: 0,
        monthlyEstimate: 0,
        overdue: 0,
        dueSoon: 0
      };
    }

    return state.bills.reduce(
      (summary, bill) => {
        if (bill.status !== "active") {
          return summary;
        }

        const dueIn = daysUntilDue(bill.next_due_date);
        summary.activeCount += 1;
        summary.monthlyEstimate += Number(bill.amount);
        if (dueIn < 0) {
          summary.overdue += 1;
        }
        if (dueIn >= 0 && dueIn <= bill.reminder_days_before) {
          summary.dueSoon += 1;
        }
        return summary;
      },
      {
        activeCount: 0,
        monthlyEstimate: 0,
        overdue: 0,
        dueSoon: 0
      }
    );
  }, [state]);

  async function handleCreateBill(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const accessToken = getAccessToken();

    if (!accessToken) {
      setFormError("Sign in before creating a recurring bill.");
      return;
    }

    const form = event.currentTarget;
    const formData = new FormData(form);
    setFormError(null);
    setIsCreating(true);

    try {
      await createRecurringBill(accessToken, {
        account: String(formData.get("account") ?? ""),
        amount: String(formData.get("amount") ?? ""),
        auto_create_transaction: false,
        category: String(formData.get("category") ?? "") || null,
        frequency: String(formData.get("frequency") ?? "monthly") as RecurringBillFrequency,
        name: String(formData.get("name") ?? ""),
        next_due_date: String(formData.get("next_due_date") ?? ""),
        note: String(formData.get("note") ?? ""),
        reminder_days_before: Number(formData.get("reminder_days_before") ?? 3)
      });
      form.reset();
      await loadRecurringBills(false);
      notify("Recurring bill added.");
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "Could not create recurring bill.");
    } finally {
      setIsCreating(false);
    }
  }


  if (state.status === "loading") {
    return <LoadingState detail="Checking schedules, due dates, and payment history" label="Loading recurring bills" />;
  }

  if (state.status === "error") {
    return (
      <section className="panel">
        <div className="panel__body empty-state">
          <h1 className="section-title">Recurring bills</h1>
          <p className="section-subtitle">{state.message}</p>
          <Link className="button button--primary" href="/login">
            Sign in
          </Link>
        </div>
      </section>
    );
  }

  const currencyByAccount = new Map(state.accounts.map(account => [account.id, account.currency]));
  const estimates = monthlyCommitments(state.bills.filter(bill => bill.status === "active").map(bill => ({ amount: bill.amount, frequency: bill.frequency, currency: currencyByAccount.get(bill.account) ?? "BDT" })));
  const expenseCategories = state.categories.filter((category) => category.kind === "expense");

  return (
    <div className="workspace-grid">
      <section className="panel">
        <div className="panel__body">
          <h1 className="section-title">Recurring bills</h1>
          <p className="section-subtitle">
            Track rent, utilities, subscriptions, and other repeating payments before they become surprises.
          </p>

          <p className="muted-text">Monthly estimate annualizes weekly (52 per year), monthly, quarterly and yearly schedules. It is a planning estimate; actual payments appear in Reports.</p>
          <div className="metric-row">
            <div className="metric">
              <span className="metric__label">Monthly estimate</span>
              <span className="metric__value">{estimates.map(row => <span key={row.currency}>{formatMoney(row.amount, row.currency)}<br /></span>)}</span>
            </div>
            <div className="metric">
              <span className="metric__label">Active / due soon</span>
              <span className="metric__value">
                {totals.activeCount} / {totals.dueSoon}
              </span>
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
          <h2 className="section-title">Bill schedule</h2>
          <DatedList items={state.bills} fields={[{ label: "Next due date", date: bill => bill.next_due_date }]} label="Recurring bill history">{bills => <>
          {bills.length === 0 ? (
            <div className="empty-state">
              <p>No recurring bills match these dates.</p>
            </div>
          ) : (
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Account</th>
                    <th>Category</th>
                    <th>Amount</th>
                    <th>Frequency</th>
                    <th>Next due</th>
                    <th>Reminder</th>
                    <th>Status</th>
                    <th>Note</th><th>Payments</th>
                  </tr>
                </thead>
                <tbody>
                  {bills.map((bill) => (
                    <tr key={bill.id}>
                      <td>{bill.name}</td>
                      <td>{accountNames.get(bill.account) ?? bill.account}</td>
                      <td>{bill.category ? categoryNames.get(bill.category) ?? bill.category : "-"}</td>
                      <td>{formatMoney(bill.amount, currencyByAccount.get(bill.account))}</td>
                      <td>{formatLabel(bill.frequency)}</td>
                      <td>{dueLabel(bill)}</td>
                      <td>{bill.reminder_days_before} days</td>
                      <td>
                        <span className={statusBadgeClass(bill)}>{formatLabel(bill.status)}</span>
                      </td>
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
      <PlanningPaymentForm selectedParent={paymentRequest} kind="recurring" parents={state.bills.map(row => ({ id: row.id, label: row.name, open: row.status === "active", account: row.account }))} onChange={() => loadRecurringBills(false)} />
      <section className="panel">
        <div className="panel__body">
          <details><summary><strong>Add recurring bill</strong></summary>
          {state.accounts.length === 0 ? (
            <div className="empty-state">
              <p>Create an account before adding recurring bills.</p>
              <Link className="button button--primary" href="/accounts">
                Open accounts
              </Link>
            </div>
          ) : (
            <form className="transaction-form" onSubmit={handleCreateBill}>
              <label className="field">
                <span className="field__label">Bill name</span>
                <input className="field__control" name="name" required />
              </label>
              <label className="field">
                <span className="field__label">Account</span>
                <select className="field__control" name="account" required>
                  <option value="">Select account</option>
                  {state.accounts.map((account) => (
                    <option key={account.id} value={account.id}>
                      {account.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span className="field__label">Category</span>
                <select className="field__control" name="category">
                  <option value="">No category</option>
                  {expenseCategories.map((category) => (
                    <option key={category.id} value={category.id}>
                      {category.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span className="field__label">Amount</span>
                <input className="field__control" min="0.01" name="amount" required step="0.01" type="number" />
              </label>
              <label className="field">
                <span className="field__label">Frequency</span>
                <select className="field__control" name="frequency" required>
                  <option value="monthly">Monthly</option>
                  <option value="weekly">Weekly</option>
                  <option value="quarterly">Quarterly</option>
                  <option value="yearly">Yearly</option>
                </select>
              </label>
              <label className="field">
                <span className="field__label">Next due date</span>
                <CalendarDateInput defaultValue={today()} name="next_due_date" required />
              </label>
              <label className="field">
                <span className="field__label">Reminder days</span>
                <input
                  className="field__control"
                  defaultValue="3"
                  max="60"
                  min="0"
                  name="reminder_days_before"
                  required
                  type="number"
                />
              </label>
              <p className="field--wide muted-text">This creates a schedule only. Link or record payments from the schedule when money moves; automatic posting is not enabled.</p>
              <label className="field field--wide">
                <span className="field__label">Note</span>
                <input className="field__control" name="note" />
              </label>
              <button className="button button--primary field--wide" disabled={isCreating} type="submit">
                {isCreating ? <ButtonBusy label="Saving" /> : "Save recurring bill"}
              </button>
            </form>
          )}
          </details>
        </div>
      </section>
    </div>
  );
}
