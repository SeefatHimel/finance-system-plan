import type { SavedStatementRow } from "@/lib/api";

export type StatementReviewSection = "review" | "description" | "matches";

export function distinctStatementNote(primary: string, note: string) {
  const normalized = (value: string) => value.replace(/\s+/g, " ").trim().toLocaleLowerCase();
  return normalized(primary) === normalized(note) ? "" : note;
}

export function statementSmsMatchCount(row: SavedStatementRow) {
  const review = row.review;
  if (review.pending_sms_match_count === null) return null;
  return review.unified_pending_sms_pair_id ? Math.max(1, review.pending_sms_match_count) : review.pending_sms_match_count;
}

export function statementRowSummary(row: SavedStatementRow) {
  const review = row.review;
  const flags: string[] = [];
  const direction = row.reviewed_source_direction || row.extracted.direction;
  if ((direction === "credit" || direction === "debit") && direction !== row.direction) flags.push("Debit/credit mismatch");
  if (review.matches.some(match => match.conflict)) flags.push("Match conflict");
  if (review.matches.some(match => match.rounding_correction)) flags.push("Amount differs");
  if (review.matches.some(match => row.date && match.date !== row.date && !match.reporting_observation_is_fallback)) flags.push("Dates differ");
  if (review.issues.length || review.draft_issues.length || review.requires_acknowledgement) flags.push("Source / draft issue");
  if (review.matching_truncated) flags.push("More matches unchecked");
  if (review.unified_pending_sms_status === "unavailable" || review.pending_sms_match_count === null) flags.push("SMS check unavailable");
  if (review.unified_pending_sms_status === "ambiguous") flags.push("Multiple SMS candidates");
  const smsCount = statementSmsMatchCount(row);
  const count = smsCount === null ? null : review.matches.length + smsCount;
  const hasMatches = review.matches.length > 0 || (smsCount !== null && smsCount > 0)
    || review.unified_pending_sms_status !== "none" || review.matching_truncated;
  const needsReview = flags.length > 0 || review.review_state === "needs_correction" || row.amount === null || row.date === null;
  const status = needsReview ? "Needs review" : row.transaction ? "Already linked" : row.state === "skipped" ? "Skipped" : hasMatches ? "Match available" : "Ready";
  return {
    status,
    tone: needsReview ? "warning" : row.transaction || status === "Ready" ? "ok" : "idle",
    flags,
    matchLabel: count !== null && count > 0 && !review.matching_truncated
      ? `View ${count} match${count === 1 ? "" : "es"}` : "Review matches",
    hasMatches: !row.transaction && row.state !== "skipped" && hasMatches,
  };
}
