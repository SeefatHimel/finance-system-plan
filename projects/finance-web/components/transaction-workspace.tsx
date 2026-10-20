"use client";
import { displayLabel, formatCurrency, formatCalendarDate, formatClockTime, formatTimestamp } from "../../finance-contracts/presentation";

import { QuickTimePicker } from "./quick-time-picker";
import { CalendarDateInput } from "@/components/calendar-date-input";
import { useQuickAdd } from "./quick-add";
import { localDay, localTime } from "../../finance-contracts/quick-add";

import { identifierLabel, useIdentifierView } from "@/components/identifier-view";

import { RecentTransactionAction, useTransactionRecovery } from "@/components/transaction-recovery";
import { useRouter, useSearchParams } from "next/navigation";
import { useFeedbackMessage } from "@/components/toast-provider";

import { Plus, SlidersHorizontal, X } from "@phosphor-icons/react";
import type React from "react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  type Account,
  type Category,
  type Transaction,
  type TransactionSourceMessage,
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
  getTransaction,
  type TransactionFilters,
  type TransactionSource,
  type TransactionType,
  updateTransaction
} from "@/lib/api";
import { ModalDialog } from "@/components/modal-dialog";
import { HelpTooltip } from "@/components/help-tooltip";
import { TransferBalanceFields } from "@/components/transfer-balance-fields";
import { TransferMatchDialog } from "@/components/transfer-match-dialog";
import { transferComparison } from "../../finance-contracts/transfer-comparison";
import { getAccessToken } from "@/lib/auth-storage";
import { ButtonBusy, LoadingState } from "@/components/loading-state";
import { TransactionSourceMessages } from "@/components/transaction-source-messages";
import { TransactionRevalidationDialog } from "@/components/transaction-revalidation";
import { TransactionIssueAudit } from "@/components/transaction-issue-audit";
import { smsEvidenceWarnings } from "@/lib/sms-evidence-review";
import { TransactionStatementEvidence } from "@/components/transaction-statement-evidence";
import { useCategoryTypeChoice } from "@/components/use-category-type-choice";
import { directionForType, transactionTypes } from "@/lib/category-type";
import { accountBoundBalances, editableReportedBalance, transferBalancePayload } from "@/lib/transaction-balances";
import { DatePeriodControls } from "@/components/date-period-controls";
import { periodFromFilters, periodLabel, type DatePeriod } from "@/lib/date-period";
import { LatestRequest, type RequestTicket } from "@/lib/latest-request";

import { FieldError } from "@/components/field-error";
import { fieldErrorsFrom, focusFieldError, nativeFieldErrors } from "@/lib/form-feedback";
import { reviewFieldErrors } from "@/lib/review-status";

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

const allTransactionColumns = transactionColumns.map((column) => column.id);
const defaultTransactionColumns: TransactionColumn[] = ["date", "time", "description", "account", "category", "amount"];
const transactionColumnsStorageKey = "finance.transactions.columns.v1";

