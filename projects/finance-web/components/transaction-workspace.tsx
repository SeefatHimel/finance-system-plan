"use client";
import { BalanceSourceStatus } from "./balance-source-status";
import { ClockTimeInput } from "./clock-time-input";
import { filteredFinancialTotals } from "@/lib/financial-totals";
import { TransactionActionMenu } from "@/components/transaction-action-menu";
import { transactionTableLayout, transactionColumnPreferences, transactionPage, transactionPageParams, transactionPeriodFilters, transactionPeriodCaption } from "@/lib/transaction-list";
import { CompactReportedBalances } from "@/components/compact-reported-balances";
import { AccountLabel } from "@/components/account-avatar";
import { displayLabel, formatCurrency, formatCalendarDate, formatClockTime, formatTimestamp } from "../../finance-contracts/presentation";

import { CalendarDateInput } from "@/components/calendar-date-input";
import { useQuickAdd } from "./quick-add";
import { localDay, localTime } from "../../finance-contracts/quick-add";

import { identifierLabel, useIdentifierView } from "@/components/identifier-view";

import { useTransactionRecovery } from "@/components/transaction-recovery";
import { useRouter, useSearchParams } from "next/navigation";
import { useFeedbackMessage, useToast } from "@/components/toast-provider";

import { Plus, SlidersHorizontal, X, FunnelSimple, MagnifyingGlass, SortDescending, DownloadSimple, ArrowClockwise, CaretLeft, CaretRight, CalendarBlank, SpinnerGap } from "@phosphor-icons/react";
import type React from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
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
import { smsEvidenceWarnings } from "@/lib/sms-evidence-review";
import { TransactionStatementEvidence } from "@/components/transaction-statement-evidence";
import { useCategoryTypeChoice } from "@/components/use-category-type-choice";
import { directionForType, transactionTypes } from "@/lib/category-type";
import { BalanceSourceBadges } from "@/components/balance-source-badges";
import { balanceEditPrefill, type BalanceEditSuggestion, accountBoundBalances, editableReportedBalance, transferBalancePayload } from "@/lib/transaction-balances";
import { periodFromFilters, periodLabel, shiftPeriod, dailyPeriod, monthPeriod, allDates, dateRangeError, type DatePeriod } from "@/lib/date-period";
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

const TransactionDetailDialog = dynamic(() => import("@/components/transaction-detail-dialog").then(module => module.TransactionDetailDialog));

const transactionSources: TransactionSource[] = ["web", "mobile", "sms", "import", "system"];

type TransactionColumn = "date" | "description" | "account" | "category" | "source" | "balance" | "senderIdentifiers" | "receiverIdentifiers" | "amount";

