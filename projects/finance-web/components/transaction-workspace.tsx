"use client";

import type React from "react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import {
  type Account,
  type Category,
  type Transaction,
  createTransaction,
  listAccounts,
  listCategories,
  listTransactions
} from "@/lib/api";
import { getAccessToken } from "@/lib/auth-storage";

type LoadState =
  | { status: "loading" }
  | { message: string; status: "error" }
  | {
      accounts: Account[];
      categories: Category[];
      status: "ready";
      transactions: Transaction[];
    };

const transactionTypes = [
  "expense",
  "income",
  "transfer",
  "adjustment",
  "fee",
  "refund",
  "lend",
  "borrow",
  "repayment_received",
  "repayment_paid"
];

const moneyFormatter = new Intl.NumberFormat("en-BD", {
  currency: "BDT",
  style: "currency"
});

export function TransactionWorkspace() {
  const [loadState, setLoadState] = useState<LoadState>({ status: "loading" });
  const [formError, setFormError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function loadData() {
    const accessToken = getAccessToken();

    if (!accessToken) {
      setLoadState({ message: "Sign in before managing transactions.", status: "error" });
      return;
    }

    setLoadState({ status: "loading" });

    try {
      const [accounts, categories, transactions] = await Promise.all([
        listAccounts(accessToken),
        listCategories(accessToken),
        listTransactions(accessToken)
      ]);

      setLoadState({ accounts, categories, status: "ready", transactions });
    } catch (error) {
      setLoadState({
        message: error instanceof Error ? error.message : "Could not load transactions.",
        status: "error"
      });
    }
  }

  useEffect(() => {
    void loadData();
  }, []);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const accessToken = getAccessToken();

    if (!accessToken) {
      setFormError("Sign in before adding a transaction.");
      return;
    }

    const formData = new FormData(event.currentTarget);
    const type = String(formData.get("type") ?? "expense");
    const transferAccount = String(formData.get("transfer_account") ?? "");
    const category = String(formData.get("category") ?? "");

    setFormError(null);
    setIsSubmitting(true);

    try {
      await createTransaction(accessToken, {
        account: String(formData.get("account") ?? ""),
        amount: String(formData.get("amount") ?? ""),
        category: category || undefined,
        date: String(formData.get("date") ?? ""),
        note: String(formData.get("note") ?? ""),
        transfer_account: type === "transfer" ? transferAccount : undefined,
        type
      });
      event.currentTarget.reset();
      await loadData();
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "Could not create transaction.");
    } finally {
      setIsSubmitting(false);
    }
  }

  const accountNames = useMemo(() => {
    if (loadState.status !== "ready") {
      return new Map<string, string>();
    }
    return new Map(loadState.accounts.map((account) => [account.id, account.name]));
  }, [loadState]);

  const categoryNames = useMemo(() => {
    if (loadState.status !== "ready") {
      return new Map<string, string>();
    }
    return new Map(loadState.categories.map((category) => [category.id, category.name]));
  }, [loadState]);

  if (loadState.status === "loading") {
    return (
      <div className="panel">
        <div className="panel__body">
          <span className="status-badge status-badge--idle">Loading transactions</span>
        </div>
      </div>
    );
  }

  if (loadState.status === "error") {
    return (
      <div className="panel">
        <div className="panel__body empty-state">
          <h1 className="section-title">Transactions</h1>
          <p className="section-subtitle">{loadState.message}</p>
          <Link className="button button--primary" href="/login">
            Sign in
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="workspace-grid">
      <section className="panel">
        <div className="panel__body">
          <h1 className="section-title">Add transaction</h1>
          <p className="section-subtitle">
            Create manual records against your configured accounts and categories.
          </p>

          <form className="transaction-form" onSubmit={handleSubmit}>
            <label className="field">
              <span className="field__label">Date</span>
              <input className="field__control" name="date" required type="date" />
            </label>

            <label className="field">
              <span className="field__label">Type</span>
              <select className="field__control" name="type" required>
                {transactionTypes.map((type) => (
                  <option key={type} value={type}>
                    {type.replaceAll("_", " ")}
                  </option>
                ))}
              </select>
            </label>

            <label className="field">
              <span className="field__label">Account</span>
              <select className="field__control" name="account" required>
                <option value="">Select account</option>
                {loadState.accounts.map((account) => (
                  <option key={account.id} value={account.id}>
                    {account.name}
                  </option>
                ))}
              </select>
            </label>

            <label className="field">
              <span className="field__label">Transfer to</span>
              <select className="field__control" name="transfer_account">
                <option value="">Only for transfers</option>
                {loadState.accounts.map((account) => (
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
                {loadState.categories.map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.name}
                  </option>
                ))}
              </select>
            </label>

            <label className="field">
              <span className="field__label">Amount</span>
              <input
                className="field__control"
                min="0.01"
                name="amount"
                required
                step="0.01"
                type="number"
              />
            </label>

            <label className="field field--wide">
              <span className="field__label">Note</span>
              <input className="field__control" name="note" type="text" />
            </label>

            {formError ? <p className="form-error field--wide">{formError}</p> : null}

            <button className="button button--primary field--wide" disabled={isSubmitting} type="submit">
              {isSubmitting ? "Saving..." : "Save transaction"}
            </button>
          </form>
        </div>
      </section>

      <section className="panel">
        <div className="panel__body">
          <h2 className="section-title">Recent transactions</h2>
          <p className="section-subtitle">
            Showing records from the authenticated backend API.
          </p>

          {loadState.transactions.length === 0 ? (
            <div className="empty-state">
              <p>No transactions yet.</p>
            </div>
          ) : (
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Type</th>
                    <th>Account</th>
                    <th>Category</th>
                    <th>Amount</th>
                    <th>Note</th>
                  </tr>
                </thead>
                <tbody>
                  {loadState.transactions.map((transaction) => (
                    <tr key={transaction.id}>
                      <td>{transaction.date}</td>
                      <td>{transaction.type.replaceAll("_", " ")}</td>
                      <td>{accountNames.get(transaction.account) ?? "Unknown"}</td>
                      <td>
                        {transaction.category
                          ? categoryNames.get(transaction.category) ?? "Unknown"
                          : "None"}
                      </td>
                      <td>{moneyFormatter.format(Number(transaction.amount))}</td>
                      <td>{transaction.note || "-"}</td>
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
