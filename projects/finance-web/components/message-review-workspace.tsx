"use client";
import { formatCurrency, formatTimestamp as formatDateTime, timestampFields } from "../../finance-contracts/presentation";

import Link from "next/link";
import { HelpTooltip } from "@/components/help-tooltip";
import { useAuth } from "@/components/auth-provider";
import { FieldError } from "@/components/field-error";
import { fieldErrorsFrom, focusFieldError, nativeFieldErrors } from "@/lib/form-feedback";
import { publishReviewCount, reviewFieldErrors, type ReviewValues } from "@/lib/review-status";
import { canFindTransferMatch, confidenceBands, confidenceRangeError, confidenceValue, hasOriginalSms, matchesConfidence, matchesReviewCondition, reviewConditions, reviewSummary, type ConfidenceBand, type ReviewCondition } from "@/lib/review-filters";
import { createReviewDrafts } from "@/lib/review-drafts";
import { RecentTransactionAction, useTransactionRecovery } from "@/components/transaction-recovery";

import { DatePeriodControls } from "@/components/date-period-controls";
import { allDates, dateInPeriod, type DatePeriod } from "@/lib/date-period";

import { useFeedbackMessage } from "@/components/toast-provider";

import { ArrowClockwise, ArrowLeft, ArrowRight, ArrowsLeftRight, CheckCircle, CornersIn, CornersOut, DotsThree, FunnelSimple, Info, List, MagnifyingGlass, Warning, X } from "@phosphor-icons/react";
import type React from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { ButtonBusy, LoadingState } from "@/components/loading-state";
import {
  type Account,
  type Category,
  type ParsedMessageCandidate,
  type PaymentMethod,
  type TransactionDirection,
  type TransactionType,
  confirmMessageCandidate,
  findTransferMatches,
  getPendingMessageCandidate,
  linkTransfer,
  type ConfirmMessageCandidateInput,
  type TransferMatch,
  listAccounts,
  listCategories,
  listMessageCandidatePage,
  listPaymentMethods,
  redactRawMessage,
  reprocessPendingMessageCandidates,
  reprocessMessageCandidate,
  rejectMessageCandidate
} from "@/lib/api";
import { useReviewFocus } from "@/components/use-review-focus";
import { ModalDialog } from "@/components/modal-dialog";
import { TransferMatchDialog } from "@/components/transfer-match-dialog";
import { getAccessToken } from "@/lib/auth-storage";
import { useCategoryTypeChoice } from "@/components/use-category-type-choice";
import { directionForType, transactionTypes } from "@/lib/category-type";
import { balanceAfterAccountChange } from "@/lib/transaction-balances";
import { transferComparison } from "../../finance-contracts/transfer-comparison";

type ReviewState =
  | { status: "loading" }
  | { message: string; status: "error" }
  | { accounts: Account[]; candidates: ParsedMessageCandidate[]; categories: Category[]; paymentMethods: PaymentMethod[]; status: "ready"; totalCount: number };

type RejectDraft = {
  candidate: ParsedMessageCandidate;
  note: string;
  reason: string;
  redact: boolean;
  scope: "message" | "provider" | "sender" | "kind";
};

function accountReviewDefaults(candidate: ParsedMessageCandidate) {
  const incoming = candidate.suggested_transfer_direction ? candidate.suggested_transfer_direction === "credit"
    : ["cash_in", "receive_money", "bank_transfer_in"].includes(candidate.message_kind);
  const reportingRole = incoming || ["income", "refund"].includes(candidate.transaction_type) ? "receiver" : "sender";
  const weakRoles = new Set(candidate.identity_suggestions.map(hint => hint.role));
  return {
    account: weakRoles.has(reportingRole) ? "" : (incoming ? candidate.destination_account ?? candidate.account : candidate.account) ?? "",
    other: weakRoles.has(reportingRole === "receiver" ? "sender" : "receiver") ? "" : (incoming ? candidate.destination_account ? candidate.account : null : candidate.destination_account) ?? "",
    transferDirection: candidate.suggested_transfer_direction || (incoming || ["income", "refund"].includes(candidate.transaction_type) ? "credit" : "debit"),
    direction: candidate.suggested_transfer_direction || (incoming || ["income", "refund"].includes(candidate.transaction_type) ? "credit" : "debit")
  };
}

function formatLabel(value: string) {
  return value.replaceAll("_", " ").replace(/\b\w/g, (character) => character.toUpperCase());
}

const queueDayFormatter = new Intl.DateTimeFormat("en-BD", { month: "short", day: "numeric" });
const queueTimeFormatter = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

function dateInputFromTimestamp(value: string) { return timestampFields(value).date; }
function timeInputFromTimestamp(value: string) { return timestampFields(value).time; }

const confidenceFormatter = new Intl.NumberFormat("en", { maximumFractionDigits: 2 });

function confidencePercent(value: string) {
  const percent = confidenceValue(value);
  return percent === null ? "Unknown" : `${confidenceFormatter.format(percent)}%`;
}

function normalizedNote(candidate: ParsedMessageCandidate) {
  const parts = [formatLabel(candidate.message_kind)];
  if (candidate.counterparty_text) parts.push(candidate.counterparty_text);
  return parts.join(" · ");
}

