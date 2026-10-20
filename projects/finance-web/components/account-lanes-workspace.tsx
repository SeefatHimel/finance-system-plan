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
import { addDays, balanceGaps, laneBalance, laneDirection, weekStart } from "@/lib/account-lanes";

type WeekResult = { status: "loading" } | { status: "error"; message: string } | { status: "ready"; rows: Transaction[] };
type ViewMode = "amount" | "balance" | "both";
const WINDOW_DAYS = 21;
const today = () => {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Dhaka", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const part = (type: string) => parts.find(item => item.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
};
const initialWindow = () => addDays(weekStart(today()), -7);
const dayLabel = (date: string) => new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${date}T12:00:00Z`));

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
  const [selectedTransaction, setSelectedTransaction] = useState<Transaction | null>(null);
  const [accountsOpen, setAccountsOpen] = useState(false);
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [showEmptyDays, setShowEmptyDays] = useState(true);
  const [showGaps, setShowGaps] = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [fontAdjustment, setFontAdjustment] = useState(0);
  const viewportRef = useRef<HTMLDivElement>(null);
  const viewPositionRef = useRef({ top: 0, left: 0 });
  const revealAccountRef = useRef<string | null>(null);
  const anchorRef = useRef<{ date: string; top: number } | null>(null);
  const initializedRef = useRef(false);
  const jumpTargetRef = useRef<string | null>(null);
  const shiftingRef = useRef(false);
  const requestsRef = useRef(new Map<string, AbortController>());

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
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      const viewport = viewportRef.current;
      if (viewport) viewPositionRef.current = { top: viewport.scrollTop, left: viewport.scrollLeft };
      setIsFullscreen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => { document.body.style.overflow = priorOverflow; if (appFrame) appFrame.inert = priorInert; window.removeEventListener("keydown", onKeyDown); };
  }, [isFullscreen]);
  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    viewport.scrollTop = viewPositionRef.current.top;
    viewport.scrollLeft = viewPositionRef.current.left;
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
    setWeekResults(current => ({ ...current, [start]: { status: "loading" } }));
    try {
      const rows: Transaction[] = [];
      let offset: number | null = 0;
      while (offset !== null) {
        const page = await listTransactionActivityPage(token, start, addDays(start, 6), offset, controller.signal);
        rows.push(...page.results);
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
    for (let index = 0; index < 3; index++) {
      const start = addDays(windowStart, index * 7);
      if ((!weekResults[start] || weekResults[start].status === "loading") && !requestsRef.current.has(start)) void loadWeek(start);
    }
  }, [loadWeek, weekResults, windowStart]);

  useEffect(() => {
    const retained = new Set(Array.from({ length: 5 }, (_, index) => addDays(windowStart, (index - 1) * 7)));
    setWeekResults(current => {
      if (Object.keys(current).every(key => retained.has(key))) return current;
      return Object.fromEntries(Object.entries(current).filter(([key]) => retained.has(key)));
    });
    for (const [key, controller] of requestsRef.current) if (!retained.has(key)) { controller.abort(); requestsRef.current.delete(key); }
  }, [windowStart]);

  const dates = useMemo(() => Array.from({ length: WINDOW_DAYS }, (_, index) => addDays(windowStart, index)), [windowStart]);
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
  const gaps = useMemo(() => new Map(selectedAccounts.map(account => [account.id, balanceGaps(allRows, account.id, loadedDays)])), [allRows, loadedDays, selectedAccounts]);

  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    if (!initializedRef.current) {
      const target = viewport.querySelector<HTMLElement>(`[data-lane-day="${jumpTargetRef.current ?? today()}"]`);
      if (target) { viewport.scrollTop = target.offsetTop - viewport.offsetTop - (viewport.querySelector<HTMLElement>(".account-lanes-head")?.offsetHeight ?? 64) - 8; initializedRef.current = true; jumpTargetRef.current = null; }
    } else if (anchorRef.current) {
      const anchor = anchorRef.current;
      const target = viewport.querySelector<HTMLElement>(`[data-lane-day="${anchor.date}"]`);
      if (target) viewport.scrollTop += target.getBoundingClientRect().top - viewport.getBoundingClientRect().top - anchor.top;
    }
    anchorRef.current = null;
    shiftingRef.current = false;
  }, [windowStart, weekResults]);

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
      const target = viewport?.querySelector<HTMLElement>(`[data-lane-day="${date}"]`);
      if (viewport && target) viewport.scrollTo({ top: target.offsetTop - viewport.offsetTop - (viewport.querySelector<HTMLElement>(".account-lanes-head")?.offsetHeight ?? 64) - 8, behavior: "smooth" });
    }
  }, [windowStart]);

  const onScroll = useCallback(() => {
    const viewport = viewportRef.current;
    if (!viewport || !initializedRef.current) return;
    const middle = viewport.getBoundingClientRect().top + Math.min(viewport.clientHeight / 3, 180) + 56;
    const current = Array.from(viewport.querySelectorAll<HTMLElement>("[data-lane-day]")).find(day => day.getBoundingClientRect().bottom > middle);
    if (current?.dataset.laneDay) setVisibleDate(previous => previous === current.dataset.laneDay ? previous : current.dataset.laneDay!);
    if (shiftingRef.current) return;
    if (viewport.scrollTop < 260) {
      captureAnchor(); shiftingRef.current = true; setWindowStart(previous => addDays(previous, -7));
    } else if (viewport.scrollHeight - viewport.clientHeight - viewport.scrollTop < 260) {
      captureAnchor(); shiftingRef.current = true; setWindowStart(previous => addDays(previous, 7));
    }
  }, [captureAnchor]);

  const toggleAccount = (id: string) => setSelectedIds(previous => previous.includes(id) ? previous.filter(value => value !== id) : [...previous, id]);
  const showAccount = (id: string) => { revealAccountRef.current = id; setSelectedIds(previous => previous.includes(id) ? previous : [...previous, id]); };
  const toggleFullscreen = () => {
    const viewport = viewportRef.current;
    if (viewport) viewPositionRef.current = { top: viewport.scrollTop, left: viewport.scrollLeft };
    setIsFullscreen(value => !value);
  };
  const selected = selectedTransaction && allRows.find(row => row.id === selectedTransaction.id) || selectedTransaction;
  const selectedGapRows = selected ? selectedAccounts.flatMap(account => {
    const cents = gaps.get(account.id)?.get(selected.id);
    return cents === undefined ? [] : [{ account, cents }];
  }) : [];

  const view = <main className={`account-lanes-page${isFullscreen ? " account-lanes-page--fullscreen" : ""}`} aria-label="Account transaction timeline" style={{ "--lanes-font-adjust": `${fontAdjustment}px`, "--lanes-row-min-height": `${Math.max(88, 100 + fontAdjustment * 6)}px` } as CSSProperties}>
    <div className="account-lanes-toolbar">
      <div className="account-lanes-date"><CalendarBlank aria-hidden="true" size={20} /><CalendarDateInput aria-label="Jump to date" value={visibleDate} onChange={value => { if (value) jumpTo(value); }} /><button type="button" aria-label="Previous day" onClick={() => jumpTo(addDays(visibleDate, -1))}><CaretLeft size={18} /></button><button type="button" aria-label="Next day" onClick={() => jumpTo(addDays(visibleDate, 1))}><CaretRight size={18} /></button><button type="button" onClick={() => jumpTo(today())}>Today</button></div>
      <div className="account-lanes-dropdown"><button className="account-lanes-control" aria-expanded={accountsOpen} onClick={() => { setAccountsOpen(!accountsOpen); setOptionsOpen(false); }} type="button">Accounts · {selectedAccounts.length} shown{accounts.length > selectedAccounts.length ? ` · ${accounts.length - selectedAccounts.length} hidden` : ""}</button>{accountsOpen ? <div className="account-lanes-menu" role="group" aria-label="Visible accounts">{accounts.map(account => <label key={account.id}><input checked={selectedIds.includes(account.id)} onChange={() => toggleAccount(account.id)} type="checkbox" />{account.name}{!account.is_active ? " (inactive)" : ""}</label>)}{!selectedAccounts.length ? <small>Select an account to show its lane.</small> : null}</div> : null}</div>
      <div className="account-lanes-mode" role="group" aria-label="Card values">{(["amount", "balance", "both"] as const).map(value => <button className={mode === value ? "is-active" : ""} key={value} onClick={() => setMode(value)} type="button" aria-pressed={mode === value}>{value[0].toUpperCase() + value.slice(1)}</button>)}</div>
      <div className="account-lanes-dropdown"><button className="account-lanes-control" aria-expanded={optionsOpen} onClick={() => { setOptionsOpen(!optionsOpen); setAccountsOpen(false); }} type="button"><SlidersHorizontal size={18} /> View options</button>{optionsOpen ? <div className="account-lanes-menu account-lanes-menu--right" role="group" aria-label="Timeline options"><label><input checked={showEmptyDays} onChange={event => setShowEmptyDays(event.target.checked)} type="checkbox" />Show quiet days</label><label><input checked={showGaps} onChange={event => setShowGaps(event.target.checked)} type="checkbox" />Show possible balance gaps</label></div> : null}</div>
      <div className="account-lanes-text-size" role="group" aria-label="Timeline text size"><button type="button" aria-label="Decrease timeline text size by 0.5 pixels" disabled={fontAdjustment <= -2} onClick={() => setFontAdjustment(value => Math.max(-2, value - 0.5))}>A−</button><span aria-live="polite">{fontAdjustment > 0 ? "+" : ""}{fontAdjustment.toFixed(1)} px</span><button type="button" aria-label="Increase timeline text size by 0.5 pixels" disabled={fontAdjustment >= 2} onClick={() => setFontAdjustment(value => Math.min(2, value + 0.5))}>A+</button></div>
      <button className="account-lanes-control account-lanes-fullscreen" type="button" aria-label={isFullscreen ? "Exit full screen timeline" : "Open full screen timeline"} aria-pressed={isFullscreen} onClick={toggleFullscreen}>{isFullscreen ? <ArrowsIn size={18} /> : <ArrowsOut size={18} />}{isFullscreen ? "Exit full screen" : "Full screen"}</button>
    </div>
    {accountsError ? <div className="account-lanes-error" role="alert">{accountsError} <button type="button" onClick={() => void loadAccounts()}>Retry</button></div> : null}
    <div className="account-lanes-layout">
      <div className="account-lanes-main" style={{ "--lane-count": Math.max(selectedAccounts.length, 1), "--lanes-min-width": `${88 + Math.max(selectedAccounts.length, 1) * 240}px` } as CSSProperties}>
        <div className="account-lanes-scroll" ref={viewportRef} onScroll={onScroll} tabIndex={0} aria-label="Timeline. Scroll up for earlier dates and down for later dates.">
          <div className="account-lanes-head" style={{ gridTemplateColumns: `88px repeat(${Math.max(selectedAccounts.length, 1)}, minmax(240px, 1fr))` }}><span>Time</span>{selectedAccounts.length ? selectedAccounts.map(account => <div data-lane-account={account.id} key={account.id}><strong>{account.name}</strong><small>{account.currency} · latest reported {account.latest_reported_balance === null ? "unknown" : formatCurrency(account.latest_reported_balance, account.currency)}{account.latest_reported_balance_date ? ` on ${formatCalendarDate(account.latest_reported_balance_date)}` : ""}</small></div>) : <div><strong>Choose an account</strong></div>}</div>
          {dates.map(date => {
            const result = weekResults[weekStart(date)];
            const daily = result?.status === "ready" ? result.rows.filter(row => row.date === date && selectedAccounts.some(account => laneDirection(row, account.id))) : [];
            if (!showEmptyDays && result?.status === "ready" && daily.length === 0) return <div className="account-lanes-empty-day" data-lane-day={date} key={date}><time dateTime={date}>{dayLabel(date)}</time><span>No movements in selected accounts</span></div>;
            const timed = daily.filter(row => row.time).sort((a, b) => `${a.time}:${a.id}`.localeCompare(`${b.time}:${b.id}`));
            const untimed = daily.filter(row => !row.time);
            return <section className="account-lanes-day" data-lane-day={date} key={date} aria-label={dayLabel(date)}><div className="account-lanes-day-title"><div className="account-lanes-day-title__content"><time dateTime={date}>{dayLabel(date)}</time><span>{daily.length} {daily.length === 1 ? "movement" : "movements"}</span></div></div>
              {result?.status === "error" ? <p className="account-lanes-status" role="alert">Could not load this week: {result.message} <button type="button" onClick={() => void loadWeek(weekStart(date), true)}>Retry</button></p> : result?.status !== "ready" ? <p className="account-lanes-status" role="status">Loading movements…</p> : daily.length === 0 ? <p className="account-lanes-status">No movements in selected accounts on this day.</p> : null}
              {timed.map(row => <div className={`account-lanes-row${row.type === "transfer" ? " account-lanes-row--transfer" : ""}`} key={row.id} style={{ gridTemplateColumns: `88px repeat(${Math.max(selectedAccounts.length, 1)}, minmax(240px, 1fr))` }}><time dateTime={`${date}T${row.time}`}>{formatClockTime(row.time!)}</time>{selectedAccounts.map(account => { const direction = laneDirection(row, account.id); if (!direction) return <div className="account-lanes-cell" key={account.id} />; const otherId = row.type === "transfer" ? row.account === account.id ? row.transfer_account : row.account : null; const other = otherId ? accountById.get(otherId) : null; const gap = gaps.get(account.id)?.get(row.id); return <div className="account-lanes-cell" key={account.id}><button className={`account-lanes-card${selected?.id === row.id ? " is-selected" : ""}`} type="button" onClick={() => setSelectedTransaction(row)}><span className="account-lanes-card__top"><strong>{title(row)}</strong>{row.type === "transfer" ? <LinkSimple aria-label="Transfer" size={16} /> : null}</span><small>{formatClockTime(row.time!)} · {row.type.replaceAll("_", " ")}{row.category && categoryById.get(row.category) ? ` · ${categoryById.get(row.category)}` : ""}</small><span className="account-lanes-card__numbers">{mode !== "balance" ? <b className={direction === "credit" ? "is-credit" : "is-debit"}>{amountLabel(row, account.id, account.currency)}</b> : null}{mode !== "amount" ? <span>Bal {laneBalance(row, account.id) === null ? "not reported" : formatCurrency(laneBalance(row, account.id)!, account.currency)}</span> : null}</span></button>{other && !selectedIds.includes(other.id) ? <button className="account-lanes-hidden-link" type="button" onClick={() => showAccount(other.id)}>{other.name} hidden · Show lane <Eye size={14} /></button> : null}{showGaps && gap !== undefined ? <button className="account-lanes-gap" type="button" onClick={() => setSelectedTransaction(row)}>Possible balance gap · {gap > 0 ? "+" : "−"}{formatCurrency(Math.abs(gap / 100).toFixed(2), account.currency)} <CaretRight size={14} /></button> : null}</div>; })}</div>)}
              {untimed.length ? <details className="account-lanes-untimed"><summary>Time not reported · {untimed.length} {untimed.length === 1 ? "movement" : "movements"}</summary>{untimed.map(row => <button type="button" key={row.id} onClick={() => setSelectedTransaction(row)}>{title(row)} · {formatCurrency(row.amount, accountById.get(row.account)?.currency)}{row.type === "transfer" ? " · transfer" : ""}</button>)}</details> : null}
            </section>;
          })}
        </div>
      </div>
      <aside className="account-lanes-inspector" aria-label="Transaction details">{selected ? <><div className="account-lanes-inspector__title"><h2>Transaction details</h2><button type="button" aria-label="Close transaction details" onClick={() => setSelectedTransaction(null)}><X size={18} /></button></div><p className="account-lanes-inspector__date">{formatCalendarDate(selected.date)} · {selected.time ? formatClockTime(selected.time) : "time not reported"}</p><h3>{title(selected)}</h3><strong className="account-lanes-inspector__amount">{formatCurrency(selected.amount, accountById.get(selected.account)?.currency)}</strong><p>{selected.type.replaceAll("_", " ")}{selected.category && categoryById.get(selected.category) ? ` · ${categoryById.get(selected.category)}` : ""}</p><div className="account-lanes-observations"><h3>Account observations</h3>{[selected.account, selected.transfer_account].filter((id): id is string => Boolean(id)).map(id => { const account = accountById.get(id); if (!account) return null; const observation = selected.transfer_evidence.find(item => item.account === id); return <div key={id}><strong>{account.name}</strong><span className={laneDirection(selected, id) === "credit" ? "is-credit" : "is-debit"}>{amountLabel(selected, id, account.currency)}</span><small>Balance after · {laneBalance(selected, id) === null ? "not reported" : formatCurrency(laneBalance(selected, id)!, account.currency)}</small>{observation && (observation.date !== selected.date || observation.time !== selected.time) ? <small>Source observed {formatCalendarDate(observation.date)} · {observation.time ? formatClockTime(observation.time) : "time not reported"}; lane position uses the ledger date.</small> : null}{!selectedIds.includes(id) ? <button type="button" onClick={() => showAccount(id)}>Show {account.name} lane</button> : null}</div>; })}</div>{selectedGapRows.length ? <div className="account-lanes-gap-detail"><h3>Possible balance gap</h3>{selectedGapRows.map(({ account, cents }) => <p key={account.id}>{account.name}: {cents > 0 ? "+" : "−"}{formatCurrency(Math.abs(cents / 100).toFixed(2), account.currency)} between consecutive reported balances. Check missing movements, fees or ordering before reconciling.</p>)}</div> : null}{selected.note ? <div className="account-lanes-note"><h3>Note</h3><p>{selected.note}</p></div> : null}{selected.reference ? <p>Reference · {selected.reference}</p> : null}<div className="account-lanes-sources"><TransactionSourceMessages key={selected.id} transactionId={selected.id} loadOnExpand showEmpty /><TransactionStatementEvidence key={`statement-${selected.id}`} transactionId={selected.id} /></div><Link className="button button--ghost" href={`/transactions?edit=${selected.id}`}>Open ledger entry</Link><p className="account-lanes-inspector__hint">A transfer is one ledger transaction shown in each involved account.</p></> : <div className="account-lanes-inspector__empty"><h2>Transaction details</h2><p>Select a movement to inspect its account balances, note, and original sources.</p><p>Only reported balances are shown. A missing report is never treated as a calculated balance.</p></div>}</aside>
    </div>
    {accountsLoading ? <span className="sr-only" role="status">Loading accounts…</span> : null}
  </main>;
  return isFullscreen ? createPortal(view, document.body) : view;
}
