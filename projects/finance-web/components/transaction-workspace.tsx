"use client";

import { useFeedbackMessage } from "@/components/toast-provider";

import { CalendarBlank, CaretLeft, CaretRight, Plus, SlidersHorizontal, X } from "@phosphor-icons/react";
import type React from "react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import {
  type Account,
  type Category,
  type Transaction,
  type TransactionDirection,
  createTransaction,
  findTransferMatches,
  linkTransfer,
  mergeTransfers,
  type CreateTransactionInput,
  type TransferMatch,
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
import { ModalDialog } from "@/components/modal-dialog";
import { TransferMatchDialog } from "@/components/transfer-match-dialog";
import { getAccessToken } from "@/lib/auth-storage";
import { ButtonBusy, LoadingState } from "@/components/loading-state";
import { TransactionSourceMessages } from "@/components/transaction-source-messages";

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

type TransactionColumn = "date" | "time" | "description" | "account" | "category" | "source" | "balance" | "senderIdentifiers" | "receiverIdentifiers" | "amount";

const transactionColumns: { id: TransactionColumn; label: string }[] = [
  { id: "date", label: "Date" },
  { id: "time", label: "Time" },
  { id: "description", label: "Description" },
  { id: "account", label: "Account" },
  { id: "category", label: "Category" },
  { id: "source", label: "Source" },
  { id: "balance", label: "Reported balance" },
  { id: "senderIdentifiers", label: "Sender identifiers" },
  { id: "receiverIdentifiers", label: "Receiver identifiers" },
  { id: "amount", label: "Amount" }
];

const defaultTransactionColumns = transactionColumns.map((column) => column.id);
const transactionColumnsStorageKey = "finance.transactions.columns.v1";

type TransactionFilterState = Required<Pick<TransactionFilters, "direction" | "source" | "type">> & {
  account: string;
  category: string;
  month: string;
  ordering: "-date" | "-created_at" | "-updated_at";
  search: string;
};

