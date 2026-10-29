import type { Transaction } from "./api";

/** Do not publish a partial week or a response from a cancelled refresh. */
export async function loadTimelinePages<T>(
  readPage: (offset: number) => Promise<{ results: T[]; count: number; next_offset: number | null }>,
  signal: AbortSignal,
  progress?: (loaded: number, total: number) => void,
): Promise<T[]> {
  const rows: T[] = [];
  let offset: number | null = 0;
  while (offset !== null) {
    signal.throwIfAborted();
    const page = await readPage(offset);
    signal.throwIfAborted();
    rows.push(...page.results);
    if (page.next_offset !== null) {
      if (page.next_offset <= offset) throw new Error("Timeline pages changed. Please refresh again.");
      progress?.(rows.length, page.count);
    }
    offset = page.next_offset;
  }
  return rows;
}

export function addDays(day: string, count: number): string {
  const date = new Date(`${day}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + count);
  return date.toISOString().slice(0, 10);
}

export function weekStart(day: string): string {
  const weekday = new Date(`${day}T12:00:00Z`).getUTCDay();
  return addDays(day, -(weekday + 6) % 7);
}

export function isVerticalTimelineGesture(deltaX: number, deltaY: number, minimumDistance: number): boolean {
  return Math.abs(deltaY) > minimumDistance && Math.abs(deltaY) > Math.abs(deltaX);
}

/** Use gesture direction when a short window touches both scroll edges. */
export function atTimelineEdge(direction: -1 | 1, scrollTop: number, scrollHeight: number, viewportHeight: number, threshold: number): boolean {
  return direction < 0 ? scrollTop <= threshold : scrollHeight - viewportHeight - scrollTop <= threshold;
}

export function timelineScrollShift(movement: number, scrollTop: number, scrollHeight: number, viewportHeight: number, earlierReady: boolean, laterReady: boolean): -1 | 0 | 1 {
  if (movement < 0 && earlierReady && atTimelineEdge(-1, scrollTop, scrollHeight, viewportHeight, 4)) return -1;
  if (movement > 0 && laterReady && atTimelineEdge(1, scrollTop, scrollHeight, viewportHeight, 4)) return 1;
  return 0;
}

export type TimelineRange = { start: string; end: string }; // End is exclusive.

/** Extend an already visible range only after its next week has loaded. */
export function expandReadyTimelineRange(range: TimelineRange, direction: -1 | 1, readyWeeks: Set<string>): TimelineRange | null {
  const enteringWeek = direction < 0 ? addDays(range.start, -7) : range.end;
  if (!readyWeeks.has(enteringWeek)) return null;
  return direction < 0 ? { start: enteringWeek, end: range.end } : { start: range.start, end: addDays(range.end, 7) };
}

export type TimelineDayItem = { kind: "day"; date: string } | { kind: "quiet"; start: string; end: string; count: number };

/** Keep the visible timeline continuous while weeks finish out of order. */
export function contiguousReadyDates(dates: string[], readyWeeks: Set<string>, anchorDate: string): string[] {
  const weeks = [...new Set(dates.map(weekStart))];
  const anchorIndex = weeks.indexOf(weekStart(anchorDate));
  if (anchorIndex < 0 || !readyWeeks.has(weeks[anchorIndex])) return [];
  let first = anchorIndex;
  let last = anchorIndex;
  while (first > 0 && readyWeeks.has(weeks[first - 1])) first--;
  while (last < weeks.length - 1 && readyWeeks.has(weeks[last + 1])) last++;
  return dates.filter(date => {
    const index = weeks.indexOf(weekStart(date));
    return index >= first && index <= last;
  });
}

/** Only verified empty days are collapsed; unloaded days stay visible. */
export function groupTimelineDays(dates: string[], movementDates: Set<string>, loadedDays: Set<string>, collapseQuiet: boolean): TimelineDayItem[] {
  const items: TimelineDayItem[] = [];
  for (const date of dates) {
    if (collapseQuiet && loadedDays.has(date) && !movementDates.has(date)) {
      const previous = items[items.length - 1];
      // Keep a visible band per week so scrolling through long quiet periods
      // still advances instead of endlessly enlarging one stationary band.
      if (previous?.kind === "quiet" && weekStart(previous.end) === weekStart(date)) { previous.end = date; previous.count++; }
      else items.push({ kind: "quiet", start: date, end: date, count: 1 });
    } else items.push({ kind: "day", date });
  }
  return items;
}

export function laneDirection(transaction: Transaction, accountId: string): "debit" | "credit" | null {
  if (transaction.type === "transfer") {
    if (transaction.account === accountId) return "debit";
    if (transaction.transfer_account === accountId) return "credit";
    return null;
  }
  return transaction.account === accountId ? (transaction.direction === "credit" ? "credit" : "debit") : null;
}

export function laneBalance(transaction: Transaction, accountId: string): string | null {
  if (transaction.type === "transfer") {
    return transaction.reported_balances?.find(report => report.account === accountId)?.balance_after ?? null;
  }
  return transaction.account === accountId ? transaction.balance_after : null;
}

export function signedCents(transaction: Transaction, accountId: string): number {
  const amount = Math.round(Number(transaction.amount) * 100);
  return laneDirection(transaction, accountId) === "credit" ? amount : -amount;
}

export function laneMomentMatchesCanonical(transaction: Transaction, accountId: string): boolean {
  if (transaction.type !== "transfer") return true;
  return transaction.transfer_evidence
    .filter(item => item.account === accountId)
    .every(item => item.date === transaction.date && item.time === transaction.time);
}

export type ReportedBalanceAtDate =
  | { status: "reported"; value: string; date: string; time: string | null }
  | { status: "unavailable"; reason: "not_loaded" | "no_report" | "ambiguous_order" };

/** A historical label uses a saved report, never an inferred running balance. */
export function reportedBalanceAtDate(transactions: Transaction[], accountId: string, date: string, loadedDays: Set<string>): ReportedBalanceAtDate {
  if (!loadedDays.has(date)) return { status: "unavailable", reason: "not_loaded" };
  const reports = transactions
    .filter(row => row.date <= date && laneDirection(row, accountId) && laneMomentMatchesCanonical(row, accountId) && laneBalance(row, accountId) !== null)
    .sort((left, right) => `${right.date}T${right.time ?? ""}:${right.id}`.localeCompare(`${left.date}T${left.time ?? ""}:${left.id}`));
  if (!reports.length) return { status: "unavailable", reason: "no_report" };
  const latestDate = reports[0].date;
  const sameDay = reports.filter(row => row.date === latestDate);
  const values = new Set(sameDay.map(row => laneBalance(row, accountId)!));
  if (values.size > 1 && (sameDay.some(row => !row.time) || (sameDay.length > 1 && sameDay[0].time === sameDay[1].time))) {
    return { status: "unavailable", reason: "ambiguous_order" };
  }
  const latest = sameDay[0];
  return { status: "reported", value: laneBalance(latest, accountId)!, date: latest.date, time: latest.time };
}

export type BalanceGapDetail = {
  from: Transaction;
  to: Transaction;
  movements: Transaction[];
  priorCents: number;
  movementCents: number;
  expectedCents: number;
  actualCents: number;
  differenceCents: number;
};

/** Compare only complete, ordered reporting intervals. Missing time makes order ambiguous. */
export function balanceGapDetails(transactions: Transaction[], accountId: string, loadedDays: Set<string>) {
  const rows = transactions
    .filter(transaction => laneDirection(transaction, accountId))
    .sort((left, right) => `${left.date}T${left.time ?? ""}:${left.id}`.localeCompare(`${right.date}T${right.time ?? ""}:${right.id}`));
  const gaps = new Map<string, BalanceGapDetail>();
  let prior: { index: number; value: number } | null = null;
  for (let index = 0; index < rows.length; index++) {
    const balance = laneBalance(rows[index], accountId);
    const cents = balance === null ? NaN : Math.round(Number(balance) * 100);
    if (!Number.isFinite(cents)) continue;
    if (prior) {
      const from = rows[prior.index];
      const to = rows[index];
      let complete = Boolean(from.time && to.time);
      for (let day = from.date; day <= to.date; day = addDays(day, 1)) {
        if (!loadedDays.has(day)) { complete = false; break; }
      }
      for (let middle = prior.index + 1; middle <= index; middle++) {
        if (!rows[middle].time || !Number.isFinite(Number(rows[middle].amount)) || !laneMomentMatchesCanonical(rows[middle], accountId)) complete = false;
      }
      if (!laneMomentMatchesCanonical(from, accountId)) complete = false;
      // A time-less movement on either boundary day could fall anywhere in the interval.
      if (rows.some(row => row.date >= from.date && row.date <= to.date && !row.time)) complete = false;
      for (let middle = prior.index + 1; middle <= index; middle++) {
        const previous = rows[middle - 1];
        const current = rows[middle];
        if (previous.date === current.date && previous.time === current.time) complete = false;
      }
      if (complete) {
        const movements = rows.slice(prior.index + 1, index + 1);
        const movementCents = movements.reduce((sum, row) => sum + signedCents(row, accountId), 0);
        const expectedCents = prior.value + movementCents;
        const differenceCents = cents - expectedCents;
        if (differenceCents !== 0) gaps.set(to.id, {
          from, to, movements, priorCents: prior.value, movementCents,
          expectedCents, actualCents: cents, differenceCents
        });
      }
    }
    prior = { index, value: cents };
  }
  return gaps;
}

export function balanceGaps(transactions: Transaction[], accountId: string, loadedDays: Set<string>) {
  return new Map([...balanceGapDetails(transactions, accountId, loadedDays)].map(([id, detail]) => [id, detail.differenceCents]));
}

/** Merge relative placements into lanes without creating a timestamp. */
export function placedTimelineEvents(rows: Transaction[], accounts: string[], orders: { account: string; status: string; ordered_ids: string[]; basis: string }[]) {
  const timed = rows.filter(row => row.time).sort((a, b) => `${a.time}:${a.id}`.localeCompare(`${b.time}:${b.id}`));
  type Event = { row: Transaction; account?: string; basis?: string; key: string };
  const before = new Map<string, Event[]>();
  const tail: Event[] = [];
  const placed = new Set<string>();
  for (const account of accounts) {
    const order = orders.find(item => item.account === account && item.status === "valid" && item.ordered_ids.length);
    if (!order) continue;
    const ownRows = rows.filter(row => laneDirection(row, account));
    if (ownRows.length !== order.ordered_ids.length || ownRows.some(row => !order.ordered_ids.includes(row.id))) continue;
    for (let index = 0; index < order.ordered_ids.length; index++) {
      const row = ownRows.find(item => item.id === order.ordered_ids[index]);
      if (!row || row.time) continue;
      const next = order.ordered_ids.slice(index + 1).find(id => ownRows.find(item => item.id === id)?.time);
      const event = { row, account, basis: order.basis, key: `${row.id}:${account}` };
      if (next) before.set(next, [...(before.get(next) ?? []), event]); else tail.push(event);
      placed.add(event.key);
    }
  }
  const events: Event[] = timed.flatMap(row => [...(before.get(row.id) ?? []), { row, key: row.id }]);
  events.push(...tail);
  return { events, unplaced: rows.filter(row => !row.time && accounts.some(account => laneDirection(row, account) && !placed.has(`${row.id}:${account}`))) };
}
