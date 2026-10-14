import { reviewFieldErrors, reviewNotes, type ReviewValues } from "./review-status";

export type ReviewCandidate = {
  confidence: string; transaction_type: string; message_kind: string;
  possible_internal_transfer: boolean; possible_related_candidate: string | null;
  related_match_reason: string; identity_suggestions: { role: "sender" | "receiver" }[];
  raw_message: { duplicate_of: string | null; status: string; body: string | null };
};
export const reviewConditions = [
  { value: "ready", label: "Ready to confirm", group: "Readiness" },
  { value: "missing", label: "Needs required input", group: "Readiness" },
  { value: "amount", label: "Amount missing or invalid", group: "Required corrections" },
  { value: "account", label: "Reporting account needed", group: "Required corrections" },
  { value: "transfer_account", label: "Other transfer account needed", group: "Required corrections" },
  { value: "same_accounts", label: "Transfer accounts must differ", group: "Required corrections" },
  { value: "uncategorized", label: "Category not selected", group: "Verification" },
  { value: "verify_account", label: "Account identifier suggestions", group: "Verification" },
  { value: "duplicate", label: "Possible duplicate SMS", group: "Verification" },
  { value: "related", label: "Possible related transfer SMS", group: "Verification" },
  { value: "notes", label: "Review notes / low confidence", group: "Verification" },
  { value: "unknown", label: "Unknown SMS format", group: "Verification" },
  { value: "non_transaction", label: "Non-transaction / skip-rule review", group: "Verification" },
  { value: "match", label: "Can look for a transfer match", group: "Available actions" },
  { value: "reparse", label: "Can re-run parser", group: "Available actions" },
  { value: "redact", label: "Can redact original SMS", group: "Available actions" },
  { value: "unavailable", label: "Original SMS unavailable", group: "Available actions" }
] as const;
export type ReviewCondition = "all" | typeof reviewConditions[number]["value"];
export const confidenceBands = [
  { value: "all", label: "All confidence levels" },
  { value: "90", label: "90–100%" },
  { value: "85", label: "85–<90%" },
  { value: "65", label: "65–<85%" },
  { value: "low", label: "Below 65%" },
  { value: "unknown", label: "Unknown confidence" },
  { value: "custom", label: "Custom percentage range" }
] as const;
export type ConfidenceBand = typeof confidenceBands[number]["value"];
export function confidenceValue(value: string): number | null {
  if (!value.trim()) return null;
  const score = Number(value);
  return Number.isFinite(score) && score >= 0 && score <= 1 ? score * 100 : null;
}
export function confidenceRangeError(min: string, max: string) {
  const lower = min.trim() ? Number(min) : 0;
  const upper = max.trim() ? Number(max) : 100;
  if (![lower, upper].every(value => Number.isFinite(value) && value >= 0 && value <= 100)) return "Use percentages between 0 and 100.";
  if (lower > upper) return "Minimum confidence cannot exceed maximum confidence.";
  return "";
}
export function matchesConfidence(score: string, band: ConfidenceBand, min = "", max = "") {
  if (band === "all" || (band === "custom" && confidenceRangeError(min, max))) return true;
  const percent = confidenceValue(score);
  if (band === "unknown") return percent === null;
  if (percent === null) return false;
  if (band === "90") return percent >= 90;
  if (band === "85") return percent >= 85 && percent < 90;
  if (band === "65") return percent >= 65 && percent < 85;
  if (band === "low") return percent < 65;
  return percent >= (min.trim() ? Number(min) : 0) && percent <= (max.trim() ? Number(max) : 100);
}
export function canFindTransferMatch(candidate: ReviewCandidate, values: ReviewValues) {
  return values.type === "transfer" || (values.type === candidate.transaction_type && (candidate.possible_internal_transfer || ["receive_money", "bank_transfer_in"].includes(candidate.message_kind)));
}
export function hasOriginalSms(candidate: ReviewCandidate) {
  return candidate.raw_message.status !== "redacted" && Boolean(candidate.raw_message.body);
}
export function matchesReviewCondition(candidate: ReviewCandidate, values: ReviewValues, condition: ReviewCondition) {
  const errors = reviewFieldErrors(values);
  switch (condition) {
    case "all": return true;
    case "ready": return !Object.keys(errors).length;
    case "missing": return Boolean(Object.keys(errors).length);
    case "amount": return Boolean(errors.amount);
    case "account": return Boolean(errors.account);
    case "transfer_account": return values.type === "transfer" && !values.other;
    case "same_accounts": return values.type === "transfer" && Boolean(values.account) && values.account === values.other;
    case "uncategorized": return !values.category;
    case "verify_account": return candidate.identity_suggestions.length > 0;
    case "duplicate": return Boolean(candidate.raw_message.duplicate_of);
    case "related": return Boolean(candidate.possible_related_candidate);
    case "notes": return reviewNotes(candidate.confidence, values.category, values.type).length > 0;
    case "unknown": return candidate.message_kind === "unknown";
    case "non_transaction": return ["promotional", "otp_security", "balance_notice"].includes(candidate.message_kind);
    case "match": return canFindTransferMatch(candidate, values);
    case "reparse": case "redact": return hasOriginalSms(candidate);
    case "unavailable": return !hasOriginalSms(candidate);
  }
}
export function reviewSummary(candidate: ReviewCandidate, values: ReviewValues) {
  const errors = Object.values(reviewFieldErrors(values));
  const notes = reviewNotes(candidate.confidence, values.category, values.type);
  if (errors.length) return { tone: "warning", title: `${errors.length} correction${errors.length === 1 ? "" : "s"} needed`, details: errors };
  if (candidate.raw_message.duplicate_of) return { tone: "warning", title: "Verify possible duplicate", details: ["Another SMS may describe the same activity.", ...notes] };
  if (candidate.possible_related_candidate) return { tone: "info", title: "Possible transfer match", details: [candidate.related_match_reason || "Check the other account’s SMS before linking.", ...notes] };
  if (notes.length) return { tone: "warning", title: "Check review notes", details: notes };
  return { tone: "ready", title: "Ready to confirm", details: [] };
}
