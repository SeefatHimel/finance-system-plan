"use client";
import { TimelineOrderDialog } from "@/components/timeline-order-dialog";
import { AccountLabel } from "@/components/account-avatar";

import { ArrowClockwise, ArrowsIn, ArrowsOut, CalendarBlank, CaretLeft, CaretRight, Eye, LinkSimple, SlidersHorizontal, X } from "@phosphor-icons/react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type TouchEvent as ReactTouchEvent, type WheelEvent as ReactWheelEvent } from "react";
import { createPortal } from "react-dom";
import { formatCalendarDate, formatClockTime, formatCurrency } from "../../finance-contracts/presentation";
import { CalendarDateInput } from "./calendar-date-input";
import { TransactionSourceMessages } from "./transaction-source-messages";
import { TransactionStatementEvidence } from "./transaction-statement-evidence";
import { useTransactionRecovery } from "./transaction-recovery";
import { useToast } from "./toast-provider";
import { getAccessToken } from "@/lib/auth-storage";
import { getTimelineBalances, saveTimelineBalance, type TimelineBalanceAllocation, getTimelineOrders, type TimelineSavedOrder, listAccounts, listCategories, listTransactionActivityPage, type Account, type Category, type Transaction } from "@/lib/api";
import { sharedBalanceEventOrder, sharedBalanceOrder, placedTimelineEvents, addDays, atTimelineEdge, balanceGapDetails, contiguousReadyDates, expandReadyTimelineRange, groupTimelineDays, isVerticalTimelineGesture, laneBalance, laneDirection, loadTimelinePages, reportedBalanceAtDate, timelineScrollShift, weekStart, type TimelineRange } from "@/lib/account-lanes";