type TransactionFilterState = Required<Pick<TransactionFilters, "direction" | "source" | "type">> & {
  account: string;
  category: string;
  month: string;
  start_date: string;
  end_date: string;
  date_field: "date" | "created_at" | "updated_at";
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

function formatTransactionTime(value: string | null) {
  if (!value) return "—";
  const time = formatClockTime(value);
  return time === "Not reported" ? time : time.slice(0, 5);
}

function persistVisibleColumns(columns: TransactionColumn[]) {
  try {
    window.localStorage.setItem(transactionColumnsStorageKey, JSON.stringify(columns));
  } catch {
    // Column preferences are optional when browser storage is unavailable.
  }
}

export function TransactionWorkspace() {
  const recovery = useTransactionRecovery();
  const router = useRouter();
  const searchParams = useSearchParams();
  const editorForm = useRef<HTMLFormElement>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const feedback = (field: string) => ({ "aria-invalid": Boolean(fieldErrors[field]), "aria-describedby": fieldErrors[field] ? `transaction-error-${field}` : undefined });
  const saveInFlight = useRef(false);
  const saveKey = useRef("");
  const editLoad = useRef<AbortController>();
  const [editingRecord, setEditingRecord] = useState<Transaction | null>(null);
  const [reportingAccount, setReportingAccount] = useState("");
  const quickAdd = useQuickAdd();
  const { fullDraft, consumeFullDraft } = quickAdd;
  const [filters, setFilterState] = useState<TransactionFilterState>({
    account: "",
    category: "",
    direction: "",
    month: currentMonth(),
    start_date: "",
    end_date: "",
    date_field: "date",
    ordering: "-date",
    search: "",
    source: "",
    type: ""
  });
  const [advancedFiltersOpen, setAdvancedFiltersOpen] = useState(false);
  const [dateView, setDateView] = useState<DatePeriod["mode"]>("monthly");
  const filtersRef = useRef(filters);
  const setFilters = useCallback((next: TransactionFilterState) => {
    filtersRef.current = next;
    setFilterState(next);
  }, []);
  const dataRequests = useRef(new LatestRequest());
  const readyData = useRef<Extract<LoadState, { status: "ready" }> | null>(null);
  const [displayedFilters, setDisplayedFilters] = useState(filters);
  const [requestedFilters, setRequestedFilters] = useState(filters);
  const [revalidationId, setRevalidationId] = useState<string | null>(null);
  const [refreshError, setRefreshError] = useFeedbackMessage("error");
  const [loadState, setLoadState] = useState<LoadState>({ status: "loading" });
  const [transferDecision, setTransferDecision] = useState<{ input: CreateTransactionInput; matches: TransferMatch[]; mergeId?: string } | null>(null);
  const [matchError, setMatchError] = useFeedbackMessage("error");
  const [formError, setFormError] = useFeedbackMessage("error");
  const [formMessage, setFormMessage] = useFeedbackMessage("success");
  const [clockEdit, setClockEdit] = useState<{ value: string } | null>(null);
  const [editorMode, setEditorMode] = useState<"create" | "edit" | null>(null);
  const [evidenceTransaction, setEvidenceTransaction] = useState<Transaction | null>(null);
  const [editingReportedBalances, setEditingReportedBalances] = useState<Record<string, string>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isUpdating, setIsUpdating] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [exportMessage, setExportMessage] = useFeedbackMessage("success");
  const [deletingTransactionId, setDeletingTransactionId] = useState<string | null>(null);
  const [editingTransactionId, setEditingTransactionId] = useState("");
  const [editingSourceMessages, setEditingSourceMessages] = useState<TransactionSourceMessage[] | null>(null);
  const [editingSourceError, setEditingSourceError] = useState("");
  const [sourceWarningsReviewed, setSourceWarningsReviewed] = useState(false);
  const [editingDate, setEditingDate] = useState("");
  const [editingTime, setEditingTime] = useState("");
  const [editingType, setEditingType] = useState<TransactionType>("expense");
  const [editingDirection, setEditingDirection] = useState<TransactionDirection>("debit");
  const [editingAccountId, setEditingAccountId] = useState("");
  const [editingTransferAccountId, setEditingTransferAccountId] = useState("");
  const transferAccountDraft = useRef<{ from: string; to: string } | null>(null);
  const [editingCategoryId, setEditingCategoryId] = useState("");
  const [editingAmount, setEditingAmount] = useState("");
  const [editingBalanceAfter, setEditingBalanceAfter] = useState("");
  const [editingBalanceNotice, setEditingBalanceNotice] = useState("");
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

  function changeEditingContext(patch: Partial<{ type: TransactionType; account: string; transfer_account: string }>) {
    const before = { type: editingType, account: editingAccountId, transfer_account: editingTransferAccountId };
    const after = { ...before, ...patch };
    if (after.account !== before.account) setEditingPaymentMethodId("");
    setEditingBalanceAfter(editingReportedBalances[after.account] ?? "");
    setEditingBalanceNotice(after.type !== "transfer" && after.account !== before.account && editingBalanceAfter && !editingReportedBalances[after.account] ? "The reporting account changed. Enter its reported balance if available." : "");
    if (editorMode === "create" && after.type !== "transfer") setReportingAccount(after.account);
    setEditingType(after.type);
    setEditingAccountId(after.account);
    setEditingTransferAccountId(after.transfer_account);
    setAllowLinkedCorrection(false);
  }

  function changeEditingType(type: TransactionType) {
    if (type === editingType) return;
    if (type === "transfer") {
      setReportingAccount(editingAccountId);
      const saved = transferAccountDraft.current;
      if (saved && [saved.from, saved.to].includes(editingAccountId)) {
        changeEditingContext({ type, account: saved.from, transfer_account: saved.to });
      } else if (editingDirection === "credit") {
        changeEditingContext({ type, account: "", transfer_account: editingAccountId });
      } else {
        changeEditingContext({ type, transfer_account: "" });
      }
      setEditingPaymentMethodId("");
    } else if (editingType === "transfer") {
      transferAccountDraft.current = { from: editingAccountId, to: editingTransferAccountId };
      changeEditingContext({ type, account: directionForType(type) === "credit" ? editingTransferAccountId : editingAccountId, transfer_account: "" });
    } else {
      changeEditingContext({ type, transfer_account: "" });
    }
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
      month: searchParams.has("start_date") || searchParams.has("end_date") ? "" : searchParams.has("month") ? searchParams.get("month") ?? "" : requestedSearch || ordering !== "-date" ? "" : currentMonth(),
      start_date: searchParams.get("start_date") ?? "",
      end_date: searchParams.get("end_date") ?? "",
      date_field: searchParams.get("date_field") === "created_at" ? "created_at" : searchParams.get("date_field") === "updated_at" ? "updated_at" : "date",
      ordering,
      search: requestedSearch,
      source: (searchParams.get("source") ?? "") as TransactionFilterState["source"],
      type: (searchParams.get("type") ?? "") as TransactionFilterState["type"]
    };
    setFilters(requestedFilters);
    setDateView(periodFromFilters(requestedFilters, searchParams.get("date_view") ?? undefined).mode);
    void loadData(requestedFilters);
    return () => requests.cancel();
  }, [loadData, setFilters]);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(transactionColumnsStorageKey);
      if (!stored) return;
      const parsed = JSON.parse(stored) as unknown;
      if (!Array.isArray(parsed)) return;
      const allowed = new Set<TransactionColumn>(allTransactionColumns);
      const restored = parsed.filter((value): value is TransactionColumn =>
        typeof value === "string" && allowed.has(value as TransactionColumn)
      );
      if (restored.length > 0) setVisibleColumns(restored);
    } catch {
      // Fall back to the compact default table when storage is unavailable.
    }
  }, []);

  useEffect(() => {
    const refresh = () => { void loadData(filtersRef.current); };
    window.addEventListener("finance:transactions-changed", refresh);
    return () => window.removeEventListener("finance:transactions-changed", refresh);
  }, [loadData]);
  const openNewTransaction = useCallback((defaults?: { type: TransactionType; account: string; category: string; amount: string; note: string; counterparty_text: string; date: string; time: string }) => {
    editLoad.current?.abort();
    transferAccountDraft.current = null;
    saveKey.current = `manual-entry:${crypto.randomUUID()}`;
    setEditingRecord(null); setEditingTransactionId("");
    setEditingSourceMessages(null); setEditingSourceError(""); setSourceWarningsReviewed(false);
    setEditingDate(defaults?.date ?? currentDate()); setEditingTime(defaults?.time ?? currentTime());
    setEditingType(defaults?.type ?? "expense"); setEditingDirection(directionForType(defaults?.type ?? "expense"));
    setEditingAccountId(defaults?.account ?? ""); setReportingAccount(defaults?.account ?? ""); setEditingTransferAccountId("");
    setEditingCategoryId(defaults?.category ?? ""); setEditingAmount(defaults?.amount ?? "");
    setEditingBalanceAfter(""); setEditingReportedBalances({}); setEditingBalanceNotice("");
    setEditingReference(""); setEditingCounterpartyText(defaults?.counterparty_text ?? ""); setEditingNote(defaults?.note ?? "");
    setEditingPaymentMethodId(""); setEditingSource("web"); setEditingNeedsReview(false); setAllowLinkedCorrection(false);
    setEditingSenderAccountIdentifier(""); setEditingSenderCardIdentifier(""); setEditingReceiverAccountIdentifier(""); setEditingReceiverCardIdentifier("");
    setFieldErrors({}); setFormError(null); setFormMessage(null); setEditorMode("create");
  }, [setFormError, setFormMessage]);
  useEffect(() => {
    if (!fullDraft) return;
    openNewTransaction({ ...fullDraft, date: fullDraft.dateMode === "today" ? localDay() : fullDraft.date,
      time: fullDraft.timeMode === "now" ? localTime() : fullDraft.timeMode === "none" ? "" : fullDraft.time });
    consumeFullDraft();
  }, [fullDraft, consumeFullDraft, openNewTransaction]);
  function closeEditor() {
    editLoad.current?.abort();
    setEditorMode(null);
    if (searchParams.has("edit")) {
      const params = new URLSearchParams(searchParams); params.delete("edit");
      router.replace(`/transactions${params.size ? `?${params}` : ""}`, { scroll: false });
    }
  }

  function handleFilterSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    applyFilterUrl(filtersRef.current);
    void loadData(filtersRef.current, false);
  }

  function applyFilterUrl(nextFilters: TransactionFilterState, view = dateView) {
    const params = new URLSearchParams();
    params.set("month", nextFilters.month);
    params.set("date_view", view);
    Object.entries(nextFilters).forEach(([key, value]) => {
      if (value) params.set(key, value);
    });
    window.history.replaceState(null, "", `${window.location.pathname}${params.size ? `?${params.toString()}` : ""}`);
  }

  function selectPeriod(period: DatePeriod) {
    setDateView(period.mode);
    const nextFilters = { ...filtersRef.current,
      month: period.mode === "monthly" ? period.start.slice(0, 7) : "",
      start_date: period.mode === "daily" || period.mode === "custom" ? period.start : "",
      end_date: period.mode === "daily" || period.mode === "custom" ? period.end : ""
    };
    setFilters(nextFilters);
    applyFilterUrl(nextFilters, period.mode);
    markPending(nextFilters);
    dataRequests.current.schedule((ticket) => { void requestData(nextFilters, false, ticket); }, 250);
  }

  function selectOrdering(ordering: TransactionFilterState["ordering"]) {
    const nextFilters: TransactionFilterState = { ...filtersRef.current, ordering, month: ordering !== "-date" ? "" : currentMonth(), start_date: "", end_date: "", date_field: ordering === "-created_at" ? "created_at" : ordering === "-updated_at" ? "updated_at" : "date" };
    setDateView(ordering === "-date" ? "monthly" : "all");
    setFilters(nextFilters);
    applyFilterUrl(nextFilters, ordering === "-date" ? "monthly" : "all");
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
      start_date: "",
      end_date: "",
      date_field: filtersRef.current.date_field,
      ordering: filtersRef.current.ordering,
      search: "",
      source: "",
      type: ""
    };
    setDateView("all");
    setFilters(clearedFilters);
    applyFilterUrl(clearedFilters, "all");
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
      link.download = `transactions-${filters.month || (filters.start_date ? `${filters.start_date}-to-${filters.end_date}` : "all")}.csv`;
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

  async function handleTransferDecision(match?: TransferMatch, balanceChoices: import("@/lib/api").TransferBalanceChoice[] = []) {
    const accessToken = getAccessToken();
    if (!accessToken || !transferDecision || saveInFlight.current) return;
    saveInFlight.current = true;
    setIsSubmitting(true);
    setMatchError(null);
    try {
      if (transferDecision.mergeId) {
        if (match) { const saved = await mergeTransfers(accessToken, match.id, transferDecision.mergeId, balanceChoices); recovery.announce(saved.undo_action); }
      } else if (match) {
        const saved = await linkTransfer(accessToken, { draft: transferDecision.input }, match, balanceChoices); recovery.announce(saved.undo_action);
      } else {
        const saved = await createTransaction(accessToken, transferDecision.input); recovery.announce(saved.undo_action);
      }
      setTransferDecision(null);
      closeEditor();
      await loadData(filters);
    } catch (error) {
      setMatchError(error instanceof Error ? error.message : "Could not link transfer.");
    } finally {
      saveInFlight.current = false;
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
        amount: record.amount, date: record.date, time: record.time, reference: record.reference,
        reported_balances: transferBalancePayload(record.account, record.transfer_account ?? "", accountBoundBalances(record)),
        counterparty_text: record.counterparty_text, note: record.note, direction: "debit", type: "transfer" };
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
      `Delete ${displayLabel(transaction.type)} transaction on ${formatCalendarDate(transaction.date)}?`
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

  const selectTransactionForEdit = useCallback(async (transactionId: string) => {
    const token = getAccessToken(); if (!token) return;
    editLoad.current?.abort();
    const controller = new AbortController(); editLoad.current = controller;
    try {
    const transaction = await getTransaction(token, transactionId, controller.signal);
    if (controller.signal.aborted) return;
    setEditingRecord(transaction);
    setEditingTransactionId(transactionId);
    setEditingSourceMessages(null); setEditingSourceError(""); setSourceWarningsReviewed(false);
    transferAccountDraft.current = null;
    setEditingDate(transaction.date);
    setEditingTime(transaction.time ?? "");
    setEditingType(transaction.type as TransactionType);
    setEditingDirection(transaction.direction as TransactionDirection);
    setEditingAccountId(transaction.account);
    setEditingTransferAccountId(transaction.transfer_account ?? "");
    setEditingCategoryId(transaction.category ?? "");
    setEditingAmount(transaction.amount);
    setEditingBalanceAfter(editableReportedBalance(transaction));
    setEditingReportedBalances(accountBoundBalances(transaction));
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
    setFieldErrors({}); setEditorMode("edit");
    } catch (error) { if (!controller.signal.aborted) setFormError(error instanceof Error ? error.message : "Could not load this transaction."); }
  }, [setFormError, setFormMessage]);
  useEffect(() => () => editLoad.current?.abort(), []);
  const editId = searchParams.get("edit");
  useEffect(() => { if (editId) void selectTransactionForEdit(editId); }, [editId, selectTransactionForEdit]);

  async function handleSave(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saveInFlight.current) return;
    const token = getAccessToken();
    if (!token) return setFormError("Sign in before saving a transaction.");
    if (editorMode === "edit" && editingSourceMessages === null) {
      setFormError(editingSourceError
        ? "Could not check attached SMS. Open Original SMS and retry loading it before saving."
        : "Wait for the attached SMS check to finish before saving.");
      return;
    }
    if (sourceWarnings.length && !sourceWarningsReviewed) {
      setFormError("Review the SMS evidence warnings and confirm your choice before saving.");
      return;
    }
    const errors = { ...nativeFieldErrors(event.currentTarget), ...reviewFieldErrors({ account: editingAccountId, other: editingTransferAccountId, amount: editingAmount, type: editingType, category: editingCategoryId }) };
    if (Object.keys(errors).length) {
      setFieldErrors(errors); setFormError("Check the highlighted fields."); focusFieldError(event.currentTarget, errors); return;
    }
    setFieldErrors({});
    saveInFlight.current = true; setIsUpdating(true); setFormError(null); setFormMessage(null);
    const input = {
      account: editingAccountId, amount: editingAmount,
      ...(editingType === "transfer" ? { reported_balances: transferBalancePayload(editingAccountId, editingTransferAccountId, editingReportedBalances) } : { balance_after: editingBalanceAfter || null }),
      counterparty_text: editingCounterpartyText, date: editingDate, time: editingTime || null,
      direction: editingDirection, note: editingNote, payment_method: editingPaymentMethodId || null,
      sender_account_identifier: editingSenderAccountIdentifier, sender_card_identifier: editingSenderCardIdentifier,
      receiver_account_identifier: editingReceiverAccountIdentifier, receiver_card_identifier: editingReceiverCardIdentifier,
      source: editingSource, needs_review: editingNeedsReview, reference: editingReference, type: editingType
    };
    try {
      let saved: Transaction;
      if (editorMode === "create") {
        const draft: CreateTransactionInput = { ...input, external_key: saveKey.current,
          category: editingCategoryId || undefined, transfer_account: editingType === "transfer" ? editingTransferAccountId : undefined };
        if (editingType === "transfer") {
          const matches = await findTransferMatches(token, { draft });
          if (matches.length) { setMatchError(null); setTransferDecision({ input: draft, matches }); return; }
        }
        saved = await createTransaction(token, draft);
      } else {
        saved = await updateTransaction(token, editingTransactionId, { ...input,
          allow_linked_correction: allowLinkedCorrection, category: editingCategoryId || null,
          transfer_account: editingType === "transfer" ? editingTransferAccountId : null });
      }
      closeEditor(); recovery.announce(saved.undo_action); await loadData(filtersRef.current);
    } catch (error) {
      const errors = fieldErrorsFrom(error); setFieldErrors(errors); focusFieldError(editorForm.current, errors);
      setFormError(error instanceof Error ? error.message : "Could not save transaction.");
    }
    finally { saveInFlight.current = false; setIsUpdating(false); }
  }

  const accountNames = useMemo(() => {
    if (loadState.status !== "ready") {
      return new Map<string, string>();
    }
    return new Map(loadState.accounts.map((account) => [account.id, account.name]));
  }, [loadState]);

  const currencyByAccount = useMemo(() => new Map(loadState.status === "ready" ? loadState.accounts.map(account => [account.id, account.currency]) : []), [loadState]);

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

  const advancedFilterCount = [filters.type, filters.direction, filters.source, filters.category, filters.date_field !== "date" ? filters.date_field : ""].filter(Boolean).length;
  const hasUnappliedFilters = (["search", "account", "type", "direction", "source", "category", "date_field"] as const).some(key => filters[key] !== displayedFilters[key]);
  const appliedFilterSummary = [displayedFilters.type, displayedFilters.direction, displayedFilters.source,
    displayedFilters.category ? categoryNames.get(displayedFilters.category) ?? "Selected category" : "", displayedFilters.date_field === "date" ? "" : displayedFilters.date_field === "created_at" ? "Added date" : "Updated date"].filter(Boolean).join(" · ");

  const editingTransaction = editingRecord ?? undefined;
  const sourceWarnings = editorMode === "edit" && loadState.status === "ready" ? smsEvidenceWarnings({
    account: loadState.accounts.find(account => account.id === editingAccountId),
    categoryName: loadState.categories.find(category => category.id === editingCategoryId)?.name ?? "",
    counterparty: editingCounterpartyText,
    methods: loadState.paymentMethods,
    note: editingNote,
    sources: editingSourceMessages,
    transactionType: editingType,
  }) : [];
  const balanceAccountId = editingAccountId;
  const requiresLinkedCorrection = Boolean(editingTransaction && (
    editingTransaction.statement_evidence_count > 0 || (editingTransaction.transfer_evidence.length > 1 &&
    (editingTransaction.type === "transfer" || editingType === "transfer"))) && (
      editingTransaction.type !== editingType || editingTransaction.account !== editingAccountId ||
      editingTransaction.transfer_account !== (editingType === "transfer" ? editingTransferAccountId || null : null) ||
      Number(editingTransaction.amount) !== Number(editingAmount) ||
      (editingTransaction.statement_evidence_count > 0 && editingTransaction.direction !== editingDirection)
    ));

  function columnContent(column: TransactionColumn, transaction: Transaction) {
    const methods = loadState.status === "ready" ? loadState.paymentMethods : [];
    switch (column) {
      case "date": return <time dateTime={transaction.date}>{formatCalendarDate(transaction.date)}</time>;
      case "time": return formatTransactionTime(transaction.time);
      case "description": return <><span className="transaction-ledger-primary">{transaction.counterparty_text || transaction.reference || transaction.note || displayLabel(transaction.type)}</span><span className="transaction-ledger-secondary">{displayLabel(transaction.type)} · {transaction.type === "transfer" && !displayedFilters.account ? "Internal movement" : displayLabel(transaction.account_direction)}{transaction.reference ? ` · ${transaction.reference}` : ""}</span>{transaction.needs_review ? <span className="status-badge status-badge--idle">Needs review</span> : null}</>;
      case "account": return <>{accountNames.get(transaction.account) ?? "Unknown"}{transaction.type === "transfer" ? ` → ${accountNames.get(transaction.transfer_account ?? "") ?? "Unknown"}` : ""}</>;
      case "category": return transaction.category ? categoryNames.get(transaction.category) ?? "Unknown" : "None";
      case "source": return displayLabel(transaction.source);
      case "balance": return transaction.type === "transfer" && transaction.transfer_evidence.length ? transaction.transfer_evidence.map(item => <span className="transaction-ledger-secondary" key={item.id}>{accountNames.get(item.account)}: {item.balance_after === null ? "No reported balance" : formatCurrency(item.balance_after, currencyByAccount.get(item.account))}{item.reference ? ` · ${item.reference}` : ""}</span>) : transaction.balance_after !== null ? formatCurrency(transaction.balance_after, currencyByAccount.get(transaction.account)) : "—";
      case "senderIdentifiers": return <><span>{identifierView.format(transaction.sender_account_identifier, identifierLabel(transaction.sender_account_identifier, "account", methods, accountNames, transaction.direction === "debit" ? transaction.account : undefined))}</span><span className="transaction-ledger-secondary">{transaction.sender_card_identifier ? `Card ${identifierView.format(transaction.sender_card_identifier, identifierLabel(transaction.sender_card_identifier, "card", methods, accountNames, transaction.direction === "debit" ? transaction.account : undefined))}` : "No card identifier"}</span></>;
      case "receiverIdentifiers": {
        const account = transaction.type === "transfer" ? transaction.transfer_account ?? undefined : transaction.direction === "credit" ? transaction.account : undefined;
        return <><span>{identifierView.format(transaction.receiver_account_identifier, identifierLabel(transaction.receiver_account_identifier, "account", methods, accountNames, account))}</span><span className="transaction-ledger-secondary">{transaction.receiver_card_identifier ? `Card ${identifierView.format(transaction.receiver_card_identifier, identifierLabel(transaction.receiver_card_identifier, "card", methods, accountNames, account))}` : "No card identifier"}</span></>;
      }
      case "amount": return <>{transaction.type === "transfer" && !displayedFilters.account ? "" : transaction.account_direction === "credit" ? "+" : "−"}{formatCurrency(transaction.amount, currencyByAccount.get(transaction.account))}</>;
    }
  }
  function amountClass(transaction: Transaction) {
    return `transaction-ledger-amount${transaction.type === "transfer" && !displayedFilters.account ? " transaction-ledger-amount--transfer" : transaction.account_direction === "credit" ? " transaction-ledger-amount--credit" : ""}`;
  }
  function activityTime(transaction: Transaction) {
    const stamp = displayedFilters.ordering === "-updated_at" ? transaction.updated_at : transaction.created_at;
    return <time dateTime={stamp}>{formatTimestamp(stamp)}</time>;
  }
  function transactionActions(transaction: Transaction) {
    return <div className="list-row__actions">
      {transaction.statement_evidence_count > 0 || transaction.raw_message || transaction.transfer_evidence.some(item => item.raw_message) ? <button className="button button--ghost" onClick={() => setEvidenceTransaction(transaction)} type="button">Sources</button> : null}
      {transaction.type === "transfer" ? <button className="button button--ghost" disabled={isSubmitting} onClick={() => void handleFindPostedMatch(transaction)} type="button">Find match</button> : null}
      <button className="button button--ghost" onClick={() => void selectTransactionForEdit(transaction.id)} type="button">Edit</button>
      <button className="button button--ghost" onClick={() => setRevalidationId(transaction.id)} type="button">Revalidate</button>
      <Link className="button button--ghost" href={`/audit-logs?entity_type=transactions.transaction&entity_id=${transaction.id}`}>History</Link>
      <button className="button button--danger" disabled={deletingTransactionId === transaction.id} onClick={() => void handleDeleteTransaction(transaction)} type="button">{deletingTransactionId === transaction.id ? <ButtonBusy label="Deleting" /> : "Delete"}</button>
    </div>;
  }

  return (
    <div className="workspace-grid">
      {revalidationId ? <TransactionRevalidationDialog key={revalidationId} transactionId={revalidationId} onClose={() => setRevalidationId(null)} /> : null}
      {categoryChoice.confirmation}
      {clockEdit ? <QuickTimePicker value={clockEdit.value} onCancel={() => setClockEdit(null)} onApply={time => { setEditingTime(time); setClockEdit(null); }} /> : null}
      {evidenceTransaction ? <ModalDialog labelledBy="transaction-sources-title" className="form-drawer transaction-sources-dialog" onCancel={() => setEvidenceTransaction(null)}>
        <div className="form-drawer__header"><div><h2 id="transaction-sources-title">Attached sources</h2><p>{formatCalendarDate(evidenceTransaction.date)} · {accountNames.get(evidenceTransaction.account) ?? "Account"} · {formatCurrency(evidenceTransaction.amount, currencyByAccount.get(evidenceTransaction.account))}</p></div><button className="icon-button" type="button" aria-label="Close attached sources" onClick={() => setEvidenceTransaction(null)}><X aria-hidden="true" size={20} /></button></div>
        <div className="transaction-sources-dialog__body"><p className="inline-note">These are the saved source observations for this ledger entry. Viewing them does not change the transaction.</p>
          {evidenceTransaction.raw_message || evidenceTransaction.transfer_evidence.some(item => item.raw_message) ? <TransactionSourceMessages key={`sources-${evidenceTransaction.id}`} transactionId={evidenceTransaction.id} expanded showEmpty /> : null}
          {evidenceTransaction.statement_evidence_count > 0 ? <TransactionStatementEvidence key={`statement-sources-${evidenceTransaction.id}`} transactionId={evidenceTransaction.id} expanded /> : null}
        </div>
      </ModalDialog> : null}
      {editorMode ? (
        <ModalDialog labelledBy="transaction-editor-title" className="form-drawer transaction-editor-drawer" busy={isSubmitting || isUpdating} onCancel={closeEditor}>
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
                {editorMode === "edit" ? <p className="transaction-editor-context"><strong>{accountNames.get(editingAccountId) ?? "Choose account"}</strong> · BDT {editingAmount || "—"} · {editingDate}{editingTime ? ` · ${editingTime.slice(0, 5)}` : ""}</p> : null}
                {requiresLinkedCorrection ? <p className="transaction-editor-warning">This changes a linked ledger entry. Review its source evidence and confirm the correction before saving.</p> : null}
                {formError ? <p className="form-error" role="alert">{formError}</p> : null}
              </div>
              <button
                aria-label="Close transaction editor"
                autoFocus
                className="icon-button"
                disabled={isSubmitting || isUpdating}
                onClick={closeEditor}
                type="button"
              >
                <X aria-hidden="true" size={20} />
              </button>
            </div>

          <form className="transaction-form drawer-form" noValidate ref={editorForm} onSubmit={handleSave}
            onChangeCapture={event => {
              const target = event.target as HTMLInputElement;
              if (target.name) setFieldErrors(current => { const next = { ...current }; delete next[target.name]; return next; });
              if (["account", "category", "counterparty_text", "note"].includes(target.name)) setSourceWarningsReviewed(false);
            }}>
            <div className="transaction-editor-scroll compact-editor"><div className="transaction-editor-fields compact-editor-grid">
            {editorMode === "edit" ? <TransactionSourceMessages key={editingTransactionId} transactionId={editingTransactionId} onMessages={setEditingSourceMessages} onLoadError={setEditingSourceError} /> : null}
            {editorMode === "edit" && editingSourceMessages === null ? <p className="field--wide" role="status">{editingSourceError ? "SMS check failed. Open Original SMS and retry before saving." : "Checking attached SMS before this entry can be saved…"}</p> : null}
            {sourceWarnings.length ? <div className="transaction-source-warning field--wide" role="alert">
              <strong>Check this entry against its SMS</strong>
              <ul>{sourceWarnings.map(warning => <li key={warning}>{warning}</li>)}</ul>
              <label><input checked={sourceWarningsReviewed} onChange={event => setSourceWarningsReviewed(event.target.checked)} type="checkbox" /> I checked the source and want to save these details</label>
            </div> : null}
            {editingTransaction?.statement_evidence_count ? <TransactionStatementEvidence key={`statement-${editingTransactionId}`} transactionId={editingTransactionId} /> : null}
            <div className="transaction-datetime compact-editor-datetime" role="group" aria-label="Date and time">
              <label className="field">
                <span className="field__label">Date</span>
                <CalendarDateInput name="date" {...feedback("date")}
                  onChange={setEditingDate}
                  required
                  value={editingDate}
                /><FieldError field="date" errors={fieldErrors} />
              </label>

              <div className="field">
                <label className="field__label" htmlFor="edit-transaction-time">Time</label>
                <input name="time" {...feedback("time")} id="edit-transaction-time" step="1" className="field__control" onChange={event => setEditingTime(event.target.value)} type="time" value={editingTime} /><FieldError field="time" errors={fieldErrors} />
                <button className="quick-see-all" type="button" onClick={() => setClockEdit({ value: editingTime || currentTime() })}>Choose time on clock</button>
              </div>
            </div>

            <div className="field">
              <label className="field__label" htmlFor="edit-transaction-type">Type</label>
              <select id="edit-transaction-type"
                name="type" {...feedback("type")}
                className="field__control"
                onChange={(event) => changeEditingType(event.target.value as TransactionType)}
                required
                value={editingType}
              >
                {transactionTypes.map((type) => (
                  <option key={type} value={type}>
                    {displayLabel(type)}
                  </option>
                ))}
              </select><FieldError field="type" errors={fieldErrors} />
            </div>

            <div className="field">
              <label className="field__label" htmlFor="edit-transaction-category">Category</label>
              <select id="edit-transaction-category"
                name="category" {...feedback("category")}
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
              </select><FieldError field="category" errors={fieldErrors} />
            </div>

            <div className="field">
              <label className="field__label" htmlFor="edit-transaction-account">{editingType === "transfer" ? "From account" : "Account"}</label>
              <select id="edit-transaction-account"
                name="account" {...feedback("account")}
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
              </select><FieldError field="account" errors={fieldErrors} />
            </div>

            {editingType === "transfer" ? <div className="field">
              <label className="field__label" htmlFor="edit-transaction-other-account">{editingType === "transfer" ? "To account" : "Transfer to"}</label>
              <select id="edit-transaction-other-account"
                name="transfer_account" {...feedback("transfer_account")}
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
              </select><FieldError field="transfer_account" errors={fieldErrors} />
            </div> : null}

            {editingType === "transfer" ? <div className="field transaction-direction-control">
              <span className="field__label inline-help">Direction <HelpTooltip label="About transfer direction">Money moves from From (debit) to To (credit). Transfers between tracked accounts count as neither income nor expense.</HelpTooltip></span>
              <button className="button button--ghost" onClick={() => {
                changeEditingContext({ account: editingTransferAccountId, transfer_account: editingAccountId });
                setEditingDirection("debit");
                setEditingPaymentMethodId("");
                setAllowLinkedCorrection(false);
              }} type="button">Reverse transfer direction</button>
            </div> : <div className="field">
              <label className="field__label" htmlFor="edit-transaction-direction">Debit / credit</label>
              <select id="edit-transaction-direction"
                name="direction" {...feedback("direction")}
                className="field__control"
                onChange={(event) => setEditingDirection(event.target.value as TransactionDirection)}
                required
                value={editingDirection}
              >
                <option value="debit">Debit</option>
                <option value="credit">Credit</option>
              </select><FieldError field="direction" errors={fieldErrors} />
            </div>}

            <label className="field">
              <span className="field__label">Amount</span>
              <input name="amount" {...feedback("amount")}
                className="field__control"
                min="0.01"
                inputMode="decimal"
                onChange={(event) => { setEditingAmount(event.target.value); setAllowLinkedCorrection(false); }}
                required
                type="text"
                value={editingAmount}
              /><FieldError field="amount" errors={fieldErrors} />
            </label>

            {editingType === "transfer" ? <TransferBalanceFields error={fieldErrors.reported_balances} accounts={[editingAccountId, editingTransferAccountId]} primaryAccount={editingTransaction?.balance_reporting_account ?? (reportingAccount || editingAccountId)} names={accountNames} values={editingReportedBalances} onChange={(account, value) => setEditingReportedBalances(current => ({ ...current, [account]: value }))} /> : <>            <div className="field">
              <div className="inline-help"><label className="field__label" htmlFor="edit-reported-balance">Reported balance after</label> <HelpTooltip label="About reported balance">Optional balance from this account’s report, rather than its calculated ledger balance. Leave blank if unknown.</HelpTooltip></div>
              <input name="balance_after" {...feedback("balance_after")} id="edit-reported-balance"
                className="field__control"
                inputMode="decimal"
                onChange={(event) => { setEditingBalanceAfter(event.target.value); setEditingReportedBalances(current => ({ ...current, [editingAccountId]: event.target.value })); setEditingBalanceNotice(""); }}
                type="text"
                value={editingBalanceAfter}
              /><FieldError field="balance_after" errors={fieldErrors} />
              {balanceAccountId ? <small className="field__hint">{loadState.accounts.find((account) => account.id === balanceAccountId)?.name ?? "This account"}</small> : null}
              {editingBalanceNotice ? <small className="field__hint inline-help" role="status">Balance cleared <HelpTooltip warning label="Why the balance was cleared">{editingBalanceNotice}</HelpTooltip></small> : null}
            </div></>}

            {editingTransaction?.type === "transfer" && editingTransaction.transfer_evidence.length ? <details className="raw-message field--wide">
              <summary>Saved transfer reported balances</summary>
              {editingTransaction.transfer_evidence.map((item) => <p key={item.id}><strong>{loadState.accounts.find((account) => account.id === item.account)?.name ?? "Unknown account"}</strong>: {item.balance_after === null ? "No reported balance" : formatCurrency(item.balance_after, currencyByAccount.get(item.account))}{item.is_primary ? " · Primary report" : " · Linked report"}</p>)}
              <HelpTooltip label="About saved account reports">Original account reports remain attached to their accounts. Edit a balance or expand the other account balance to add a missing report. Neither creates another money movement.</HelpTooltip>
            </details> : null}

            <label className="field">
              <span className="field__label">Merchant / counterparty</span>
              <input name="counterparty_text" {...feedback("counterparty_text")}
                className="field__control"
                onChange={(event) => setEditingCounterpartyText(event.target.value)}
                type="text"
                value={editingCounterpartyText}
              /><FieldError field="counterparty_text" errors={fieldErrors} />
            </label>

            <label className="field field--wide">
              <span className="field__label">Note</span>
              <input name="note" {...feedback("note")}
                className="field__control"
                onChange={(event) => setEditingNote(event.target.value)}
                type="text"
                value={editingNote}
              /><FieldError field="note" errors={fieldErrors} />
            </label>

            <details className="raw-message field--wide transaction-more-details"><summary>More details <span className="compact-editor-details-hint">Reference, payment method, identifiers{editingReference || editingPaymentMethodId || editingSenderAccountIdentifier || editingSenderCardIdentifier || editingReceiverAccountIdentifier || editingReceiverCardIdentifier || editingNeedsReview ? " · contains values" : ""}</span>{editingPaymentMethodId ? ` · ${loadState.paymentMethods.find(method => method.id === editingPaymentMethodId)?.name ?? "Payment method selected"}` : ""}</summary><div className="transaction-more-details__fields">
            <div className="field">
              <div className="inline-help"><label className="field__label" htmlFor="edit-transaction-reference">Reference</label> <HelpTooltip label="About references">Optional bank or wallet reference. References may repeat.</HelpTooltip></div>
              <input name="reference" {...feedback("reference")} id="edit-transaction-reference"
                aria-label="Reference"
                className="field__control"
                onChange={(event) => setEditingReference(event.target.value)}
                placeholder="e.g. DEMO-TRF-1042"
                type="text"
                value={editingReference}
              /><FieldError field="reference" errors={fieldErrors} />
            </div>

            <div className="field">
              <div className="inline-help"><label className="field__label" htmlFor="edit-payment-method">Payment method</label> <HelpTooltip label="About payment methods">Optional account-linked instrument, such as a debit card, credit card, wallet or cash. Saved identifiers and aliases help recognize SMS and statement accounts.</HelpTooltip></div>
              <select name="payment_method" {...feedback("payment_method")} id="edit-payment-method" className="field__control" onChange={(event) => setEditingPaymentMethodId(event.target.value)} value={editingPaymentMethodId}>
                <option value="">No payment method</option>
                {loadState.paymentMethods.filter((method) => method.account === editingAccountId).map((method) => <option key={method.id} value={method.id}>{method.name}</option>)}
              </select><FieldError field="payment_method" errors={fieldErrors} />
            </div>

            <label className="field">
              <span className="field__label">Source</span>
              <select name="source" {...feedback("source")} className="field__control" onChange={(event) => setEditingSource(event.target.value as TransactionSource)} value={editingSource}>
                {transactionSources.map((source) => <option key={source} value={source}>{displayLabel(source)}</option>)}
              </select><FieldError field="source" errors={fieldErrors} />
            </label>
            <fieldset className="transaction-identifier-fields field--wide">
              <legend>Masked identifiers <HelpTooltip label="About masked identifiers">Use masked values or a safe suffix. Full account and card numbers are reduced to their last four digits before saving.</HelpTooltip></legend>
              <div className="transaction-identifier-grid">
                <label className="field"><span className="field__label">Sender account</span><input name="sender_account_identifier" {...feedback("sender_account_identifier")} className="field__control" maxLength={120} onChange={(event) => setEditingSenderAccountIdentifier(event.target.value)} value={editingSenderAccountIdentifier} /><FieldError field="sender_account_identifier" errors={fieldErrors} /></label>
                <label className="field"><span className="field__label">Sender card</span><input name="sender_card_identifier" {...feedback("sender_card_identifier")} className="field__control" maxLength={120} onChange={(event) => setEditingSenderCardIdentifier(event.target.value)} value={editingSenderCardIdentifier} /><FieldError field="sender_card_identifier" errors={fieldErrors} /></label>
                <label className="field"><span className="field__label">Receiver account</span><input name="receiver_account_identifier" {...feedback("receiver_account_identifier")} className="field__control" maxLength={120} onChange={(event) => setEditingReceiverAccountIdentifier(event.target.value)} value={editingReceiverAccountIdentifier} /><FieldError field="receiver_account_identifier" errors={fieldErrors} /></label>
                <label className="field"><span className="field__label">Receiver card</span><input name="receiver_card_identifier" {...feedback("receiver_card_identifier")} className="field__control" maxLength={120} onChange={(event) => setEditingReceiverCardIdentifier(event.target.value)} value={editingReceiverCardIdentifier} /><FieldError field="receiver_card_identifier" errors={fieldErrors} /></label>
              </div>
            </fieldset>
            <label className="review-remember field--wide"><input name="needs_review" {...feedback("needs_review")} checked={editingNeedsReview} onChange={(event) => setEditingNeedsReview(event.target.checked)} type="checkbox" /><FieldError field="needs_review" errors={fieldErrors} /><span><strong>Needs review</strong><small>Keep this ledger entry marked for further checking.</small></span></label>
            </div></details>
            {requiresLinkedCorrection ? <label className="review-remember field--wide"><input name="allow_linked_correction" {...feedback("allow_linked_correction")} checked={allowLinkedCorrection} onChange={(event) => setAllowLinkedCorrection(event.target.checked)} required type="checkbox" /><FieldError field="allow_linked_correction" errors={fieldErrors} /><span><strong>I reviewed the linked evidence and confirm this ledger correction</strong><small>Reversing direction keeps reports on the same accounts. Replacing an account clears the replaced account’s report before reassignment. Original SMS and statement snapshots stay unchanged as history.</small></span></label> : null}
            </div></div>
            <div className="transaction-editor-actions">
              <span role="status">{Object.keys(fieldErrors).length ? "Check the highlighted fields." : ""}</span>
              <button className="button button--ghost" disabled={isUpdating || isSubmitting} onClick={closeEditor} type="button">Cancel</button>
              <button className="button button--primary" disabled={isUpdating || isSubmitting} type="submit">
                {isUpdating ? <ButtonBusy label="Saving" /> : editorMode === "create" ? "Save transaction" : "Update transaction"}
              </button>
            </div>
          </form>
        </ModalDialog>
      ) : null}

      <section className="panel">
        <div className="panel__body">
          <div className="report-header transaction-list-header">
            <div>
              <h2 className="section-title">Transactions</h2>
              <p className="section-subtitle">
                Search and review synced activity first. Add a manual record only when automation cannot capture it.
              </p>
            </div>
            <button
              className="button button--primary"
              onClick={() => openNewTransaction()}
              type="button"
            >
              <Plus aria-hidden="true" size={17} />
              Add transaction
            </button>
          </div>

          <RecentTransactionAction />
          <TransactionIssueAudit onRevalidate={setRevalidationId} onEdit={transactionId => void selectTransactionForEdit(transactionId)} />
          {formMessage ? <p className="form-success">{formMessage}</p> : null}

          <form className="transaction-filters" onSubmit={handleFilterSubmit}>
            <div className="transaction-filter-primary">
              <label className="field">
                <span className="field__label" id="transaction-search-label">
                  Search
                </span>
                <input
                  className="field__control"
                  name="search"
                  onChange={(event) =>
                    setFilters({ ...filters, search: event.target.value })
                  }
                  aria-labelledby="transaction-search-label"
                  maxLength={256}
                  placeholder="Search all transaction fields"
                  type="search"
                  value={filters.search}
                />
              </label>
              <label className="field">
                <span className="field__label">Account</span>
                <select
                  className="field__control"
                  name="account"
                  onChange={(event) =>
                    setFilters({ ...filters, account: event.target.value })
                  }
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
                <span className="field__label">Sort</span>
                <select
                  className="field__control"
                  aria-label="Transaction ordering"
                  value={filters.ordering}
                  onChange={(event) =>
                    selectOrdering(
                      event.target.value as TransactionFilterState["ordering"],
                    )
                  }
                >
                  <option value="-date">Transaction date</option>
                  <option value="-created_at">Recently added</option>
                  <option value="-updated_at">Recently updated</option>
                </select>
              </label>
              <button className="button button--primary" type="submit">
                Apply filters
              </button>
              <button
                className="button button--ghost"
                onClick={clearFilters}
                type="button"
              >
                Clear
              </button>
            </div>
            <DatePeriodControls
              label="Transaction dates"
              description={
                filters.date_field === "date"
                  ? "Based on transaction date"
                  : `Based on ${filters.date_field === "created_at" ? "added" : "updated"} date · Asia/Dhaka`
              }
              value={periodFromFilters(filters, dateView)}
              onChange={selectPeriod}
              compact
            />
            <details
              className="transaction-advanced-filters"
              open={advancedFiltersOpen}
              onToggle={(event) => setAdvancedFiltersOpen(event.currentTarget.open)}
            >
              <summary>
                <SlidersHorizontal aria-hidden="true" size={17} />
                More filters{advancedFilterCount ? ` (${advancedFilterCount})` : ""}
              </summary>
              <div className="transaction-filter-secondary">
                <label className="field">
                  <span className="field__label">Type</span>
                  <select
                    className="field__control"
                    name="type"
                    onChange={(event) =>
                      setFilters({
                        ...filters,
                        type: event.target.value as TransactionFilterState["type"],
                      })
                    }
                    value={filters.type}
                  >
                    <option value="">All types</option>
                    {transactionTypes.map((type) => (
                      <option key={type} value={type}>
                        {displayLabel(type)}
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
                        direction: event.target
                          .value as TransactionFilterState["direction"],
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
                      setFilters({
                        ...filters,
                        source: event.target
                          .value as TransactionFilterState["source"],
                      })
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
                  <span className="field__label">Category</span>
                  <select
                    className="field__control"
                    name="category"
                    onChange={(event) =>
                      setFilters({ ...filters, category: event.target.value })
                    }
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
                <label className="field">
                  <span className="field__label">Filter date</span>
                  <select
                    aria-label="Filter date"
                    className="field__control"
                    value={filters.date_field}
                    onChange={(event) => {
                      const nextFilters = {
                        ...filtersRef.current,
                        date_field: event.target
                          .value as TransactionFilterState["date_field"],
                      };
                      setFilters(nextFilters);
                    }}
                  >
                    <option value="date">Transaction date</option>
                    <option value="created_at">Added date</option>
                    <option value="updated_at">Updated date</option>
                  </select>
                </label>
              </div>
              <div className="transaction-filter-actions">
                <button className="button button--primary" type="submit">
                  Apply advanced filters
                </button>
                <button
                  className="button button--ghost"
                  disabled={isExporting}
                  onClick={() => void handleExportTransactions()}
                  type="button"
                >
                  {isExporting ? <ButtonBusy label="Exporting" /> : "Export CSV"}
                </button>
              </div>
            </details>
            {hasUnappliedFilters ? (
              <small className="field__hint" role="status">
                Filter changes are not applied yet.
              </small>
            ) : null}
            {appliedFilterSummary ? (
              <p className="transaction-applied-filters">{appliedFilterSummary}</p>
            ) : null}
          </form>

          {exportMessage ? <p className="section-subtitle">{exportMessage}</p> : null}

          <div className="transaction-table-toolbar">
            <div>
              <p className="section-subtitle">
                {displayedFilters.ordering === "-updated_at"
                  ? "Latest saved changes first, including new entries, edits and linked transfer evidence. Transaction dates may be older."
                  : displayedFilters.ordering === "-created_at"
                    ? "Newest ledger additions first. Transaction dates may be older; edits do not change added time."
                    : `${loadState.transactions.length} ${loadState.transactions.length === 1 ? "transaction" : "transactions"} · By transaction date`}
              </p>
              {isRefreshing ? (
                <span className="transaction-refresh-state">
                  <ButtonBusy
                    label={`Loading ${periodLabel(periodFromFilters(requestedFilters))}. Showing ${periodLabel(periodFromFilters(displayedFilters))} results until ready.`}
                  />
                </span>
              ) : null}
              {refreshError ? (
                <div className="transaction-refresh-error" role="alert">
                  <p className="form-error">
                    {refreshError} Showing{" "}
                    {periodLabel(periodFromFilters(displayedFilters))} results.
                  </p>
                  <button
                    className="button button--ghost button--small"
                    onClick={() => void loadData(requestedFilters, false)}
                    type="button"
                  >
                    Retry loading transactions
                  </button>
                </div>
              ) : null}
            </div>
            <details className="transaction-display-options">
              <summary>Display options</summary>
              <div className="transaction-display-options__body">
                {identifierView.control}
                <details className="column-picker">
                  <summary>
                    <SlidersHorizontal aria-hidden="true" size={17} />
                    Columns{" "}
                    <span>
                      {visibleColumns.length}/{transactionColumns.length}
                    </span>
                  </summary>
                  <div className="column-picker__menu">
                    <strong>Visible columns</strong>
                    {transactionColumns.map((column) => (
                      <label key={column.id}>
                        <input
                          checked={visibleColumns.includes(column.id)}
                          onChange={() => toggleColumn(column.id)}
                          type="checkbox"
                        />
                        <span>{column.label}</span>
                      </label>
                    ))}
                    <button
                      className="button button--ghost button--small"
                      onClick={() => {
                        setVisibleColumns(allTransactionColumns);
                        persistVisibleColumns(allTransactionColumns);
                      }}
                      type="button"
                    >
                      Show all
                    </button>
                    <button
                      className="button button--ghost button--small"
                      type="button"
                      onClick={() => {
                        setVisibleColumns(defaultTransactionColumns);
                        persistVisibleColumns(defaultTransactionColumns);
                      }}
                    >
                      Reset default
                    </button>
                  </div>
                </details>
              </div>
            </details>
          </div>

          {loadState.transactions.length === 0 ? (
            <div className="empty-state">
              <p>No transactions match these filters.</p><button className="button button--ghost" onClick={clearFilters} type="button">Clear filters</button>
            </div>
          ) : (<>
            <div className="transaction-mobile-list" aria-busy={isRefreshing}>
              {loadState.transactions.map(transaction => <article className="transaction-card" key={transaction.id} aria-label={`Transaction on ${formatCalendarDate(transaction.date)}`}>
                <div className="transaction-card__heading">
                  {visibleColumns.includes("description") ? <div>{columnContent("description", transaction)}</div> : null}
                  {visibleColumns.includes("amount") ? <strong className={amountClass(transaction)}>{columnContent("amount", transaction)}</strong> : null}
                </div>
                <dl className="transaction-card__details">
                  {displayedFilters.ordering !== "-date" ? <div><dt>{displayedFilters.ordering === "-updated_at" ? "Updated" : "Added"}</dt><dd>{activityTime(transaction)}</dd></div> : null}
                  {transactionColumns.filter(column => visibleColumns.includes(column.id) && ["date", "time", "account", "category"].includes(column.id)).map(column => <div key={column.id}><dt>{column.label}</dt><dd>{columnContent(column.id, transaction)}</dd></div>)}
                </dl>
                {visibleColumns.some(column => ["source", "balance", "senderIdentifiers", "receiverIdentifiers"].includes(column)) ? <details><summary>More details</summary><dl className="transaction-card__details">
                  {transactionColumns.filter(column => visibleColumns.includes(column.id) && ["source", "balance", "senderIdentifiers", "receiverIdentifiers"].includes(column.id)).map(column => <div key={column.id}><dt>{column.label}</dt><dd>{columnContent(column.id, transaction)}</dd></div>)}
                </dl></details> : null}
                {transactionActions(transaction)}
              </article>)}
            </div>
            <div className="table-wrap transaction-desktop-list" aria-busy={isRefreshing}>
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
                  {loadState.transactions.map(transaction => <tr key={transaction.id}>
                    {displayedFilters.ordering !== "-date" ? <td>{activityTime(transaction)}</td> : null}
                    {transactionColumns.filter(column => visibleColumns.includes(column.id)).map(column => <td key={column.id} className={column.id === "amount" ? amountClass(transaction) : undefined}>{columnContent(column.id, transaction)}</td>)}
                    <td>{transactionActions(transaction)}</td>
                  </tr>)}
                </tbody>
              </table>
            </div>
          </>)}
        </div>
      </section>
      {transferDecision ? <TransferMatchDialog original={transferComparison(transferDecision.input, id => accountNames.get(id))} originalSource={transferDecision.mergeId ? "Recorded transfer selected" : "New manual transfer"} matches={transferDecision.matches} busy={isSubmitting} error={matchError} merging={Boolean(transferDecision.mergeId)} onAccept={(match, choices) => void handleTransferDecision(match, choices)} onSeparate={() => void handleTransferDecision()} onCancel={() => setTransferDecision(null)} /> : null}
    </div>
  );
}