export function MessageReviewWorkspace() {
  const recovery = useTransactionRecovery();
  const { session } = useAuth();
  const owner = session.status === "signed-in" ? session.user.id : null;
  const ownerRef = useRef(owner); ownerRef.current = owner;
  const loadVersion = useRef(0);
  const loadedLimit = useRef(100);
  const [loadingMore, setLoadingMore] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const nativeDrafts = useRef(createReviewDrafts());
  const [formRevisions, setFormRevisions] = useState<Record<string, number>>({});
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const feedback = (field: string) => ({ "aria-invalid": Boolean(fieldErrors[field]), "aria-describedby": fieldErrors[field] ? `review-error-${field}` : undefined });
  const confirmInFlight = useRef(false);
  const [transferDecision, setTransferDecision] = useState<{ candidate: ParsedMessageCandidate; input: ConfirmMessageCandidateInput; matches: TransferMatch[]; lookupOnly?: boolean } | null>(null);
  const [paymentMethodDrafts, setPaymentMethodDrafts] = useState<Record<string, string>>({});
  const [accountDrafts, setAccountDrafts] = useState<Record<string, ReturnType<typeof accountReviewDefaults>>>({});
  const [matchError, setMatchError] = useFeedbackMessage("error");
  const [reviewState, setReviewState] = useState<ReviewState>({ status: "loading" });
  const [activeCandidateId, setActiveCandidateId] = useState("");
  const [actionError, setActionError] = useFeedbackMessage("error");
  const [actionMessage, setActionMessage] = useFeedbackMessage("success");
  const [linkNotice, setLinkNotice] = useState("");
  const [lookupInProgress, setLookupInProgress] = useState(false);
  const [workingCandidateId, setWorkingCandidateId] = useState<string | null>(null);
  const [reprocessingCandidateId, setReprocessingCandidateId] = useState<string | null>(null);
  const [isBulkReprocessing, setIsBulkReprocessing] = useState(false);
  const [period, setPeriod] = useState<DatePeriod>(allDates);
  const [query, setQuery] = useState("");
  const queueList = useRef<HTMLDivElement>(null);
  const reviewSurface = useRef<HTMLDivElement>(null);
  const [focusMode, setFocusMode] = useState(false);
  const [focusQueueOpen, setFocusQueueOpen] = useState(true);
  const [amountDrafts, setAmountDrafts] = useState<Record<string, string>>({});
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [providerFilter, setProviderFilter] = useState("all");
  const [issueFilter, setIssueFilter] = useState<ReviewCondition>("all");
  const [confidenceFilter, setConfidenceFilter] = useState<ConfidenceBand>("all");
  const [confidenceMin, setConfidenceMin] = useState("");
  const [confidenceMax, setConfidenceMax] = useState("");
  const [accountFilter, setAccountFilter] = useState("all");
  const [directionFilter, setDirectionFilter] = useState("all");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState("all");
  const [returnPath, setReturnPath] = useState("");
  const [rejectDraft, setRejectDraft] = useState<RejectDraft | null>(null);
  const [classificationDrafts, setClassificationDrafts] = useState<Record<string, { type: TransactionType; category: string; balanceAfter: string; balanceCleared?: boolean }>>({});
  const categoryChoice = useCategoryTypeChoice(reviewState.status === "ready" ? reviewState.categories : []);

  useEffect(() => {
    const requestedReturn = new URLSearchParams(window.location.search).get("return");
    if (requestedReturn === "/review") setReturnPath(requestedReturn);
  }, []);

  async function loadData(showLoading = true) {
    const accessToken = getAccessToken();
    const ticket = ++loadVersion.current;
    const requestOwner = ownerRef.current;
    if (!accessToken) {
      setReviewState({ message: "Sign in before reviewing SMS candidates.", status: "error" });
      return;
    }
    if (showLoading) setReviewState({ status: "loading" });
    try {
      const requestedCandidateId = new URLSearchParams(window.location.search).get("candidate") ?? "";
      const [accounts, categories, firstPage, paymentMethods] = await Promise.all([
        listAccounts(accessToken),
        listCategories(accessToken),
        listMessageCandidatePage(accessToken, 0, 100),
        listPaymentMethods(accessToken)
      ]);
      const candidates = [...firstPage.results];
      while (candidates.length < firstPage.count && candidates.length < loadedLimit.current) {
        const page = await listMessageCandidatePage(accessToken, candidates.length, Math.min(100, loadedLimit.current - candidates.length));
        if (!page.results.length) break;
        candidates.push(...page.results);
      }
      let unavailableLink = false;
      if (requestedCandidateId && !candidates.some(candidate => candidate.id === requestedCandidateId)) {
        try {
          candidates.push(await getPendingMessageCandidate(accessToken, requestedCandidateId));
        } catch (error) {
          if (!(error instanceof Error && "status" in error && error.status === 404)) throw error;
          unavailableLink = true;
        }
      }
      if (ticket !== loadVersion.current || requestOwner !== ownerRef.current) return;
      setLinkNotice(unavailableLink ? "That message is no longer pending or available to this account. Showing your current inbox." : "");
      if (unavailableLink) {
        const params = new URLSearchParams(window.location.search);
        if (params.get("candidate") === requestedCandidateId) {
          params.delete("candidate");
          window.history.replaceState(null, "", `${window.location.pathname}${params.size ? `?${params.toString()}` : ""}`);
        }
      }
      setReviewState({ accounts, candidates, categories, paymentMethods, status: "ready", totalCount: firstPage.count });
      publishReviewCount(firstPage.count, requestOwner);
      setActiveCandidateId((current) => {
        if (candidates.some((candidate) => candidate.id === requestedCandidateId)) return requestedCandidateId;
        if (candidates.some((candidate) => candidate.id === current)) return current;
        return candidates[0]?.id ?? "";
      });
    } catch (error) {
      if (ticket !== loadVersion.current || requestOwner !== ownerRef.current) return;
      setReviewState({ message: error instanceof Error ? error.message : "Could not load SMS review inbox.", status: "error" });
    }
  }

  async function loadMoreCandidates() {
    loadedLimit.current += 100;
    setLoadingMore(true);
    try { await loadData(false); }
    finally { setLoadingMore(false); }
  }

  useEffect(() => { const version = loadVersion; void loadData();
    const refresh = () => { void loadData(false); };
    window.addEventListener("finance:transactions-changed", refresh);
    return () => { version.current++; window.removeEventListener("finance:transactions-changed", refresh); };
  }, []);

  useEffect(() => {
    if (reviewState.status !== "ready") return;
    const params = new URLSearchParams(window.location.search);
    if (activeCandidateId) params.set("candidate", activeCandidateId);
    else params.delete("candidate");
    window.history.replaceState(null, "", `${window.location.pathname}${params.size ? `?${params.toString()}` : ""}`);
  }, [activeCandidateId, reviewState.status]);

  const valuesFor = useCallback((candidate: ParsedMessageCandidate): ReviewValues => {
    const account = accountDrafts[candidate.id] ?? accountReviewDefaults(candidate);
    const classification = classificationDrafts[candidate.id];
    return { account: account.account, other: account.other, amount: amountDrafts[candidate.id] ?? candidate.amount ?? "", type: classification?.type ?? candidate.transaction_type, category: classification?.category ?? candidate.category ?? "" };
  }, [accountDrafts, amountDrafts, classificationDrafts]);
  const filteredCandidates = useMemo(() => {
    if (reviewState.status !== "ready") return [];
    const normalizedQuery = query.trim().toLowerCase();
    return reviewState.candidates.filter((candidate) => {
      if (!dateInPeriod(candidate.raw_message.received_at, period)) return false;
      if (providerFilter !== "all" && candidate.provider !== providerFilter) return false;
      if (typeFilter !== "all" && candidate.transaction_type !== typeFilter) return false;
      if (categoryFilter === "uncategorized" && candidate.category) return false;
      if (categoryFilter !== "all" && categoryFilter !== "uncategorized" && candidate.category !== categoryFilter) return false;
      const values = valuesFor(candidate);
      if (!matchesConfidence(candidate.confidence, confidenceFilter, confidenceMin, confidenceMax)) return false;
      if (accountFilter !== "all" && values.account !== accountFilter && !(values.type === "transfer" && values.other === accountFilter)) return false;
      if (directionFilter !== "all" && (accountDrafts[candidate.id] ?? accountReviewDefaults(candidate)).direction !== directionFilter) return false;
      const keepEditedSelection = ["ready", "missing", "amount", "account", "transfer_account", "same_accounts", "uncategorized"].includes(issueFilter) && candidate.id === activeCandidateId && Boolean(accountDrafts[candidate.id] || classificationDrafts[candidate.id] || amountDrafts[candidate.id] !== undefined);
      if (!keepEditedSelection && !matchesReviewCondition(candidate, values, issueFilter)) return false;
      if (!normalizedQuery) return true;
      return [candidate.provider, candidate.message_kind, candidate.raw_message.sender, candidate.counterparty_text, candidate.reference]
        .some((value) => value.toLowerCase().includes(normalizedQuery));
    });
  }, [categoryFilter, issueFilter, confidenceFilter, confidenceMin, confidenceMax, accountFilter, directionFilter, providerFilter, query, reviewState, typeFilter, period, valuesFor, activeCandidateId, accountDrafts, classificationDrafts, amountDrafts]);

  const activeCandidate = filteredCandidates.find((candidate) => candidate.id === activeCandidateId) ?? filteredCandidates[0] ?? null;
  useEffect(() => {
    if (activeCandidate && activeCandidateId !== activeCandidate.id) setActiveCandidateId(activeCandidate.id);
  }, [activeCandidate, activeCandidateId]);
  const activeValues = activeCandidate ? valuesFor(activeCandidate) : null;
  const summary = activeCandidate && activeValues ? reviewSummary(activeCandidate, activeValues) : null;
  const activeCorrections = activeValues ? Object.keys(reviewFieldErrors(activeValues)) : [];
  const isFocused = focusMode && reviewState.status === "ready" && reviewState.candidates.length > 0;
  const prepareFocus = useReviewFocus(isFocused, reviewSurface, queueList, () => setFocusMode(false));
  const selectedReviewId = activeCandidate?.id;
  useEffect(() => {
    setFieldErrors({});
  }, [selectedReviewId]);
  useEffect(() => {
    if (reviewState.status === "ready" && !reviewState.candidates.length) setFocusMode(false);
  }, [reviewState]);
  const accountDraft = activeCandidate ? accountDrafts[activeCandidate.id] ?? accountReviewDefaults(activeCandidate) : null;
  function updateAccountDraft(patch: Partial<ReturnType<typeof accountReviewDefaults>>) {
    if (!activeCandidate || !accountDraft) return;
    if (patch.account !== undefined && classification) {
      const balanceAfter = balanceAfterAccountChange(classification.balanceAfter, accountDraft.account, patch.account);
      if (balanceAfter !== classification.balanceAfter) {
        setClassificationDrafts((current) => ({ ...current, [activeCandidate.id]: { ...classification, balanceAfter, balanceCleared: true } }));
      }
    }
    if (patch.account !== undefined && patch.account !== accountDraft.account) {
      setPaymentMethodDrafts(current => ({ ...current, [activeCandidate.id]: "" }));
    }
    setAccountDrafts((current) => ({ ...current, [activeCandidate.id]: { ...accountDraft, ...patch, ...(patch.transferDirection === undefined && patch.direction && classification?.type === "transfer" ? { transferDirection: patch.direction } : {}) } }));
  }
  const classification = activeCandidate ? classificationDrafts[activeCandidate.id] ?? { type: activeCandidate.transaction_type as TransactionType, category: activeCandidate.category ?? "", balanceAfter: activeCandidate.balance_after ?? "" } : null;
  function applyClassification(category: string, type: TransactionType) {
    if (!activeCandidate || !classification) return;
    setClassificationDrafts((current) => ({ ...current, [activeCandidate.id]: { ...classification, type, category } }));
    if (type !== classification.type) {
      updateAccountDraft({ direction: type === "transfer" ? accountDraft?.transferDirection ?? "debit" : directionForType(type), transferDirection: classification.type === "transfer" ? accountDraft?.direction ?? "debit" : accountDraft?.transferDirection ?? "debit" });
    }
  }
  const activeIndex = activeCandidate ? filteredCandidates.findIndex((candidate) => candidate.id === activeCandidate.id) : -1;
  useEffect(() => {
    const list = queueList.current;
    const selected = list?.querySelector<HTMLElement>('[aria-current="true"]');
    if (!list || !selected) return;
    const itemBounds = selected.getBoundingClientRect();
    const listBounds = list.getBoundingClientRect();
    if (itemBounds.top < listBounds.top) list.scrollTop += itemBounds.top - listBounds.top;
    else if (itemBounds.bottom > listBounds.bottom) list.scrollTop += itemBounds.bottom - listBounds.bottom;
  }, [activeCandidate?.id, isFocused, focusQueueOpen]);

  const accountNameById = useMemo(() => reviewState.status === "ready"
    ? new Map(reviewState.accounts.map((account) => [account.id, account.name]))
    : new Map<string, string>(), [reviewState]);
  const selectedPaymentMethod = activeCandidate && reviewState.status === "ready" ? paymentMethodDrafts[activeCandidate.id] ?? reviewState.paymentMethods.find(method => method.account === accountDraft?.account && [activeCandidate.payment_method, activeCandidate.destination_payment_method].includes(method.id))?.id ?? "" : "";
  const providers = useMemo(() => reviewState.status === "ready"
    ? Array.from(new Set(reviewState.candidates.map((candidate) => candidate.provider))).sort()
    : [], [reviewState]);

  async function handleConfirm(candidate: ParsedMessageCandidate, event: React.FormEvent<HTMLFormElement> | null, lookupOnly = false) {
    event?.preventDefault();
    const form = event?.currentTarget ?? formRef.current;
    if (!form || reprocessingCandidateId !== null || isBulkReprocessing) return;
    const accessToken = getAccessToken();
    if (!accessToken) return setActionError("Sign in before confirming SMS candidates.");
    const formData = new FormData(form);
    const errors = { ...nativeFieldErrors(form), ...reviewFieldErrors(valuesFor(candidate)) };
    // An existing transfer may supply its missing other account during matching.
    if (valuesFor(candidate).type === "transfer" && !valuesFor(candidate).other) delete errors.transfer_account;
    if (Object.keys(errors).length) { setFieldErrors(errors); setActionError("Check the highlighted fields."); focusFieldError(form, errors); return; }
    setFieldErrors({});
    setActionError(null);
    setActionMessage(null);
    if (confirmInFlight.current) return;
    confirmInFlight.current = true;
    setWorkingCandidateId(candidate.id);
    setLookupInProgress(lookupOnly);
    try {
      const input: ConfirmMessageCandidateInput = {
        account_perspective: true,
        account: String(formData.get("account") ?? "") || undefined,
        amount: String(formData.get("amount") ?? "") || undefined,
        balance_after: String(formData.get("balance_after") ?? "") || null,
        category: String(formData.get("category") ?? "") || null,
        counterparty_text: String(formData.get("counterparty_text") ?? ""),
        date: String(formData.get("date") ?? "") || undefined,
        direction: String(formData.get("direction") ?? "") as TransactionDirection,
        note: String(formData.get("note") ?? ""),
        payment_method: String(formData.get("payment_method") ?? "") || null,
        reference: String(formData.get("reference") ?? ""),
        receiver_account_identifier: String(formData.get("receiver_account_identifier") ?? ""),
        receiver_card_identifier: String(formData.get("receiver_card_identifier") ?? ""),
        remember_mapping: formData.get("remember_mapping") === "on",
        sender_account_identifier: String(formData.get("sender_account_identifier") ?? ""),
        sender_card_identifier: String(formData.get("sender_card_identifier") ?? ""),
        time: String(formData.get("time") ?? "") || null,
        transfer_account: formData.get("type") === "transfer" ? String(formData.get("transfer_account") ?? "") || null : null,
        type: String(formData.get("type") ?? candidate.transaction_type) as TransactionType
      };
      if (canFindTransferMatch(candidate, valuesFor(candidate))) {
        const matches = await findTransferMatches(accessToken, { candidate: candidate.id, draft: input });
        if (matches.length) {
          setMatchError(null);
          setTransferDecision({ candidate, input, matches, lookupOnly });
          return;
        }
      }
      if (lookupOnly) { setActionMessage("No matching transfer found. Review the details before adding."); return; }
      if (input.type === "transfer" && !input.transfer_account) {
        const errors = { transfer_account: "Choose the other transfer account." };
        setFieldErrors(errors); setActionError("Choose the other transfer account, or accept an existing match."); focusFieldError(formRef.current, errors); return;
      }
      const saved = await confirmMessageCandidate(accessToken, candidate.id, input);
      recovery.announce(saved.undo_action);
      await loadData(false);
    } catch (error) {
      const errors = fieldErrorsFrom(error); setFieldErrors(errors); focusFieldError(formRef.current, errors);
      setActionError(error instanceof Error ? error.message : "Could not confirm candidate.");
    } finally {
      confirmInFlight.current = false;
      setLookupInProgress(false);
      setWorkingCandidateId(null);
    }
  }

  async function handleTransferDecision(match?: TransferMatch, balanceChoices: import("@/lib/api").TransferBalanceChoice[] = []) {
    const accessToken = getAccessToken();
    if (!accessToken || !transferDecision || confirmInFlight.current) return;
    if (!match && transferDecision.lookupOnly) { setTransferDecision(null); return; }
    if (!match && transferDecision.input.type === "transfer" && !transferDecision.input.transfer_account) {
      setTransferDecision(null);
      const errors = { transfer_account: "Choose the other account before adding a separate transfer." };
      setFieldErrors(errors); setActionError(errors.transfer_account);
      requestAnimationFrame(() => focusFieldError(formRef.current, errors)); return;
    }
    confirmInFlight.current = true;
    setWorkingCandidateId(transferDecision.candidate.id);
    setMatchError(null);
    try {
      const saved = match ? await linkTransfer(accessToken, { candidate: transferDecision.candidate.id, draft: transferDecision.input }, match, balanceChoices)
        : await confirmMessageCandidate(accessToken, transferDecision.candidate.id, transferDecision.input);
      recovery.announce(saved.undo_action);
      setTransferDecision(null);
      await loadData(false);

    } catch (error) {
      setMatchError(error instanceof Error ? error.message : "Could not link transfer.");
    } finally { confirmInFlight.current = false; setWorkingCandidateId(null); }
  }

  async function handleReject(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!rejectDraft) return;
    const accessToken = getAccessToken();
    if (!accessToken) return setActionError("Sign in before rejecting SMS candidates.");
    setActionError(null);
    setActionMessage(null);
    setWorkingCandidateId(rejectDraft.candidate.id);
    try {
      await rejectMessageCandidate(accessToken, rejectDraft.candidate.id, {
        exclude_message_kind: rejectDraft.scope === "kind",
        exclude_provider: rejectDraft.scope === "provider",
        exclude_sender: rejectDraft.scope === "sender",
        note: rejectDraft.note,
        reason: rejectDraft.reason,
        redact_raw_sms: rejectDraft.redact
      });
      setRejectDraft(null);
      setActionMessage(rejectDraft.scope === "kind"
        ? "Skip rule saved. Matching non-transaction notices are removed from review and will be skipped in future. Undo in SMS settings."
        : "Message rejected. Your capture rules were updated if requested.");
      await loadData(false);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Could not reject candidate.");
    } finally {
      setWorkingCandidateId(null);
    }
  }

  async function handleRedact(candidate: ParsedMessageCandidate) {
    const accessToken = getAccessToken();
    if (!accessToken) return setActionError("Sign in before redacting raw SMS messages.");
    setWorkingCandidateId(candidate.id);
    setActionError(null);
    try {
      await redactRawMessage(accessToken, candidate.raw_message.id);
      setActionMessage("Original SMS text was redacted; parsed evidence remains available.");
      await loadData(false);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Could not redact raw SMS.");
    } finally {
      setWorkingCandidateId(null);
    }
  }

  async function handleReprocess(candidate: ParsedMessageCandidate) {
    const accessToken = getAccessToken();
    if (!accessToken) return setActionError("Sign in before re-running the parser.");
    setReprocessingCandidateId(candidate.id);
    setActionError(null);
    setActionMessage(null);
    try {
      const updated = await reprocessMessageCandidate(accessToken, candidate.id);
      nativeDrafts.current.reset(candidate.id);
      setFormRevisions(current => ({ ...current, [candidate.id]: (current[candidate.id] ?? 0) + 1 }));
      if (updated.status !== "needs_review") {
        setActionMessage("The message was identified as non-transactional and removed from review.");
        await loadData(false);
        return;
      }
      setClassificationDrafts((current) => { const next = { ...current }; delete next[candidate.id]; return next; });
      setAccountDrafts(current => { const next = { ...current }; delete next[candidate.id]; return next; });
      setAmountDrafts(current => { const next = { ...current }; delete next[candidate.id]; return next; });
      setPaymentMethodDrafts(current => { const next = { ...current }; delete next[candidate.id]; return next; });
      setReviewState((current) => current.status === "ready"
        ? { ...current, candidates: current.candidates.map((item) => item.id === updated.id ? updated : item) }
        : current);
      setActionMessage("Parser re-run complete. Review the refreshed fields before confirming.");
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Could not re-run the parser.");
    } finally {
      setReprocessingCandidateId(null);
    }
  }

  async function handleBulkReprocess() {
    const accessToken = getAccessToken();
    if (!accessToken) return setActionError("Sign in before reapplying parser rules.");
    if (!window.confirm(
      "Re-run the latest parser and learned mappings for every pending message? Confirmed transactions will not be changed."
    )) return;

    setIsBulkReprocessing(true);
    setActionError(null);
    setActionMessage(null);
    try {
      const result = await reprocessPendingMessageCandidates(accessToken);
      nativeDrafts.current.reset();
      if (reviewState.status === "ready") setFormRevisions(current => Object.fromEntries(reviewState.candidates.map(candidate => [candidate.id, (current[candidate.id] ?? 0) + 1])));
      setAccountDrafts({}); setAmountDrafts({}); setClassificationDrafts({}); setPaymentMethodDrafts({});
      await loadData(false);
      setActionMessage(
        `Reprocessed ${result.reprocessed} of ${result.requested} pending messages. ${result.remaining_for_review} remain for review.`
      );
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Could not reapply parser rules.");
    } finally {
      setIsBulkReprocessing(false);
    }
  }

  function clearFilters() {
    setProviderFilter("all"); setIssueFilter("all"); setCategoryFilter("all"); setTypeFilter("all"); setConfidenceFilter("all"); setConfidenceMin(""); setConfidenceMax(""); setAccountFilter("all"); setDirectionFilter("all");
  }
  const activeFilters = [
    { key: "provider", value: providerFilter, label: formatLabel(providerFilter), clear: () => setProviderFilter("all") },
    { key: "state", value: issueFilter, label: reviewConditions.find(condition => condition.value === issueFilter)?.label ?? "Condition", clear: () => setIssueFilter("all") },
    { key: "category", value: categoryFilter, label: categoryFilter === "uncategorized" ? "Uncategorized" : reviewState.status === "ready" ? reviewState.categories.find(category => category.id === categoryFilter)?.name ?? "Category" : "Category", clear: () => setCategoryFilter("all") },
    { key: "type", value: typeFilter, label: formatLabel(typeFilter), clear: () => setTypeFilter("all") },
    { key: "confidence", value: confidenceFilter, label: confidenceFilter === "custom" ? `Confidence ${confidenceMin || "0"}–${confidenceMax || "100"}%` : `Confidence ${confidenceBands.find(band => band.value === confidenceFilter)?.label}`, clear: () => setConfidenceFilter("all") },
    { key: "account", value: accountFilter, label: accountNameById.get(accountFilter) ?? "Account", clear: () => setAccountFilter("all") },
    { key: "direction", value: directionFilter, label: directionFilter === "credit" ? "Money received" : "Money sent", clear: () => setDirectionFilter("all") }
  ].filter(filter => filter.value !== "all");

  if (reviewState.status === "loading") return <LoadingState detail="Checking messages and parser confidence" label="Preparing the review inbox" />;
  if (reviewState.status === "error") return <section className="panel"><div className="panel__body"><h2 className="section-title">SMS review inbox</h2><p className="section-subtitle">{reviewState.message}</p></div></section>;

  return (
    <div className={`workspace-grid review-workspace${isFocused ? " review-workspace--focus" : ""}`}>
      {categoryChoice.confirmation}
      {actionError ? <p className="form-error" role="alert">{actionError}</p> : null}
      {actionMessage ? <p className="form-success"><CheckCircle aria-hidden="true" size={18} weight="fill" />{actionMessage}</p> : null}
      {linkNotice ? <p className="form-warning" role="status"><Warning aria-hidden="true" size={18} />{linkNotice}</p> : null}

      <div className={`review-canvas${isFocused && !focusQueueOpen ? " review-canvas--queue-collapsed" : ""}`} ref={reviewSurface} role={isFocused ? "dialog" : undefined} aria-modal={isFocused || undefined} aria-label={isFocused ? "Focused SMS review" : undefined}>
        <div className="review-focus-header" hidden={!isFocused}>
          <div><h2 className="review-focus-title" tabIndex={-1}>{activeCandidate ? `SMS review · ${formatCurrency(activeValues?.amount)}` : "SMS review"}</h2><span aria-live="polite" aria-atomic="true">{activeCandidate ? `${accountNameById.get(accountDraft?.account ?? "") ?? "Account not selected"} · ${activeIndex + 1} / ${filteredCandidates.length}` : "No messages match these filters"}</span></div>
          <div className="review-focus-header__actions">
            {reviewState.candidates.length < reviewState.totalCount ? <button className="button button--ghost" disabled={loadingMore} onClick={() => void loadMoreCandidates()} type="button">{loadingMore ? "Loading…" : "Load more"}</button> : null}
            <button className="button button--ghost" type="button" aria-haspopup="dialog" onClick={() => setFiltersOpen(true)} aria-label={`Filters, ${activeFilters.length} active`} title="Filter pending messages"><FunnelSimple size={18} aria-hidden="true" /><span>Filters{activeFilters.length ? ` (${activeFilters.length})` : ""}</span></button>
            <button className="button button--ghost review-focus-queue-toggle" type="button" aria-expanded={focusQueueOpen} aria-controls="sms-review-queue" aria-label={focusQueueOpen ? "Hide messages" : "Show messages"} title={focusQueueOpen ? "Hide messages" : "Show messages"} onClick={() => setFocusQueueOpen(current => !current)}><List size={18} aria-hidden="true" /><span>{focusQueueOpen ? "Hide messages" : "Show messages"}</span></button>
            <button className="button button--ghost" type="button" aria-label="Exit focus" title="Exit focus (Escape)" onClick={() => setFocusMode(false)}><CornersIn size={19} aria-hidden="true" /><span>Exit focus</span></button>
          </div>
        </div>
        <section className="panel review-date-toolbar review-inbox-toolbar" aria-label="Review inbox controls">
          <div className="review-toolbar__title">
            <h2 className="section-title">SMS review inbox</h2>
            <HelpTooltip label="About SMS review">Resolve one message at a time. Required corrections are highlighted before confirmation.</HelpTooltip>
          </div>
          {reviewState.candidates.length > 0 ? <div className="review-toolbar__dates"><DatePeriodControls compact label="Received dates" description="Local timezone" value={period} onChange={setPeriod} /></div> : null}
          <div className="review-hero__actions"><span className="status-badge status-badge--idle">{reviewState.totalCount} pending</span><button className="button button--ghost" disabled={isBulkReprocessing || reviewState.candidates.length === 0} onClick={() => void handleBulkReprocess()} type="button">{isBulkReprocessing ? <ButtonBusy label="Reapplying rules" /> : <><ArrowClockwise aria-hidden="true" size={17} />Reapply rules to pending</>}</button></div>
        </section>
        {returnPath ? <div className="review-return"><Link className="button button--ghost" href={returnPath}><ArrowLeft aria-hidden="true" size={17} />Return to matched review</Link><span>Saved SMS corrections will be reconsidered for one-to-one matching.</span></div> : null}
        <div className="review-recovery"><RecentTransactionAction /></div>

      {reviewState.candidates.length === 0 ? (
        <section className="panel"><div className="panel__body empty-state"><CheckCircle aria-hidden="true" size={34} weight="fill" /><h2 className="section-title">Review queue is clear</h2><p className="section-subtitle">No captured messages currently require a decision.</p></div></section>
      ) : (
        <section className="review-split">
          <aside className="panel review-queue" id="sms-review-queue" aria-label="Pending messages">
            <div className="review-queue__filters">
              <div className="review-queue__search-row">
                <label className="review-search"><MagnifyingGlass aria-hidden="true" size={18} /><input aria-label="Search review queue" onChange={event => setQuery(event.target.value)} placeholder="Search messages" type="search" value={query} /></label>
                <button className="button button--ghost review-filter-trigger" aria-label={`Filters${activeFilters.length ? `, ${activeFilters.length} active` : ""}`} aria-haspopup="dialog" onClick={() => setFiltersOpen(true)} type="button"><FunnelSimple aria-hidden="true" size={18} /><span>Filters{activeFilters.length ? ` (${activeFilters.length})` : ""}</span></button>
              </div>
              {activeFilters.length ? <div className="review-active-filters" aria-label="Active filters">{activeFilters.map(filter => <button key={filter.key} type="button" onClick={filter.clear} aria-label={`Remove ${filter.label} filter`}>{filter.label}<X aria-hidden="true" size={12} /></button>)}<button type="button" onClick={clearFilters}>Clear filters</button></div> : null}
              <span className="review-queue__count" role="status">{filteredCandidates.length} shown · {reviewState.candidates.length} loaded of {reviewState.totalCount} pending{reviewState.candidates.length < reviewState.totalCount ? " · Filters apply to loaded messages" : ""}</span>
            </div>
            <div className="review-queue__list" ref={queueList}>
              {filteredCandidates.map((candidate) => {
                const status = reviewSummary(candidate, valuesFor(candidate));
                const selected = candidate.id === activeCandidate?.id;
                return <button aria-current={selected ? "true" : undefined} className={`review-queue-item${selected ? " review-queue-item--active" : ""}`} key={candidate.id} onClick={() => setActiveCandidateId(candidate.id)} type="button">
                  <span className="review-queue-item__top"><strong>{valuesFor(candidate).amount ? formatCurrency(valuesFor(candidate).amount) : "Amount needed"}</strong><small><time dateTime={candidate.raw_message.received_at} title={formatDateTime(candidate.raw_message.received_at)}><span>{queueDayFormatter.format(new Date(candidate.raw_message.received_at))}</span><span>{queueTimeFormatter.format(new Date(candidate.raw_message.received_at))}</span></time></small></span>
                  <span className="review-queue-item__description"><span title={candidate.counterparty_text || formatLabel(candidate.message_kind)}>{candidate.counterparty_text || formatLabel(candidate.message_kind)}</span><small>· {formatLabel(candidate.provider)}</small></span>
                  <span className="review-queue-item__status"><span className={status.tone === "ready" ? "review-queue-item__ready" : status.tone === "warning" ? "review-queue-item__issue" : ""}>{status.title}</span><small title="Parser confidence">{confidencePercent(candidate.confidence)}</small></span>
                </button>;
              })}
              {!filteredCandidates.length ? <div className="review-queue__empty">No messages match these filters.</div> : null}
              {reviewState.candidates.length < reviewState.totalCount ? <button className="button button--ghost" disabled={loadingMore} onClick={() => void loadMoreCandidates()} type="button">{loadingMore ? "Loading…" : "Load 100 more messages"}</button> : null}
            </div>
          </aside>

          {activeCandidate ? (
            <article className="panel review-detail">
              <form noValidate ref={formRef} key={`${activeCandidate.id}:${formRevisions[activeCandidate.id] ?? 0}`} onChangeCapture={event => { const input = event.target as HTMLInputElement; const name = input.name; nativeDrafts.current.capture(activeCandidate.id, name, input.type === "checkbox" ? input.checked : input.value); setFieldErrors(current => { const next = { ...current }; delete next[name]; return next; }); }} onSubmit={(event) => void handleConfirm(activeCandidate, event)}>
                <div className="review-detail__content">
                <div className="review-detail__header">
                  <div className="review-detail__summary">
                    <span className="review-card__eyebrow">{formatLabel(activeCandidate.provider)} / {formatLabel(activeCandidate.message_kind)}</span>
                    <div className="review-amount-row">
                      <h2 className="review-card__amount">{(activeValues?.amount) ? formatCurrency(activeValues?.amount) : "Complete the amount"}</h2>
                      <button type="button" className={`review-direction-toggle review-direction-toggle--${accountDraft?.direction ?? "debit"}`}
                        aria-label={`Switch to ${accountDraft?.direction === "credit" ? "debit / money sent" : "credit / money received"}`}
                        aria-describedby="review-direction-context"
                        title={`Change direction for ${accountNameById.get(accountDraft?.account ?? "") ?? "the selected account"}`}
                        disabled={workingCandidateId === activeCandidate.id}
                        onClick={() => updateAccountDraft({ direction: accountDraft?.direction === "credit" ? "debit" : "credit" })}>
                        <span>{accountDraft?.direction === "credit" ? "Credit" : "Debit"}</span><ArrowsLeftRight aria-hidden="true" size={18} />
                      </button>
                    </div>
                    <p className="review-card__confidence review-summary-meta"><span className="inline-help">Parser confidence {confidencePercent(activeCandidate.confidence)}<HelpTooltip label="About parser confidence">Confidence in parsing this SMS. This is not a transfer-match probability; transfer suggestions explain their matching evidence.</HelpTooltip></span><span id="review-direction-context">{classification?.type === "transfer" ? `Reported by ${accountNameById.get(accountDraft?.account ?? "") ?? "the selected account"}` : `${accountDraft?.direction === "credit" ? "Money into" : "Money out of"} ${accountNameById.get(accountDraft?.account ?? "") ?? "the selected account"}`}</span></p>
                  </div>

                </div>

                <div className={`review-issue-bar review-issue-bar--${summary?.tone}`}>
                  {summary?.tone === "ready" ? <CheckCircle aria-hidden="true" size={19} weight="fill" /> : summary?.tone === "info" ? <Info aria-hidden="true" size={19} /> : <Warning aria-hidden="true" size={19} weight="fill" />}
                  <div><strong className="inline-help">{summary?.title}{summary?.details.length ? <HelpTooltip label="Review details" warning={summary.tone === "warning"}>{summary.details.join(" · ")}</HelpTooltip> : null}</strong><span>{formatDateTime(activeCandidate.raw_message.received_at)} · {activeCandidate.raw_message.sender}</span></div>
                  <details className="review-message-actions"><summary aria-label="Message actions" title="Message actions"><DotsThree size={20} aria-hidden="true" /><span>Message actions</span></summary><div>
                    {activeValues && canFindTransferMatch(activeCandidate, activeValues) ? <button className="button button--ghost" type="button" disabled={workingCandidateId !== null || reprocessingCandidateId !== null} onClick={() => void handleConfirm(activeCandidate, null, true)}>Find transfer match</button> : null}
                    {hasOriginalSms(activeCandidate) ? <><button className="button button--ghost" type="button" disabled={workingCandidateId !== null || reprocessingCandidateId !== null} onClick={() => void handleReprocess(activeCandidate)}>Re-run parser</button><button className="button button--ghost" type="button" disabled={workingCandidateId !== null || reprocessingCandidateId !== null} onClick={() => void handleRedact(activeCandidate)}>Redact original SMS</button></> : null}
                    <button className="button button--ghost" type="button" disabled={workingCandidateId !== null} onClick={() => setRejectDraft({ candidate: activeCandidate, note: "", reason: "not_transaction", redact: true, scope: "message" })}>Reject / save skip rule</button>
                  </div></details>
                </div>
                {activeCandidate.identity_suggestions.map(hint => {
                  const reporting = hint.role === (accountDraft?.direction === "credit" ? "receiver" : "sender");
                  const selectedAccount = reporting ? accountDraft?.account : accountDraft?.other;
                  if (!reporting && classification?.type !== "transfer") return null;
                  return <div className="review-identity-hint" key={hint.role} role="group" aria-label={`${hint.role} account suggestions`}>
                    <strong>Check {hint.role} account · {hint.observed_identifiers.join(" / ")}</strong><p>{hint.reason}</p>
                    <div className="review-identity-choices">{hint.choices.map(choice => <button className="button button--ghost" type="button" key={choice.payment_method} disabled={workingCandidateId === activeCandidate.id || (!reporting && choice.account === accountDraft?.account)}
                      aria-pressed={selectedAccount === choice.account && (!reporting || paymentMethodDrafts[activeCandidate.id] === choice.payment_method)}
                      onClick={() => {
                        if (reporting) { updateAccountDraft({ account: choice.account, other: choice.account === accountDraft?.other ? "" : accountDraft?.other ?? "" }); setPaymentMethodDrafts(current => ({ ...current, [activeCandidate.id]: choice.payment_method })); }
                        else updateAccountDraft({ other: choice.account });
                      }}>{selectedAccount === choice.account && (!reporting || paymentMethodDrafts[activeCandidate.id] === choice.payment_method) ? "Selected · " : ""}{choice.name} · {choice.method_name}</button>)}</div>
                    {!hint.choices.length ? <p>No compatible saved identifier. Choose the account below after checking the SMS.</p> : null}
                  </div>;
                })}


                {classification?.type === "transfer" ? <div className="review-transfer-path" aria-label="Transfer path"><span>Money moves</span><strong>{accountNameById.get((accountDraft?.direction === "credit" ? accountDraft.other : accountDraft?.account) ?? "") ?? "Choose From account"} → {accountNameById.get((accountDraft?.direction === "credit" ? accountDraft.account : accountDraft?.other) ?? "") ?? "Choose To account"}</strong></div> : null}
                <div className="review-form review-form--focused">
                  <label className="field"><span className="field__label">Type</span><select className="field__control" value={classification?.type ?? activeCandidate.transaction_type} onChange={(event) => applyClassification(classification?.category ?? "", event.target.value as TransactionType)} name="type" {...feedback("type")}>{transactionTypes.map((type) => <option key={type} value={type}>{formatLabel(type)}</option>)}</select><FieldError prefix="review" field="type" errors={fieldErrors} /></label>
                  <label className="field"><span className="field__label">Category</span><select className="field__control" value={classification?.category ?? ""} disabled={workingCandidateId === activeCandidate.id} onChange={(event) => categoryChoice.choose(event.target.value, classification?.type ?? activeCandidate.transaction_type as TransactionType, applyClassification)} name="category" {...feedback("category")}><option value="">No category</option>{reviewState.categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select><FieldError prefix="review" field="category" errors={fieldErrors} /></label>
                  <input name="direction" type="hidden" value={accountDraft?.direction ?? "debit"} />
                  <label className="field"><span className="field__label">{classification?.type === "transfer" ? accountDraft?.direction === "credit" ? "To account" : "From account" : "Account"}</span><select className="field__control" value={accountDraft?.account ?? ""} onChange={(event) => { updateAccountDraft({ account: event.target.value, other: event.target.value === accountDraft?.other ? "" : accountDraft?.other ?? "" }); }} name="account" {...feedback("account")} required><option value="">Select account</option>{reviewState.accounts.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}</select><FieldError prefix="review" field="account" errors={fieldErrors} /></label>
                  {classification?.type === "transfer" ? <label className="field"><span className="field__label">{accountDraft?.direction === "credit" ? "From account" : "To account"}</span><select className="field__control" value={accountDraft?.other ?? ""} onChange={(event) => updateAccountDraft({ other: event.target.value })} name="transfer_account" {...feedback("transfer_account")}><option value="">Select account</option>{reviewState.accounts.filter((account) => account.id !== accountDraft?.account).map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}</select>{activeCandidate.transfer_suggestion_reason && accountDraft?.account === accountReviewDefaults(activeCandidate).account && accountDraft?.other === accountReviewDefaults(activeCandidate).other && accountDraft?.direction === accountReviewDefaults(activeCandidate).direction ? <span className="field__hint" role="status">{accountDraft?.other ? `Suggested: ${reviewState.accounts.find((account) => account.id === accountDraft.other)?.name ?? "saved account"}. ` : ""}{activeCandidate.transfer_suggestion_reason}</span> : null}<FieldError prefix="review" field="transfer_account" errors={fieldErrors} /></label> : null}
                  <label className="field"><span className="field__label">Amount</span><input className="field__control" value={activeValues?.amount ?? ""} onChange={event => setAmountDrafts(current => ({ ...current, [activeCandidate.id]: event.target.value }))} inputMode="decimal" name="amount" {...feedback("amount")} required /><FieldError prefix="review" field="amount" errors={fieldErrors} /></label>
                  <label className="field"><span className="field__label">Balance after</span><input className="field__control" value={classification?.balanceAfter ?? ""} onChange={(event) => setClassificationDrafts((current) => ({ ...current, [activeCandidate.id]: { type: classification?.type ?? activeCandidate.transaction_type as TransactionType, category: classification?.category ?? "", balanceAfter: event.target.value } }))} inputMode="decimal" name="balance_after" {...feedback("balance_after")} /><span className="field__hint">Reported for the selected account; kept when type changes.</span>{classification && "balanceCleared" in classification && classification.balanceCleared ? <span className="field__hint" role="status">Reported balance cleared because its reporting account changed. Enter the balance for the new account if available.</span> : null}<FieldError prefix="review" field="balance_after" errors={fieldErrors} /></label>
                  <div className="transaction-datetime" role="group" aria-label="Date and time">
                    <label className="field"><span className="field__label">Date</span><input className="field__control" defaultValue={nativeDrafts.current.text(activeCandidate.id, "date", dateInputFromTimestamp(activeCandidate.raw_message.received_at))} name="date" {...feedback("date")} type="date" /><FieldError prefix="review" field="date" errors={fieldErrors} /></label>
                    <label className="field"><span className="field__label">Time</span><input className="field__control" defaultValue={nativeDrafts.current.text(activeCandidate.id, "time", timeInputFromTimestamp(activeCandidate.raw_message.received_at))} name="time" {...feedback("time")} type="time" /><FieldError prefix="review" field="time" errors={fieldErrors} /></label>
                  </div>
                  <label className="field"><span className="field__label">Merchant / counterparty</span><input className="field__control" defaultValue={nativeDrafts.current.text(activeCandidate.id, "counterparty_text", activeCandidate.counterparty_text)} name="counterparty_text" {...feedback("counterparty_text")} /><FieldError prefix="review" field="counterparty_text" errors={fieldErrors} /></label>
                  <label className="field"><span className="field__label">Reference</span><input className="field__control" defaultValue={nativeDrafts.current.text(activeCandidate.id, "reference", activeCandidate.reference)} name="reference" {...feedback("reference")} /><FieldError prefix="review" field="reference" errors={fieldErrors} /></label>
                  <details className="review-payment-details field--wide"><summary>Payment method <span>{reviewState.paymentMethods.find(method => method.id === selectedPaymentMethod)?.name ?? "Optional"}</span></summary>
                  <label className="field"><span className="field__label">Payment method</span><select className="field__control" value={selectedPaymentMethod} onChange={event => setPaymentMethodDrafts(current => ({ ...current, [activeCandidate.id]: event.target.value }))} name="payment_method" {...feedback("payment_method")}><option value="">No payment method</option>{reviewState.paymentMethods.filter((method) => method.account === accountDraft?.account).map((method) => <option key={method.id} value={method.id}>{method.name}</option>)}</select><FieldError prefix="review" field="payment_method" errors={fieldErrors} /></label>
                  </details>
                  <details className="review-identifiers field--wide" open={!accountDraft?.account || Number(activeCandidate.confidence) < 0.65}><summary>Masked sender and receiver identifiers</summary><fieldset className="review-identifier-grid field--wide"><legend>Masked sender and receiver identifiers</legend><p>These values help match a saved payment method. Store only masked values or a safe suffix, never a full card number. Choose ledger accounts using the account selectors above.</p><label className="field"><span className="field__label">Sender account</span><input className="field__control" defaultValue={nativeDrafts.current.text(activeCandidate.id, "sender_account_identifier", activeCandidate.sender_account_identifier)} name="sender_account_identifier" {...feedback("sender_account_identifier")} /><FieldError prefix="review" field="sender_account_identifier" errors={fieldErrors} /></label><label className="field"><span className="field__label">Sender card</span><input className="field__control" defaultValue={nativeDrafts.current.text(activeCandidate.id, "sender_card_identifier", activeCandidate.sender_card_identifier)} name="sender_card_identifier" {...feedback("sender_card_identifier")} /><FieldError prefix="review" field="sender_card_identifier" errors={fieldErrors} /></label><label className="field"><span className="field__label">Receiver account</span><input className="field__control" defaultValue={nativeDrafts.current.text(activeCandidate.id, "receiver_account_identifier", activeCandidate.receiver_account_identifier)} name="receiver_account_identifier" {...feedback("receiver_account_identifier")} /><FieldError prefix="review" field="receiver_account_identifier" errors={fieldErrors} /></label><label className="field"><span className="field__label">Receiver card</span><input className="field__control" defaultValue={nativeDrafts.current.text(activeCandidate.id, "receiver_card_identifier", activeCandidate.receiver_card_identifier)} name="receiver_card_identifier" {...feedback("receiver_card_identifier")} /><FieldError prefix="review" field="receiver_card_identifier" errors={fieldErrors} /></label></fieldset></details>
                  <label className="field field--wide"><span className="field__label">Ledger note</span><input className="field__control" defaultValue={nativeDrafts.current.text(activeCandidate.id, "note", normalizedNote(activeCandidate))} name="note" {...feedback("note")} /><span className="field__hint">The full SMS is not copied into your transaction note.</span><FieldError prefix="review" field="note" errors={fieldErrors} /></label>
                  <label className="field field--wide review-remember"><input defaultChecked={nativeDrafts.current.remember(activeCandidate.id)} name="remember_mapping" type="checkbox" /><span><strong>Use these choices for similar messages</strong><small>Saved after confirmation. Transfer choices are scoped to this reporting account and counterparty; other messages keep their own choices.</small></span></label>
                </div>

                <details className="raw-message" open={Number(activeCandidate.confidence) < 0.65 || Boolean(activeCandidate.raw_message.duplicate_of)}><summary>Original SMS and parser evidence</summary><p>{activeCandidate.raw_message.body}</p><p>{activeCandidate.parser_notes}</p>{activeCandidate.raw_message.status !== "redacted" ? <div className="raw-message-actions"><button className="button button--ghost" disabled={reprocessingCandidateId === activeCandidate.id || workingCandidateId === activeCandidate.id} onClick={() => void handleReprocess(activeCandidate)} type="button">{reprocessingCandidateId === activeCandidate.id ? <ButtonBusy label="Re-running parser" /> : <><ArrowClockwise aria-hidden="true" size={18} />Re-run parser</>}</button><button className="button button--ghost" disabled={reprocessingCandidateId === activeCandidate.id || workingCandidateId === activeCandidate.id} onClick={() => void handleRedact(activeCandidate)} type="button">Redact original SMS now</button></div> : <span className="status-badge status-badge--ok">Original SMS redacted</span>}</details>

                </div>
                <div className="review-sticky-actions"><div className="review-action-status"><strong>{accountNameById.get(accountDraft?.account ?? "") ?? "Account not selected"}</strong><span>{activeCorrections.length ? `${activeCorrections.length} correction(s) needed` : ""}</span></div><div className="review-detail__pager" role="group" aria-label="Message navigation"><button aria-label="Previous message" disabled={activeIndex <= 0} onClick={() => setActiveCandidateId(filteredCandidates[activeIndex - 1]?.id ?? activeCandidate.id)} type="button"><ArrowLeft size={18} /></button><span>{activeIndex + 1} / {filteredCandidates.length}</span><button aria-label="Next message" disabled={activeIndex >= filteredCandidates.length - 1} onClick={() => setActiveCandidateId(filteredCandidates[activeIndex + 1]?.id ?? activeCandidate.id)} type="button"><ArrowRight size={18} /></button><button hidden={isFocused} className="review-focus-toggle" aria-label={isFocused ? "Exit focus mode" : "Enter focus mode"} aria-pressed={isFocused} title={isFocused ? "Exit focus mode (Escape)" : "Focus on the review workspace"} onClick={event => { if (!isFocused) { prepareFocus(event.currentTarget); setFocusQueueOpen(window.matchMedia("(min-width: 821px)").matches); } setFocusMode(current => !current); }} type="button">{isFocused ? <CornersIn size={19} aria-hidden="true" /> : <CornersOut size={19} aria-hidden="true" />}</button></div><button className="button button--danger" disabled={workingCandidateId === activeCandidate.id} onClick={() => setRejectDraft({ candidate: activeCandidate, note: "", reason: "not_transaction", redact: true, scope: "message" })} type="button">Reject</button><button className="button button--primary" disabled={workingCandidateId === activeCandidate.id} type="submit">{workingCandidateId === activeCandidate.id ? <ButtonBusy label={lookupInProgress ? "Finding matches" : "Confirming"} /> : "Confirm & add"}</button></div>
              </form>
            </article>
          ) : null}
        </section>
      )}
      </div>

      {filtersOpen ? <ModalDialog labelledBy="review-filters-title" className="decision-modal review-filter-dialog" onCancel={() => setFiltersOpen(false)}>
        <button className="decision-modal__close" aria-label="Close filters" onClick={() => setFiltersOpen(false)} type="button"><X size={20} /></button>
        <h2 id="review-filters-title">Filter messages</h2><p>Filters apply immediately to the review queue.</p>
        <div className="review-filter-content"><div className="review-filter-grid">
          <label className="field field--wide"><span className="field__label">Pending condition / available action</span><select className="field__control" onChange={event => { setIssueFilter(event.target.value as ReviewCondition); setActiveCandidateId(""); }} value={issueFilter}><option value="all">All pending conditions</option>{[...new Set(reviewConditions.map(condition => condition.group))].map(group => <optgroup key={group} label={group}>{reviewConditions.filter(condition => condition.group === group).map(condition => <option key={condition.value} value={condition.value}>{condition.label}</option>)}</optgroup>)}</select></label>
          <label className="field field--wide"><span className="field__label inline-help">Parser confidence<HelpTooltip label="About confidence filters">Percentage describes parser confidence, not transfer-match strength. Other filters combine with this range.</HelpTooltip></span><select className="field__control" aria-label="Parser confidence range" value={confidenceFilter} onChange={event => setConfidenceFilter(event.target.value as ConfidenceBand)}>{confidenceBands.map(band => <option key={band.value} value={band.value}>{band.label}</option>)}</select></label>
          {confidenceFilter === "custom" ? <><label className="field"><span className="field__label">Minimum %</span><input className="field__control" type="number" min="0" max="100" step="any" value={confidenceMin} onChange={event => setConfidenceMin(event.target.value)} aria-invalid={Boolean(confidenceRangeError(confidenceMin, confidenceMax))} aria-describedby="confidence-range-note" /></label><label className="field"><span className="field__label">Maximum %</span><input className="field__control" type="number" min="0" max="100" step="any" value={confidenceMax} onChange={event => setConfidenceMax(event.target.value)} aria-invalid={Boolean(confidenceRangeError(confidenceMin, confidenceMax))} aria-describedby="confidence-range-note" /></label><p id="confidence-range-note" className={`field--wide ${confidenceRangeError(confidenceMin, confidenceMax) ? "form-error" : "field__hint"}`} role="status">{confidenceRangeError(confidenceMin, confidenceMax) ? `${confidenceRangeError(confidenceMin, confidenceMax)} Confidence range is not applied until valid.` : "Inclusive range. Empty minimum / maximum means 0% / 100%."}</p></> : null}
          <label className="field"><span className="field__label">Provider</span><select className="field__control" onChange={event => setProviderFilter(event.target.value)} value={providerFilter}><option value="all">All providers</option>{providers.map(provider => <option key={provider} value={provider}>{formatLabel(provider)}</option>)}</select></label>
          <label className="field"><span className="field__label">Account involved</span><select className="field__control" onChange={event => setAccountFilter(event.target.value)} value={accountFilter}><option value="all">All accounts</option>{reviewState.accounts.map(account => <option key={account.id} value={account.id}>{account.name}</option>)}</select></label>
          <label className="field"><span className="field__label">Category</span><select className="field__control" onChange={event => setCategoryFilter(event.target.value)} value={categoryFilter}><option value="all">All categories</option><option value="uncategorized">Uncategorized</option>{reviewState.categories.map(category => <option key={category.id} value={category.id}>{category.name}</option>)}</select></label>
          <label className="field"><span className="field__label">Transaction type</span><select className="field__control" onChange={event => setTypeFilter(event.target.value)} value={typeFilter}><option value="all">All types</option>{transactionTypes.map(type => <option key={type} value={type}>{formatLabel(type)}</option>)}</select></label>
          <label className="field field--wide"><span className="field__label">Reporting account direction</span><select className="field__control" onChange={event => setDirectionFilter(event.target.value)} value={directionFilter}><option value="all">All directions</option><option value="debit">Debit · money sent</option><option value="credit">Credit · money received</option></select></label>
        </div>
        <p role="status">{filteredCandidates.length} of {reviewState.candidates.length} pending messages</p></div>
        <div className="decision-modal__actions"><button className="button button--ghost" onClick={clearFilters} type="button">Clear filters</button><button className="button button--primary" onClick={() => setFiltersOpen(false)} type="button">Done</button></div>
      </ModalDialog> : null}
      {rejectDraft ? <ModalDialog labelledBy="reject-title" busy={workingCandidateId === rejectDraft.candidate.id} onCancel={() => setRejectDraft(null)}><button aria-label="Close rejection options" className="decision-modal__close" disabled={workingCandidateId === rejectDraft.candidate.id} onClick={() => setRejectDraft(null)} type="button"><X size={20} /></button><h2 id="reject-title">Reject this message</h2><p>Choose whether to reject only this message or remember a skip rule. Skipping a recognized promotional, OTP/security or balance-notice type applies across your trusted senders and keeps transaction messages enabled. Undo the rule in SMS settings.</p><form onSubmit={(event) => void handleReject(event)}><label className="field"><span className="field__label">Reason</span><select className="field__control" onChange={(event) => setRejectDraft({ ...rejectDraft, reason: event.target.value })} value={rejectDraft.reason}>{[["not_transaction", "Not a transaction"], ["otp_security", "OTP or security"], ["duplicate", "Duplicate"], ["wrong_provider_account", "Wrong provider or account"], ["personal", "Personal or non-financial"], ["unsupported_format", "Unsupported format"], ["other", "Other"]].map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label className="field"><span className="field__label">Apply to</span><select className="field__control" onChange={(event) => setRejectDraft({ ...rejectDraft, scope: event.target.value as RejectDraft["scope"] })} value={rejectDraft.scope}><option value="message">Only this message</option><option value="kind">This message and skip its non-transaction type</option><option value="sender">This message and disable {rejectDraft.candidate.raw_message.sender}</option><option value="provider">This message and exclude all {formatLabel(rejectDraft.candidate.provider)} messages</option></select></label><label className="field"><span className="field__label">Note (optional)</span><input className="field__control" onChange={(event) => setRejectDraft({ ...rejectDraft, note: event.target.value })} value={rejectDraft.note} /></label><label className="review-remember"><input checked={rejectDraft.redact} onChange={(event) => setRejectDraft({ ...rejectDraft, redact: event.target.checked })} type="checkbox" /><span><strong>Redact original SMS now</strong><small>Parsed metadata remains for audit and duplicate protection.</small></span></label><div className="decision-modal__actions"><button className="button button--ghost" disabled={workingCandidateId === rejectDraft.candidate.id} onClick={() => setRejectDraft(null)} type="button">Cancel</button><button className="button button--danger" disabled={workingCandidateId === rejectDraft.candidate.id} type="submit">{workingCandidateId === rejectDraft.candidate.id ? <ButtonBusy label="Rejecting" /> : "Reject message"}</button></div></form></ModalDialog> : null}
      {transferDecision ? <TransferMatchDialog original={transferComparison(transferDecision.input, id => accountNameById.get(id))} originalSource="SMS awaiting confirmation" matches={transferDecision.matches} busy={workingCandidateId !== null} error={matchError} onAccept={(match, choices) => void handleTransferDecision(match, choices)} separateLabel={transferDecision.lookupOnly ? "Back to review" : undefined} onSeparate={() => void handleTransferDecision()} onCancel={() => setTransferDecision(null)} /> : null}
    </div>
  );
}
