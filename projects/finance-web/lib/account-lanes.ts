import type { Transaction } from "./api";

export function addDays(day: string, count: number): string {
  const date = new Date(`${day}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + count);
  return date.toISOString().slice(0, 10);
}

export function weekStart(day: string): string {
  const weekday = new Date(`${day}T12:00:00Z`).getUTCDay();
  return addDays(day, -(weekday + 6) % 7);
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

/** Compare only complete, ordered reporting intervals. Missing time makes order ambiguous. */
export function balanceGaps(transactions: Transaction[], accountId: string, loadedDays: Set<string>) {
  const rows = transactions
    .filter(transaction => laneDirection(transaction, accountId))
    .sort((left, right) => `${left.date}T${left.time ?? ""}:${left.id}`.localeCompare(`${right.date}T${right.time ?? ""}:${right.id}`));
  const gaps = new Map<string, number>();
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
        const movement = rows.slice(prior.index + 1, index + 1).reduce((sum, row) => sum + signedCents(row, accountId), 0);
        const difference = cents - (prior.value + movement);
        if (difference !== 0) gaps.set(to.id, difference);
      }
    }
    prior = { index, value: cents };
  }
  return gaps;
}
