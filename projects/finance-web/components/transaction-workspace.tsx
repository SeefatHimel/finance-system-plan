"use client";

import type React from "react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import {
  type Account,
  type Category,
  type Transaction,
  type TransactionDirection,
  createTransaction,
  deleteTransaction,
  exportTransactionsCsv,
  listAccounts,
  listCategories,
  listTransactions,
  type TransactionFilters,
  type TransactionSource,
  type TransactionType,
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

const transactionTypes: TransactionType[] = [
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

const transactionSources: TransactionSource[] = ["web", "mobile", "sms", "import", "system"];

type TransactionFilterState = Required<Pick<TransactionFilters, "direction" | "source" | "type">> & {
  account: string;
  category: string;
  month: string;
  search: string;
};

function currentMonth() {
  return new Date().toISOString().slice(0, 7);
}

const moneyFormatter = new Intl.NumberFormat("en-BD", {
  currency: "BDT",
  style: "currency"
});

export function TransactionWorkspace() {
  const [filters, setFilters] = useState<TransactionFilterState>({
    account: "",
    category: "",
    direction: "",
    month: currentMonth(),
    search: "",
    source: "",
    type: ""
  });
  const [loadState, setLoadState] = useState<LoadState>({ status: "loading" });
  const [formError, setFormError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isUpdating, setIsUpdating] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [exportMessage, setExportMessage] = useState<string | null>(null);
  const [deletingTransactionId, setDeletingTransactionId] = useState<string | null>(null);
  const [editingTransactionId, setEditingTransactionId] = useState("");
  const [editingDate, setEditingDate] = useState("");
  const [editingType, setEditingType] = useState<TransactionType>("expense");
  const [editingDirection, setEditingDirection] = useState<TransactionDirection>("debit");
  const [editingAccountId, setEditingAccountId] = useState("");
  const [editingTransferAccountId, setEditingTransferAccountId] = useState("");
  const [editingCategoryId, setEditingCategoryId] = useState("");
  const [editingAmount, setEditingAmount] = useState("");
  const [editingBalanceAfter, setEditingBalanceAfter] = useState("");
  const [editingReference, setEditingReference] = useState("");
  const [editingCounterpartyText, setEditingCounterpartyText] = useState("");
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
    const accessToken = getAccessToken();

    if (!accessToken) {
      setLoadState({ message: "Sign in before managing transactions.", status: "error" });
      return;
    }

    setLoadState({ status: "loading" });

    void Promise.all([
      listAccounts(accessToken),
      listCategories(accessToken),
      listTransactions(accessToken, {
        account: "",
        category: "",
        direction: "",
        month: currentMonth(),
        search: "",
        source: "",
        type: ""
      })
    ])
      .then(([accounts, categories, transactions]) => {
        setLoadState({ accounts, categories, status: "ready", transactions });
      })
      .catch((error) => {
        setLoadState({
          message: error instanceof Error ? error.message : "Could not load transactions.",
          status: "error"
        });
      });
  }, []);

  function handleFilterSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void loadData(filters);
  }

  function clearFilters() {
    const clearedFilters: TransactionFilterState = {
      account: "",
      category: "",
      direction: "",
      month: "",
      search: "",
      source: "",
      type: ""
    };
    setFilters(clearedFilters);
    void loadData(clearedFilters);
  }

  async function handleExportTransactions() {
    const accessToken = getAccessToken();

    if (!accessToken) {
      setFormError("Sign in before exporting transactions.");
      return;
    }

    setExportMessage(null);
    setFormError(null);
    setIsExporting(true);

    try {
      const blob = await exportTransactionsCsv(accessToken, filters);
      const objectUrl = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = objectUrl;
      link.download = `transactions-${filters.month || "all"}.csv`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(objectUrl);
      setExportMessage("CSV export downloaded.");
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "Could not export transactions.");
    } finally {
      setIsExporting(false);
    }
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const accessToken = getAccessToken();

    if (!accessToken) {
      setFormError("Sign in before adding a transaction.");
      return;
    }

    const formData = new FormData(event.currentTarget);
    const type = String(formData.get("type") ?? "expense") as TransactionType;
    const direction = String(formData.get("direction") ?? "debit") as TransactionDirection;
    const transferAccount = String(formData.get("transfer_account") ?? "");
    const category = String(formData.get("category") ?? "");

    setFormError(null);
    setIsSubmitting(true);

    try {
      await createTransaction(accessToken, {
        account: String(formData.get("account") ?? ""),
        amount: String(formData.get("amount") ?? ""),
        balance_after: String(formData.get("balance_after") ?? "") || null,
        category: category || undefined,
        counterparty_text: String(formData.get("counterparty_text") ?? ""),
        date: String(formData.get("date") ?? ""),
        direction,
        note: String(formData.get("note") ?? ""),
        reference: String(formData.get("reference") ?? ""),
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
    setEditingType(transaction.type as TransactionType);
    setEditingDirection(transaction.direction as TransactionDirection);
    setEditingAccountId(transaction.account);
    setEditingTransferAccountId(transaction.transfer_account ?? "");
    setEditingCategoryId(transaction.category ?? "");
    setEditingAmount(transaction.amount);
    setEditingBalanceAfter(transaction.balance_after ?? "");
    setEditingReference(transaction.reference);
    setEditingCounterpartyText(transaction.counterparty_text);
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
        balance_after: editingBalanceAfter || null,
        category: editingCategoryId || null,
        counterparty_text: editingCounterpartyText,
        date: editingDate,
        direction: editingDirection,
        note: editingNote,
        reference: editingReference,
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
              <span className="field__label">Debit / credit</span>
              <select className="field__control" defaultValue="debit" name="direction" required>
                <option value="debit">Debit</option>
                <option value="credit">Credit</option>
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

            <label className="field">
              <span className="field__label">Balance after</span>
              <input className="field__control" min="0" name="balance_after" step="0.01" type="number" />
            </label>

            <label className="field">
              <span className="field__label">Transaction ID</span>
              <input className="field__control" name="reference" type="text" />
            </label>

            <label className="field">
              <span className="field__label">Sent to / received from</span>
              <input className="field__control" name="counterparty_text" type="text" />
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
                onChange={(event) => setEditingType(event.target.value as TransactionType)}
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
              <span className="field__label">Debit / credit</span>
              <select
                className="field__control"
                onChange={(event) => setEditingDirection(event.target.value as TransactionDirection)}
                required
                value={editingDirection}
              >
                <option value="debit">Debit</option>
                <option value="credit">Credit</option>
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

            <label className="field">
              <span className="field__label">Balance after</span>
              <input
                className="field__control"
                min="0"
                onChange={(event) => setEditingBalanceAfter(event.target.value)}
                step="0.01"
                type="number"
                value={editingBalanceAfter}
              />
            </label>

            <label className="field">
              <span className="field__label">Transaction ID</span>
              <input
                className="field__control"
                onChange={(event) => setEditingReference(event.target.value)}
                type="text"
                value={editingReference}
              />
            </label>

            <label className="field">
              <span className="field__label">Sent to / received from</span>
              <input
                className="field__control"
                onChange={(event) => setEditingCounterpartyText(event.target.value)}
                type="text"
                value={editingCounterpartyText}
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
                Filter records by month, account, category, type, debit/credit direction, source, and text.
              </p>
            </div>
          </div>

          <form className="filter-form transaction-filter-form" onSubmit={handleFilterSubmit}>
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
                onChange={(event) =>
                  setFilters({ ...filters, type: event.target.value as TransactionFilterState["type"] })
                }
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
              <span className="field__label">Debit / credit</span>
              <select
                className="field__control"
                name="direction"
                onChange={(event) =>
                  setFilters({
                    ...filters,
                    direction: event.target.value as TransactionFilterState["direction"]
                  })
                }
                value={filters.direction}
              >
                <option value="">All directions</option>
                <option value="debit">Debit</option>
                <option value="credit">Credit</option>
              </select>
            </label>

            <label className="field">
              <span className="field__label">Source</span>
              <select
                className="field__control"
                name="source"
                onChange={(event) =>
                  setFilters({ ...filters, source: event.target.value as TransactionFilterState["source"] })
                }
                value={filters.source}
              >
                <option value="">All sources</option>
                {transactionSources.map((source) => (
                  <option key={source} value={source}>
                    {source}
                  </option>
                ))}
              </select>
            </label>

            <label className="field">
              <span className="field__label">Search</span>
              <input
                className="field__control"
                name="search"
                onChange={(event) => setFilters({ ...filters, search: event.target.value })}
                placeholder="TrxID, person, note"
                type="search"
                value={filters.search}
              />
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
            <button
              className="button button--ghost"
              disabled={isExporting}
              onClick={() => void handleExportTransactions()}
              type="button"
            >
              {isExporting ? "Exporting..." : "Export CSV"}
            </button>
          </form>

          {exportMessage ? <p className="section-subtitle">{exportMessage}</p> : null}

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
                    <th>Debit / credit</th>
                    <th>Source</th>
                    <th>Account</th>
                    <th>Category</th>
                    <th>Amount</th>
                    <th>Balance after</th>
                    <th>Transaction ID</th>
                    <th>Sent to / received from</th>
                    <th>Note</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {loadState.transactions.map((transaction) => (
                    <tr key={transaction.id}>
                      <td>{transaction.date}</td>
                      <td>{transaction.type.replaceAll("_", " ")}</td>
                      <td>{transaction.direction}</td>
                      <td>{transaction.source}</td>
                      <td>{accountNames.get(transaction.account) ?? "Unknown"}</td>
                      <td>
                        {transaction.category
                          ? categoryNames.get(transaction.category) ?? "Unknown"
                          : "None"}
                      </td>
                      <td>{moneyFormatter.format(Number(transaction.amount))}</td>
                      <td>
                        {transaction.balance_after
                          ? moneyFormatter.format(Number(transaction.balance_after))
                          : "-"}
                      </td>
                      <td>{transaction.reference || "-"}</td>
                      <td>{transaction.counterparty_text || "-"}</td>
                      <td>{transaction.note || "-"}</td>
                      <td>
                        <div className="list-row__actions">
                          <Link
                            className="button button--ghost"
                            href={`/audit-logs?entity_type=transactions.transaction&entity_id=${transaction.id}`}
                          >
                            History
                          </Link>
                          <button
                            className="button button--danger"
                            disabled={deletingTransactionId === transaction.id}
                            onClick={() => void handleDeleteTransaction(transaction)}
                            type="button"
                          >
                            {deletingTransactionId === transaction.id ? "Deleting..." : "Delete"}
                          </button>
                        </div>
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
