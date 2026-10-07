"use client";

import { useFeedbackMessage, useToast } from "@/components/toast-provider";

import type React from "react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import {
  type Debt,
  type DebtDirection,
  createDebt,
  createDebtPayment,
  listDebts
} from "@/lib/api";
import { getAccessToken } from "@/lib/auth-storage";
import { ButtonBusy, LoadingState } from "@/components/loading-state";

type DebtState =
  | { status: "loading" }
  | { message: string; status: "error" }
  | { debts: Debt[]; status: "ready" };

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

export function DebtWorkspace() {
  const { notify } = useToast();
  const [debtState, setDebtState] = useState<DebtState>({ status: "loading" });
  const [formError, setFormError] = useFeedbackMessage("error");
  const [isCreating, setIsCreating] = useState(false);
  const [paymentDebtId, setPaymentDebtId] = useState("");
  const [paymentAmount, setPaymentAmount] = useState("");
  const [paymentDate, setPaymentDate] = useState(today());
  const [paymentNote, setPaymentNote] = useState("");
  const [isPaying, setIsPaying] = useState(false);

  async function loadDebts(showLoading = true) {
    const accessToken = getAccessToken();

    if (!accessToken) {
      setDebtState({ message: "Sign in before managing debts.", status: "error" });
      return;
    }

    if (showLoading) {
      setDebtState({ status: "loading" });
    }

    try {
      const debts = await listDebts(accessToken);
      setDebtState({ debts, status: "ready" });
    } catch (error) {
      setDebtState({
        message: error instanceof Error ? error.message : "Could not load debts.",
        status: "error"
      });
    }
  }

  useEffect(() => {
    void loadDebts();
  }, []);

  const totals = useMemo(() => {
    if (debtState.status !== "ready") {
      return {
        borrowed: 0,
        dueSoon: 0,
        lent: 0,
        openCount: 0
      };
    }

    const openDebts = debtState.debts.filter((debt) => debt.status !== "paid");
    const dueLimit = new Date();
    dueLimit.setDate(dueLimit.getDate() + 7);

    return openDebts.reduce(
      (summary, debt) => {
        const balance = Number(debt.current_balance);
        if (debt.direction === "lent_by_me") {
          summary.lent += balance;
        } else {
          summary.borrowed += balance;
        }
        if (debt.due_date && new Date(debt.due_date) <= dueLimit) {
          summary.dueSoon += 1;
        }
        summary.openCount += 1;
        return summary;
      },
      {
        borrowed: 0,
        dueSoon: 0,
        lent: 0,
        openCount: 0
      }
    );
  }, [debtState]);

  async function handleCreateDebt(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const accessToken = getAccessToken();

    if (!accessToken) {
      setFormError("Sign in before creating a debt record.");
      return;
    }

    const form = event.currentTarget;
    const formData = new FormData(form);
    setFormError(null);
    setIsCreating(true);

    try {
      await createDebt(accessToken, {
        counterparty_name: String(formData.get("counterparty_name") ?? ""),
        direction: String(formData.get("direction") ?? "lent_by_me") as DebtDirection,
        due_date: String(formData.get("due_date") ?? "") || null,
        note: String(formData.get("note") ?? ""),
        opened_at: String(formData.get("opened_at") ?? ""),
        principal_amount: String(formData.get("principal_amount") ?? "")
      });
      form.reset();
      await loadDebts(false);
      notify("Debt record added.");
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "Could not create debt.");
    } finally {
      setIsCreating(false);
    }
  }

  async function handleCreatePayment(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const accessToken = getAccessToken();

    if (!accessToken) {
      setFormError("Sign in before recording a payment.");
      return;
    }
    if (!paymentDebtId || !paymentAmount || !paymentDate) {
      setFormError("Debt, amount, and paid date are required.");
      return;
    }

    setFormError(null);
    setIsPaying(true);

    try {
      await createDebtPayment(accessToken, paymentDebtId, {
        amount: paymentAmount,
        note: paymentNote,
        paid_at: paymentDate
      });
      setPaymentAmount("");
      setPaymentNote("");
      await loadDebts(false);
      notify("Debt payment recorded.");
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "Could not record payment.");
    } finally {
      setIsPaying(false);
    }
  }

  if (debtState.status === "loading") {
    return <LoadingState detail="Calculating balances and repayment history" label="Loading debts and lending" />;
  }

  if (debtState.status === "error") {
    return (
      <section className="panel">
        <div className="panel__body empty-state">
          <h1 className="section-title">Debts and lending</h1>
          <p className="section-subtitle">{debtState.message}</p>
          <Link className="button button--primary" href="/login">
            Sign in
          </Link>
        </div>
      </section>
    );
  }

  const openDebts = debtState.debts.filter((debt) => debt.status !== "paid");

  return (
    <div className="workspace-grid">
      <section className="panel">
        <div className="panel__body">
          <h1 className="section-title">Debts and lending</h1>
          <p className="section-subtitle">
            Track who owes you, what you owe, due dates, and repayment progress.
          </p>

          <div className="metric-row">
            <div className="metric">
              <span className="metric__label">Receivable</span>
              <span className="metric__value">{moneyFormatter.format(totals.lent)}</span>
            </div>
            <div className="metric">
              <span className="metric__label">Payable</span>
              <span className="metric__value">{moneyFormatter.format(totals.borrowed)}</span>
            </div>
            <div className="metric">
              <span className="metric__label">Open / due soon</span>
              <span className="metric__value">
                {totals.openCount} / {totals.dueSoon}
              </span>
            </div>
          </div>
        </div>
      </section>

      {formError ? <p className="form-error">{formError}</p> : null}

      <section className="panel">
        <div className="panel__body">
          <h2 className="section-title">Add debt record</h2>
          <form className="transaction-form" onSubmit={handleCreateDebt}>
            <label className="field">
              <span className="field__label">Person or business</span>
              <input className="field__control" name="counterparty_name" required />
            </label>
            <label className="field">
              <span className="field__label">Direction</span>
              <select className="field__control" name="direction" required>
                <option value="lent_by_me">Lent by me</option>
                <option value="borrowed_by_me">Borrowed by me</option>
              </select>
            </label>
            <label className="field">
              <span className="field__label">Principal amount</span>
              <input className="field__control" min="0.01" name="principal_amount" required step="0.01" type="number" />
            </label>
            <label className="field">
              <span className="field__label">Opened date</span>
              <input className="field__control" defaultValue={today()} name="opened_at" required type="date" />
            </label>
            <label className="field">
              <span className="field__label">Due date</span>
              <input className="field__control" name="due_date" type="date" />
            </label>
            <label className="field">
              <span className="field__label">Note</span>
              <input className="field__control" name="note" />
            </label>
            <button className="button button--primary field--wide" disabled={isCreating} type="submit">
              {isCreating ? <ButtonBusy label="Saving" /> : "Save debt"}
            </button>
          </form>
        </div>
      </section>

      <section className="panel">
        <div className="panel__body">
          <h2 className="section-title">Record repayment</h2>
          <form className="transaction-form" onSubmit={handleCreatePayment}>
            <label className="field field--wide">
              <span className="field__label">Debt</span>
              <select
                className="field__control"
                onChange={(event) => setPaymentDebtId(event.target.value)}
                required
                value={paymentDebtId}
              >
                <option value="">Select open debt</option>
                {openDebts.map((debt) => (
                  <option key={debt.id} value={debt.id}>
                    {debt.counterparty_name} | {formatLabel(debt.direction)} | {formatMoney(debt.current_balance)}
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
            <button className="button button--primary field--wide" disabled={isPaying} type="submit">
              {isPaying ? <ButtonBusy label="Recording" /> : "Record repayment"}
            </button>
          </form>
        </div>
      </section>

      <section className="panel">
        <div className="panel__body">
          <h2 className="section-title">People and balances</h2>
          {debtState.debts.length === 0 ? (
            <div className="empty-state">
              <p>No debt records yet.</p>
            </div>
          ) : (
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Counterparty</th>
                    <th>Direction</th>
                    <th>Principal</th>
                    <th>Balance</th>
                    <th>Opened</th>
                    <th>Due</th>
                    <th>Status</th>
                    <th>Note</th>
                  </tr>
                </thead>
                <tbody>
                  {debtState.debts.map((debt) => (
                    <tr key={debt.id}>
                      <td>{debt.counterparty_name}</td>
                      <td>{formatLabel(debt.direction)}</td>
                      <td>{formatMoney(debt.principal_amount)}</td>
                      <td>{formatMoney(debt.current_balance)}</td>
                      <td>{debt.opened_at}</td>
                      <td>{debt.due_date || "-"}</td>
                      <td>{formatLabel(debt.status)}</td>
                      <td>{debt.note || "-"}</td>
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