function currentMonth() {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function currentDate() {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function currentTime() {
  const date = new Date();
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function shiftMonth(value: string, amount: number) {
  const [year, month] = (value || currentMonth()).split("-").map(Number);
  const shifted = new Date(year, month - 1 + amount, 1);
  return `${shifted.getFullYear()}-${String(shifted.getMonth() + 1).padStart(2, "0")}`;
}

function formatTransactionTime(value: string | null) {
  if (!value) return "—";
  return value.slice(0, 5);
}

function persistVisibleColumns(columns: TransactionColumn[]) {
  try {
    window.localStorage.setItem(transactionColumnsStorageKey, JSON.stringify(columns));
  } catch {
    // Column preferences are optional when browser storage is unavailable.
  }
}

const moneyFormatter = new Intl.NumberFormat("en-BD", {
  currency: "BDT",
  style: "currency"
});

const activityTimeFormatter = new Intl.DateTimeFormat("en-BD", { dateStyle: "medium", timeStyle: "short" });

export function TransactionWorkspace() {
  const [filters, setFilters] = useState<TransactionFilterState>({
    account: "",
    category: "",
    direction: "",
    month: currentMonth(),
    ordering: "-date",
    search: "",
    source: "",
    type: ""
  });
  const [loadState, setLoadState] = useState<LoadState>({ status: "loading" });
  const [transferDecision, setTransferDecision] = useState<{ input: CreateTransactionInput; matches: TransferMatch[]; mergeId?: string } | null>(null);
  const [matchError, setMatchError] = useFeedbackMessage("error");
  const [formError, setFormError] = useFeedbackMessage("error");
  const [formMessage, setFormMessage] = useFeedbackMessage("success");
  const [editorMode, setEditorMode] = useState<"create" | "edit" | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isUpdating, setIsUpdating] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [exportMessage, setExportMessage] = useFeedbackMessage("success");
  const [deletingTransactionId, setDeletingTransactionId] = useState<string | null>(null);
  const [editingTransactionId, setEditingTransactionId] = useState("");
  const [editingDate, setEditingDate] = useState("");
  const [editingTime, setEditingTime] = useState("");
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
  const [isMonthLoading, setIsMonthLoading] = useState(false);
  const [visibleColumns, setVisibleColumns] = useState<TransactionColumn[]>(defaultTransactionColumns);

  async function loadData(activeFilters = filters, showLoading = true) {
    const accessToken = getAccessToken();

    if (!accessToken) {
      setLoadState({ message: "Sign in before managing transactions.", status: "error" });
      return;
    }

    if (showLoading) {
      setLoadState({ status: "loading" });
    }

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

    const searchParams = new URLSearchParams(window.location.search);
    const requestedSearch = searchParams.get("search")?.trim() ?? "";
    const requestedOrdering = searchParams.get("ordering");
    const ordering = requestedOrdering === "-created_at" || requestedOrdering === "-updated_at" ? requestedOrdering : "-date";
    const requestedFilters: TransactionFilterState = {
      account: searchParams.get("account") ?? "",
      category: searchParams.get("category") ?? "",
      direction: (searchParams.get("direction") ?? "") as TransactionFilterState["direction"],
      month: searchParams.has("month") ? searchParams.get("month") ?? "" : requestedSearch || ordering !== "-date" ? "" : currentMonth(),
      ordering,
      search: requestedSearch,
      source: (searchParams.get("source") ?? "") as TransactionFilterState["source"],
      type: (searchParams.get("type") ?? "") as TransactionFilterState["type"]
    };

    setFilters(requestedFilters);
    setLoadState({ status: "loading" });

    void Promise.all([
      listAccounts(accessToken),
      listCategories(accessToken),
      listTransactions(accessToken, requestedFilters)
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

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(transactionColumnsStorageKey);
      if (!stored) return;
      const parsed = JSON.parse(stored) as unknown;
      if (!Array.isArray(parsed)) return;
      const allowed = new Set<TransactionColumn>(defaultTransactionColumns);
      const restored = parsed.filter((value): value is TransactionColumn =>
        typeof value === "string" && allowed.has(value as TransactionColumn)
      );
      if (restored.length > 0) setVisibleColumns(restored);
    } catch {
      // Fall back to the complete default table when storage is unavailable.
    }
  }, []);

  function handleFilterSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    applyFilterUrl(filters);
    void loadData(filters);
  }

  function applyFilterUrl(nextFilters: TransactionFilterState) {
    const params = new URLSearchParams();
    params.set("month", nextFilters.month);
    Object.entries(nextFilters).forEach(([key, value]) => {
      if (value) params.set(key, value);
    });
    window.history.replaceState(null, "", `${window.location.pathname}${params.size ? `?${params.toString()}` : ""}`);
  }

  async function selectMonth(month: string) {
    const nextFilters = { ...filters, month };
    setFilters(nextFilters);
    applyFilterUrl(nextFilters);
    setIsMonthLoading(true);
    try {
      await loadData(nextFilters, false);
    } finally {
      setIsMonthLoading(false);
    }
  }

  async function selectOrdering(ordering: TransactionFilterState["ordering"]) {
    const nextFilters = { ...filters, ordering, month: ordering !== "-date" ? "" : currentMonth() };
    setFilters(nextFilters);
    applyFilterUrl(nextFilters);
    setIsMonthLoading(true);
    try { await loadData(nextFilters, false); }
    finally { setIsMonthLoading(false); }
  }

  function toggleColumn(column: TransactionColumn) {
    setVisibleColumns((current) => {
      const next = current.includes(column)
        ? current.filter((item) => item !== column)
        : transactionColumns.filter((item) => item.id === column || current.includes(item.id)).map((item) => item.id);
      if (next.length === 0) return current;
      persistVisibleColumns(next);
      return next;
    });
  }

  function clearFilters() {
    const clearedFilters: TransactionFilterState = {
      account: "",
      category: "",
      direction: "",
      month: "",
      ordering: filters.ordering,
      search: "",
      source: "",
      type: ""
    };
    setFilters(clearedFilters);
    applyFilterUrl(clearedFilters);
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

    const form = event.currentTarget;
    const formData = new FormData(form);
    const type = String(formData.get("type") ?? "expense") as TransactionType;
    const direction = String(formData.get("direction") ?? "debit") as TransactionDirection;
    const transferAccount = String(formData.get("transfer_account") ?? "");
    const category = String(formData.get("category") ?? "");

    setFormError(null);
    setFormMessage(null);
    setIsSubmitting(true);

    try {
      const input: CreateTransactionInput = {
        external_key: `manual-transfer:${crypto.randomUUID()}`,
        account: String(formData.get("account") ?? ""),
        amount: String(formData.get("amount") ?? ""),
        balance_after: String(formData.get("balance_after") ?? "") || null,
        category: category || undefined,
        counterparty_text: String(formData.get("counterparty_text") ?? ""),
        date: String(formData.get("date") ?? ""),
        direction,
        note: String(formData.get("note") ?? ""),
        reference: String(formData.get("reference") ?? ""),
        time: String(formData.get("time") ?? "") || null,
        transfer_account: type === "transfer" ? transferAccount : undefined,
        type
      };
      if (type === "transfer") {
        const matches = await findTransferMatches(accessToken, { draft: input });
        if (matches.length) {
          setMatchError(null);
          setTransferDecision({ input, matches });
          return;
        }
      }
      await createTransaction(accessToken, input);
      form.reset();
      await loadData(filters, false);
      setEditorMode(null);
      setFormMessage("Transaction saved.");
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "Could not create transaction.");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleTransferDecision(match?: TransferMatch) {
    const accessToken = getAccessToken();
    if (!accessToken || !transferDecision) return;
    setIsSubmitting(true);
    setMatchError(null);
    try {
      if (transferDecision.mergeId) {
        if (match) await mergeTransfers(accessToken, match.id, transferDecision.mergeId);
      } else if (match) {
        await linkTransfer(accessToken, { draft: transferDecision.input }, match);
      } else {
        await createTransaction(accessToken, transferDecision.input);
      }
      setTransferDecision(null);
      setEditorMode(null);
      await loadData(filters, false);
      setFormMessage(match ? "Transfer linked. Both accounts show one movement." : "Transfer kept separate.");
    } catch (error) {
      setMatchError(error instanceof Error ? error.message : "Could not link transfer.");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleFindPostedMatch(record: Transaction) {
    const accessToken = getAccessToken();
    if (!accessToken) return;
    setFormError(null);
    setIsSubmitting(true);
    try {
      const input: CreateTransactionInput = { account: record.account, transfer_account: record.transfer_account || undefined,
        amount: record.amount, date: record.date, direction: "debit", type: "transfer" };
      const matches = (await findTransferMatches(accessToken, { draft: input, exclude_transaction: record.id })).filter((match) => match.kind === "transaction");
      if (matches.length) {
        setMatchError(null);
        setTransferDecision({ input, matches, mergeId: record.id });
      } else setFormMessage("No matching recorded transfer found.");
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "Could not find matches.");
    } finally { setIsSubmitting(false); }
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
      await loadData(filters, false);
      setFormMessage("Transaction deleted.");
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
    setEditingTime(transaction.time?.slice(0, 5) ?? "");
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
    setFormError(null);
    setFormMessage(null);
    setEditorMode("edit");
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
    setFormMessage(null);
    setIsUpdating(true);
    try {
      await updateTransaction(accessToken, editingTransactionId, {
        account: editingAccountId,
        amount: editingAmount,
        balance_after: editingBalanceAfter || null,
        category: editingCategoryId || null,
        counterparty_text: editingCounterpartyText,
        date: editingDate,
        time: editingTime || null,
        direction: editingDirection,
        note: editingNote,
        reference: editingReference,
        transfer_account: editingType === "transfer" ? editingTransferAccountId || null : null,
        type: editingType
      });
      await loadData(filters, false);
      setEditorMode(null);
      setFormMessage("Transaction updated.");
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
    return <LoadingState detail="Syncing ledger entries, accounts, and categories" label="Loading transactions" />;
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
      {editorMode ? (
        <ModalDialog labelledBy="transaction-editor-title" className="form-drawer transaction-editor-drawer" busy={isSubmitting || isUpdating} onCancel={() => setEditorMode(null)}>
            <div className="form-drawer__header">
              <div>
                <h2 id="transaction-editor-title">
                  {editorMode === "create" ? "Add transaction" : "Edit transaction"}
                </h2>
                <p>
                  {editorMode === "create"
                    ? "Manual entry is available for activity that did not arrive through mobile sync."
                    : "Correct the selected ledger entry without leaving your transaction list."}
                </p>
              </div>
              <button
                aria-label="Close transaction editor"
                autoFocus
                className="icon-button"
                disabled={isSubmitting || isUpdating}
                onClick={() => setEditorMode(null)}
                type="button"
              >
                <X aria-hidden="true" size={20} />
              </button>
            </div>

          {editorMode === "create" ? <form className="transaction-form drawer-form" onSubmit={handleSubmit}>
            <label className="field">
              <span className="field__label">Date</span>
              <input className="field__control" defaultValue={currentDate()} name="date" required type="date" />
            </label>

            <label className="field">
              <span className="field__label">Time</span>
              <input className="field__control" defaultValue={currentTime()} name="time" type="time" />
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
              <span className="field__hint">For transfers: debit means this account sends; credit means this account receives. Select the other account below.</span>
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
              <span className="field__label">Other transfer account</span>
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
                inputMode="decimal"
                required
                type="text"
              />
            </label>

            <label className="field">
              <span className="field__label">Reported balance after (optional)</span>
              <input className="field__control" inputMode="decimal" name="balance_after" placeholder="72,308.00" type="text" />
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
              {isSubmitting ? <ButtonBusy label="Saving" /> : "Save transaction"}
            </button>
          </form> : null}

          {editorMode === "edit" ? <form className="transaction-form drawer-form" onSubmit={handleUpdate}>
            <TransactionSourceMessages key={editingTransactionId} transactionId={editingTransactionId} />
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
              <span className="field__label">Time</span>
              <input
                className="field__control"
                onChange={(event) => setEditingTime(event.target.value)}
                type="time"
                value={editingTime}
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
                inputMode="decimal"
                onChange={(event) => setEditingAmount(event.target.value)}
                required
                type="text"
                value={editingAmount}
              />
            </label>

            <label className="field">
              <span className="field__label">Reported balance after (optional)</span>
              <input
                className="field__control"
                inputMode="decimal"
                onChange={(event) => setEditingBalanceAfter(event.target.value)}
                type="text"
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
              {isUpdating ? <ButtonBusy label="Updating" /> : "Update transaction"}
            </button>
            {formError ? <p className="form-error field--wide">{formError}</p> : null}

          </form> : null}
        </ModalDialog>
      ) : null}

      <section className="panel">
        <div className="panel__body">
          <div className="report-header">
            <div>
              <h2 className="section-title">Transactions</h2>
              <p className="section-subtitle">
                Search and review synced activity first. Add a manual record only when automation cannot capture it.
              </p>
            </div>
            <button
              className="button button--primary"
              onClick={() => {
                setFormError(null);
                setFormMessage(null);
                setEditorMode("create");
              }}
              type="button"
            >
              <Plus aria-hidden="true" size={17} />
              Add transaction
            </button>
          </div>

          {formMessage ? <p className="form-success">{formMessage}</p> : null}

          <div className="transaction-view-switch" aria-label="Transaction ordering">
            <button className="button button--ghost" aria-pressed={filters.ordering === "-date"} disabled={isMonthLoading} onClick={() => void selectOrdering("-date")} type="button">By transaction date</button>
            <button className="button button--ghost" aria-pressed={filters.ordering === "-created_at"} disabled={isMonthLoading} onClick={() => void selectOrdering("-created_at")} type="button">Recently added</button>
            <button className="button button--ghost" aria-pressed={filters.ordering === "-updated_at"} disabled={isMonthLoading} onClick={() => void selectOrdering("-updated_at")} type="button">Recently updated</button>
          </div>

          <form className="filter-form transaction-filter-form" onSubmit={handleFilterSubmit}>
            <div className="field transaction-month-filter">
              <span className="field__label">Month</span>
              <span className="month-navigator" aria-busy={isMonthLoading}>
                <button aria-label="Previous month" disabled={isMonthLoading} onClick={() => void selectMonth(shiftMonth(filters.month, -1))} type="button"><CaretLeft aria-hidden="true" size={18} /></button>
                <input
                  className="field__control"
                  disabled={isMonthLoading}
                  name="month"
                  onChange={(event) => void selectMonth(event.target.value)}
                  type="month"
                  value={filters.month}
                />
                <button aria-label="Next month" disabled={isMonthLoading} onClick={() => void selectMonth(shiftMonth(filters.month, 1))} type="button"><CaretRight aria-hidden="true" size={18} /></button>
                <button aria-label="Current month" className="month-navigator__today" disabled={isMonthLoading || filters.month === currentMonth()} onClick={() => void selectMonth(currentMonth())} title="Current month" type="button"><CalendarBlank aria-hidden="true" size={18} /></button>
              </span>
            </div>

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
              {isExporting ? <ButtonBusy label="Exporting" /> : "Export CSV"}
            </button>
          </form>

          {exportMessage ? <p className="section-subtitle">{exportMessage}</p> : null}

          <div className="transaction-table-toolbar">
            <div>
              <p className="section-subtitle">{filters.ordering === "-updated_at" ? "Latest saved changes first, including new entries, edits and linked transfer evidence. Transaction dates may be older." : filters.ordering === "-created_at" ? "Newest ledger additions first. Transaction dates may be older; edits do not change added time." : "Showing records by transaction date from the authenticated backend API."}</p>
              {isMonthLoading ? <span className="transaction-refresh-state"><ButtonBusy label="Updating transactions" /></span> : null}
            </div>
            <details className="column-picker">
              <summary><SlidersHorizontal aria-hidden="true" size={17} />Columns <span>{visibleColumns.length}/{transactionColumns.length}</span></summary>
              <div className="column-picker__menu">
                <strong>Visible columns</strong>
                {transactionColumns.map((column) => (
                  <label key={column.id}>
                    <input checked={visibleColumns.includes(column.id)} onChange={() => toggleColumn(column.id)} type="checkbox" />
                    <span>{column.label}</span>
                  </label>
                ))}
                <button className="button button--ghost button--small" onClick={() => {
                  setVisibleColumns(defaultTransactionColumns);
                  persistVisibleColumns(defaultTransactionColumns);
                }} type="button">Show all</button>
              </div>
            </details>
          </div>

          {loadState.transactions.length === 0 ? (
            <div className="empty-state">
              <p>No transactions yet.</p>
            </div>
          ) : (
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    {filters.ordering === "-created_at" ? <th>Added</th> : null}
                    {filters.ordering === "-updated_at" ? <th>Updated</th> : null}
                    {visibleColumns.includes("date") ? <th>Date</th> : null}
                    {visibleColumns.includes("time") ? <th>Time</th> : null}
                    {visibleColumns.includes("description") ? <th>Description</th> : null}
                    {visibleColumns.includes("account") ? <th>Account</th> : null}
                    {visibleColumns.includes("category") ? <th>Category</th> : null}
                    {visibleColumns.includes("source") ? <th>Source</th> : null}
                    {visibleColumns.includes("balance") ? <th>Reported balance</th> : null}
                    {visibleColumns.includes("senderIdentifiers") ? <th>Sender identifiers</th> : null}
                    {visibleColumns.includes("receiverIdentifiers") ? <th>Receiver identifiers</th> : null}
                    {visibleColumns.includes("amount") ? <th>Amount</th> : null}
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {loadState.transactions.map((transaction) => (
                    <tr key={transaction.id}>
                      {filters.ordering !== "-date" ? <td><time dateTime={filters.ordering === "-updated_at" ? transaction.updated_at : transaction.created_at}>{activityTimeFormatter.format(new Date(filters.ordering === "-updated_at" ? transaction.updated_at : transaction.created_at))}</time></td> : null}
                      {visibleColumns.includes("date") ? <td>{transaction.date}</td> : null}
                      {visibleColumns.includes("time") ? <td>{formatTransactionTime(transaction.time)}</td> : null}
                      {visibleColumns.includes("description") ? <td>
                        <span className="transaction-ledger-primary">
                          {transaction.counterparty_text || transaction.reference || transaction.note || transaction.type.replaceAll("_", " ")}
                        </span>
                        <span className="transaction-ledger-secondary">
                          {transaction.type.replaceAll("_", " ")} · {transaction.account_direction}
                          {transaction.reference ? ` · ${transaction.reference}` : ""}
                        </span>
                      </td> : null}
                      {visibleColumns.includes("account") ? <td>{accountNames.get(transaction.account) ?? "Unknown"}{transaction.type === "transfer" ? ` → ${accountNames.get(transaction.transfer_account ?? "") ?? "Unknown"}` : ""}</td> : null}
                      {visibleColumns.includes("category") ? <td>
                        {transaction.category
                          ? categoryNames.get(transaction.category) ?? "Unknown"
                          : "None"}
                      </td> : null}
                      {visibleColumns.includes("source") ? <td>{transaction.source}</td> : null}
                      {visibleColumns.includes("balance") ? <td>
                        {transaction.transfer_evidence.length ? transaction.transfer_evidence.map((item) => <span className="transaction-ledger-secondary" key={item.id}>{accountNames.get(item.account)}: {item.balance_after === null ? "No reported balance" : moneyFormatter.format(Number(item.balance_after))}{item.reference ? ` · ${item.reference}` : ""}</span>) : transaction.balance_after
                          ? moneyFormatter.format(Number(transaction.balance_after))
                          : "-"}
                      </td> : null}
                      {visibleColumns.includes("senderIdentifiers") ? <td><span className="transaction-ledger-primary">{transaction.sender_account_identifier || "—"}</span><span className="transaction-ledger-secondary">{transaction.sender_card_identifier ? `Card ${transaction.sender_card_identifier}` : "No card identifier"}</span></td> : null}
                      {visibleColumns.includes("receiverIdentifiers") ? <td><span className="transaction-ledger-primary">{transaction.receiver_account_identifier || "—"}</span><span className="transaction-ledger-secondary">{transaction.receiver_card_identifier ? `Card ${transaction.receiver_card_identifier}` : "No card identifier"}</span></td> : null}
                      {visibleColumns.includes("amount") ? <td className={transaction.account_direction === "credit" ? "transaction-ledger-amount transaction-ledger-amount--credit" : "transaction-ledger-amount"}>
                        {transaction.account_direction === "credit" ? "+" : "-"}{moneyFormatter.format(Number(transaction.amount))}
                      </td> : null}
                      <td>
                        <div className="list-row__actions">
                          {transaction.type === "transfer" ? <button className="button button--ghost" disabled={isSubmitting} onClick={() => void handleFindPostedMatch(transaction)} type="button">Find match</button> : null}
                          <button
                            className="button button--ghost"
                            onClick={() => selectTransactionForEdit(transaction.id)}
                            type="button"
                          >
                            Edit
                          </button>
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
                            {deletingTransactionId === transaction.id ? <ButtonBusy label="Deleting" /> : "Delete"}
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
      {transferDecision ? <TransferMatchDialog matches={transferDecision.matches} busy={isSubmitting} error={matchError} merging={Boolean(transferDecision.mergeId)} onAccept={(match) => void handleTransferDecision(match)} onSeparate={() => void handleTransferDecision()} onCancel={() => setTransferDecision(null)} /> : null}
    </div>
  );
}
