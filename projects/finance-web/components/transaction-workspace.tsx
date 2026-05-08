"use client";

import type React from "react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import {
  type Account,
  type Category,
  type Transaction,
  createTransaction,
  deleteTransaction,
  listAccounts,
  listCategories,
  listTransactions,
  updateTransaction
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

function currentMonth() {
  return new Date().toISOString().slice(0, 7);
}

const moneyFormatter = new Intl.NumberFormat("en-BD", {
  currency: "BDT",
  style: "currency"
});

export function TransactionWorkspace() {
  const [filters, setFilters] = useState({
    account: "",
    category: "",
    month: currentMonth(),
    type: ""
  });
  const [loadState, setLoadState] = useState<LoadState>({ status: "loading" });
  const [formError, setFormError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isUpdating, setIsUpdating] = useState(false);
  const [deletingTransactionId, setDeletingTransactionId] = useState<string | null>(null);
  const [editingTransactionId, setEditingTransactionId] = useState("");
  const [editingDate, setEditingDate] = useState("");
  const [editingType, setEditingType] = useState("expense");
  const [editingAccountId, setEditingAccountId] = useState("");
  const [editingTransferAccountId, setEditingTransferAccountId] = useState("");
  const [editingCategoryId, setEditingCategoryId] = useState("");
  const [editingAmount, setEditingAmount] = useState("");
  const [editingNote, setEditingNote] = useState("");

  async function loadData(activeFilters = filters) {
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
        listTransactions(accessToken, activeFilters)
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

  function handleFilterSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void loadData(filters);
  }

  function clearFilters() {
    const clearedFilters = {
      account: "",
      category: "",
      month: "",
      type: ""
    };
    setFilters(clearedFilters);
    void loadData(clearedFilters);
  }

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
      await loadData(filters);
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "Could not create transaction.");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleDeleteTransaction(transaction: Transaction) {
    const accessToken = getAccessToken();
    if (!accessToken) {
      setFormError("Sign in before deleting a transaction.");
      return;
    }

    const confirmed = window.confirm(
      `Delete ${transaction.type.replaceAll("_", " ")} transaction on ${transaction.date}?`
    );
    if (!confirmed) {
      return;
    }

    setDeletingTransactionId(transaction.id);
    try {
      await deleteTransaction(accessToken, transaction.id);
      await loadData(filters);
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "Could not delete transaction.");
    } finally {
      setDeletingTransactionId(null);
    }
  }

  function selectTransactionForEdit(transactionId: string) {
    setEditingTransactionId(transactionId);
    if (loadState.status !== "ready") {
      return;
    }
    const transaction = loadState.transactions.find((item) => item.id === transactionId);
    if (!transaction) {
      return;
    }
    setEditingDate(transaction.date);
    setEditingType(transaction.type);
    setEditingAccountId(transaction.account);
    setEditingTransferAccountId(transaction.transfer_account ?? "");
    setEditingCategoryId(transaction.category ?? "");
    setEditingAmount(transaction.amount);
    setEditingNote(transaction.note ?? "");
  }

  async function handleUpdate(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const accessToken = getAccessToken();
    if (!accessToken) {
      setFormError("Sign in before updating a transaction.");
      return;
    }
    if (!editingTransactionId) {
      setFormError("Select a transaction to edit.");
      return;
    }

    setFormError(null);
    setIsUpdating(true);
    try {
      await updateTransaction(accessToken, editingTransactionId, {
        account: editingAccountId,
        amount: editingAmount,
        category: editingCategoryId || null,
        date: editingDate,
        note: editingNote,
        transfer_account: editingType === "transfer" ? editingTransferAccountId || null : null,
        type: editingType
      });
      await loadData(filters);
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "Could not update transaction.");
    } finally {
      setIsUpdating(false);
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

          <form className="transaction-form" onSubmit={handleUpdate}>
            <label className="field field--wide">
              <span className="field__label">Edit transaction</span>
              <select
                className="field__control"
                onChange={(event) => selectTransactionForEdit(event.target.value)}
                value={editingTransactionId}
              >
                <option value="">Select transaction</option>
                {loadState.transactions.map((transaction) => (
                  <option key={transaction.id} value={transaction.id}>
                    {transaction.date} | {transaction.type.replaceAll("_", " ")} | {transaction.amount}
                  </option>
                ))}
              </select>
            </label>

            <label className="field">
              <span className="field__label">Date</span>
              <input
                className="field__control"
                onChange={(event) => setEditingDate(event.target.value)}
                required
                type="date"
                value={editingDate}
              />
            </label>

            <label className="field">
              <span className="field__label">Type</span>
              <select
                className="field__control"
                onChange={(event) => setEditingType(event.target.value)}
                required
                value={editingType}
              >
                {transactionTypes.map((type) => (
                  <option key={type} value={type}>
                    {type.replaceAll("_", " ")}
                  </option>
                ))}
              </select>
            </label>

            <label className="field">
              <span className="field__label">Account</span>
              <select
                className="field__control"
                onChange={(event) => setEditingAccountId(event.target.value)}
                required
                value={editingAccountId}
              >
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
              <select
                className="field__control"
                onChange={(event) => setEditingTransferAccountId(event.target.value)}
                value={editingTransferAccountId}
              >
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
              <select
                className="field__control"
                onChange={(event) => setEditingCategoryId(event.target.value)}
                value={editingCategoryId}
              >
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
                onChange={(event) => setEditingAmount(event.target.value)}
                required
                step="0.01"
                type="number"
                value={editingAmount}
              />
            </label>

            <label className="field field--wide">
              <span className="field__label">Note</span>
              <input
                className="field__control"
                onChange={(event) => setEditingNote(event.target.value)}
                type="text"
                value={editingNote}
              />
            </label>

            <button className="button button--ghost field--wide" disabled={isUpdating} type="submit">
              {isUpdating ? "Updating..." : "Update transaction"}
            </button>
          </form>
        </div>
      </section>

      <section className="panel">
        <div className="panel__body">
          <div className="report-header">
            <div>
              <h2 className="section-title">Transactions</h2>
              <p className="section-subtitle">
                Filter records by month, account, category, and type.
              </p>
            </div>
          </div>

          <form className="filter-form" onSubmit={handleFilterSubmit}>
            <label className="field">
              <span className="field__label">Month</span>
              <input
                className="field__control"
                name="month"
                onChange={(event) => setFilters({ ...filters, month: event.target.value })}
                type="month"
                value={filters.month}
              />
            </label>

            <label className="field">
              <span className="field__label">Type</span>
              <select
                className="field__control"
                name="type"
                onChange={(event) => setFilters({ ...filters, type: event.target.value })}
                value={filters.type}
              >
                <option value="">All types</option>
                {transactionTypes.map((type) => (
                  <option key={type} value={type}>
                    {type.replaceAll("_", " ")}
                  </option>
                ))}
              </select>
            </label>

            <label className="field">
              <span className="field__label">Account</span>
              <select
                className="field__control"
                name="account"
                onChange={(event) => setFilters({ ...filters, account: event.target.value })}
                value={filters.account}
              >
                <option value="">All accounts</option>
                {loadState.accounts.map((account) => (
                  <option key={account.id} value={account.id}>
                    {account.name}
                  </option>
                ))}
              </select>
            </label>

            <label className="field">
              <span className="field__label">Category</span>
              <select
                className="field__control"
                name="category"
                onChange={(event) => setFilters({ ...filters, category: event.target.value })}
                value={filters.category}
              >
                <option value="">All categories</option>
                {loadState.categories.map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.name}
                  </option>
                ))}
              </select>
            </label>

            <button className="button button--primary" type="submit">
              Apply filters
            </button>
            <button className="button button--ghost" onClick={clearFilters} type="button">
              Clear
            </button>
          </form>

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
                    <th>Actions</th>
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
                      <td>
                        <button
                          className="button button--danger"
                          disabled={deletingTransactionId === transaction.id}
                          onClick={() => void handleDeleteTransaction(transaction)}
                          type="button"
                        >
                          {deletingTransactionId === transaction.id ? "Deleting..." : "Delete"}
                        </button>
                      </td>
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
