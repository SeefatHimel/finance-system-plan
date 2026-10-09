"use client";

import { identifierLabel, useIdentifierView } from "@/components/identifier-view";

import { useFeedbackMessage } from "@/components/toast-provider";

import { CalendarBlank, CaretLeft, CaretRight, Plus, SlidersHorizontal, X } from "@phosphor-icons/react";
import type React from "react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

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
  listPaymentMethods,
  type PaymentMethod,
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
import { TransactionStatementEvidence } from "@/components/transaction-statement-evidence";
import { useCategoryTypeChoice } from "@/components/use-category-type-choice";
import { directionForType, transactionTypes } from "@/lib/category-type";
import { balanceAfterAccountChange, balanceReportingAccount, editableReportedBalance } from "@/lib/transaction-balances";
import { LatestRequest, type RequestTicket } from "@/lib/latest-request";

type LoadState =
  | { status: "loading" }
  | { message: string; status: "error" }
  | {
      accounts: Account[];
      categories: Category[];
      paymentMethods: PaymentMethod[];
      status: "ready";
      transactions: Transaction[];
    };

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
  const [filters, setFilterState] = useState<TransactionFilterState>({
    account: "",
    category: "",
    direction: "",
    month: currentMonth(),
    ordering: "-date",
    search: "",
    source: "",
    type: ""
  });
  const filtersRef = useRef(filters);
  const setFilters = useCallback((next: TransactionFilterState) => {
    filtersRef.current = next;
    setFilterState(next);
  }, []);
  const dataRequests = useRef(new LatestRequest());
  const readyData = useRef<Extract<LoadState, { status: "ready" }> | null>(null);
  const [displayedFilters, setDisplayedFilters] = useState(filters);
  const [requestedFilters, setRequestedFilters] = useState(filters);
  const [refreshError, setRefreshError] = useFeedbackMessage("error");
  const [loadState, setLoadState] = useState<LoadState>({ status: "loading" });
  const [transferDecision, setTransferDecision] = useState<{ input: CreateTransactionInput; matches: TransferMatch[]; mergeId?: string } | null>(null);
  const [matchError, setMatchError] = useFeedbackMessage("error");
  const [formError, setFormError] = useFeedbackMessage("error");
  const [formMessage, setFormMessage] = useFeedbackMessage("success");
  const [editorMode, setEditorMode] = useState<"create" | "edit" | null>(null);
  const [createType, setCreateType] = useState<TransactionType>("expense");
  const [createDirection, setCreateDirection] = useState<TransactionDirection>("debit");
  const [createCategoryId, setCreateCategoryId] = useState("");
  const createForm = useRef<HTMLFormElement>(null);
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
  const [editingBalanceNotice, setEditingBalanceNotice] = useState("");
  const [createAccountId, setCreateAccountId] = useState("");
  const [createBalanceNotice, setCreateBalanceNotice] = useState("");
  const [editingReference, setEditingReference] = useState("");
  const [editingCounterpartyText, setEditingCounterpartyText] = useState("");
  const [editingNote, setEditingNote] = useState("");
  const [editingPaymentMethodId, setEditingPaymentMethodId] = useState("");
  const [editingSenderAccountIdentifier, setEditingSenderAccountIdentifier] = useState("");
  const [editingSenderCardIdentifier, setEditingSenderCardIdentifier] = useState("");
  const [editingReceiverAccountIdentifier, setEditingReceiverAccountIdentifier] = useState("");
  const [editingReceiverCardIdentifier, setEditingReceiverCardIdentifier] = useState("");
  const [editingSource, setEditingSource] = useState<TransactionSource>("web");
  const [editingNeedsReview, setEditingNeedsReview] = useState(false);
  const [allowLinkedCorrection, setAllowLinkedCorrection] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const identifierView = useIdentifierView();
  const [visibleColumns, setVisibleColumns] = useState<TransactionColumn[]>(defaultTransactionColumns);
  const categoryChoice = useCategoryTypeChoice(loadState.status === "ready" ? loadState.categories : []);

  function changeCreateType(type: TransactionType) {
    setCreateType(type);
    setCreateDirection(directionForType(type));
    for (const name of type !== "transfer" ? ["transfer_account"] : []) {
      const field = createForm.current?.elements.namedItem(name);
      if (field instanceof HTMLInputElement || field instanceof HTMLSelectElement) field.value = "";
    }
  }

  function changeEditingContext(patch: Partial<{ type: TransactionType; account: string; transfer_account: string }>) {
    const record = loadState.status === "ready" ? loadState.transactions.find((item) => item.id === editingTransactionId) : null;
    const primaryDirection = record?.transfer_evidence.find((item) => item.is_primary)?.direction;
    const before = { type: editingType, account: editingAccountId, transfer_account: editingTransferAccountId };
    const after = { ...before, ...patch };
    const nextBalance = balanceAfterAccountChange(editingBalanceAfter, balanceReportingAccount(before, primaryDirection), balanceReportingAccount(after, primaryDirection));
    if (nextBalance !== editingBalanceAfter) {
      setEditingBalanceAfter(nextBalance);
      setEditingBalanceNotice("Reported balance cleared because its reporting account changed. Enter the balance for the new account if available.");
    }
    setEditingType(after.type);
    setEditingAccountId(after.account);
    setEditingTransferAccountId(after.transfer_account);
    setAllowLinkedCorrection(false);
  }

  function changeEditingType(type: TransactionType) {
    changeEditingContext({ type, ...(type !== "transfer" ? { transfer_account: "" } : {}) });
    setEditingDirection(directionForType(type));
  }

  const markPending = useCallback((activeFilters: TransactionFilterState) => {
    setRequestedFilters(activeFilters);
    setRefreshError(null);
    setIsRefreshing(true);
  }, [setRefreshError]);

  const requestData = useCallback(async (activeFilters: TransactionFilterState, refreshLookups: boolean, ticket: RequestTicket) => {
    const accessToken = getAccessToken();
    if (!accessToken) {
      if (ticket.isCurrent()) {
        setLoadState({ message: "Sign in before managing transactions.", status: "error" });
        setIsRefreshing(false);
      }
      return;
    }
    if (!readyData.current) setLoadState({ status: "loading" });
    try {
      const previous = readyData.current;
      const next: Extract<LoadState, { status: "ready" }> = previous && !refreshLookups
        ? { ...previous, transactions: await listTransactions(accessToken, activeFilters, ticket.signal) }
        : await Promise.all([
            listAccounts(accessToken, ticket.signal), listCategories(accessToken, ticket.signal),
            listTransactions(accessToken, activeFilters, ticket.signal), listPaymentMethods(accessToken, ticket.signal)
          ]).then(([accounts, categories, transactions, paymentMethods]) => ({ accounts, categories, transactions, paymentMethods, status: "ready" as const }));
      if (!ticket.isCurrent()) return;
      readyData.current = next;
      setLoadState(next);
      setDisplayedFilters(activeFilters);
    } catch (error) {
      if (!ticket.isCurrent()) return;
      const message = error instanceof Error ? error.message : "Could not load transactions.";
      if (readyData.current) setRefreshError(message);
      else setLoadState({ message, status: "error" });
    } finally {
      if (ticket.isCurrent()) setIsRefreshing(false);
    }
  }, [setRefreshError]);

  const loadData = useCallback((activeFilters = filtersRef.current, refreshLookups = true) => {
    markPending(activeFilters);
    return dataRequests.current.run((ticket) => requestData(activeFilters, refreshLookups, ticket));
  }, [markPending, requestData]);

  useEffect(() => {
    const requests = dataRequests.current;
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
    void loadData(requestedFilters);
    return () => requests.cancel();
  }, [loadData, setFilters]);

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
    applyFilterUrl(filtersRef.current);
    void loadData(filtersRef.current, false);
  }

  function applyFilterUrl(nextFilters: TransactionFilterState) {
    const params = new URLSearchParams();
    params.set("month", nextFilters.month);
    Object.entries(nextFilters).forEach(([key, value]) => {
      if (value) params.set(key, value);
    });
    window.history.replaceState(null, "", `${window.location.pathname}${params.size ? `?${params.toString()}` : ""}`);
  }

  function selectMonth(selection: string | number) {
    const current = filtersRef.current;
    const month = typeof selection === "number" ? shiftMonth(current.month, selection) : selection;
    const nextFilters = { ...current, month };
    setFilters(nextFilters);
    applyFilterUrl(nextFilters);
    markPending(nextFilters);
    dataRequests.current.schedule((ticket) => { void requestData(nextFilters, false, ticket); }, 250);
  }

  function selectOrdering(ordering: TransactionFilterState["ordering"]) {
    const nextFilters = { ...filtersRef.current, ordering, month: ordering !== "-date" ? "" : currentMonth() };
    setFilters(nextFilters);
    applyFilterUrl(nextFilters);
    void loadData(nextFilters, false);
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
      ordering: filtersRef.current.ordering,
      search: "",
      source: "",
      type: ""
    };
    setFilters(clearedFilters);
    applyFilterUrl(clearedFilters);
    void loadData(clearedFilters, false);
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

    if (type === "transfer" && !transferAccount) return setFormError("Choose the other account before saving a transfer.");
    if (type === "transfer" && transferAccount === String(formData.get("account"))) return setFormError("Choose different From and To accounts for a transfer.");

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
      await loadData(filters);
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
      await loadData(filters);
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
      await loadData(filters);
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
    setEditingBalanceAfter(editableReportedBalance(transaction));
    setEditingBalanceNotice("");
    setEditingReference(transaction.reference);
    setEditingCounterpartyText(transaction.counterparty_text);
    setEditingNote(transaction.note ?? "");
    setEditingPaymentMethodId(transaction.payment_method ?? "");
    setEditingSenderAccountIdentifier(transaction.sender_account_identifier);
    setEditingSenderCardIdentifier(transaction.sender_card_identifier);
    setEditingReceiverAccountIdentifier(transaction.receiver_account_identifier);
    setEditingReceiverCardIdentifier(transaction.receiver_card_identifier);
    setEditingSource(transaction.source as TransactionSource);
    setEditingNeedsReview(transaction.needs_review);
    setAllowLinkedCorrection(false);
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
    if (editingType === "transfer" && !editingTransferAccountId) return setFormError("Choose the To account before saving a transfer.");
    if (editingType === "transfer" && editingAccountId === editingTransferAccountId) return setFormError("Choose different From and To accounts for a transfer.");

    setFormError(null);
    setFormMessage(null);
    setIsUpdating(true);
    try {
      await updateTransaction(accessToken, editingTransactionId, {
        allow_linked_correction: allowLinkedCorrection,
        account: editingAccountId,
        amount: editingAmount,
        balance_after: editingBalanceAfter || null,
        category: editingCategoryId || null,
        counterparty_text: editingCounterpartyText,
        date: editingDate,
        time: editingTime || null,
        direction: editingDirection,
        note: editingNote,
        payment_method: editingPaymentMethodId || null,
        sender_account_identifier: editingSenderAccountIdentifier,
        sender_card_identifier: editingSenderCardIdentifier,
        receiver_account_identifier: editingReceiverAccountIdentifier,
        receiver_card_identifier: editingReceiverCardIdentifier,
        source: editingSource,
        needs_review: editingNeedsReview,
        reference: editingReference,
        transfer_account: editingType === "transfer" ? editingTransferAccountId || null : null,
        type: editingType
      });
      await loadData(filters);
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

  const editingTransaction = loadState.transactions.find((item) => item.id === editingTransactionId);
  const primaryBalanceReport = editingTransaction?.transfer_evidence.find((item) => item.is_primary);
  const balanceAccountId = balanceReportingAccount({ type: editingType, account: editingAccountId, transfer_account: editingTransferAccountId }, primaryBalanceReport?.direction);
  const requiresLinkedCorrection = Boolean(editingTransaction && (
    editingTransaction.statement_evidence_count > 0 || (editingTransaction.transfer_evidence.length > 1 &&
    (editingTransaction.type === "transfer" || editingType === "transfer"))) && (
      editingTransaction.type !== editingType || editingTransaction.account !== editingAccountId ||
      editingTransaction.transfer_account !== (editingType === "transfer" ? editingTransferAccountId || null : null) ||
      Number(editingTransaction.amount) !== Number(editingAmount) ||
      (editingTransaction.statement_evidence_count > 0 && editingTransaction.direction !== editingDirection)
    ));

  return (
    <div className="workspace-grid">
      {categoryChoice.confirmation}
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

          {editorMode === "create" ? <form className="transaction-form drawer-form" onSubmit={handleSubmit} ref={createForm}>
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
              <select className="field__control" name="type" required value={createType} onChange={(event) => changeCreateType(event.target.value as TransactionType)}>
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
              <select className="field__control" value={createDirection} onChange={(event) => setCreateDirection(event.target.value as TransactionDirection)} name="direction" required>
                <option value="debit">Debit</option>
                <option value="credit">Credit</option>
              </select>
            </label>

            <label className="field">
              <span className="field__label">Account</span>
              <select className="field__control" name="account" required value={createAccountId} onChange={(event) => {
                const field = createForm.current?.elements.namedItem("balance_after");
                if (field instanceof HTMLInputElement && balanceAfterAccountChange(field.value, createAccountId, event.target.value) !== field.value) {
                  field.value = "";
                  setCreateBalanceNotice("Reported balance cleared because its reporting account changed. Enter the balance for the new account if available.");
                }
                setCreateAccountId(event.target.value);
              }}>
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
              <select className="field__control" name="category" value={createCategoryId} disabled={isSubmitting} onChange={(event) => categoryChoice.choose(event.target.value, createType, (categoryId, type) => { setCreateCategoryId(categoryId); if (type !== createType) changeCreateType(type); })}>
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
              {createBalanceNotice ? <small className="field__hint" role="status">{createBalanceNotice}</small> : null}
            </label>

            <label className="field">
              <span className="field__label">Reference</span>
              <input aria-label="Reference" aria-describedby="transaction-create-reference-help" className="field__control" name="reference" placeholder="e.g. DEMO-TRF-1042" type="text" />
              <small className="field__hint" id="transaction-create-reference-help">Optional bank or wallet reference. References may repeat.</small>
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
            {editingTransaction?.statement_evidence_count ? <TransactionStatementEvidence key={`statement-${editingTransactionId}`} transactionId={editingTransactionId} /> : null}
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
                onChange={(event) => changeEditingType(event.target.value as TransactionType)}
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

            {editingType === "transfer" ? <div className="field">
              <span className="field__label">Direction</span>
              <button className="button button--ghost" onClick={() => {
                changeEditingContext({ account: editingTransferAccountId, transfer_account: editingAccountId });
                setEditingDirection("debit");
                setEditingPaymentMethodId("");
                setAllowLinkedCorrection(false);
              }} type="button">Reverse transfer direction</button>
              <small>Money moves from the From account to the To account.</small>
            </div> : <label className="field">
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
            </label>}

            <label className="field">
              <span className="field__label">{editingType === "transfer" ? "From account" : "Account"}</span>
              <select
                className="field__control"
                onChange={(event) => {
                  changeEditingContext({ account: event.target.value });
                  setEditingPaymentMethodId("");
                  setAllowLinkedCorrection(false);
                }}
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
              <span className="field__label">{editingType === "transfer" ? "To account" : "Transfer to"}</span>
              <select
                className="field__control"
                disabled={editingType !== "transfer"}
                onChange={(event) => {
                  changeEditingContext({ transfer_account: event.target.value });
                  setAllowLinkedCorrection(false);
                }}
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
                disabled={isUpdating}
                onChange={(event) => categoryChoice.choose(event.target.value, editingType, (categoryId, type) => { setEditingCategoryId(categoryId); if (type !== editingType) changeEditingType(type); })}
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
                onChange={(event) => { setEditingAmount(event.target.value); setAllowLinkedCorrection(false); }}
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
                onChange={(event) => { setEditingBalanceAfter(event.target.value); setEditingBalanceNotice(""); }}
                type="text"
                value={editingBalanceAfter}
              />
              {balanceAccountId ? <small className="field__hint">Reported for {loadState.accounts.find((account) => account.id === balanceAccountId)?.name ?? "this account"}. This is the balance from the report, rather than the calculated ledger balance.</small> : <small className="field__hint">Optional balance from the original report. Linked account balances are shown below.</small>}
              {editingBalanceNotice ? <small className="field__hint" role="status">{editingBalanceNotice}</small> : null}
            </label>

            {editingTransaction?.type === "transfer" && editingTransaction.transfer_evidence.length ? <details className="raw-message field--wide" open>
              <summary>Saved transfer reported balances</summary>
              {editingTransaction.transfer_evidence.map((item) => <p key={item.id}><strong>{loadState.accounts.find((account) => account.id === item.account)?.name ?? "Unknown account"}</strong>: {item.balance_after === null ? "No reported balance" : moneyFormatter.format(Number(item.balance_after))}{item.is_primary ? " · Primary report" : " · Linked report"}</p>)}
              <p>These are the saved reports for each account. The draft balance is kept while its reporting account stays the same. Moving it to another account clears it.</p>
            </details> : null}

            <label className="field">
              <span className="field__label">Reference</span>
              <input
                aria-label="Reference"
                aria-describedby="transaction-edit-reference-help"
                className="field__control"
                onChange={(event) => setEditingReference(event.target.value)}
                placeholder="e.g. DEMO-TRF-1042"
                type="text"
                value={editingReference}
              />
              <small className="field__hint" id="transaction-edit-reference-help">Optional bank or wallet reference. References may repeat.</small>
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

            <label className="field">
              <span className="field__label">Payment method</span>
              <select className="field__control" onChange={(event) => setEditingPaymentMethodId(event.target.value)} value={editingPaymentMethodId}>
                <option value="">No payment method</option>
                {loadState.paymentMethods.filter((method) => method.account === editingAccountId).map((method) => <option key={method.id} value={method.id}>{method.name}</option>)}
              </select>
            </label>
            <label className="field">
              <span className="field__label">Source</span>
              <select className="field__control" onChange={(event) => setEditingSource(event.target.value as TransactionSource)} value={editingSource}>
                {transactionSources.map((source) => <option key={source} value={source}>{source}</option>)}
              </select>
            </label>
            <fieldset className="transaction-identifier-fields field--wide">
              <legend>Masked sender and receiver identifiers</legend>
              <p>Use masked values or a safe suffix. Full account and card numbers are reduced to their last four digits before saving.</p>
              <div className="transaction-identifier-grid">
                <label className="field"><span className="field__label">Sender account</span><input className="field__control" maxLength={120} onChange={(event) => setEditingSenderAccountIdentifier(event.target.value)} value={editingSenderAccountIdentifier} /></label>
                <label className="field"><span className="field__label">Sender card</span><input className="field__control" maxLength={120} onChange={(event) => setEditingSenderCardIdentifier(event.target.value)} value={editingSenderCardIdentifier} /></label>
                <label className="field"><span className="field__label">Receiver account</span><input className="field__control" maxLength={120} onChange={(event) => setEditingReceiverAccountIdentifier(event.target.value)} value={editingReceiverAccountIdentifier} /></label>
                <label className="field"><span className="field__label">Receiver card</span><input className="field__control" maxLength={120} onChange={(event) => setEditingReceiverCardIdentifier(event.target.value)} value={editingReceiverCardIdentifier} /></label>
              </div>
            </fieldset>
            <label className="review-remember field--wide"><input checked={editingNeedsReview} onChange={(event) => setEditingNeedsReview(event.target.checked)} type="checkbox" /><span><strong>Needs review</strong><small>Keep this ledger entry marked for further checking.</small></span></label>
            {requiresLinkedCorrection ? <label className="review-remember field--wide"><input checked={allowLinkedCorrection} onChange={(event) => setAllowLinkedCorrection(event.target.checked)} required type="checkbox" /><span><strong>I reviewed the linked evidence and confirm this ledger correction</strong><small>Account changes remap transfer observations by debit/credit side and clear old reported balances. Original SMS and statement snapshots stay unchanged as history.</small></span></label> : null}
            <button className="button button--ghost field--wide" disabled={isUpdating || (requiresLinkedCorrection && !allowLinkedCorrection)} type="submit">
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
                setCreateType("expense");
                setCreateAccountId("");
                setCreateBalanceNotice("");
                setCreateDirection("debit");
                setCreateCategoryId("");
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
            <button className="button button--ghost" aria-pressed={filters.ordering === "-date"} onClick={() => selectOrdering("-date")} type="button">By transaction date</button>
            <button className="button button--ghost" aria-pressed={filters.ordering === "-created_at"} onClick={() => selectOrdering("-created_at")} type="button">Recently added</button>
            <button className="button button--ghost" aria-pressed={filters.ordering === "-updated_at"} onClick={() => selectOrdering("-updated_at")} type="button">Recently updated</button>
          </div>

          <form className="filter-form transaction-filter-form" onSubmit={handleFilterSubmit}>
            <div className="field transaction-month-filter">
              <span className="field__label">Month</span>
              <span className="month-navigator" aria-busy={isRefreshing}>
                <button aria-label="Previous month" onClick={() => selectMonth(-1)} type="button"><CaretLeft aria-hidden="true" size={18} /></button>
                <input
                  className="field__control"
                  name="month"
                  onChange={(event) => void selectMonth(event.target.value)}
                  type="month"
                  value={filters.month}
                />
                <button aria-label="Next month" onClick={() => selectMonth(1)} type="button"><CaretRight aria-hidden="true" size={18} /></button>
                <button aria-label="Current month" className="month-navigator__today" disabled={filters.month === currentMonth()} onClick={() => void selectMonth(currentMonth())} title="Current month" type="button"><CalendarBlank aria-hidden="true" size={18} /></button>
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
                placeholder="Reference, person, note"
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
              <p className="section-subtitle">{displayedFilters.ordering === "-updated_at" ? "Latest saved changes first, including new entries, edits and linked transfer evidence. Transaction dates may be older." : displayedFilters.ordering === "-created_at" ? "Newest ledger additions first. Transaction dates may be older; edits do not change added time." : "Showing records by transaction date from the authenticated backend API."}</p>
              {isRefreshing ? <span className="transaction-refresh-state"><ButtonBusy label={`Loading ${requestedFilters.month || "all months"}. Showing ${displayedFilters.month || "all months"} results until ready.`} /></span> : null}
              {refreshError ? <div className="transaction-refresh-error" role="alert"><p className="form-error">{refreshError} Showing {displayedFilters.month || "all months"} results.</p><button className="button button--ghost button--small" onClick={() => void loadData(requestedFilters, false)} type="button">Retry loading transactions</button></div> : null}
            </div>
            {identifierView.control}
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
            <div className="table-wrap" aria-busy={isRefreshing}>
              <table className="data-table">
                <thead>
                  <tr>
                    {displayedFilters.ordering === "-created_at" ? <th>Added</th> : null}
                    {displayedFilters.ordering === "-updated_at" ? <th>Updated</th> : null}
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
                      {displayedFilters.ordering !== "-date" ? <td><time dateTime={displayedFilters.ordering === "-updated_at" ? transaction.updated_at : transaction.created_at}>{activityTimeFormatter.format(new Date(displayedFilters.ordering === "-updated_at" ? transaction.updated_at : transaction.created_at))}</time></td> : null}
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
                        {transaction.needs_review ? <span className="status-badge status-badge--idle">Needs review</span> : null}
                      </td> : null}
                      {visibleColumns.includes("account") ? <td>{accountNames.get(transaction.account) ?? "Unknown"}{transaction.type === "transfer" ? ` → ${accountNames.get(transaction.transfer_account ?? "") ?? "Unknown"}` : ""}</td> : null}
                      {visibleColumns.includes("category") ? <td>
                        {transaction.category
                          ? categoryNames.get(transaction.category) ?? "Unknown"
                          : "None"}
                      </td> : null}
                      {visibleColumns.includes("source") ? <td>{transaction.source}</td> : null}
                      {visibleColumns.includes("balance") ? <td>
                        {transaction.type === "transfer" && transaction.transfer_evidence.length ? transaction.transfer_evidence.map((item) => <span className="transaction-ledger-secondary" key={item.id}>{accountNames.get(item.account)}: {item.balance_after === null ? "No reported balance" : moneyFormatter.format(Number(item.balance_after))}{item.reference ? ` · ${item.reference}` : ""}</span>) : transaction.balance_after
                          ? moneyFormatter.format(Number(transaction.balance_after))
                          : "-"}
                      </td> : null}
                      {visibleColumns.includes("senderIdentifiers") ? <td><span className="transaction-ledger-primary">{identifierView.format(transaction.sender_account_identifier, identifierLabel(transaction.sender_account_identifier, "account", loadState.paymentMethods, accountNames, transaction.direction === "debit" ? transaction.account : undefined))}</span><span className="transaction-ledger-secondary">{transaction.sender_card_identifier ? `Card ${identifierView.format(transaction.sender_card_identifier, identifierLabel(transaction.sender_card_identifier, "card", loadState.paymentMethods, accountNames, transaction.direction === "debit" ? transaction.account : undefined))}` : "No card identifier"}</span></td> : null}
                      {visibleColumns.includes("receiverIdentifiers") ? <td><span className="transaction-ledger-primary">{identifierView.format(transaction.receiver_account_identifier, identifierLabel(transaction.receiver_account_identifier, "account", loadState.paymentMethods, accountNames, (transaction.type === "transfer" ? transaction.transfer_account ?? undefined : transaction.direction === "credit" ? transaction.account : undefined)))}</span><span className="transaction-ledger-secondary">{transaction.receiver_card_identifier ? `Card ${identifierView.format(transaction.receiver_card_identifier, identifierLabel(transaction.receiver_card_identifier, "card", loadState.paymentMethods, accountNames, (transaction.type === "transfer" ? transaction.transfer_account ?? undefined : transaction.direction === "credit" ? transaction.account : undefined)))}` : "No card identifier"}</span></td> : null}
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