const transactionColumns: { id: TransactionColumn; label: string }[] = [
  { id: "date", label: "Date & time" },
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
const defaultTransactionColumns: TransactionColumn[] = ["date", "description", "account", "category", "amount"];
const transactionColumnsStorageKey = "finance.transactions.columns.v2";

type TransactionFilterState = Required<Pick<TransactionFilters, "direction" | "source" | "type">> & {
  currency: string;
  spending: string;
  needs_review: string;
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

type TransactionWorkspaceProps = {
  embeddedEditId?: string;
  embeddedBalanceSuggestion?: BalanceEditSuggestion;
  embeddedCreate?: boolean;
  onEmbeddedClose?: () => void;
  onEmbeddedSaved?: (transaction: Transaction) => void;
};

export function TransactionWorkspace({ embeddedEditId, embeddedBalanceSuggestion, embeddedCreate = false, onEmbeddedClose, onEmbeddedSaved }: TransactionWorkspaceProps = {}) {
  const isEmbedded = Boolean(embeddedEditId || embeddedCreate);
  const recovery = useTransactionRecovery();
  const { dismiss: dismissToast } = useToast();
  const router = useRouter();
  const searchParams = useSearchParams();
  const editorForm = useRef<HTMLFormElement>(null);
  const editorDirty = useRef(false);
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
    currency: "", spending: "", needs_review: "",
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
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [displayOptionsOpen, setDisplayOptionsOpen] = useState(false);
  const tableScroll = useRef<HTMLDivElement>(null);
  const listTop = useRef<HTMLDivElement>(null);
  const restorePosition = useRef<{ y: number; x: number } | null>(null);
  const [filterPanel, setFilterPanel] = useState<{ filters: TransactionFilterState; period: DatePeriod } | null>(null);
  const [filterDateError, setFilterDateError] = useState("");
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
  const [, setFormMessage] = useFeedbackMessage("success");
  const [editorMode, setEditorMode] = useState<"create" | "edit" | null>(null);
  const [viewingId, setViewingId] = useState<string | null>(null);
  const [editingReportedBalances, setEditingReportedBalances] = useState<Record<string, string>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isUpdating, setIsUpdating] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [, setExportMessage] = useFeedbackMessage("success");
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
  const [balanceSuggestionNotice, setBalanceSuggestionNotice] = useState("");
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
      const next: Extract<LoadState, { status: "ready" }> = isEmbedded
        ? await Promise.all([
            listAccounts(accessToken, ticket.signal), listCategories(accessToken, ticket.signal),
            listPaymentMethods(accessToken, ticket.signal)
          ]).then(([accounts, categories, paymentMethods]) => ({ accounts, categories, paymentMethods, transactions: [], status: "ready" as const }))
        : previous && !refreshLookups
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
  }, [isEmbedded, setRefreshError]);

  const loadData = useCallback((activeFilters = filtersRef.current, refreshLookups = true) => {
    markPending(activeFilters);
    return dataRequests.current.run((ticket) => requestData(activeFilters, refreshLookups, ticket));
  }, [markPending, requestData]);

  useEffect(() => {
    const requests = dataRequests.current;
    if (isEmbedded) {
      void loadData(filtersRef.current);
      return () => requests.cancel();
    }
    const restore = () => {
      const searchParams = new URLSearchParams(window.location.search);
      const pagination = transactionPageParams(searchParams);
      setPage(pagination.page); setPageSize(pagination.pageSize);
      restorePosition.current = window.history.state?.financeTransactionPosition ?? null;
      const requestedSearch = searchParams.get("search")?.trim() ?? "";
      const requestedOrdering = searchParams.get("ordering");
      const ordering = requestedOrdering === "-created_at" || requestedOrdering === "-updated_at" ? requestedOrdering : "-date";
      const requestedFilters: TransactionFilterState = {
        currency: searchParams.get("currency") ?? "", spending: searchParams.get("spending") ?? "", needs_review: searchParams.get("needs_review") ?? "",
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
    };
    restore();
    window.addEventListener("popstate", restore);
    return () => { requests.cancel(); window.removeEventListener("popstate", restore); };
  }, [isEmbedded, loadData, setFilters]);

  useEffect(() => {
    if (isEmbedded) return;
    // Contain touchpad edge gestures on this workspace; Back buttons still work.
    const root = document.documentElement;
    const previous = root.style.overscrollBehaviorX;
    root.style.overscrollBehaviorX = "none";
    return () => { root.style.overscrollBehaviorX = previous; };
  }, [isEmbedded]);

  useEffect(() => {
    if (!editorMode) return;
    const warn = (event: BeforeUnloadEvent) => {
      if (!editorDirty.current || saveInFlight.current) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [editorMode]);

  useEffect(() => {
    if (isEmbedded) return;
    try {
      const stored = window.localStorage.getItem(transactionColumnsStorageKey) ?? window.localStorage.getItem("finance.transactions.columns.v1");
      if (!stored) return;
      const parsed = JSON.parse(stored) as unknown;
      if (!Array.isArray(parsed)) return;
      const restored = transactionColumnPreferences(parsed, allTransactionColumns) as TransactionColumn[];
      if (restored.length > 0) setVisibleColumns(restored);
    } catch {
      // Fall back to the compact default table when storage is unavailable.
    }
  }, [isEmbedded]);

  useEffect(() => {
    if (isEmbedded || loadState.status !== "ready") return;
    let frame = 0;
    let timer: ReturnType<typeof setTimeout>;
    const pathname = window.location.pathname;
    if (restorePosition.current) {
      const position = restorePosition.current;
      frame = requestAnimationFrame(() => {
        if (tableScroll.current) tableScroll.current.scrollLeft = position.x;
        window.scrollTo(0, position.y);
        restorePosition.current = null;
      });
    }
    const remember = () => {
      clearTimeout(timer);
      if (window.location.pathname !== pathname || restorePosition.current || document.body.style.overflow === "hidden") return;
      try {
        window.history.replaceState({ ...window.history.state,
          financeTransactionPosition: { y: window.scrollY, x: tableScroll.current?.scrollLeft ?? 0 }
        }, "");
      } catch { /* Position recovery is optional when the browser limits history writes. */ }
    };
    // Debounce history writes so continuous touchpad scrolling cannot hit browser quotas.
    const queue = () => { clearTimeout(timer); timer = setTimeout(remember, 150); };
    const beforeLink = (event: MouseEvent) => {
      if (event.target instanceof Element && event.target.closest("a[href]")) remember();
    };
    const table = tableScroll.current;
    window.addEventListener("scroll", queue, { passive: true });
    table?.addEventListener("scroll", queue, { passive: true });
    window.addEventListener("pagehide", remember);
    document.addEventListener("click", beforeLink, true);
    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(timer);
      window.removeEventListener("scroll", queue);
      table?.removeEventListener("scroll", queue);
      window.removeEventListener("pagehide", remember);
      document.removeEventListener("click", beforeLink, true);
    };
  }, [isEmbedded, loadState]);

  useEffect(() => {
    const refresh = () => { void loadData(filtersRef.current); };
    window.addEventListener("finance:transactions-changed", refresh);
    return () => window.removeEventListener("finance:transactions-changed", refresh);
  }, [loadData]);
  const openNewTransaction = useCallback((defaults?: { type: TransactionType; account: string; category: string; amount: string; note: string; counterparty_text: string; date: string; time: string }) => {
    editLoad.current?.abort();
    editorDirty.current = false;
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
    if (!embeddedCreate) return;
    if (!fullDraft) return;
    openNewTransaction({ ...fullDraft, date: fullDraft.dateMode === "today" ? localDay() : fullDraft.date,
      time: fullDraft.timeMode === "now" ? localTime() : fullDraft.timeMode === "none" ? "" : fullDraft.time });
    consumeFullDraft();
  }, [embeddedCreate, fullDraft, consumeFullDraft, openNewTransaction]);
  function closeEditor() {
    if (editorDirty.current && !window.confirm("Discard the unsaved transaction changes?")) return;
    editorDirty.current = false;
    editLoad.current?.abort();
    setEditorMode(null);
    if (isEmbedded) { onEmbeddedClose?.(); return; }
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

  function applyFilterUrl(nextFilters: TransactionFilterState, view = dateView, nextPage = 1, size = pageSize) {
    setPage(nextPage);
    const params = new URLSearchParams();
    params.set("month", nextFilters.month);
    params.set("date_view", view);
    if (nextPage > 1) params.set("page", String(nextPage));
    if (size !== 25) params.set("page_size", String(size));
    Object.entries(nextFilters).forEach(([key, value]) => {
      if (value) params.set(key, value);
    });
    window.history.replaceState({ ...window.history.state, financeTransactionPosition: null }, "", `${window.location.pathname}${params.size ? `?${params.toString()}` : ""}`);
  }

  function selectPeriod(period: DatePeriod) {
    setDateView(period.mode);
    const nextFilters = { ...filtersRef.current, ...transactionPeriodFilters(period) };
    setFilters(nextFilters);
    applyFilterUrl(nextFilters, period.mode);
    markPending(nextFilters);
    dataRequests.current.schedule((ticket) => { void requestData(nextFilters, false, ticket); }, 250);
  }

  function selectOrdering(ordering: TransactionFilterState["ordering"]) {
    const nextFilters = { ...filtersRef.current, ordering };
    setFilters(nextFilters);
    applyFilterUrl(nextFilters);
    void loadData(nextFilters, false);
  }

  function refreshFilters(next: TransactionFilterState, debounce = false) {
    setFilters(next);
    applyFilterUrl(next);
    if (debounce) {
      markPending(next);
      dataRequests.current.schedule(ticket => { void requestData(next, false, ticket); }, 300);
    } else void loadData(next, false);
  }
  function openFilters() {
    dismissToast();
    setFilterDateError("");
    setFilterPanel({ filters: { ...filtersRef.current }, period: periodFromFilters(filtersRef.current, dateView) });
  }
  function changePanelMode(mode: DatePeriod["mode"]) {
    if (!filterPanel) return;
    const start = filterPanel.period.start || currentDate();
    setFilterDateError("");
    setFilterPanel({ ...filterPanel, period: mode === "all" ? { ...allDates } : mode === "monthly" ? monthPeriod(start.slice(0, 7)) : mode === "daily" ? dailyPeriod(start) : { mode, start, end: filterPanel.period.end || start } });
  }
  function applyPanelFilters(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!filterPanel) return;
    const period = filterPanel.period;
    const error = period.mode !== "all" ? dateRangeError(period.start, period.end) : "";
    if (error) {
      setFilterDateError(error);
      event.currentTarget.querySelector<HTMLElement>("[aria-label='Start date'], [aria-label='Selected date']")?.focus();
      return;
    }
    const next = { ...filterPanel.filters, ...transactionPeriodFilters(period) };
    setDateView(period.mode);
    setFilters(next);
    applyFilterUrl(next, period.mode);
    void loadData(next, false);
    setFilterPanel(null);
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
      currency: "", spending: "", needs_review: "",
      account: "",
      category: "",
      direction: "",
      month: "",
      start_date: "",
      end_date: "",
      date_field: "date",
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
      const blob = await exportTransactionsCsv(accessToken, displayedFilters);
      const objectUrl = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = objectUrl;
      link.download = `transactions-${displayedFilters.month || (displayedFilters.start_date ? `${displayedFilters.start_date}-to-${displayedFilters.end_date}` : "all")}.csv`;
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
      editorDirty.current = false;
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
    editorDirty.current = false;
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
    const prefill = balanceEditPrefill(transaction, embeddedBalanceSuggestion);
    const balances = accountBoundBalances(transaction);
    if (prefill) balances[prefill.account] = prefill.balance;
    setEditingBalanceAfter(prefill && (transaction.type !== "transfer" || prefill.account === transaction.balance_reporting_account) ? prefill.balance : editableReportedBalance(transaction));
    setEditingReportedBalances(balances);
    setBalanceSuggestionNotice(embeddedBalanceSuggestion ? prefill
      ? `Suggested balance ${prefill.balance} was copied into this draft. This is calculated, not a source report. Check the originals and save to confirm, or cancel to discard.`
      : "This entry or its reports changed. The suggestion was not filled in. Close this form and refresh the timeline before trying again." : "");
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
  }, [setFormError, setFormMessage, embeddedBalanceSuggestion]);
  useEffect(() => () => editLoad.current?.abort(), []);
  const editId = isEmbedded ? embeddedEditId : searchParams.get("edit");
  useEffect(() => { if (editId) void selectTransactionForEdit(editId); }, [editId, selectTransactionForEdit]);
  const revalidateId = searchParams.get("revalidate");
  useEffect(() => { if (!isEmbedded && revalidateId) setRevalidationId(revalidateId); }, [isEmbedded, revalidateId]);

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
      editorDirty.current = false;
      closeEditor(); recovery.announce(saved.undo_action);
      if (isEmbedded) {
        onEmbeddedSaved?.(saved);
        window.dispatchEvent(new Event("finance:transactions-changed"));
      } else await loadData(filtersRef.current);
    } catch (error) {
      const errors = fieldErrorsFrom(error); setFieldErrors(errors); focusFieldError(editorForm.current, errors);
      setFormError(error instanceof Error ? error.message : "Could not save transaction.");
    }
    finally { saveInFlight.current = false; setIsUpdating(false); }
  }

  const accountAppearances = useMemo(() => new Map(loadState.status === "ready" ? loadState.accounts.map(account => [account.id, account]) : []), [loadState]);

  const accountNames = useMemo(() => {
    if (loadState.status !== "ready") {
      return new Map<string, string>();
    }
    return new Map(loadState.accounts.map((account) => [account.id, account.name]));
  }, [loadState]);

  const currencyByAccount = useMemo(() => new Map(loadState.status === "ready" ? loadState.accounts.map(account => [account.id, account.currency]) : []), [loadState]);
  const tableLayout = transactionTableLayout(visibleColumns, displayedFilters.ordering !== "-date");
  const financialTotals = useMemo(() => loadState.status === "ready" ? filteredFinancialTotals(loadState.transactions, currencyByAccount, displayedFilters.account) : [], [loadState, currencyByAccount, displayedFilters.account]);

  const categoryNames = useMemo(() => {
    if (loadState.status !== "ready") {
      return new Map<string, string>();
    }
    return new Map(loadState.categories.map((category) => [category.id, category.name]));
  }, [loadState]);

  if (loadState.status === "loading") {
    if (isEmbedded) return <ModalDialog className="form-drawer embedded-editor-status" labelledBy="embedded-editor-loading-title" onCancel={() => onEmbeddedClose?.()}><div className="form-drawer__header"><h2 id="embedded-editor-loading-title">Opening transaction</h2><button className="icon-button" type="button" onClick={() => onEmbeddedClose?.()} aria-label="Close transaction editor"><X size={20} /></button></div><div className="panel__body"><LoadingState compact detail="Loading account and category choices" label="Preparing editor" /></div></ModalDialog>;
    return <LoadingState detail="Syncing ledger entries, accounts, and categories" label="Loading transactions" />;
  }

  if (loadState.status === "error") {
    if (isEmbedded) return <ModalDialog className="form-drawer embedded-editor-status" labelledBy="embedded-editor-error-title" onCancel={() => onEmbeddedClose?.()}><div className="form-drawer__header"><h2 id="embedded-editor-error-title">Could not open transaction</h2><button className="icon-button" type="button" onClick={() => onEmbeddedClose?.()} aria-label="Close transaction editor"><X size={20} /></button></div><div className="panel__body"><p role="alert">{loadState.message}</p><button className="button button--ghost" type="button" onClick={() => void loadData(filtersRef.current)}>Retry</button></div></ModalDialog>;
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

  const advancedFilterCount = [displayedFilters.currency, displayedFilters.spending, displayedFilters.needs_review, displayedFilters.type, displayedFilters.direction, displayedFilters.source, displayedFilters.category, displayedFilters.date_field !== "date" ? displayedFilters.date_field : ""].filter(Boolean).length;
  const activeFilterChips: { key: "account" | "category" | "direction" | "source" | "type" | "search" | "date_field" | "currency" | "spending" | "needs_review"; label: string }[] = [
    ...(displayedFilters.currency ? [{ key: "currency" as const, label: displayedFilters.currency }] : []),
    ...(displayedFilters.spending ? [{ key: "spending" as const, label: "Spending & refunds" }] : []),
    ...(displayedFilters.needs_review ? [{ key: "needs_review" as const, label: displayedFilters.needs_review === "true" ? "Needs review" : "Reviewed" }] : []),
    ...(displayedFilters.account ? [{ key: "account" as const, label: accountNames.get(displayedFilters.account) ?? "Selected account" }] : []),
    ...(displayedFilters.search ? [{ key: "search" as const, label: `Search: ${displayedFilters.search}` }] : []),
    ...(["type", "direction", "source"] as const).flatMap(key => displayedFilters[key] ? [{ key, label: displayLabel(displayedFilters[key]) }] : []),
    ...(displayedFilters.category ? [{ key: "category" as const, label: displayedFilters.category === "uncategorized" ? "Uncategorized" : categoryNames.get(displayedFilters.category) ?? "Selected category" }] : []),
    ...(displayedFilters.date_field !== "date" ? [{ key: "date_field" as const, label: displayedFilters.date_field === "created_at" ? "Added date" : "Updated date" }] : []),
  ];
  const activePeriod = periodFromFilters(filters, dateView);

  const editingTransaction = editingRecord ?? undefined;
  const balanceChecks = (account: string, value: string) => editorMode === 'edit' && editingTransaction ? <BalanceSourceBadges
    value={value || null} account={account} currency={loadState.status === 'ready' ? loadState.accounts.find(item => item.id === account)?.currency ?? '' : ''}
    date={editingDate} time={editingTime || null} direction={editingType === 'transfer' ? account === editingTransferAccountId ? 'credit' : 'debit' : editingDirection}
    sources={editingTransaction.balance_sources} calculated={Boolean(embeddedBalanceSuggestion && account === embeddedBalanceSuggestion.account && value === embeddedBalanceSuggestion.balance && balanceEditPrefill(editingTransaction, embeddedBalanceSuggestion))} /> : null;
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

  const pagination = transactionPage(loadState.status === "ready" ? loadState.transactions.length : 0, page, pageSize);
  const pageTransactions = loadState.status === "ready" ? loadState.transactions.slice(pagination.start, pagination.end) : [];
  function changePage(next: number, size = pageSize) {
    const bounded = transactionPage(loadState.status === "ready" ? loadState.transactions.length : 0, next, size);
    setPageSize(size);
    applyFilterUrl(displayedFilters, dateView, bounded.current, size);
    listTop.current?.scrollIntoView({ block: "start", behavior: "instant" });
  }
  function fullText(text: string, label: string) {
    return <HelpTooltip label={`${label}: ${text}`} textTrigger={<span>{text}</span>}>{text}</HelpTooltip>;
  }
  function sourceBadges(transaction: Transaction) {
    const sms = transaction.source === "sms" || transaction.raw_message || transaction.transfer_evidence.some(item => item.raw_message || item.source === "sms");
    return <span className="transaction-badges">
      <span className="transaction-mini-badge">{displayLabel(transaction.type)}</span>
      {sms ? <span className="transaction-mini-badge transaction-mini-badge--source" title={transaction.raw_message || transaction.transfer_evidence.some(item => item.raw_message) ? "Saved SMS evidence is attached" : "Recorded from SMS; the original message may no longer be available"}>SMS</span> : null}
      {transaction.statement_evidence_count > 0 ? <span className="transaction-mini-badge transaction-mini-badge--source" title={`${transaction.statement_evidence_count} attached statement rows`}>PDF</span> : null}
      {!sms && !transaction.statement_evidence_count ? <span className="transaction-mini-badge">{transaction.source === "web" ? "Manual" : displayLabel(transaction.source)}</span> : null}
      {transaction.needs_review ? <span className="transaction-mini-badge transaction-mini-badge--review">Needs review</span> : null}
    </span>;
  }
  function columnContent(column: TransactionColumn, transaction: Transaction) {
    const methods = loadState.status === "ready" ? loadState.paymentMethods : [];
    switch (column) {
      case "date": return <><time dateTime={transaction.date}>{formatCalendarDate(transaction.date)}</time><span className="transaction-ledger-secondary">{formatTransactionTime(transaction.time)}</span></>;
      case "description": {
        const description = transaction.counterparty_text || transaction.reference || transaction.note || displayLabel(transaction.type);
        return <><div className="transaction-ledger-primary"><button className="transaction-view-trigger" data-transaction-view type="button" aria-haspopup="dialog" aria-label={`View transaction: ${description}`} title={description} onClick={() => setViewingId(transaction.id)}>{description}</button></div>{sourceBadges(transaction)}</>;
      }
      case "account": return <span className="account-path">{fullTextAccount(transaction.account)}{transaction.type === "transfer" ? <><span aria-label="to">→</span>{fullTextAccount(transaction.transfer_account ?? "")}</> : null}</span>;
      case "category": return <span className={`transaction-category transaction-category--${transaction.type === "transfer" ? "transfer" : transaction.account_direction === "credit" ? "credit" : "debit"}`}>{fullText(transaction.category ? categoryNames.get(transaction.category) ?? "Unknown" : "Uncategorized", "Category")}</span>;
      case "source": return displayLabel(transaction.source);
      case "balance": return <CompactReportedBalances record={transaction} accounts={loadState.status === "ready" ? loadState.accounts : []} />;
      case "senderIdentifiers": return <><span>{identifierView.format(transaction.sender_account_identifier, identifierLabel(transaction.sender_account_identifier, "account", methods, accountNames, transaction.direction === "debit" ? transaction.account : undefined))}</span><span className="transaction-ledger-secondary">{transaction.sender_card_identifier ? `Card ${identifierView.format(transaction.sender_card_identifier, identifierLabel(transaction.sender_card_identifier, "card", methods, accountNames, transaction.direction === "debit" ? transaction.account : undefined))}` : "No card identifier"}</span></>;
      case "receiverIdentifiers": {
        const account = transaction.type === "transfer" ? transaction.transfer_account ?? undefined : transaction.direction === "credit" ? transaction.account : undefined;
        return <><span>{identifierView.format(transaction.receiver_account_identifier, identifierLabel(transaction.receiver_account_identifier, "account", methods, accountNames, account))}</span><span className="transaction-ledger-secondary">{transaction.receiver_card_identifier ? `Card ${identifierView.format(transaction.receiver_card_identifier, identifierLabel(transaction.receiver_card_identifier, "card", methods, accountNames, account))}` : "No card identifier"}</span></>;
      }
      case "amount": return <>{transaction.type === "transfer" && !displayedFilters.account ? "" : transaction.account_direction === "credit" ? "+" : "−"}{formatCurrency(transaction.amount, currencyByAccount.get(transaction.account))}</>;
    }
  }
  function fullTextAccount(id: string) {
    const account = accountAppearances.get(id);
    return <HelpTooltip label={`Account: ${account?.name ?? "Unknown"}`} textTrigger={<AccountLabel account={account} fallback="Unknown" />}>{account?.name ?? "Unknown account"}</HelpTooltip>;
  }
  function amountClass(transaction: Transaction) {
    return `transaction-ledger-amount${transaction.type === "transfer" && !displayedFilters.account ? " transaction-ledger-amount--transfer" : transaction.account_direction === "credit" ? " transaction-ledger-amount--credit" : ""}`;
  }
  function activityTime(transaction: Transaction) {
    const stamp = displayedFilters.ordering === "-updated_at" ? transaction.updated_at : transaction.created_at;
    return <time dateTime={stamp}>{formatTimestamp(stamp)}</time>;
  }
  function viewRow(event: React.MouseEvent<HTMLElement>, transaction: Transaction) {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || !window.getSelection()?.isCollapsed) return;
    if ((event.target as HTMLElement).closest("button, a, input, select, textarea, summary, details, [role=tooltip]")) return;
    event.currentTarget.querySelector<HTMLButtonElement>('[data-transaction-view], button[aria-haspopup="dialog"]')?.focus({ preventScroll: true });
    setViewingId(transaction.id);
  }
  function transactionActions(transaction: Transaction) {
    return <div className="list-row__actions transaction-row-actions">
      <button className="button button--ghost" onClick={() => setViewingId(transaction.id)} type="button" aria-haspopup="dialog">View</button>
      <TransactionActionMenu label={`More actions for ${transaction.counterparty_text || displayLabel(transaction.type)} on ${formatCalendarDate(transaction.date)}`}>
        <button className="button button--ghost" onClick={() => void selectTransactionForEdit(transaction.id)} type="button">Edit transaction</button>
        {transaction.type === "transfer" ? <button className="button button--ghost" disabled={isSubmitting} onClick={() => void handleFindPostedMatch(transaction)} type="button">Find match</button> : null}
        <button className="button button--ghost" onClick={() => setRevalidationId(transaction.id)} type="button">Revalidate</button>
        <Link className="button button--ghost" href={`/audit-logs?entity_type=transactions.transaction&entity_id=${transaction.id}`}>History</Link>
        <button className="button button--danger" disabled={deletingTransactionId === transaction.id} onClick={() => void handleDeleteTransaction(transaction)} type="button">{deletingTransactionId === transaction.id ? <ButtonBusy label="Deleting" /> : "Delete"}</button>
      </TransactionActionMenu>
    </div>;
  }

  return (
    <div className={isEmbedded ? "" : "workspace-grid"}>
      {isEmbedded && !editorMode ? <ModalDialog className="form-drawer embedded-editor-status" labelledBy="embedded-editor-pending-title" onCancel={() => onEmbeddedClose?.()}><div className="form-drawer__header"><h2 id="embedded-editor-pending-title">Opening transaction</h2><button className="icon-button" type="button" onClick={() => onEmbeddedClose?.()} aria-label="Close transaction editor"><X size={20} /></button></div><div className="panel__body">{formError ? <p role="alert">{formError}</p> : <p role="status">Preparing {embeddedCreate ? "full entry" : "saved entry and sources"}…</p>}{formError && embeddedEditId ? <button className="button button--ghost" type="button" onClick={() => void selectTransactionForEdit(embeddedEditId)}>Retry</button> : null}</div></ModalDialog> : null}
      {filterPanel ? <ModalDialog className="form-drawer transaction-filter-dialog" labelledBy="transaction-filter-title" onCancel={() => setFilterPanel(null)}>
        <div className="form-drawer__header"><div><h2 id="transaction-filter-title">Filter transactions</h2><p>Choose what appears in the list.</p></div><button className="icon-button" type="button" aria-label="Close filters" onClick={() => setFilterPanel(null)}><X size={20} /></button></div>
        <form onSubmit={applyPanelFilters} noValidate className="transaction-filter-dialog__form">
          <div className="transaction-filter-dialog__fields">
            <label className="field"><span className="field__label">Date view</span><select className="field__control" value={filterPanel.period.mode} onChange={event => changePanelMode(event.target.value as DatePeriod["mode"])}><option value="monthly">Monthly</option><option value="daily">Daily</option><option value="custom">Custom range</option><option value="all">All dates</option></select></label>
            {filterPanel.period.mode === "all" ? null : filterPanel.period.mode === "custom" ? <>
              <label className="field"><span className="field__label">Start date</span><CalendarDateInput aria-label="Start date" aria-invalid={Boolean(filterDateError)} aria-describedby={filterDateError ? "transaction-filter-date-error" : undefined} value={filterPanel.period.start} onChange={start => { setFilterDateError(""); setFilterPanel({ ...filterPanel, period: { ...filterPanel.period, start } }); }} /></label>
              <label className="field"><span className="field__label">End date</span><CalendarDateInput aria-label="End date" aria-invalid={Boolean(filterDateError)} aria-describedby={filterDateError ? "transaction-filter-date-error" : undefined} min={filterPanel.period.start} value={filterPanel.period.end} onChange={end => { setFilterDateError(""); setFilterPanel({ ...filterPanel, period: { ...filterPanel.period, end } }); }} /></label>
            </> : <label className="field"><span className="field__label">{filterPanel.period.mode === "monthly" ? "Month (choose any day)" : "Day"}</span><CalendarDateInput aria-label="Selected date" aria-invalid={Boolean(filterDateError)} aria-describedby={filterDateError ? "transaction-filter-date-error" : undefined} value={filterPanel.period.start} onChange={start => { setFilterDateError(""); setFilterPanel({ ...filterPanel, period: start ? filterPanel.period.mode === "monthly" ? monthPeriod(start.slice(0, 7)) : dailyPeriod(start) : { ...filterPanel.period, start: "", end: "" } }); }} /></label>}
            {filterDateError ? <p className="field-error field--wide" id="transaction-filter-date-error" role="alert">{filterDateError}</p> : null}
            <label className="field"><span className="field__label">Date basis</span><select className="field__control" value={filterPanel.filters.date_field} onChange={event => setFilterPanel({ ...filterPanel, filters: { ...filterPanel.filters, date_field: event.target.value as TransactionFilterState["date_field"] } })}><option value="date">Transaction date</option><option value="created_at">Added date</option><option value="updated_at">Updated date</option></select></label>
            <label className="field"><span className="field__label">Type</span><select className="field__control" value={filterPanel.filters.type} onChange={event => setFilterPanel({ ...filterPanel, filters: { ...filterPanel.filters, type: event.target.value as TransactionFilterState["type"] } })}><option value="">All types</option>{transactionTypes.map(type => <option key={type} value={type}>{displayLabel(type)}</option>)}</select></label>
            <label className="field"><span className="field__label">Category</span><select className="field__control" value={filterPanel.filters.category} onChange={event => setFilterPanel({ ...filterPanel, filters: { ...filterPanel.filters, category: event.target.value } })}><option value="">All categories</option><option value="uncategorized">Uncategorized</option>{loadState.status === "ready" ? loadState.categories.map(category => <option key={category.id} value={category.id}>{category.name}</option>) : null}</select></label>
            <label className="field"><span className="field__label">Debit / credit</span><select className="field__control" value={filterPanel.filters.direction} onChange={event => setFilterPanel({ ...filterPanel, filters: { ...filterPanel.filters, direction: event.target.value as TransactionFilterState["direction"] } })}><option value="">All directions</option><option value="debit">Debit</option><option value="credit">Credit</option></select></label>
            <label className="field"><span className="field__label">Currency</span><select className="field__control" value={filterPanel.filters.currency} onChange={event => setFilterPanel({ ...filterPanel, filters: { ...filterPanel.filters, currency: event.target.value } })}><option value="">All currencies (separate totals)</option>{Array.from(new Set(loadState.status === "ready" ? loadState.accounts.map(row => row.currency) : [])).map(value => <option key={value}>{value}</option>)}</select></label>
            <label className="field"><span className="field__label">Spending scope</span><select className="field__control" value={filterPanel.filters.spending} onChange={event => setFilterPanel({ ...filterPanel, filters: { ...filterPanel.filters, spending: event.target.value } })}><option value="">All movements</option><option value="true">Expenses, fees & refunds only</option></select></label>
            <label className="field"><span className="field__label">Review status</span><select className="field__control" value={filterPanel.filters.needs_review} onChange={event => setFilterPanel({ ...filterPanel, filters: { ...filterPanel.filters, needs_review: event.target.value } })}><option value="">All review states</option><option value="true">Needs review</option><option value="false">Reviewed</option></select></label>
            <label className="field"><span className="field__label">Source</span><select className="field__control" value={filterPanel.filters.source} onChange={event => setFilterPanel({ ...filterPanel, filters: { ...filterPanel.filters, source: event.target.value as TransactionFilterState["source"] } })}><option value="">All sources</option>{transactionSources.map(source => <option key={source} value={source}>{displayLabel(source)}</option>)}</select></label>
          </div>
          <div className="transaction-editor-actions"><button className="button button--ghost" type="button" onClick={() => { setFilterDateError(""); setFilterPanel({ ...filterPanel, period: { ...allDates }, filters: { ...filterPanel.filters, type: "", category: "", direction: "", source: "", date_field: "date", currency: "", spending: "", needs_review: "" } }); }}><X size={17} aria-hidden="true" />Reset filters</button><button className="button button--ghost" type="button" onClick={() => setFilterPanel(null)}>Cancel</button><button className="button button--primary" type="submit">Apply filters</button></div>
        </form>
      </ModalDialog> : null}
      {displayOptionsOpen ? <ModalDialog className="form-drawer transaction-display-dialog" labelledBy="transaction-display-title" onCancel={() => setDisplayOptionsOpen(false)}>
        <div className="form-drawer__header"><h2 id="transaction-display-title">Transaction display</h2><button className="icon-button" type="button" aria-label="Close display options" onClick={() => setDisplayOptionsOpen(false)}><X size={20} /></button></div>
        <div className="transaction-display-body">
          {identifierView.control}
          <fieldset><legend>Visible columns</legend>{transactionColumns.map(column => <label key={column.id}><input type="checkbox" checked={visibleColumns.includes(column.id)} disabled={visibleColumns.length === 1 && visibleColumns.includes(column.id)} onChange={() => toggleColumn(column.id)} />{column.label}</label>)}</fieldset>
          <div className="transaction-filter-actions"><button className="button button--ghost" type="button" onClick={() => { setVisibleColumns(allTransactionColumns); persistVisibleColumns(allTransactionColumns); }}>Show all</button><button className="button button--ghost" type="button" onClick={() => { setVisibleColumns(defaultTransactionColumns); persistVisibleColumns(defaultTransactionColumns); }}>Reset default</button></div>
        </div><div className="transaction-editor-actions"><button className="button button--primary" type="button" onClick={() => setDisplayOptionsOpen(false)}>Done</button></div>
      </ModalDialog> : null}
      {revalidationId ? <TransactionRevalidationDialog key={revalidationId} transactionId={revalidationId} onClose={() => setRevalidationId(null)} onEdit={() => { const id = revalidationId; setRevalidationId(null); void selectTransactionForEdit(id); }} /> : null}
      {categoryChoice.confirmation}
      {viewingId ? <TransactionDetailDialog transactionId={viewingId} orderedIds={loadState.transactions.map(transaction => transaction.id)} accounts={loadState.accounts} categories={loadState.categories} selectedAccount={displayedFilters.account} onNavigate={setViewingId} onClose={() => setViewingId(null)} onEdit={id => { setViewingId(null); void selectTransactionForEdit(id); }} /> : null}
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
              if (!(event.target instanceof HTMLElement) || event.target.closest("form") !== event.currentTarget) return;
              editorDirty.current = true;
              const target = event.target as HTMLInputElement;
              if (target.name) setFieldErrors(current => { const next = { ...current }; delete next[target.name]; return next; });
              if (["account", "category", "counterparty_text", "note"].includes(target.name)) setSourceWarningsReviewed(false);
            }}>
            <div className="transaction-editor-scroll compact-editor"><div className="transaction-editor-fields compact-editor-grid">
            {balanceSuggestionNotice && editorMode === "edit" ? <p className="form-warning field--wide" role="status">{balanceSuggestionNotice}</p> : null}
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
                <ClockTimeInput name="time" {...feedback("time")} id="edit-transaction-time" value={editingTime} onValueChange={time => { editorDirty.current = true; setEditingTime(time); }} /><FieldError field="time" errors={fieldErrors} />
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

            {editingType === "transfer" ? <TransferBalanceFields sourceChecks={account => balanceChecks(account, editingReportedBalances[account] ?? "")} error={fieldErrors.reported_balances} accounts={[editingAccountId, editingTransferAccountId]} primaryAccount={editingTransaction?.balance_reporting_account ?? (reportingAccount || editingAccountId)} names={accountNames} values={editingReportedBalances} onChange={(account, value) => setEditingReportedBalances(current => ({ ...current, [account]: value }))} /> : <>            <div className="field">
              <div className="inline-help"><label className="field__label" htmlFor="edit-reported-balance">Reported balance after</label> <HelpTooltip label="About reported balance">Optional balance from this account’s report, rather than its calculated ledger balance. Leave blank if unknown.</HelpTooltip></div>
              <input name="balance_after" {...feedback("balance_after")} id="edit-reported-balance"
                className="field__control"
                inputMode="decimal"
                onChange={(event) => { setEditingBalanceAfter(event.target.value); setEditingReportedBalances(current => ({ ...current, [editingAccountId]: event.target.value })); setEditingBalanceNotice(""); }}
                type="text"
                value={editingBalanceAfter}
              /><FieldError field="balance_after" errors={fieldErrors} />
              {balanceChecks(editingAccountId, editingBalanceAfter)}
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
              <button className="button button--primary" disabled={isUpdating || isSubmitting || (editorMode === "edit" && editingSourceMessages === null)} type="submit">
                {isUpdating ? <ButtonBusy label="Saving" /> : editorMode === "edit" && editingSourceMessages === null ? editingSourceError ? "Sources unavailable" : <ButtonBusy label="Checking sources" /> : editorMode === "create" ? "Save transaction" : "Update transaction"}
              </button>
            </div>
          </form>
        </ModalDialog>
      ) : null}

      {!isEmbedded ? <section className="panel transaction-list-panel">
        <div className="panel__body">
          <form className="transaction-commandbar" role="search" aria-label="Search transactions" onSubmit={handleFilterSubmit}>
            <label className="field transaction-commandbar__search"><span className="sr-only">Search</span><MagnifyingGlass size={18} aria-hidden="true" /><input className="field__control" type="search" name="search" aria-label="Search transactions" placeholder="Search transactions…" maxLength={256} value={filters.search} onChange={event => refreshFilters({ ...filtersRef.current, search: event.target.value }, true)} /></label>
            <label className="field transaction-commandbar__account"><span className="sr-only">Account</span><select className="field__control" aria-label="Account" value={filters.account} onChange={event => refreshFilters({ ...filtersRef.current, account: event.target.value })}><option value="">All accounts</option>{loadState.accounts.map(account => <option key={account.id} value={account.id}>{account.name}</option>)}</select></label>
            <div className="transaction-date-navigator" role="group" aria-label="Transaction date navigation">
              {activePeriod.mode === "monthly" || activePeriod.mode === "daily" ? <button className="icon-button" type="button" aria-label={`Previous ${activePeriod.mode === "daily" ? "day" : "month"}`} title={`Previous ${activePeriod.mode === "daily" ? "day" : "month"}`} onClick={() => selectPeriod(shiftPeriod(activePeriod, -1))}><CaretLeft size={17} aria-hidden="true" /></button> : null}
              <button className="transaction-date-navigator__label" type="button" aria-haspopup="dialog" aria-label={`Choose dates: ${transactionPeriodCaption(activePeriod)}`} title={`${periodLabel(activePeriod)} · ${filters.date_field === "date" ? "Transaction date" : filters.date_field === "created_at" ? "Added date" : "Updated date"}`} onClick={openFilters}><CalendarBlank size={17} aria-hidden="true" /><span>{transactionPeriodCaption(activePeriod)}</span></button>
              {activePeriod.mode === "monthly" || activePeriod.mode === "daily" ? <button className="icon-button" type="button" aria-label={`Next ${activePeriod.mode === "daily" ? "day" : "month"}`} title={`Next ${activePeriod.mode === "daily" ? "day" : "month"}`} onClick={() => selectPeriod(shiftPeriod(activePeriod, 1))}><CaretRight size={17} aria-hidden="true" /></button> : null}
            </div>
            <button className="button button--ghost transaction-filter-trigger" type="button" aria-label={advancedFilterCount ? `Filters, ${advancedFilterCount} active` : "Filters"} title="Filters" aria-haspopup="dialog" aria-expanded={Boolean(filterPanel)} onClick={openFilters}><FunnelSimple size={20} aria-hidden="true" />{advancedFilterCount ? <span>{advancedFilterCount}</span> : null}</button>
            <button className="button button--primary transaction-commandbar__add" type="button" onClick={() => openNewTransaction()}><Plus size={17} aria-hidden="true" />Add transaction</button>
          </form>
          <div className="transaction-table-toolbar transaction-table-toolbar--compact" ref={listTop}>
            <div className="transaction-result-meta"><span>{loadState.transactions.length} {loadState.transactions.length === 1 ? "transaction" : "transactions"}</span>{isRefreshing ? <span role="status" className="transaction-refresh-state"><ButtonBusy label="Updating" /></span> : null}{refreshError ? <button className="icon-button" type="button" title={refreshError} aria-label="Retry loading transactions" onClick={() => void loadData(requestedFilters, false)}><ArrowClockwise size={18} aria-hidden="true" /></button> : null}</div>
            <div className="transaction-toolbar-actions transaction-toolbar-actions--icons" role="group" aria-label="Transaction tools">
              <TransactionActionMenu label="Sort transactions" icon={<SortDescending size={19} aria-hidden="true" />}>{([['-date', 'Transaction date'], ['-created_at', 'Recently added'], ['-updated_at', 'Recently updated']] as const).map(([value, label]) => <button className="button button--ghost" type="button" aria-pressed={displayedFilters.ordering === value} key={value} onClick={() => selectOrdering(value)}>{label}</button>)}</TransactionActionMenu>
              <button className="icon-button" type="button" aria-label={isExporting ? "Exporting CSV" : "Export CSV"} title="Export CSV" disabled={isExporting} onClick={() => void handleExportTransactions()}>{isExporting ? <SpinnerGap className="spin" size={19} aria-hidden="true" /> : <DownloadSimple size={19} aria-hidden="true" />}</button>
              <button className="icon-button" type="button" aria-label="Display options" title="Display options" onClick={() => setDisplayOptionsOpen(true)}><SlidersHorizontal size={19} aria-hidden="true" /></button>
              <button className="icon-button" type="button" aria-label="Refresh transactions" title="Refresh transactions without changing filters" aria-busy={isRefreshing} disabled={isRefreshing} onClick={() => void loadData(filtersRef.current)}>{isRefreshing ? <SpinnerGap className="spin" size={19} aria-hidden="true" /> : <ArrowClockwise size={19} aria-hidden="true" />}</button>
              {activeFilterChips.length || activePeriod.mode !== "all" ? <button className="icon-button" type="button" aria-label="Clear all filters" title="Reset filters" onClick={clearFilters}><X size={19} aria-hidden="true" /></button> : null}
              <TransactionActionMenu label="More transaction tools"><Link className="button button--ghost" href="/checks">Evidence health</Link>{recovery.latest && !recovery.latest.undone ? <><span className="transaction-menu-note">Last action: {recovery.latest.label}</span>{recovery.latest.transaction ? <button className="button button--ghost" type="button" onClick={() => recovery.edit(recovery.latest!.transaction!)}>Edit latest transaction</button> : null}<button className="button button--ghost" type="button" disabled={recovery.busy || !recovery.latest.can_undo} onClick={() => recovery.undo(recovery.latest!)}>Undo latest action</button></> : null}</TransactionActionMenu>
            </div>
          </div>
          {activeFilterChips.length ? <div className="transaction-filter-chips" aria-label="Applied filters">{activeFilterChips.map(chip => <button type="button" key={chip.key} className="transaction-filter-chip" title={`Remove ${chip.label}`} aria-label={`Remove ${chip.label}`} onClick={() => refreshFilters({ ...filtersRef.current, [chip.key]: chip.key === "date_field" ? "date" : "" })}><span>{chip.label}</span><X size={12} aria-hidden="true" /></button>)}</div> : null}

          <details className="filtered-totals"><summary>Totals for all {loadState.transactions.length} matching transactions</summary>
            <p className="muted-text">Refunds reduce spending. Principal and own-account transfers are separate. Totals cover the full filtered result, across every page.</p>
            {financialTotals.map(row => <div key={row.currency}><h3>{row.currency}</h3><div className="metric-row"><div className="metric"><span>Earned income</span><strong>{formatCurrency(row.income, row.currency)}</strong></div><div className="metric"><span>Net spending</span><strong>{formatCurrency(row.spending, row.currency)}</strong></div><div className="metric"><span>Money in / out</span><strong>{formatCurrency(row.moneyIn, row.currency)} / {formatCurrency(row.moneyOut, row.currency)}</strong></div></div><p className="muted-text">Refunds {formatCurrency(row.refunds, row.currency)} · Principal in/out {formatCurrency(row.financingIn, row.currency)} / {formatCurrency(row.financingOut, row.currency)} · Own transfers {formatCurrency(row.transfers, row.currency)}.</p></div>)}
          </details>
          {loadState.transactions.length === 0 ? (
            <div className="empty-state">
              <p>No transactions match these filters.</p><button className="button button--ghost" onClick={clearFilters} type="button">Clear filters</button>
            </div>
          ) : (<>
            <div className="transaction-mobile-list" aria-busy={isRefreshing}>
              {pageTransactions.map(transaction => <article className="transaction-card" key={transaction.id} onClick={event => viewRow(event, transaction)} aria-label={`Transaction on ${formatCalendarDate(transaction.date)}`}>
                <div className="transaction-card__heading">
                  {visibleColumns.includes("description") ? <div>{columnContent("description", transaction)}</div> : null}
                  {visibleColumns.includes("amount") ? <strong className={amountClass(transaction)}>{columnContent("amount", transaction)}</strong> : null}
                </div>
                <dl className="transaction-card__details">
                  {displayedFilters.ordering !== "-date" ? <div><dt>{displayedFilters.ordering === "-updated_at" ? "Updated" : "Added"}</dt><dd>{activityTime(transaction)}</dd></div> : null}
                  {transactionColumns.filter(column => visibleColumns.includes(column.id) && ["date", "account", "category"].includes(column.id)).map(column => <div key={column.id}><dt>{column.label}</dt><dd>{columnContent(column.id, transaction)}</dd></div>)}
                </dl>
                {visibleColumns.some(column => ["source", "balance", "senderIdentifiers", "receiverIdentifiers"].includes(column)) ? <details><summary>More details</summary><dl className="transaction-card__details">
                  {transactionColumns.filter(column => visibleColumns.includes(column.id) && ["source", "balance", "senderIdentifiers", "receiverIdentifiers"].includes(column.id)).map(column => <div key={column.id}><dt>{column.label}</dt><dd>{columnContent(column.id, transaction)}</dd></div>)}
                </dl></details> : null}
                {transactionActions(transaction)}
              </article>)}
            </div>
            <BalanceSourceStatus transactions={loadState.transactions} onRetry={() => loadData(filtersRef.current, false)} />
            <div className="table-wrap transaction-desktop-list" ref={tableScroll} aria-busy={isRefreshing} role="region" aria-label="Transaction table, scroll horizontally for more columns" tabIndex={0}>
              <table className="data-table transaction-data-table" style={{ width: tableLayout.width, minWidth: 0 }}>
                <colgroup>{tableLayout.columns.map(column => <col key={column.id} style={{ width: column.width }} />)}</colgroup>
                <thead>
                  <tr>
                    {displayedFilters.ordering === "-created_at" ? <th className="transaction-col--activity" scope="col">Added</th> : null}
                    {displayedFilters.ordering === "-updated_at" ? <th className="transaction-col--activity" scope="col">Updated</th> : null}
                    {transactionColumns.filter(column => visibleColumns.includes(column.id)).map(column => <th className={`transaction-col--${column.id}`} scope="col" key={column.id}>{column.label}</th>)}
                    <th className="transaction-col--actions" scope="col">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {pageTransactions.map(transaction => <tr key={transaction.id} className="transaction-view-row" onClick={event => viewRow(event, transaction)}>
                    {displayedFilters.ordering !== "-date" ? <td className="transaction-col--activity">{activityTime(transaction)}</td> : null}
                    {transactionColumns.filter(column => visibleColumns.includes(column.id)).map(column => <td key={column.id} className={`transaction-col--${column.id}${column.id === "amount" ? ` ${amountClass(transaction)}` : ""}`}>{columnContent(column.id, transaction)}</td>)}
                    <td className="transaction-col--actions">{transactionActions(transaction)}</td>
                  </tr>)}
                </tbody>
              </table>
            </div>
            <nav className="transaction-pagination" aria-label="Transaction pages">
              <span>Showing {pagination.start + 1}–{pagination.end} of {loadState.transactions.length} transactions</span>
              <label>Rows <select aria-label="Rows per page" value={pageSize} disabled={isRefreshing} onChange={event => changePage(1, Number(event.target.value))}>{[25, 50, 100].map(size => <option value={size} key={size}>{size}</option>)}</select></label>
              <div><button className="button button--ghost button--small" type="button" disabled={pagination.current === 1 || isRefreshing} onClick={() => changePage(pagination.current - 1)}>Previous</button><span aria-live="polite">{pagination.current} / {pagination.pages}</span><button className="button button--ghost button--small" type="button" disabled={pagination.current === pagination.pages || isRefreshing} onClick={() => changePage(pagination.current + 1)}>Next</button></div>
            </nav>
          </>)}
        </div>
      </section> : null}
      {transferDecision ? <TransferMatchDialog accounts={loadState.status === "ready" ? loadState.accounts : []} original={transferComparison(transferDecision.input, id => accountNames.get(id))} originalSource={transferDecision.mergeId ? "Recorded transfer selected" : "New manual transfer"} matches={transferDecision.matches} busy={isSubmitting} error={matchError} merging={Boolean(transferDecision.mergeId)} onAccept={(match, choices) => void handleTransferDecision(match, choices)} onSeparate={() => void handleTransferDecision()} onCancel={() => setTransferDecision(null)} /> : null}
    </div>
  );
}