type WeekResult = { status: "loading"; loaded: number; total: number | null } | { status: "error"; message: string } | { status: "ready"; rows: Transaction[] };
type ViewMode = "amount" | "balance" | "both";
type LayoutMode = "lanes" | "list";
const WINDOW_DAYS = 21;
const today = () => {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Dhaka", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const part = (type: string) => parts.find(item => item.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
};
const initialWindow = () => addDays(weekStart(today()), -7);
const dayLabel = (date: string) => new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${date}T12:00:00Z`));
const centsLabel = (cents: number, currency: string) => formatCurrency((Math.abs(cents) / 100).toFixed(2), currency);
const balanceCentsLabel = (cents: number, currency: string) => `${cents < 0 ? "−" : ""}${centsLabel(cents, currency)}`;

function findDayNode(viewport: HTMLElement, date: string) {
  return Array.from(viewport.querySelectorAll<HTMLElement>("[data-lane-day]")).find(item =>
    item.dataset.laneDay === date || (item.dataset.laneDay! <= date && date <= (item.dataset.laneEnd ?? item.dataset.laneDay!))
  );
}

function amountLabel(transaction: Transaction, accountId: string, currency: string) {
  const amount = formatCurrency(transaction.amount, currency);
  return `${laneDirection(transaction, accountId) === "credit" ? "+" : "−"}${amount}`;
}

function title(transaction: Transaction) {
  return transaction.counterparty_text || transaction.note || transaction.reference || transaction.type.replaceAll("_", " ");
}

export function AccountLanesWorkspace() {
  const { edit } = useTransactionRecovery();
  const { notify } = useToast();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [accountsLoading, setAccountsLoading] = useState(true);
  const [accountsError, setAccountsError] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [evidenceRevision, setEvidenceRevision] = useState(0);
  const [weekResults, setWeekResults] = useState<Record<string, WeekResult>>({});
  const [range, setRange] = useState<TimelineRange>(() => {
    const start = initialWindow();
    return { start, end: addDays(start, WINDOW_DAYS) };
  });
  const [pendingEdge, setPendingEdge] = useState<{ direction: -1 | 1; force: boolean } | null>(null);
  const [pendingJump, setPendingJump] = useState<string | null>(null);
  const rangeRef = useRef(range);
  rangeRef.current = range;
  const [visibleDate, setVisibleDate] = useState(today);
  const [mode, setMode] = useState<ViewMode>("both");
  const [layoutMode, setLayoutMode] = useState<LayoutMode>("lanes");
  const [placement, setPlacement] = useState<{ date: string; account?: string } | null>(null);
  const [allocations, setAllocations] = useState<TimelineBalanceAllocation[]>([]);
  const balanceFocusRef = useRef<string | null>(null);
  const [allocationBasis, setAllocationBasis] = useState<Transaction[] | null>(null);
  const [balanceError, setBalanceError] = useState("");
  const [balanceBusy, setBalanceBusy] = useState<string | null>(null);
  const [savedOrders, setSavedOrders] = useState<TimelineSavedOrder[]>([]);
  const [orderRevision, setOrderRevision] = useState(0);
  const [orderError, setOrderError] = useState("");
  const [selectedTransaction, setSelectedTransaction] = useState<Transaction | null>(null);
  const [accountsOpen, setAccountsOpen] = useState(false);
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [showEmptyDays, setShowEmptyDays] = useState(false);
  const [showGaps, setShowGaps] = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [fontAdjustment, setFontAdjustment] = useState(0);
  const viewportRef = useRef<HTMLDivElement>(null);
  const viewPositionRef = useRef({ top: 0, left: 0 });
  const inspectorTitleRef = useRef<HTMLHeadingElement>(null);
  const lastCardRef = useRef<string | null>(null);
  const revealAccountRef = useRef<string | null>(null);
  const anchorRef = useRef<{ date: string; top: number } | null>(null);
  const revealEdgeRef = useRef<-1 | 1 | null>(null);
  const manualEdgeTargetRef = useRef<string | null>(null);
  const initializedRef = useRef(false);
  const jumpTargetRef = useRef<string | null>(null);
  const shiftingRef = useRef(false);
  const touchStartRef = useRef<{ x: number; y: number } | null>(null);
  const visibleDateTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const edgeGestureRef = useRef<-1 | 1 | null>(null);
  const lastWheelAtRef = useRef(0);
  const lastScrollInputAtRef = useRef(0);
  const lastScrollTopRef = useRef(0);
  const requestsRef = useRef(new Map<string, AbortController>());
  const refreshRequestRef = useRef<AbortController | null>(null);
  const refreshAgainRef = useRef(false);
  const closeDetails = useCallback(() => {
    const id = lastCardRef.current;
    setSelectedTransaction(null);
    requestAnimationFrame(() => {
      const card = id ? Array.from(viewportRef.current?.querySelectorAll<HTMLElement>("[data-lane-card]") ?? []).find(item => item.dataset.laneCard === id) : null;
      (card ?? viewportRef.current)?.focus();
    });
  }, []);

  const loadAccounts = useCallback(async () => {
    const token = getAccessToken();
    if (!token) { setAccountsError("Sign in to view your accounts."); setAccountsLoading(false); return; }
    setAccountsLoading(true); setAccountsError(null);
    try {
      const [nextAccounts, nextCategories] = await Promise.all([listAccounts(token), listCategories(token)]);
      const ordered = [...nextAccounts].sort((a, b) => a.display_order - b.display_order);
      setAccounts(ordered);
      setCategories(nextCategories);
      setSelectedIds(previous => previous.length ? previous.filter(id => ordered.some(account => account.id === id)) : ordered.filter(account => account.is_active).slice(0, 2).map(account => account.id));
    } catch (error) {
      setAccountsError(error instanceof Error ? error.message : "Could not load your accounts.");
    } finally { setAccountsLoading(false); }
  }, []);

  useEffect(() => { void loadAccounts(); }, [loadAccounts]);
  useEffect(() => {
    const reflectSavedEntry = (event: Event) => {
      const saved = (event as CustomEvent<Transaction>).detail;
      if (!saved?.id) return;
      setSelectedTransaction(current => current?.id === saved.id ? saved : current);
      setWeekResults(current => {
        let changed = false;
        const next = { ...current };
        for (const [start, week] of Object.entries(current)) {
          if (week.status !== "ready") continue;
          const present = week.rows.some(row => row.id === saved.id);
          const belongs = start <= saved.date && saved.date <= addDays(start, 6);
          if (!present && !belongs) continue;
          next[start] = { status: "ready", rows: [...week.rows.filter(row => row.id !== saved.id), ...(belongs ? [saved] : [])] };
          changed = true;
        }
        return changed ? next : current;
      });
    };
    window.addEventListener("finance:transaction-saved", reflectSavedEntry);
    return () => window.removeEventListener("finance:transaction-saved", reflectSavedEntry);
  }, []);
  useEffect(() => () => { refreshAgainRef.current = false; refreshRequestRef.current?.abort(); for (const controller of requestsRef.current.values()) controller.abort(); requestsRef.current.clear(); }, []);
  useEffect(() => () => { if (visibleDateTimerRef.current) clearTimeout(visibleDateTimerRef.current); }, []);
  useEffect(() => {
    if (!isFullscreen) return;
    const priorOverflow = document.body.style.overflow;
    const appFrame = document.querySelector<HTMLElement>(".app-frame");
    const priorInert = appFrame?.inert ?? false;
    document.body.style.overflow = "hidden";
    if (appFrame) appFrame.inert = true;
    return () => { document.body.style.overflow = priorOverflow; if (appFrame) appFrame.inert = priorInert; };
  }, [isFullscreen]);
  useEffect(() => {
    if (!selectedTransaction && !isFullscreen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented || document.querySelector("dialog[open]")) return;
      event.preventDefault();
      if (selectedTransaction) { closeDetails(); return; }
      const viewport = viewportRef.current;
      if (viewport) viewPositionRef.current = { top: viewport.scrollTop, left: viewport.scrollLeft };
      setIsFullscreen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [closeDetails, isFullscreen, selectedTransaction]);
  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    viewport.scrollTop = viewPositionRef.current.top;
    viewport.scrollLeft = viewPositionRef.current.left;
    lastScrollTopRef.current = viewport.scrollTop;
  }, [isFullscreen]);

  const captureAnchor = useCallback(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const viewportTop = viewport.getBoundingClientRect().top;
    const visibleTop = viewportTop + (viewport.querySelector<HTMLElement>(".account-lanes-head")?.offsetHeight ?? 0);
    const day = Array.from(viewport.querySelectorAll<HTMLElement>("[data-lane-day]")).find(item => item.getBoundingClientRect().bottom > visibleTop + 4);
    if (day?.dataset.laneDay) anchorRef.current = { date: day.dataset.laneDay, top: day.getBoundingClientRect().top - viewportTop };
  }, []);

  const refreshTimeline = useCallback(async function refreshTimeline(showNotice = false): Promise<void> {
    if (refreshRequestRef.current) { refreshAgainRef.current = true; return; }
    const token = getAccessToken();
    if (!token) { notify("Sign in to refresh the timeline.", "error"); return; }
    const controller = new AbortController();
    refreshRequestRef.current = controller;
    setIsRefreshing(true);
    for (const request of requestsRef.current.values()) request.abort();
    requestsRef.current.clear();
    const refreshedRange = { ...rangeRef.current };
    const starts: string[] = [];
    for (let start = refreshedRange.start; start < refreshedRange.end; start = addDays(start, 7)) starts.push(start);
    try {
      const [nextAccounts, nextCategories, weeks] = await Promise.all([
        listAccounts(token, controller.signal),
        listCategories(token, controller.signal),
        Promise.all(starts.map(async start => ({ start, rows: await loadTimelinePages(
          offset => listTransactionActivityPage(token, start, addDays(start, 6), offset, controller.signal), controller.signal,
        ) }))),
      ]);
      if (controller.signal.aborted) return;
      // A save during the request makes this snapshot obsolete. Fetch once more.
      if (refreshAgainRef.current) return;
      captureAnchor();
      setAccounts([...nextAccounts].sort((a, b) => a.display_order - b.display_order));
      setCategories(nextCategories);
      setSelectedIds(previous => previous.filter(id => nextAccounts.some(account => account.id === id)));
      setAccountsError(null);
      setAccountsLoading(false);
      // Replace the range together so moved/deleted entries cannot leave ghost
      // cards. Drop prefetched weeks; they must be fetched afresh on navigation.
      setWeekResults(Object.fromEntries(weeks.map(({ start, rows }) => [start, { status: "ready", rows }])));
      setEvidenceRevision(value => value + 1);
      const rows = weeks.flatMap(week => week.rows);
      setSelectedTransaction(current => current ? rows.find(row => row.id === current.id)
        ?? (current.date >= refreshedRange.start && current.date < refreshedRange.end ? null : current) : null);
      if (showNotice) notify("Timeline refreshed.");
    } catch (error) {
      if (!controller.signal.aborted) {
        controller.abort();
        setWeekResults(current => Object.fromEntries(Object.entries(current).map(([start, week]) => [start,
          week.status === "loading" ? { status: "error", message: "Loading was interrupted by refresh. Please retry this week." } : week,
        ])));
        notify(`Timeline could not refresh. Previous data is still shown. ${error instanceof Error ? error.message : "Please try again."}`, "error");
      }
    } finally {
      if (refreshRequestRef.current === controller) {
        refreshRequestRef.current = null;
        setIsRefreshing(false);
        if (refreshAgainRef.current) { refreshAgainRef.current = false; void refreshTimeline(showNotice); }
      }
    }
  }, [captureAnchor, notify]);

  useEffect(() => {
    const changed = () => { void refreshTimeline(); };
    window.addEventListener("finance:transactions-changed", changed);
    return () => window.removeEventListener("finance:transactions-changed", changed);
  }, [refreshTimeline]);

  const loadWeek = useCallback(async (start: string, retry = false) => {
    if (refreshRequestRef.current || requestsRef.current.has(start) || (!retry && weekResults[start] && weekResults[start].status !== "loading")) return;
    const token = getAccessToken();
    if (!token) return;
    const controller = new AbortController();
    requestsRef.current.set(start, controller);
    setWeekResults(current => ({ ...current, [start]: { status: "loading", loaded: 0, total: null } }));
    try {
      const rows = await loadTimelinePages(
        offset => listTransactionActivityPage(token, start, addDays(start, 6), offset, controller.signal), controller.signal,
        (loaded, total) => {
        // Progress is useful under the initial overlay. Once the timeline is
        // interactive, updating every page would redraw all visible cards.
        if (!controller.signal.aborted && !initializedRef.current) {
          setWeekResults(current => ({ ...current, [start]: { status: "loading", loaded, total } }));
        }
      });
      if (!controller.signal.aborted) {
        if (start >= rangeRef.current.start && start < rangeRef.current.end) captureAnchor();
        setWeekResults(current => ({ ...current, [start]: { status: "ready", rows } }));
      }
    } catch (error) {
      if (!controller.signal.aborted) setWeekResults(current => ({ ...current, [start]: { status: "error", message: error instanceof Error ? error.message : "Could not load this week." } }));
    } finally { if (requestsRef.current.get(start) === controller) requestsRef.current.delete(start); }
  }, [captureAnchor, weekResults]);

  const windowWeeks = useMemo(() => {
    const weeks: string[] = [];
    for (let start = range.start; start < range.end; start = addDays(start, 7)) weeks.push(start);
    return weeks;
  }, [range]);
  const dates = useMemo(() => {
    const days: string[] = [];
    for (let date = range.start; date < range.end; date = addDays(date, 1)) days.push(date);
    return days;
  }, [range]);
  const readyWeeks = windowWeeks.filter(start => weekResults[start]?.status === "ready").length;
  const failedWeeks = windowWeeks.filter(start => weekResults[start]?.status === "error").length;
  useEffect(() => {
    if (accountsError || accountsLoading || isRefreshing) return;
    for (const start of windowWeeks) {
      if (!weekResults[start] && !requestsRef.current.has(start)) void loadWeek(start);
    }
  }, [accountsError, accountsLoading, isRefreshing, loadWeek, weekResults, windowWeeks]);

  useEffect(() => {
    if (accountsError || accountsLoading || isRefreshing || readyWeeks !== windowWeeks.length) return;
    // Keep two complete weeks ready on either side of the visible range.
    for (const start of [addDays(range.start, -14), addDays(range.start, -7), range.end, addDays(range.end, 7)]) {
      if (!weekResults[start] && !requestsRef.current.has(start)) void loadWeek(start);
    }
  }, [accountsError, accountsLoading, isRefreshing, loadWeek, range, readyWeeks, weekResults, windowWeeks]);
  const targetDate = jumpTargetRef.current ?? today();
  const targetWeek = weekResults[weekStart(targetDate)];
  const waitingForTarget = !initializedRef.current && targetWeek?.status !== "ready" && targetWeek?.status !== "error";
  const targetError = !initializedRef.current && targetWeek?.status === "error" ? targetWeek.message : null;
  const accountById = useMemo(() => new Map(accounts.map(account => [account.id, account])), [accounts]);
  const selectedAccounts = useMemo(() => selectedIds.map(id => accountById.get(id)).filter((account): account is Account => Boolean(account)), [accountById, selectedIds]);
  useLayoutEffect(() => {
    const accountId = revealAccountRef.current;
    const viewport = viewportRef.current;
    if (!accountId || !viewport) return;
    const target = Array.from(viewport.querySelectorAll<HTMLElement>("[data-lane-account]")).find(item => item.dataset.laneAccount === accountId);
    if (target) { viewport.scrollTo({ left: Math.max(0, target.offsetLeft + target.offsetWidth - viewport.clientWidth), behavior: "smooth" }); revealAccountRef.current = null; }
  }, [selectedIds]);
  const categoryById = useMemo(() => new Map(categories.map(category => [category.id, category.name])), [categories]);
  const renderedDates = useMemo(() => contiguousReadyDates(dates, new Set(windowWeeks.filter(start => weekResults[start]?.status === "ready")), jumpTargetRef.current ?? visibleDate), [dates, visibleDate, weekResults, windowWeeks]);
  const earlierMissingWeek = renderedDates.length && renderedDates[0] !== dates[0] ? addDays(weekStart(renderedDates[0]), -7) : null;
  const laterMissingWeek = renderedDates.length && renderedDates[renderedDates.length - 1] !== dates[dates.length - 1] ? addDays(weekStart(renderedDates[renderedDates.length - 1]), 7) : null;
  const earlierEdgeWeek = earlierMissingWeek || (pendingEdge?.direction === -1 ? addDays(range.start, -7) : null);
  const laterEdgeWeek = laterMissingWeek || (pendingEdge?.direction === 1 ? range.end : null);
  const pendingJumpResult = pendingJump ? weekResults[weekStart(pendingJump)] : null;
  const loadedDays = useMemo(() => new Set(renderedDates), [renderedDates]);
  const allRows = useMemo(() => {
    const unique = new Map<string, Transaction>();
    for (const start of new Set(renderedDates.map(weekStart))) {
      const result = weekResults[start];
      if (result?.status === "ready") for (const row of result.rows) unique.set(row.id, row);
    }
    return [...unique.values()];
  }, [renderedDates, weekResults]);
  const checkedAllocations = useMemo(() => allocationBasis === allRows ? allocations : [], [allocationBasis, allRows, allocations]);
  useEffect(() => {
    const id = balanceFocusRef.current;
    if (!id || !checkedAllocations.some(item => item.principal === id)) return;
    const summaries = document.querySelectorAll<HTMLElement>(`[data-balance-principal="${id}"] > summary`);
    summaries[summaries.length - 1]?.focus({ preventScroll: true });
    balanceFocusRef.current = null;
  }, [checkedAllocations]);
  const gaps = useMemo(() => new Map(selectedAccounts.map(account => {
    const details = balanceGapDetails(allRows, account.id, loadedDays);
    // Shared source-closing balances are not independent per-component reports.
    for (const allocation of checkedAllocations.filter(item => item.account === account.id && item.status !== "stale")) {
      for (const id of allocation.ordered_ids) details.delete(id);
    }
    return [account.id, details];
  })), [allRows, loadedDays, selectedAccounts, checkedAllocations]);
  const asOfReports = useMemo(() => new Map(selectedAccounts.map(account => [account.id, reportedBalanceAtDate(allRows, account.id, visibleDate, loadedDays)])), [allRows, loadedDays, selectedAccounts, visibleDate]);
  const movementDates = useMemo(() => new Set(allRows.filter(row => selectedAccounts.some(account => laneDirection(row, account.id))).map(row => row.date)), [allRows, selectedAccounts]);
  const displayedDays = useMemo(() => groupTimelineDays(renderedDates, movementDates, loadedDays, !showEmptyDays), [renderedDates, movementDates, loadedDays, showEmptyDays]);
  const nextMovementDate = renderedDates.find(date => date > visibleDate && movementDates.has(date));
  const nextGapDate = [...gaps.values()].flatMap(map => [...map.values()].map(detail => detail.to.date)).filter(date => date > visibleDate).sort()[0];

  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    if (!initializedRef.current) {
      const target = jumpTargetRef.current ?? today();
      if (weekResults[weekStart(target)]?.status !== "ready") return;
      const day = findDayNode(viewport, target);
      if (day) { viewport.scrollTop = day.offsetTop - viewport.offsetTop - (viewport.querySelector<HTMLElement>(".account-lanes-head")?.offsetHeight ?? 0) - 8; lastScrollTopRef.current = viewport.scrollTop; initializedRef.current = true; jumpTargetRef.current = null; }
    } else if (anchorRef.current) {
      const anchor = anchorRef.current;
      const target = findDayNode(viewport, anchor.date);
      if (target) { viewport.scrollTop += target.getBoundingClientRect().top - viewport.getBoundingClientRect().top - anchor.top; lastScrollTopRef.current = viewport.scrollTop; }
    }
    if (revealEdgeRef.current) {
      // The edge gesture should reveal a little of the newly appended content,
      // while the rest of the scroll remains native and uninterrupted.
      viewport.scrollTop += revealEdgeRef.current * Math.min(72, viewport.clientHeight / 5);
      lastScrollTopRef.current = viewport.scrollTop;
      revealEdgeRef.current = null;
    }
    if (manualEdgeTargetRef.current) {
      const target = findDayNode(viewport, manualEdgeTargetRef.current);
      if (target) {
        viewport.scrollTop = target.offsetTop - viewport.offsetTop - (viewport.querySelector<HTMLElement>(".account-lanes-head")?.offsetHeight ?? 0) - 8;
        lastScrollTopRef.current = viewport.scrollTop;
      }
      manualEdgeTargetRef.current = null;
    }
    anchorRef.current = null;
    shiftingRef.current = false;
  }, [range, weekResults, renderedDates, layoutMode, showEmptyDays]);

  const jumpTo = useCallback((date: string) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return;
    const targetWeekStart = weekStart(date);
    if (weekResults[targetWeekStart]?.status !== "ready") {
      setPendingJump(date);
      if (weekResults[targetWeekStart]?.status !== "error") void loadWeek(targetWeekStart);
      return;
    }
    setPendingJump(null);
    setPendingEdge(null);
    setVisibleDate(date);
    if (date < range.start || date >= range.end) {
      const start = addDays(weekStart(date), -7);
      initializedRef.current = false;
      jumpTargetRef.current = date;
      anchorRef.current = null;
      setRange({ start, end: addDays(start, WINDOW_DAYS) });
    } else {
      const viewport = viewportRef.current;
      const target = viewport ? findDayNode(viewport, date) : null;
      if (viewport && target) viewport.scrollTo({ top: target.offsetTop - viewport.offsetTop - (viewport.querySelector<HTMLElement>(".account-lanes-head")?.offsetHeight ?? 0) - 8, behavior: "smooth" });
      else { initializedRef.current = false; jumpTargetRef.current = date; anchorRef.current = null; }
    }
  }, [loadWeek, range, weekResults]);

  useEffect(() => {
    if (pendingJump && weekResults[weekStart(pendingJump)]?.status === "ready") jumpTo(pendingJump);
  }, [jumpTo, pendingJump, weekResults]);

  const performEdgeExpand = useCallback((direction: -1 | 1, expandedRange: TimelineRange, force: boolean) => {
    const viewport = viewportRef.current;
    if (!viewport || !renderedDates.length) return;
    if (force) manualEdgeTargetRef.current = direction < 0 ? expandedRange.start : range.end;
    else {
      if (direction < 0) captureAnchor();
      revealEdgeRef.current = direction;
    }
    setPendingEdge(null);
    edgeGestureRef.current = direction;
    shiftingRef.current = true;
    setRange(expandedRange);
  }, [captureAnchor, range.end, renderedDates]);

  const expandAtEdge = useCallback((direction: -1 | 1, force = false) => {
    const viewport = viewportRef.current;
    if (!viewport || !initializedRef.current || shiftingRef.current) return;
    // A trackpad emits many wheel events for one swipe. Expand only once per gesture.
    if (!force && edgeGestureRef.current === direction) return;
    if (!force && !atTimelineEdge(direction, viewport.scrollTop, viewport.scrollHeight, viewport.clientHeight, 4)) return;
    const edgeLoaded = direction < 0 ? renderedDates[0] === dates[0] : renderedDates[renderedDates.length - 1] === dates[dates.length - 1];
    if (!edgeLoaded) { setPendingEdge({ direction, force }); return; }
    const expandedRange = expandReadyTimelineRange(range, direction, new Set(Object.keys(weekResults).filter(start => weekResults[start].status === "ready")));
    if (!expandedRange) {
      const incomingWeek = direction < 0 ? addDays(range.start, -7) : range.end;
      setPendingEdge({ direction, force });
      if (weekResults[incomingWeek]?.status !== "error") void loadWeek(incomingWeek);
      return;
    }
    performEdgeExpand(direction, expandedRange, force);
  }, [dates, loadWeek, performEdgeExpand, range, renderedDates, weekResults]);

  useEffect(() => {
    if (!pendingEdge) return;
    const { direction, force } = pendingEdge;
    const edgeLoaded = direction < 0 ? renderedDates[0] === dates[0] : renderedDates[renderedDates.length - 1] === dates[dates.length - 1];
    if (!edgeLoaded) return;
    const expandedRange = expandReadyTimelineRange(range, direction, new Set(Object.keys(weekResults).filter(start => weekResults[start].status === "ready")));
    if (!expandedRange) {
      const incomingWeek = direction < 0 ? addDays(range.start, -7) : range.end;
      if (!weekResults[incomingWeek] && !requestsRef.current.has(incomingWeek)) void loadWeek(incomingWeek);
      return;
    }
    const viewport = viewportRef.current;
    if (force || (viewport && atTimelineEdge(direction, viewport.scrollTop, viewport.scrollHeight, viewport.clientHeight, 4))) performEdgeExpand(direction, expandedRange, force);
    else setPendingEdge(null);
  }, [dates, loadWeek, pendingEdge, performEdgeExpand, range, renderedDates, weekResults]);

  const onScroll = useCallback(() => {
    const viewport = viewportRef.current;
    if (!viewport || !initializedRef.current) return;
    const movement = viewport.scrollTop - lastScrollTopRef.current;
    lastScrollTopRef.current = viewport.scrollTop;
    // Update after the gesture rather than repainting every card per pixel.
    if (visibleDateTimerRef.current) clearTimeout(visibleDateTimerRef.current);
    visibleDateTimerRef.current = setTimeout(() => {
      const currentViewport = viewportRef.current;
      if (!currentViewport) return;
      const middle = currentViewport.getBoundingClientRect().top + Math.min(currentViewport.clientHeight / 3, 180) + (currentViewport.querySelector<HTMLElement>(".account-lanes-head")?.offsetHeight ?? 0);
      const current = Array.from(currentViewport.querySelectorAll<HTMLElement>("[data-lane-day]")).find(day => day.getBoundingClientRect().bottom > middle);
      if (current?.dataset.laneDay) setVisibleDate(previous => previous >= current.dataset.laneDay! && previous <= (current.dataset.laneEnd ?? current.dataset.laneDay!) ? previous : current.dataset.laneDay!);
      visibleDateTimerRef.current = null;
    }, 120);
    if (Date.now() - lastScrollInputAtRef.current < 1000) {
      const direction = timelineScrollShift(movement, viewport.scrollTop, viewport.scrollHeight, viewport.clientHeight, true, true);
      if (direction) expandAtEdge(direction);
    }
  }, [expandAtEdge]);

  const onWheel = (event: ReactWheelEvent<HTMLDivElement>) => {
    // Trackpad horizontal swipes often include a small vertical delta.
    if (!isVerticalTimelineGesture(event.deltaX, event.deltaY, 2)) return;
    const now = Date.now();
    if (now - lastWheelAtRef.current > 300) edgeGestureRef.current = null;
    lastWheelAtRef.current = now;
    lastScrollInputAtRef.current = now;
    expandAtEdge(event.deltaY < 0 ? -1 : 1);
  };
  const onTouchStart = (event: ReactTouchEvent<HTMLDivElement>) => {
    edgeGestureRef.current = null;
    lastScrollInputAtRef.current = Date.now();
    const touch = event.touches[0];
    touchStartRef.current = touch ? { x: touch.clientX, y: touch.clientY } : null;
  };
  const onTouchEnd = (event: ReactTouchEvent<HTMLDivElement>) => {
    lastScrollInputAtRef.current = Date.now();
    const start = touchStartRef.current;
    touchStartRef.current = null;
    const touch = event.changedTouches[0];
    if (!start || !touch) return;
    const x = touch.clientX - start.x;
    const y = touch.clientY - start.y;
    if (isVerticalTimelineGesture(x, y, 45)) expandAtEdge(y > 0 ? -1 : 1);
  };
  const onViewportKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === "ArrowUp" || event.key === "PageUp") { edgeGestureRef.current = null; lastScrollInputAtRef.current = Date.now(); expandAtEdge(-1); }
    else if (event.key === "ArrowDown" || event.key === "PageDown") { edgeGestureRef.current = null; lastScrollInputAtRef.current = Date.now(); expandAtEdge(1); }
  };

  const toggleAccount = (id: string) => setSelectedIds(previous => previous.includes(id) ? previous.filter(value => value !== id) : [...previous, id]);
  const showAccount = (id: string) => { revealAccountRef.current = id; setSelectedIds(previous => previous.includes(id) ? previous : [...previous, id]); };
  const selectTransaction = (row: Transaction, keyboard = false) => {
    lastCardRef.current = row.id;
    setSelectedTransaction(row);
    if (keyboard) requestAnimationFrame(() => inspectorTitleRef.current?.focus());
  };
  const toggleFullscreen = () => {
    const viewport = viewportRef.current;
    if (viewport) viewPositionRef.current = { top: viewport.scrollTop, left: viewport.scrollLeft };
    setIsFullscreen(value => !value);
  };
  useEffect(() => {
    const token = getAccessToken(); if (!token) return;
    const controller = new AbortController();
    // Withdraw old positions immediately while current evidence is rechecked.
    setSavedOrders([]); setOrderError("");
    void getTimelineOrders(token, range.start, addDays(range.end, -1), controller.signal).then(result => { if (!controller.signal.aborted) setSavedOrders(result); })
      .catch(() => { if (!controller.signal.aborted) setOrderError("Saved placements could not be checked. Untimed movements are shown without placement; refresh to retry."); });
    return () => controller.abort();
  }, [range.start, range.end, allRows, orderRevision, evidenceRevision]);
  useEffect(() => {
    const token = getAccessToken(); if (!token) return;
    const controller = new AbortController();
    setAllocations([]); setBalanceError("");
    void getTimelineBalances(token, range.start, addDays(range.end, -1), controller.signal)
      .then(result => { if (!controller.signal.aborted) { setAllocations(result); setAllocationBasis(allRows); } })
      .catch(() => { if (!controller.signal.aborted) setBalanceError("Shared balance confirmations could not be checked. Original reported balances are shown; refresh to retry."); });
    return () => controller.abort();
  }, [range.start, range.end, allRows, evidenceRevision]);
  const decideBalance = async (allocation: TimelineBalanceAllocation, action: "apply" | "undo") => {
    const token = getAccessToken(); if (!token || balanceBusy) return;
    setBalanceBusy(allocation.principal);
    try {
      await saveTimelineBalance(token, allocation, action);
      balanceFocusRef.current = allocation.principal;
      setAllocations([]); setEvidenceRevision(value => value + 1);
      notify(action === "apply" ? "Timeline balances manually confirmed. Original source balances are unchanged." : "Balance confirmation undone. Original reported balances restored.");
    } catch (reason) {
      notify(reason instanceof Error ? reason.message : "Could not confirm shared balances.", "error");
      setAllocations([]); setEvidenceRevision(value => value + 1);
    } finally { setBalanceBusy(null); }
  };
  const balanceAllocation = (row: Transaction, account: Account) => checkedAllocations.find(item => item.account === account.id && (item.ordered_ids.includes(row.id) || item.principal === row.id));
  const renderAllocation = (row: Transaction, account: Account) => {
    const allocation = balanceAllocation(row, account);
    if (!allocation || allocation.principal !== row.id) return null;
    return <details className="account-lanes-allocation" data-balance-principal={allocation.principal} key={`${allocation.principal}:${allocation.status}:${allocation.revision}`}>
      <summary tabIndex={0}>{allocation.status === "confirmed" ? "Manually confirmed balances" : allocation.status === "stale" ? "Balance confirmation needs review" : "Shared statement balance · Review"}</summary>
      {allocation.status === "stale" ? <p>This confirmation could not be revalidated. Original reported balances are shown.</p> : null}
      {allocation.ordered_ids.length ? <><p>One printed statement row was split into a principal movement and VAT/fee. Both report the same final balance.</p>
        <ol><li>Previous balance: {formatCurrency(allocation.anchor_balance, account.currency)}</li>{allocation.ordered_ids.map((id, index) => <li key={id}>{index === 0 ? "After principal" : "After VAT / fee"}: <strong>{formatCurrency(allocation.balances[id], account.currency)}</strong></li>)}</ol>
        <p>Source closing balance: {formatCurrency(allocation.reported_final, account.currency)}. Amounts and original reports stay unchanged.</p></> : null}
      {allocation.status !== "confirmed" && allocation.fingerprint ? <button className="button button--ghost button--small" type="button" disabled={balanceBusy !== null} onClick={() => void decideBalance(allocation, "apply")}>{balanceBusy === allocation.principal ? "Saving…" : "Apply suggested balances"}</button> : null}
      {allocation.status !== "suggested" ? <button className="button button--ghost button--small" type="button" disabled={balanceBusy !== null} onClick={() => void decideBalance(allocation, "undo")}>Undo confirmation</button> : null}
    </details>;
  };
  const selected = selectedTransaction && allRows.find(row => row.id === selectedTransaction.id) || selectedTransaction;
  const selectedGapRows = selected ? selectedAccounts.flatMap(account => {
    const detail = gaps.get(account.id)?.get(selected.id);
    return detail === undefined ? [] : [{ account, detail }];
  }) : [];
  const renderLaneRow = (row: Transaction, date: string, placedAccount?: string, placementBasis?: string) => {
    const first = selectedIds.indexOf(row.account);
    const second = row.transfer_account ? selectedIds.indexOf(row.transfer_account) : -1;
    const bridge = !placedAccount && row.type === "transfer" && first >= 0 && second >= 0;
    return <div className={`account-lanes-row${placedAccount ? " account-lanes-row--placed" : ""}${bridge ? " account-lanes-row--transfer" : ""}`} key={`${row.id}:${placedAccount ?? "timed"}`} style={{ gridTemplateColumns: `88px repeat(${Math.max(selectedAccounts.length, 1)}, minmax(240px, 1fr))` }}>
      <time dateTime={row.time ? `${date}T${row.time}` : date} style={{ gridColumn: 1, gridRow: 1 }}>{row.time ? formatClockTime(row.time) : "Order only · time unknown"}</time>
      {bridge ? <span aria-hidden="true" className="account-lanes-transfer-bridge" style={{ gridColumn: `${Math.min(first, second) + 2} / ${Math.max(first, second) + 3}`, gridRow: 1 }} /> : null}
      {selectedAccounts.map((account, index) => {
        const direction = placedAccount && placedAccount !== account.id ? null : laneDirection(row, account.id);
        if (!direction) return <div className="account-lanes-cell" key={account.id} style={{ gridColumn: index + 2, gridRow: 1 }} />;
        const otherId = row.type === "transfer" ? row.account === account.id ? row.transfer_account : row.account : null;
        const other = otherId ? accountById.get(otherId) : null;
        const gap = gaps.get(account.id)?.get(row.id);
        const allocation = balanceAllocation(row, account);
        const calculated = allocation?.status === "confirmed" ? allocation.balances[row.id] : null;
        return <div className="account-lanes-cell" key={account.id} style={{ gridColumn: index + 2, gridRow: 1 }}>
          <button className={`account-lanes-card${selected?.id === row.id ? " is-selected" : ""}${bridge ? " account-lanes-card--paired" : ""}`} data-lane-card={row.id} type="button" onClick={event => selectTransaction(row, event.detail === 0)}>
            <span className="account-lanes-card__top"><strong>{title(row)}</strong>{row.type === "transfer" ? <LinkSimple aria-hidden="true" size={16} /> : null}</span>
            <small className={placedAccount ? "account-lanes-placed-label" : undefined}>{row.time ? formatClockTime(row.time) : placementBasis === "balance" ? "Balance-supported order · no clock time" : "Manually placed · no clock time"} · {row.type.replaceAll("_", " ")}{row.category && categoryById.get(row.category) ? ` · ${categoryById.get(row.category)}` : ""}</small>
            {bridge ? <small className="account-lanes-pair-label">Same transfer · {other?.name ?? "other account"}</small> : null}
            <span className="account-lanes-card__numbers">{mode !== "balance" ? <b className={direction === "credit" ? "is-credit" : "is-debit"}>{amountLabel(row, account.id, account.currency)}</b> : null}{mode !== "amount" ? <span>{calculated ? "Confirmed bal " : "Bal "}{calculated ? formatCurrency(calculated, account.currency) : laneBalance(row, account.id) === null ? "not reported" : formatCurrency(laneBalance(row, account.id)!, account.currency)}</span> : null}</span>
          </button>
          {calculated ? <small className="account-lanes-confirmed-balance">Calculated · manually confirmed · Source final {formatCurrency(allocation!.reported_final, account.currency)}</small> : null}
          {renderAllocation(row, account)}
          {other && !selectedIds.includes(other.id) ? <button className="account-lanes-hidden-link" type="button" onClick={() => showAccount(other.id)}><LinkSimple aria-hidden="true" size={14} /> Other side: {other.name} hidden · Show lane <Eye aria-hidden="true" size={14} /></button> : null}
          {showGaps && gap ? <button className="account-lanes-gap" type="button" onClick={event => selectTransaction(row, event.detail === 0)}>Possible balance gap · {gap.differenceCents > 0 ? "+" : "−"}{centsLabel(gap.differenceCents, account.currency)} <CaretRight size={14} /></button> : null}
        </div>;
      })}
    </div>;
  };
  const renderListRow = (row: Transaction) => {
    const accountId = selectedIds.includes(row.account) ? row.account : row.transfer_account ?? row.account;
    const account = accountById.get(accountId);
    const other = row.transfer_account ? accountById.get(row.transfer_account) : null;
    const hiddenAccount = row.type === "transfer" ? accountById.get(accountId === row.account ? row.transfer_account ?? "" : row.account) : null;
    return <li key={row.id}>
      <button className={`account-lanes-list-card${selected?.id === row.id ? " is-selected" : ""}`} data-lane-card={row.id} type="button" onClick={event => selectTransaction(row, event.detail === 0)}>
        <time dateTime={row.time ? `${row.date}T${row.time}` : row.date}>{row.time ? formatClockTime(row.time) : savedOrders.some(order => order.account === accountId && order.date === row.date && order.status === "valid" && order.ordered_ids.includes(row.id)) ? "Order saved · time unknown" : "Time unknown"}</time>
        <span><strong>{title(row)}</strong><small>{row.type === "transfer" ? `${accountById.get(row.account)?.name ?? "Source"} → ${other?.name ?? "Destination"}` : account?.name ?? "Account"} · {row.type.replaceAll("_", " ")}</small></span>
        <b className={laneDirection(row, accountId) === "credit" ? "is-credit" : "is-debit"}>{account ? amountLabel(row, accountId, account.currency) : row.amount}</b>
      </button>
      {hiddenAccount && !selectedIds.includes(hiddenAccount.id) ? <button className="account-lanes-hidden-link" type="button" onClick={() => showAccount(hiddenAccount.id)}>Other side: {hiddenAccount.name} hidden · Show lane</button> : null}
    </li>;
  };
  const renderGapDetail = ({ account, detail }: (typeof selectedGapRows)[number]) => <div className="account-lanes-gap-case" key={account.id}>
    <strong><AccountLabel account={account} /></strong>
    <dl>
      <div><dt>Previous report · {formatCalendarDate(detail.from.date)} {detail.from.time ? formatClockTime(detail.from.time) : ""}</dt><dd>{balanceCentsLabel(detail.priorCents, account.currency)}</dd></div>
      <div><dt>Movements since</dt><dd>{detail.movementCents >= 0 ? "+" : "−"}{centsLabel(detail.movementCents, account.currency)}</dd></div>
      <div><dt>Expected balance</dt><dd>{balanceCentsLabel(detail.expectedCents, account.currency)}</dd></div>
      <div><dt>Current report · {formatCalendarDate(detail.to.date)} {detail.to.time ? formatClockTime(detail.to.time) : ""}</dt><dd>{balanceCentsLabel(detail.actualCents, account.currency)}</dd></div>
      <div className="account-lanes-gap-case__difference"><dt>Difference (reported − expected)</dt><dd>{detail.differenceCents >= 0 ? "+" : "−"}{centsLabel(detail.differenceCents, account.currency)}</dd></div>
    </dl>
    <details><summary>{detail.movements.length} included {detail.movements.length === 1 ? "movement" : "movements"}</summary><ol>{detail.movements.map(row => <li key={row.id}>{formatCalendarDate(row.date)} {row.time ? formatClockTime(row.time) : ""} · {title(row)} · {amountLabel(row, account.id, account.currency)} <button className="account-lanes-gap-link" type="button" onClick={() => edit(row.id)}>Open entry and sources</button></li>)}</ol></details>
    <p>Only fully loaded days with an unambiguous order produce a numeric gap. Check missing movements or fees before reconciling.</p>
    <button className="account-lanes-gap-link" type="button" onClick={() => edit(detail.from.id)}>Open previous report and sources</button>
  </div>;

  const view = <main className={`account-lanes-page${isFullscreen ? " account-lanes-page--fullscreen" : ""}`} aria-label="Account transaction timeline" style={{ "--lanes-font-adjust": `${fontAdjustment}px`, "--lanes-row-min-height": `${Math.max(88, 100 + fontAdjustment * 6)}px` } as CSSProperties}>
    <div className="account-lanes-toolbar">
      <div className="account-lanes-date"><CalendarBlank aria-hidden="true" size={20} /><CalendarDateInput aria-label="Jump to date" value={visibleDate} onChange={value => { if (value) jumpTo(value); }} /><button type="button" aria-label="Previous day" onClick={() => jumpTo(addDays(visibleDate, -1))}><CaretLeft size={18} /></button><button type="button" aria-label="Next day" onClick={() => jumpTo(addDays(visibleDate, 1))}><CaretRight size={18} /></button><button type="button" onClick={() => jumpTo(today())}>Today</button></div>
      <div className="account-lanes-dropdown"><button className="account-lanes-control" aria-expanded={accountsOpen} onClick={() => { setAccountsOpen(!accountsOpen); setOptionsOpen(false); }} type="button">Accounts · {selectedAccounts.length} shown{accounts.length > selectedAccounts.length ? ` · ${accounts.length - selectedAccounts.length} hidden` : ""}</button>{accountsOpen ? <div className="account-lanes-menu" role="group" aria-label="Visible accounts">{accounts.map(account => <label key={account.id}><input checked={selectedIds.includes(account.id)} onChange={() => toggleAccount(account.id)} type="checkbox" /><AccountLabel account={account} />{!account.is_active ? " (inactive)" : ""}</label>)}{!selectedAccounts.length ? <small>Select an account to show its lane.</small> : null}</div> : null}</div>
      <div className="account-lanes-mode" role="group" aria-label="Card values">{(["amount", "balance", "both"] as const).map(value => <button className={mode === value ? "is-active" : ""} key={value} onClick={() => setMode(value)} type="button" aria-pressed={mode === value}>{value[0].toUpperCase() + value.slice(1)}</button>)}</div>
      <div className="account-lanes-dropdown"><button className="account-lanes-control" aria-expanded={optionsOpen} onClick={() => { setOptionsOpen(!optionsOpen); setAccountsOpen(false); }} type="button"><SlidersHorizontal size={18} /> View options</button>{optionsOpen ? <div className="account-lanes-menu account-lanes-menu--right" role="group" aria-label="Timeline options"><label><input checked={showEmptyDays} onChange={event => setShowEmptyDays(event.target.checked)} type="checkbox" />Show individual quiet days</label><label><input checked={showGaps} onChange={event => setShowGaps(event.target.checked)} type="checkbox" />Show possible balance gaps</label></div> : null}</div>
      <div className="account-lanes-text-size" role="group" aria-label="Timeline text size"><button type="button" aria-label="Decrease timeline text size by 0.5 pixels" disabled={fontAdjustment <= -2} onClick={() => setFontAdjustment(value => Math.max(-2, value - 0.5))}>A−</button><span aria-live="polite">{fontAdjustment > 0 ? "+" : ""}{fontAdjustment.toFixed(1)} px</span><button type="button" aria-label="Increase timeline text size by 0.5 pixels" disabled={fontAdjustment >= 2} onClick={() => setFontAdjustment(value => Math.min(2, value + 0.5))}>A+</button></div>
      <button className="account-lanes-control account-lanes-fullscreen" type="button" aria-label={isFullscreen ? "Exit full screen timeline" : "Open full screen timeline"} aria-pressed={isFullscreen} onClick={toggleFullscreen}>{isFullscreen ? <ArrowsIn size={18} /> : <ArrowsOut size={18} />}{isFullscreen ? "Exit full screen" : "Full screen"}</button>
      <button className="account-lanes-control account-lanes-refresh" type="button" aria-label="Refresh timeline" aria-busy={isRefreshing} disabled={isRefreshing || accountsLoading} onClick={() => void refreshTimeline(true)} title="Reload transactions, accounts and reported balances">{isRefreshing ? <span className="account-lanes-spinner" aria-hidden="true" /> : <ArrowClockwise aria-hidden="true" size={18} />}<span>{isRefreshing ? "Refreshing…" : "Refresh"}</span></button>
    </div>
    <div className="account-lanes-subtoolbar">
      <div className="account-lanes-layout-switch" role="group" aria-label="Timeline layout"><button type="button" aria-pressed={layoutMode === "lanes"} className={layoutMode === "lanes" ? "is-active" : ""} onClick={() => setLayoutMode("lanes")}>Lanes</button><button type="button" aria-pressed={layoutMode === "list"} className={layoutMode === "list" ? "is-active" : ""} onClick={() => setLayoutMode("list")}>List</button></div>
      <button type="button" onClick={() => expandAtEdge(-1, true)}>Earlier dates</button>
      <button type="button" onClick={() => expandAtEdge(1, true)}>Later dates</button>
      <button type="button" disabled={!nextMovementDate} onClick={() => nextMovementDate && jumpTo(nextMovementDate)} title={nextMovementDate ? `Jump to ${formatCalendarDate(nextMovementDate)}` : "No later movement loaded"}>Next movement</button>
      <button type="button" disabled={!nextGapDate} onClick={() => nextGapDate && jumpTo(nextGapDate)} title={nextGapDate ? `Jump to ${formatCalendarDate(nextGapDate)}` : "No later gap loaded"}>Next gap</button>
      <small>Navigation uses loaded days.</small>
      {pendingJump ? <span className="account-lanes-progress" role={pendingJumpResult?.status === "error" ? "alert" : "status"}>{pendingJumpResult?.status !== "error" ? <span className="account-lanes-spinner" aria-hidden="true" /> : null}{pendingJumpResult?.status === "error" ? `Could not load ${formatCalendarDate(pendingJump)}` : `Loading ${formatCalendarDate(pendingJump)}…`}{pendingJumpResult?.status === "error" ? <button type="button" onClick={() => void loadWeek(weekStart(pendingJump), true)}>Retry</button> : null}<button type="button" onClick={() => setPendingJump(null)}>Cancel</button></span> : !accountsError && readyWeeks < windowWeeks.length && !waitingForTarget ? <span className="account-lanes-progress" role="status">{pendingEdge === null && readyWeeks + failedWeeks < windowWeeks.length ? <span className="account-lanes-spinner" aria-hidden="true" /> : null}{readyWeeks} of {windowWeeks.length} weeks ready{failedWeeks ? ` · ${failedWeeks} failed` : ""}{failedWeeks ? <button type="button" onClick={() => windowWeeks.filter(start => weekResults[start]?.status === "error").forEach(start => void loadWeek(start, true))}>Retry failed {failedWeeks === 1 ? "week" : "weeks"}</button> : null}</span> : null}
    </div>
    {accountsError ? <div className="account-lanes-error" role="alert">{accountsError} <button type="button" onClick={() => void loadAccounts()}>Retry</button></div> : null}
    <div className="account-lanes-layout">
      <div className={`account-lanes-main${layoutMode === "list" ? " account-lanes-main--list" : ""}`} style={{ "--lane-count": Math.max(selectedAccounts.length, 1), "--lanes-min-width": `${88 + Math.max(selectedAccounts.length, 1) * 240}px` } as CSSProperties}>
        <div className="account-lanes-scroll" ref={viewportRef} onScroll={onScroll} onWheel={onWheel} onTouchStart={onTouchStart} onTouchMove={() => { lastScrollInputAtRef.current = Date.now(); }} onTouchEnd={onTouchEnd} onPointerDown={() => { edgeGestureRef.current = null; lastScrollInputAtRef.current = Date.now(); }} onPointerMove={event => { if (event.buttons) lastScrollInputAtRef.current = Date.now(); }} onKeyDown={onViewportKeyDown} tabIndex={0} aria-label="Timeline. Scroll up for earlier dates and down for later dates.">
          {layoutMode === "lanes" ? <div className="account-lanes-head" style={{ gridTemplateColumns: `88px repeat(${Math.max(selectedAccounts.length, 1)}, minmax(240px, 1fr))` }}><span>Time</span>{selectedAccounts.length ? selectedAccounts.map(account => {
            const report = asOfReports.get(account.id);
            const context = report?.status === "reported"
              ? `${formatCurrency(report.value, account.currency)} · last reported ${formatCalendarDate(report.date)}${report.time ? `, ${formatClockTime(report.time)}` : ""}`
              : report?.status === "unavailable" && report.reason === "not_loaded" ? "Loading report context…"
              : report?.status === "unavailable" && report.reason === "ambiguous_order" ? savedOrders.some(order => order.account === account.id && order.date <= visibleDate && order.status === "valid" && order.ordered_ids.length) ? "Reviewed order saved · clock times incomplete" : "Report order unclear"
              : "No reported balance in loaded days";
            return <div data-lane-account={account.id} key={account.id}><strong><AccountLabel account={account} /></strong><small>By {formatCalendarDate(visibleDate)} · {context}</small></div>;
          }) : <div><strong>Choose an account</strong></div>}</div> : null}
          <div className="account-lanes-edge">{earlierEdgeWeek ? weekResults[earlierEdgeWeek]?.status === "error" ? <button type="button" onClick={() => void loadWeek(earlierEdgeWeek, true)}>Retry earlier dates</button> : <>{pendingEdge?.direction === -1 && !pendingJump ? <span className="account-lanes-spinner" aria-hidden="true" /> : null}<span role="status">Loading earlier dates…</span></> : <button type="button" onClick={() => expandAtEdge(-1, true)}>Load earlier dates</button>}</div>
          {displayedDays.map(item => {
            if (item.kind === "quiet") {
              const nextActivity = renderedDates.find(date => date > item.end && movementDates.has(date));
              return <div className="account-lanes-quiet-band" data-lane-day={item.start} data-lane-end={item.end} key={item.start}>
                <span>{item.count === 1 ? dayLabel(item.start) : `${formatCalendarDate(item.start)} – ${formatCalendarDate(item.end)}`} · {item.count} {item.count === 1 ? "day" : "days"} without recorded activity</span>
                {nextActivity ? <button type="button" onClick={() => jumpTo(nextActivity)}>Next movement <CaretRight aria-hidden="true" size={14} /></button> : null}
              </div>;
            }
            const date = item.date;
            const result = weekResults[weekStart(date)];
            const daily = result?.status === "ready" ? result.rows.filter(row => row.date === date && selectedAccounts.some(account => laneDirection(row, account.id))) : [];
            const timed = daily.filter(row => row.time).sort((a, b) => `${a.time}:${a.id}`.localeCompare(`${b.time}:${b.id}`));
            const dayOrders = savedOrders.filter(order => order.date === date);
            const placed = placedTimelineEvents(daily, selectedIds, dayOrders);
            const orderedEvents = sharedBalanceEventOrder(placed.events, checkedAllocations);
            const untimed = placed.unplaced;
            return <section className={`account-lanes-day${layoutMode === "list" ? " account-lanes-day--list" : ""}`} data-lane-day={date} key={date} aria-label={dayLabel(date)}><div className="account-lanes-day-title"><div className="account-lanes-day-title__content"><time dateTime={date}>{dayLabel(date)}</time><span>{daily.length} {daily.length === 1 ? "movement" : "movements"}</span></div>{daily.some(row => !row.time) ? <button className="account-lanes-order-action" type="button" onClick={() => setPlacement({ date })}>Suggest placement</button> : null}</div>{dayOrders.some(order => order.status === "stale") ? <p className="account-lanes-placement-warning">Saved placement needs review because this day changed.</p> : null}
              {daily.length === 0 ? <p className="account-lanes-status">No movements in selected accounts on this day.</p> : null}
              {layoutMode === "lanes" ? orderedEvents.map(event => renderLaneRow(event.row, date, event.account, event.basis)) : <ul className="account-lanes-list">{(selectedIds.length === 1 ? [...orderedEvents.map(event => event.row), ...untimed] : [...sharedBalanceOrder(timed, checkedAllocations), ...daily.filter(row => !row.time)]).map(renderListRow)}</ul>}
              {layoutMode === "lanes" && untimed.length ? <details className="account-lanes-untimed"><summary>Time not reported · {untimed.length} {untimed.length === 1 ? "movement" : "movements"}</summary>{untimed.map(row => <button type="button" data-lane-card={row.id} key={row.id} onClick={event => selectTransaction(row, event.detail === 0)}>{title(row)} · {formatCurrency(row.amount, accountById.get(row.account)?.currency)}{row.type === "transfer" ? " · transfer" : ""}</button>)}</details> : null}
            </section>;
          })}
          <div className="account-lanes-edge">{laterEdgeWeek ? weekResults[laterEdgeWeek]?.status === "error" ? <button type="button" onClick={() => void loadWeek(laterEdgeWeek, true)}>Retry later dates</button> : <>{pendingEdge?.direction === 1 && !pendingJump ? <span className="account-lanes-spinner" aria-hidden="true" /> : null}<span role="status">Loading later dates…</span></> : <button type="button" onClick={() => expandAtEdge(1, true)}>Load later dates</button>}</div>
        </div>
        {!accountsError && (waitingForTarget || targetError) ? <div className="account-lanes-initial-loading" role={targetError ? "alert" : "status"}>{targetError ? <><strong>Could not load {formatCalendarDate(targetDate)}</strong><span>{targetError}</span><button type="button" onClick={() => void loadWeek(weekStart(targetDate), true)}>Retry</button></> : <><span className="account-lanes-spinner" aria-hidden="true" /><strong>Loading timeline</strong><span>{targetWeek?.status === "loading" && targetWeek.loaded ? `${targetWeek.loaded} of ${targetWeek.total ?? "more"} movements loaded around ${formatCalendarDate(targetDate)}…` : `Fetching movements around ${formatCalendarDate(targetDate)}…`}</span></>}</div> : null}
      </div>
      {balanceError ? <p className="account-lanes-placement-warning" role="status">{balanceError}</p> : null}
      {orderError ? <p className="account-lanes-placement-warning" role="status">{orderError}</p> : null}
      {placement ? <TimelineOrderDialog date={placement.date} accounts={selectedAccounts} initialAccount={placement.account} onClose={() => setPlacement(null)} onChange={() => setOrderRevision(value => value + 1)} /> : null}
      {selected ? createPortal(<aside className="account-lanes-inspector" role="dialog" aria-modal="false" aria-labelledby="account-lanes-inspector-title">
          <div className="account-lanes-inspector__title"><h2 id="account-lanes-inspector-title" ref={inspectorTitleRef} tabIndex={-1}>Transaction details</h2><button type="button" aria-label="Close transaction details" onClick={closeDetails}><X size={18} /></button></div>
          <p className="account-lanes-inspector__date">{formatCalendarDate(selected.date)} · {selected.time ? formatClockTime(selected.time) : "time not reported"}</p>
          <h3>{title(selected)}</h3>{!selected.time ? <><span className="badge">{savedOrders.some(order => order.date === selected.date && order.status === "valid" && order.ordered_ids.includes(selected.id)) ? "Reviewed placement · time still unknown" : "Not yet placed"}</span><button className="account-lanes-order-action" type="button" onClick={() => setPlacement({ date: selected.date, account: selectedIds.includes(selected.account) ? selected.account : selected.transfer_account ?? selected.account })}>Review suggested placement</button></> : null}
          <strong className="account-lanes-inspector__amount">{formatCurrency(selected.amount, accountById.get(selected.account)?.currency)}</strong>
          <p>{selected.type.replaceAll("_", " ")}{selected.category && categoryById.get(selected.category) ? " · " + categoryById.get(selected.category) : ""}</p>
          <div className="account-lanes-observations"><h3>Account observations</h3>{[selected.account, selected.transfer_account].filter((id): id is string => Boolean(id)).map(id => {
            const account = accountById.get(id);
            if (!account) return null;
            const observation = selected.transfer_evidence.find(item => item.account === id);
            return <div key={id}><strong><AccountLabel account={account} /></strong><span className={laneDirection(selected, id) === "credit" ? "is-credit" : "is-debit"}>{amountLabel(selected, id, account.currency)}</span><small>Balance after · {laneBalance(selected, id) === null ? "not reported" : formatCurrency(laneBalance(selected, id)!, account.currency)}</small>{observation && (observation.date !== selected.date || observation.time !== selected.time) ? <small>Source observed {formatCalendarDate(observation.date)} · {observation.time ? formatClockTime(observation.time) : "time not reported"}; lane position uses the ledger date.</small> : null}{!selectedIds.includes(id) ? <button type="button" onClick={() => showAccount(id)}>Show {account.name} lane</button> : null}</div>;
          })}</div>
          {selectedAccounts.map(account => {
            const allocation = balanceAllocation(selected, account);
            const principal = allocation && allRows.find(row => row.id === allocation.principal);
            return principal ? renderAllocation(principal, account) : null;
          })}
          {selectedGapRows.length ? <div className="account-lanes-gap-detail"><h3>Possible balance gap</h3>{selectedGapRows.map(renderGapDetail)}</div> : null}
          {selected.note ? <div className="account-lanes-note"><h3>Note</h3><p>{selected.note}</p></div> : null}
          {selected.reference ? <p>Reference · {selected.reference}</p> : null}
          <div className="account-lanes-sources"><TransactionSourceMessages key={`${selected.id}-${evidenceRevision}`} transactionId={selected.id} loadOnExpand showEmpty /><TransactionStatementEvidence key={`statement-${selected.id}-${evidenceRevision}`} transactionId={selected.id} /></div>
          <button className="button button--ghost" type="button" onClick={() => edit(selected.id)}>Open ledger entry</button>
          <p className="account-lanes-inspector__hint">A transfer is one ledger transaction shown in each involved account.</p>
      </aside>, document.body) : null}
    </div>
    {accountsLoading ? <span className="sr-only" role="status">Loading accounts…</span> : null}
  </main>;
  return isFullscreen ? createPortal(view, document.body) : view;
}
