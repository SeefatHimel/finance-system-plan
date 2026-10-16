type LinkReview = {
  dirty: boolean;
  canLink: boolean;
  requiresAcknowledgement: boolean;
  issuesAcknowledged: boolean;
  conflict: boolean;
  balanceChosen: boolean;
};

/** Compare printed/received calendar dates without a timezone or DST shift. */
export function calendarDayDifference(statementDate: string | null, otherDate: string | null): number | null {
  const day = (value: string | null) => {
    if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
    const date = new Date(`${value}T00:00:00Z`);
    return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value ? date.getTime() : null;
  };
  const first = day(statementDate), second = day(otherDate);
  return first === null || second === null ? null : (second - first) / 86400000;
}

export function statementLinkBlockReason(review: LinkReview): string | null {
  if (review.dirty) return "Save your draft to refresh matches first.";
  if (!review.canLink) return "This entry cannot be linked. Refresh the match suggestions.";
  if (review.requiresAcknowledgement && !review.issuesAcknowledged) return "Review and acknowledge the source discrepancies above.";
  if (review.conflict && !review.balanceChosen) return "Choose which reported balance to keep for this match.";
  return null;
}

function cents(value: string | null): bigint | null {
  if (value === null || !/^-?\d+(?:\.\d{1,2})?$/.test(value)) return null;
  const [whole, fraction = ""] = value.replace(/^-/, "").split(".");
  const amount = BigInt(whole) * BigInt(100) + BigInt(fraction.padEnd(2, "0"));
  return value.startsWith("-") ? -amount : amount;
}

// A suggestion only: the reviewer can still choose either eligible source.
export function suggestedBalanceSource(statement: string | null, sms: string | null, statementIncludesSeparateFee = false): "statement" | "sms" | "" {
  const statementCents = cents(statement), smsCents = cents(sms);
  if (statementIncludesSeparateFee) return smsCents === null && statementCents !== null ? "" : "sms";
  if (statementCents === null) return smsCents === null ? "statement" : "sms";
  if (smsCents === null) return "statement";
  return statementCents > smsCents ? "statement" : "sms";
}

export function insignificantBdtBalanceDifference(first: string | null, second: string | null, currency: string): boolean {
  if (currency !== "BDT") return false;
  const left = cents(first), right = cents(second);
  if (left === null || right === null) return false;
  const difference = left > right ? left - right : right - left;
  return difference > BigInt(0) && difference < BigInt(100);
}

export function reportedBalanceNeedsAcknowledgment(first: string | null, second: string | null, currency: string): boolean {
  const left = cents(first), right = cents(second);
  return left !== null && right !== null && left !== right && !insignificantBdtBalanceDifference(first, second, currency);
}

// Preserve exact source reports even when the extra acknowledgment is unnecessary.
export function statementBalanceDifference(statement: string | null, ledger: string | null): string | null {
  const left = cents(statement), right = cents(ledger);
  if (left === null || right === null) return null;
  const difference = left - right;
  const absolute = difference < 0 ? -difference : difference;
  return `${difference > 0 ? "+" : difference < 0 ? "-" : ""}${absolute / BigInt(100)}.${String(absolute % BigInt(100)).padStart(2, "0")}`;
}
