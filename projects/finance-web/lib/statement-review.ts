type LinkReview = {
  dirty: boolean;
  canLink: boolean;
  requiresAcknowledgement: boolean;
  issuesAcknowledged: boolean;
  conflict: boolean;
  conflictAcknowledged: boolean;
};

export function statementLinkBlockReason(review: LinkReview): string | null {
  if (review.dirty) return "Save your draft to refresh matches first.";
  if (!review.canLink) return "This entry cannot be linked. Refresh the match suggestions.";
  if (review.requiresAcknowledgement && !review.issuesAcknowledged) return "Review and acknowledge the source discrepancies above.";
  if (review.conflict && !review.conflictAcknowledged) return "Review and acknowledge this balance difference.";
  return null;
}

// Compare exact decimal cents; even a one-cent disagreement requires review.
export function statementBalanceDifference(statement: string | null, ledger: string | null): string | null {
  function cents(value: string | null): bigint | null {
    if (value === null || !/^-?\d+(?:\.\d{1,2})?$/.test(value)) return null;
    const [whole, fraction = ""] = value.replace(/^-/, "").split(".");
    const amount = BigInt(whole) * BigInt(100) + BigInt(fraction.padEnd(2, "0"));
    return value.startsWith("-") ? -amount : amount;
  }
  const left = cents(statement), right = cents(ledger);
  if (left === null || right === null) return null;
  const difference = left - right;
  const absolute = difference < 0 ? -difference : difference;
  return `${difference > 0 ? "+" : difference < 0 ? "-" : ""}${absolute / BigInt(100)}.${String(absolute % BigInt(100)).padStart(2, "0")}`;
}
