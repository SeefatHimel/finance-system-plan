"use client";

import { ArrowsIn, ArrowsOut, CalendarBlank, CaretLeft, CaretRight, Eye, LinkSimple, SlidersHorizontal, X } from "@phosphor-icons/react";
import Link from "next/link";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { formatCalendarDate, formatClockTime, formatCurrency } from "../../finance-contracts/presentation";
import { CalendarDateInput } from "./calendar-date-input";
import { TransactionSourceMessages } from "./transaction-source-messages";
import { TransactionStatementEvidence } from "./transaction-statement-evidence";
import { getAccessToken } from "@/lib/auth-storage";
import { listAccounts, listCategories, listTransactionActivityPage, type Account, type Category, type Transaction } from "@/lib/api";
import { addDays, atTimelineEdge, balanceGapDetails, groupTimelineDays, laneBalance, laneDirection, reportedBalanceAtDate, timelineScrollShift, weekStart } from "@/lib/account-lanes";

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
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [accountsLoading, setAccountsLoading] = useState(true);
  const [accountsError, setAccountsError] = useState<string | null>(null);
  const [weekResults, setWeekResults] = useState<Record<string, WeekResult>>({});
  const [windowStart, setWindowStart] = useState(initialWindow);
  const [visibleDate, setVisibleDate] = useState(today);
  const [mode, setMode] = useState<ViewMode>("both");
  const [layoutMode, setLayoutMode] = useState<LayoutMode>("lanes");
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
  const initializedRef = useRef(false);
  const jumpTargetRef = useRef<string | null>(null);
  const shiftingRef = useRef(false);
  const touchStartRef = useRef<number | null>(null);
  const lastScrollInputRef = useRef(0);
  const lastScrollTopRef = useRef(0);
  const requestsRef = useRef(new Map<string, AbortController>());
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
  useEffect(() => () => { for (const controller of requestsRef.current.values()) controller.abort(); requestsRef.current.clear(); }, []);
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
      if (event.key !== "Escape" || event.defaultPrevented) return;
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

  const loadWeek = useCallback(async (start: string, retry = false) => {
    if (requestsRef.current.has(start) || (!retry && weekResults[start] && weekResults[start].status !== "loading")) return;
    const token = getAccessToken();
    if (!token) return;
    const controller = new AbortController();
    requestsRef.current.set(start, controller);
    setWeekResults(current => ({ ...current, [start]: { status: "loading", loaded: 0, total: null } }));
    try {
      const rows: Transaction[] = [];
      let offset: number | null = 0;
      while (offset !== null) {
        const page = await listTransactionActivityPage(token, start, addDays(start, 6), offset, controller.signal);
        rows.push(...page.results);
        if (!controller.signal.aborted && page.next_offset !== null) {
          setWeekResults(current => ({ ...current, [start]: { status: "loading", loaded: rows.length, total: page.count } }));
        }
        offset = page.next_offset;
      }
      if (!controller.signal.aborted) {
        captureAnchor();
        setWeekResults(current => ({ ...current, [start]: { status: "ready", rows } }));
      }
    } catch (error) {
      if (!controller.signal.aborted) setWeekResults(current => ({ ...current, [start]: { status: "error", message: error instanceof Error ? error.message : "Could not load this week." } }));
    } finally { if (requestsRef.current.get(start) === controller) requestsRef.current.delete(start); }
  }, [captureAnchor, weekResults]);

  useEffect(() => {
    if (accountsError) return;
    for (let index = 0; index < 3; index++) {
      const start = addDays(windowStart, index * 7);
      if ((!weekResults[start] || weekResults[start].status === "loading") && !requestsRef.current.has(start)) void loadWeek(start);
    }
  }, [accountsError, accountsLoading, loadWeek, weekResults, windowStart]);

  useEffect(() => {
    const retained = new Set(Array.from({ length: 5 }, (_, index) => addDays(windowStart, (index - 1) * 7)));
    setWeekResults(current => {
      if (Object.keys(current).every(key => retained.has(key))) return current;
      return Object.fromEntries(Object.entries(current).filter(([key]) => retained.has(key)));
    });
    for (const [key, controller] of requestsRef.current) if (!retained.has(key)) { controller.abort(); requestsRef.current.delete(key); }
  }, [windowStart]);

  const dates = useMemo(() => Array.from({ length: WINDOW_DAYS }, (_, index) => addDays(windowStart, index)), [windowStart]);
  const windowWeeks = useMemo(() => Array.from({ length: 3 }, (_, index) => addDays(windowStart, index * 7)), [windowStart]);
  const readyWeeks = windowWeeks.filter(start => weekResults[start]?.status === "ready").length;
  const failedWeeks = windowWeeks.filter(start => weekResults[start]?.status === "error").length;
  const targetDate = jumpTargetRef.current ?? today();
  const targetWeek = weekResults[weekStart(targetDate)];
  const waitingForTarget = !initializedRef.current && targetWeek?.status !== "ready" && targetWeek?.status !== "error";
  const targetError = targetWeek?.status === "error" ? targetWeek.message : null;
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
  const loadedDays = useMemo(() => new Set(dates.filter(date => weekResults[weekStart(date)]?.status === "ready")), [dates, weekResults]);
  const allRows = useMemo(() => {
    const unique = new Map<string, Transaction>();
    for (const date of dates) {
      const result = weekResults[weekStart(date)];
      if (result?.status === "ready") for (const row of result.rows) unique.set(row.id, row);
    }
    return [...unique.values()];
  }, [dates, weekResults]);
  const gaps = useMemo(() => new Map(selectedAccounts.map(account => [account.id, balanceGapDetails(allRows, account.id, loadedDays)])), [allRows, loadedDays, selectedAccounts]);
  const asOfReports = useMemo(() => new Map(selectedAccounts.map(account => [account.id, reportedBalanceAtDate(allRows, account.id, visibleDate, loadedDays)])), [allRows, loadedDays, selectedAccounts, visibleDate]);
  const movementDates = useMemo(() => new Set(allRows.filter(row => selectedAccounts.some(account => laneDirection(row, account.id))).map(row => row.date)), [allRows, selectedAccounts]);
  const displayedDays = useMemo(() => groupTimelineDays(dates, movementDates, loadedDays, !showEmptyDays), [dates, movementDates, loadedDays, showEmptyDays]);
  const nextMovementDate = dates.find(date => date > visibleDate && loadedDays.has(date) && movementDates.has(date));
  const nextGapDate = [...gaps.values()].flatMap(map => [...map.values()].map(detail => detail.to.date)).filter(date => date > visibleDate).sort()[0];

  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    if (!initializedRef.current) {
      const target = jumpTargetRef.current ?? today();
      if (weekResults[weekStart(target)]?.status !== "ready") return;
      const day = findDayNode(viewport, target);
      if (day) { lastScrollInputRef.current = 0; viewport.scrollTop = day.offsetTop - viewport.offsetTop - (viewport.querySelector<HTMLElement>(".account-lanes-head")?.offsetHeight ?? 0) - 8; lastScrollTopRef.current = viewport.scrollTop; initializedRef.current = true; jumpTargetRef.current = null; }
    } else if (anchorRef.current) {
      const anchor = anchorRef.current;
      const target = findDayNode(viewport, anchor.date);
      if (target) { lastScrollInputRef.current = 0; viewport.scrollTop += target.getBoundingClientRect().top - viewport.getBoundingClientRect().top - anchor.top; lastScrollTopRef.current = viewport.scrollTop; }
    }
    anchorRef.current = null;
    shiftingRef.current = false;
  }, [windowStart, weekResults, layoutMode, showEmptyDays]);

  const jumpTo = useCallback((date: string) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return;
    setVisibleDate(date);
    const start = addDays(weekStart(date), -7);
    if (start !== windowStart) {
      initializedRef.current = false;
      jumpTargetRef.current = date;
      anchorRef.current = null;
      setWindowStart(start);
    } else {
      const viewport = viewportRef.current;
      const target = viewport ? findDayNode(viewport, date) : null;
      if (viewport && target) viewport.scrollTo({ top: target.offsetTop - viewport.offsetTop - (viewport.querySelector<HTMLElement>(".account-lanes-head")?.offsetHeight ?? 0) - 8, behavior: "smooth" });
    }
  }, [windowStart]);

  const onScroll = useCallback(() => {
    const viewport = viewportRef.current;
    if (!viewport || !initializedRef.current) return;
    const movement = viewport.scrollTop - lastScrollTopRef.current;
    lastScrollTopRef.current = viewport.scrollTop;
    const middle = viewport.getBoundingClientRect().top + Math.min(viewport.clientHeight / 3, 180) + (viewport.querySelector<HTMLElement>(".account-lanes-head")?.offsetHeight ?? 0);
    const current = Array.from(viewport.querySelectorAll<HTMLElement>("[data-lane-day]")).find(day => day.getBoundingClientRect().bottom > middle);
    if (current?.dataset.laneDay) setVisibleDate(previous => previous >= current.dataset.laneDay! && previous <= (current.dataset.laneEnd ?? current.dataset.laneDay!) ? previous : current.dataset.laneDay!);
    if (shiftingRef.current || Date.now() - lastScrollInputRef.current > 2000) return;
    const shift = timelineScrollShift(movement, viewport.scrollTop, viewport.scrollHeight, viewport.clientHeight, weekResults[windowStart]?.status === "ready", weekResults[addDays(windowStart, 14)]?.status === "ready");
    if (shift < 0) {
      captureAnchor(); shiftingRef.current = true; setWindowStart(previous => addDays(previous, -7));
    } else if (shift > 0) {
      captureAnchor(); shiftingRef.current = true; setWindowStart(previous => addDays(previous, 7));
    }
  }, [captureAnchor, weekResults, windowStart]);

  const shiftAtEdge = useCallback((direction: -1 | 1) => {
    const viewport = viewportRef.current;
    if (!viewport || !initializedRef.current || shiftingRef.current) return;
    const edgeWeek = direction < 0 ? windowStart : addDays(windowStart, 14);
    if (weekResults[edgeWeek]?.status !== "ready") return;
    const atEdge = atTimelineEdge(direction, viewport.scrollTop, viewport.scrollHeight, viewport.clientHeight, 4);
    if (!atEdge) return;
    captureAnchor();
    shiftingRef.current = true;
    setWindowStart(previous => addDays(previous, direction * 7));
  }, [captureAnchor, weekResults, windowStart]);

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
  const selected = selectedTransaction && allRows.find(row => row.id === selectedTransaction.id) || selectedTransaction;
  const selectedGapRows = selected ? selectedAccounts.flatMap(account => {
    const detail = gaps.get(account.id)?.get(selected.id);
    return detail === undefined ? [] : [{ account, detail }];
  }) : [];
  const renderLaneRow = (row: Transaction, date: string) => {
    const first = selectedIds.indexOf(row.account);
    const second = row.transfer_account ? selectedIds.indexOf(row.transfer_account) : -1;
    const bridge = row.type === "transfer" && first >= 0 && second >= 0;
    return <div className={`account-lanes-row${bridge ? " account-lanes-row--transfer" : ""}`} key={row.id} style={{ gridTemplateColumns: `88px repeat(${Math.max(selectedAccounts.length, 1)}, minmax(240px, 1fr))` }}>
      <time dateTime={`${date}T${row.time}`} style={{ gridColumn: 1, gridRow: 1 }}>{formatClockTime(row.time!)}</time>
      {bridge ? <span aria-hidden="true" className="account-lanes-transfer-bridge" style={{ gridColumn: `${Math.min(first, second) + 2} / ${Math.max(first, second) + 3}`, gridRow: 1 }} /> : null}
      {selectedAccounts.map((account, index) => {
        const direction = laneDirection(row, account.id);
        if (!direction) return <div className="account-lanes-cell" key={account.id} style={{ gridColumn: index + 2, gridRow: 1 }} />;
        const otherId = row.type === "transfer" ? row.account === account.id ? row.transfer_account : row.account : null;
        const other = otherId ? accountById.get(otherId) : null;
        const gap = gaps.get(account.id)?.get(row.id);
        return <div className="account-lanes-cell" key={account.id} style={{ gridColumn: index + 2, gridRow: 1 }}>
          <button className={`account-lanes-card${selected?.id === row.id ? " is-selected" : ""}${bridge ? " account-lanes-card--paired" : ""}`} data-lane-card={row.id} type="button" onClick={event => selectTransaction(row, event.detail === 0)}>
            <span className="account-lanes-card__top"><strong>{title(row)}</strong>{row.type === "transfer" ? <LinkSimple aria-hidden="true" size={16} /> : null}</span>
            <small>{formatClockTime(row.time!)} · {row.type.replaceAll("_", " ")}{row.category && categoryById.get(row.category) ? ` · ${categoryById.get(row.category)}` : ""}</small>
            {bridge ? <small className="account-lanes-pair-label">Same transfer · {other?.name ?? "other account"}</small> : null}
            <span className="account-lanes-card__numbers">{mode !== "balance" ? <b className={direction === "credit" ? "is-credit" : "is-debit"}>{amountLabel(row, account.id, account.currency)}</b> : null}{mode !== "amount" ? <span>Bal {laneBalance(row, account.id) === null ? "not reported" : formatCurrency(laneBalance(row, account.id)!, account.currency)}</span> : null}</span>
          </button>
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
        <time dateTime={row.time ? `${row.date}T${row.time}` : row.date}>{row.time ? formatClockTime(row.time) : "Time unknown"}</time>
        <span><strong>{title(row)}</strong><small>{row.type === "transfer" ? `${accountById.get(row.account)?.name ?? "Source"} → ${other?.name ?? "Destination"}` : account?.name ?? "Account"} · {row.type.replaceAll("_", " ")}</small></span>
        <b className={laneDirection(row, accountId) === "credit" ? "is-credit" : "is-debit"}>{account ? amountLabel(row, accountId, account.currency) : row.amount}</b>
      </button>
      {hiddenAccount && !selectedIds.includes(hiddenAccount.id) ? <button className="account-lanes-hidden-link" type="button" onClick={() => showAccount(hiddenAccount.id)}>Other side: {hiddenAccount.name} hidden · Show lane</button> : null}
    </li>;
  };
  const renderGapDetail = ({ account, detail }: (typeof selectedGapRows)[number]) => <div className="account-lanes-gap-case" key={account.id}>
    <strong>{account.name}</strong>
    <dl>
      <div><dt>Previous report · {formatCalendarDate(detail.from.date)} {detail.from.time ? formatClockTime(detail.from.time) : ""}</dt><dd>{balanceCentsLabel(detail.priorCents, account.currency)}</dd></div>
      <div><dt>Movements since</dt><dd>{detail.movementCents >= 0 ? "+" : "−"}{centsLabel(detail.movementCents, account.currency)}</dd></div>
      <div><dt>Expected balance</dt><dd>{balanceCentsLabel(detail.expectedCents, account.currency)}</dd></div>
      <div><dt>Current report · {formatCalendarDate(detail.to.date)} {detail.to.time ? formatClockTime(detail.to.time) : ""}</dt><dd>{balanceCentsLabel(detail.actualCents, account.currency)}</dd></div>
      <div className="account-lanes-gap-case__difference"><dt>Difference (reported − expected)</dt><dd>{detail.differenceCents >= 0 ? "+" : "−"}{centsLabel(detail.differenceCents, account.currency)}</dd></div>
    </dl>
    <details><summary>{detail.movements.length} included {detail.movements.length === 1 ? "movement" : "movements"}</summary><ol>{detail.movements.map(row => <li key={row.id}>{formatCalendarDate(row.date)} {row.time ? formatClockTime(row.time) : ""} · {title(row)} · {amountLabel(row, account.id, account.currency)} <Link href={`/transactions?edit=${row.id}`}>Open entry and sources</Link></li>)}</ol></details>
    <p>Only fully loaded days with an unambiguous order produce a numeric gap. Check missing movements or fees before reconciling.</p>
    <Link href={`/transactions?edit=${detail.from.id}`}>Open previous report and sources</Link>
  </div>;

  const view = <main className={`account-lanes-page${isFullscreen ? " account-lanes-page--fullscreen" : ""}`} aria-label="Account transaction timeline" style={{ "--lanes-font-adjust": `${fontAdjustment}px`, "--lanes-row-min-height": `${Math.max(88, 100 + fontAdjustment * 6)}px` } as CSSProperties}>
    <div className="account-lanes-toolbar">
      <div className="account-lanes-date"><CalendarBlank aria-hidden="true" size={20} /><CalendarDateInput aria-label="Jump to date" value={visibleDate} onChange={value => { if (value) jumpTo(value); }} /><button type="button" aria-label="Previous day" onClick={() => jumpTo(addDays(visibleDate, -1))}><CaretLeft size={18} /></button><button type="button" aria-label="Next day" onClick={() => jumpTo(addDays(visibleDate, 1))}><CaretRight size={18} /></button><button type="button" onClick={() => jumpTo(today())}>Today</button></div>
      <div className="account-lanes-dropdown"><button className="account-lanes-control" aria-expanded={accountsOpen} onClick={() => { setAccountsOpen(!accountsOpen); setOptionsOpen(false); }} type="button">Accounts · {selectedAccounts.length} shown{accounts.length > selectedAccounts.length ? ` · ${accounts.length - selectedAccounts.length} hidden` : ""}</button>{accountsOpen ? <div className="account-lanes-menu" role="group" aria-label="Visible accounts">{accounts.map(account => <label key={account.id}><input checked={selectedIds.includes(account.id)} onChange={() => toggleAccount(account.id)} type="checkbox" />{account.name}{!account.is_active ? " (inactive)" : ""}</label>)}{!selectedAccounts.length ? <small>Select an account to show its lane.</small> : null}</div> : null}</div>
      <div className="account-lanes-mode" role="group" aria-label="Card values">{(["amount", "balance", "both"] as const).map(value => <button className={mode === value ? "is-active" : ""} key={value} onClick={() => setMode(value)} type="button" aria-pressed={mode === value}>{value[0].toUpperCase() + value.slice(1)}</button>)}</div>
      <div className="account-lanes-dropdown"><button className="account-lanes-control" aria-expanded={optionsOpen} onClick={() => { setOptionsOpen(!optionsOpen); setAccountsOpen(false); }} type="button"><SlidersHorizontal size={18} /> View options</button>{optionsOpen ? <div className="account-lanes-menu account-lanes-menu--right" role="group" aria-label="Timeline options"><label><input checked={showEmptyDays} onChange={event => setShowEmptyDays(event.target.checked)} type="checkbox" />Show individual quiet days</label><label><input checked={showGaps} onChange={event => setShowGaps(event.target.checked)} type="checkbox" />Show possible balance gaps</label></div> : null}</div>
      <div className="account-lanes-text-size" role="group" aria-label="Timeline text size"><button type="button" aria-label="Decrease timeline text size by 0.5 pixels" disabled={fontAdjustment <= -2} onClick={() => setFontAdjustment(value => Math.max(-2, value - 0.5))}>A−</button><span aria-live="polite">{fontAdjustment > 0 ? "+" : ""}{fontAdjustment.toFixed(1)} px</span><button type="button" aria-label="Increase timeline text size by 0.5 pixels" disabled={fontAdjustment >= 2} onClick={() => setFontAdjustment(value => Math.min(2, value + 0.5))}>A+</button></div>
      <button className="account-lanes-control account-lanes-fullscreen" type="button" aria-label={isFullscreen ? "Exit full screen timeline" : "Open full screen timeline"} aria-pressed={isFullscreen} onClick={toggleFullscreen}>{isFullscreen ? <ArrowsIn size={18} /> : <ArrowsOut size={18} />}{isFullscreen ? "Exit full screen" : "Full screen"}</button>
    </div>
    <div className="account-lanes-subtoolbar">
      <div className="account-lanes-layout-switch" role="group" aria-label="Timeline layout"><button type="button" aria-pressed={layoutMode === "lanes"} className={layoutMode === "lanes" ? "is-active" : ""} onClick={() => setLayoutMode("lanes")}>Lanes</button><button type="button" aria-pressed={layoutMode === "list"} className={layoutMode === "list" ? "is-active" : ""} onClick={() => setLayoutMode("list")}>List</button></div>
      <button type="button" onClick={() => jumpTo(addDays(windowStart, -7))}>Earlier dates</button>
      <button type="button" onClick={() => jumpTo(addDays(windowStart, WINDOW_DAYS))}>Later dates</button>
      <button type="button" disabled={!nextMovementDate} onClick={() => nextMovementDate && jumpTo(nextMovementDate)} title={nextMovementDate ? `Jump to ${formatCalendarDate(nextMovementDate)}` : "No later movement loaded"}>Next movement</button>
      <button type="button" disabled={!nextGapDate} onClick={() => nextGapDate && jumpTo(nextGapDate)} title={nextGapDate ? `Jump to ${formatCalendarDate(nextGapDate)}` : "No later gap loaded"}>Next gap</button>
      <small>Navigation uses loaded days.</small>
      {!accountsError && readyWeeks < 3 ? <span className="account-lanes-progress" role="status">{readyWeeks + failedWeeks < 3 ? <span className="account-lanes-spinner" aria-hidden="true" /> : null}{readyWeeks} of 3 weeks ready{failedWeeks ? ` · ${failedWeeks} failed` : ""}{failedWeeks ? <button type="button" onClick={() => windowWeeks.filter(start => weekResults[start]?.status === "error").forEach(start => void loadWeek(start, true))}>Retry failed {failedWeeks === 1 ? "week" : "weeks"}</button> : null}</span> : null}
    </div>
    {accountsError ? <div className="account-lanes-error" role="alert">{accountsError} <button type="button" onClick={() => void loadAccounts()}>Retry</button></div> : null}
    <div className="account-lanes-layout">
      <div className={`account-lanes-main${layoutMode === "list" ? " account-lanes-main--list" : ""}`} style={{ "--lane-count": Math.max(selectedAccounts.length, 1), "--lanes-min-width": `${88 + Math.max(selectedAccounts.length, 1) * 240}px` } as CSSProperties}>
        <div className="account-lanes-scroll" ref={viewportRef} onScroll={onScroll} onWheel={event => { lastScrollInputRef.current = Date.now(); if (Math.abs(event.deltaY) > 2) shiftAtEdge(event.deltaY < 0 ? -1 : 1); }} onTouchStart={event => { lastScrollInputRef.current = Date.now(); touchStartRef.current = event.touches[0]?.clientY ?? null; }} onTouchEnd={event => { const start = touchStartRef.current; touchStartRef.current = null; if (start !== null && Math.abs(start - event.changedTouches[0].clientY) > 45) shiftAtEdge(start < event.changedTouches[0].clientY ? -1 : 1); }} onPointerDown={() => { lastScrollInputRef.current = Date.now(); }} onKeyDown={event => { if (["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End"].includes(event.key)) lastScrollInputRef.current = Date.now(); }} tabIndex={0} aria-label="Timeline. Scroll up for earlier dates and down for later dates.">
          {layoutMode === "lanes" ? <div className="account-lanes-head" style={{ gridTemplateColumns: `88px repeat(${Math.max(selectedAccounts.length, 1)}, minmax(240px, 1fr))` }}><span>Time</span>{selectedAccounts.length ? selectedAccounts.map(account => {
            const report = asOfReports.get(account.id);
            const context = report?.status === "reported"
              ? `${formatCurrency(report.value, account.currency)} · last reported ${formatCalendarDate(report.date)}${report.time ? `, ${formatClockTime(report.time)}` : ""}`
              : report?.status === "unavailable" && report.reason === "not_loaded" ? "Loading report context…"
              : report?.status === "unavailable" && report.reason === "ambiguous_order" ? "Report order unclear"
              : "No reported balance in loaded days";
            return <div data-lane-account={account.id} key={account.id}><strong>{account.name}</strong><small>By {formatCalendarDate(visibleDate)} · {context}</small></div>;
          }) : <div><strong>Choose an account</strong></div>}</div> : null}
          <div className="account-lanes-edge" role="status">{weekResults[windowStart]?.status === "error" ? <button type="button" onClick={() => void loadWeek(windowStart, true)}>Retry earlier dates</button> : weekResults[windowStart]?.status !== "ready" ? <><span className="account-lanes-spinner" aria-hidden="true" />Loading earlier dates…</> : <button type="button" onClick={() => jumpTo(addDays(windowStart, -7))}>Load earlier dates</button>}</div>
          {displayedDays.map(item => {
            if (item.kind === "quiet") {
              const nextActivity = dates.find(date => date > item.end && movementDates.has(date) && loadedDays.has(date));
              return <div className="account-lanes-quiet-band" data-lane-day={item.start} data-lane-end={item.end} key={item.start}>
                <span>{item.count === 1 ? dayLabel(item.start) : `${formatCalendarDate(item.start)} – ${formatCalendarDate(item.end)}`} · {item.count} {item.count === 1 ? "day" : "days"} without recorded activity</span>
                {nextActivity ? <button type="button" onClick={() => jumpTo(nextActivity)}>Next movement <CaretRight aria-hidden="true" size={14} /></button> : null}
              </div>;
            }
            const date = item.date;
            const result = weekResults[weekStart(date)];
            const daily = result?.status === "ready" ? result.rows.filter(row => row.date === date && selectedAccounts.some(account => laneDirection(row, account.id))) : [];
            const timed = daily.filter(row => row.time).sort((a, b) => `${a.time}:${a.id}`.localeCompare(`${b.time}:${b.id}`));
            const untimed = daily.filter(row => !row.time);
            return <section className={`account-lanes-day${layoutMode === "list" ? " account-lanes-day--list" : ""}`} data-lane-day={date} key={date} aria-label={dayLabel(date)}><div className="account-lanes-day-title"><div className="account-lanes-day-title__content"><time dateTime={date}>{dayLabel(date)}</time><span>{daily.length} {daily.length === 1 ? "movement" : "movements"}</span></div></div>
              {result?.status === "error" ? date === weekStart(date) ? <p className="account-lanes-status" role="alert">Could not load this week: {result.message} <button type="button" onClick={() => void loadWeek(weekStart(date), true)}>Retry</button></p> : null : result?.status !== "ready" ? date === weekStart(date) ? <p className="account-lanes-status">Loading movements…</p> : null : daily.length === 0 ? <p className="account-lanes-status">No movements in selected accounts on this day.</p> : null}
              {layoutMode === "lanes" ? timed.map(row => renderLaneRow(row, date)) : <ul className="account-lanes-list">{[...timed, ...untimed].map(renderListRow)}</ul>}
              {layoutMode === "lanes" && untimed.length ? <details className="account-lanes-untimed"><summary>Time not reported · {untimed.length} {untimed.length === 1 ? "movement" : "movements"}</summary>{untimed.map(row => <button type="button" data-lane-card={row.id} key={row.id} onClick={event => selectTransaction(row, event.detail === 0)}>{title(row)} · {formatCurrency(row.amount, accountById.get(row.account)?.currency)}{row.type === "transfer" ? " · transfer" : ""}</button>)}</details> : null}
            </section>;
          })}
          <div className="account-lanes-edge" role="status">{weekResults[addDays(windowStart, 14)]?.status === "error" ? <button type="button" onClick={() => void loadWeek(addDays(windowStart, 14), true)}>Retry later dates</button> : weekResults[addDays(windowStart, 14)]?.status !== "ready" ? <><span className="account-lanes-spinner" aria-hidden="true" />Loading later dates…</> : <button type="button" onClick={() => jumpTo(addDays(windowStart, WINDOW_DAYS))}>Load later dates</button>}</div>
        </div>
        {!accountsError && (waitingForTarget || targetError) ? <div className="account-lanes-initial-loading" role={targetError ? "alert" : "status"}>{targetError ? <><strong>Could not load {formatCalendarDate(targetDate)}</strong><span>{targetError}</span><button type="button" onClick={() => void loadWeek(weekStart(targetDate), true)}>Retry</button></> : <><span className="account-lanes-spinner" aria-hidden="true" /><strong>Loading timeline</strong><span>{targetWeek?.status === "loading" && targetWeek.loaded ? `${targetWeek.loaded} of ${targetWeek.total ?? "more"} movements loaded around ${formatCalendarDate(targetDate)}…` : `Fetching movements around ${formatCalendarDate(targetDate)}…`}</span></>}</div> : null}
      </div>
      {selected ? createPortal(<aside className="account-lanes-inspector" role="dialog" aria-modal="false" aria-labelledby="account-lanes-inspector-title">
          <div className="account-lanes-inspector__title"><h2 id="account-lanes-inspector-title" ref={inspectorTitleRef} tabIndex={-1}>Transaction details</h2><button type="button" aria-label="Close transaction details" onClick={closeDetails}><X size={18} /></button></div>
          <p className="account-lanes-inspector__date">{formatCalendarDate(selected.date)} · {selected.time ? formatClockTime(selected.time) : "time not reported"}</p>
          <h3>{title(selected)}</h3>
          <strong className="account-lanes-inspector__amount">{formatCurrency(selected.amount, accountById.get(selected.account)?.currency)}</strong>
          <p>{selected.type.replaceAll("_", " ")}{selected.category && categoryById.get(selected.category) ? " · " + categoryById.get(selected.category) : ""}</p>
          <div className="account-lanes-observations"><h3>Account observations</h3>{[selected.account, selected.transfer_account].filter((id): id is string => Boolean(id)).map(id => {
            const account = accountById.get(id);
            if (!account) return null;
            const observation = selected.transfer_evidence.find(item => item.account === id);
            return <div key={id}><strong>{account.name}</strong><span className={laneDirection(selected, id) === "credit" ? "is-credit" : "is-debit"}>{amountLabel(selected, id, account.currency)}</span><small>Balance after · {laneBalance(selected, id) === null ? "not reported" : formatCurrency(laneBalance(selected, id)!, account.currency)}</small>{observation && (observation.date !== selected.date || observation.time !== selected.time) ? <small>Source observed {formatCalendarDate(observation.date)} · {observation.time ? formatClockTime(observation.time) : "time not reported"}; lane position uses the ledger date.</small> : null}{!selectedIds.includes(id) ? <button type="button" onClick={() => showAccount(id)}>Show {account.name} lane</button> : null}</div>;
          })}</div>
          {selectedGapRows.length ? <div className="account-lanes-gap-detail"><h3>Possible balance gap</h3>{selectedGapRows.map(renderGapDetail)}</div> : null}
          {selected.note ? <div className="account-lanes-note"><h3>Note</h3><p>{selected.note}</p></div> : null}
          {selected.reference ? <p>Reference · {selected.reference}</p> : null}
          <div className="account-lanes-sources"><TransactionSourceMessages key={selected.id} transactionId={selected.id} loadOnExpand showEmpty /><TransactionStatementEvidence key={"statement-" + selected.id} transactionId={selected.id} /></div>
          <Link className="button button--ghost" href={"/transactions?edit=" + selected.id}>Open ledger entry</Link>
          <p className="account-lanes-inspector__hint">A transfer is one ledger transaction shown in each involved account.</p>
      </aside>, document.body) : null}
    </div>
    {accountsLoading ? <span className="sr-only" role="status">Loading accounts…</span> : null}
  </main>;
  return isFullscreen ? createPortal(view, document.body) : view;
}
