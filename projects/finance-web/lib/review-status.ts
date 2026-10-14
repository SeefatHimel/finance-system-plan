export type ReviewValues = { account: string; other: string; amount: string; type: string; category: string };
export function reviewFieldErrors(values: ReviewValues): Record<string, string> {
  const errors: Record<string, string> = {};
  if (!values.account) errors.account = "Choose an account.";
  const normalized = values.amount.trim().replaceAll(",", "");
  const amount = Number(normalized);
  if (!normalized || amount <= 0) errors.amount = "Enter an amount greater than zero.";
  else if (!/^\d+(?:\.\d{1,2})?$/.test(normalized) || !Number.isFinite(amount)) errors.amount = "Enter a valid amount with up to two decimal places.";
  if (values.type === "transfer") {
    if (!values.other) errors.transfer_account = "Choose the other transfer account.";
    else if (values.other === values.account) errors.transfer_account = "Choose two different accounts.";
  }
  return errors;
}
export function reviewNotes(confidence: string, category: string, type: string): string[] {
  const notes: string[] = [];
  if (Number(confidence) < 0.65) notes.push("Check source SMS");
  if (!category && type !== "transfer") notes.push("Uncategorized");
  return notes;
}
export const REVIEW_QUEUE_CHANGED = "finance:review-queue-changed";
export type ReviewQueueCount = { count: number; owner: number };
export function validReviewCount(value: unknown, owner: number | null): value is ReviewQueueCount {
  if (!value || typeof value !== "object") return false;
  const data = value as ReviewQueueCount;
  return owner !== null && data.owner === owner && Number.isInteger(data.count) && data.count >= 0;
}
export function publishReviewCount(count: number, owner: number | null) {
  if (owner !== null) window.dispatchEvent(new CustomEvent(REVIEW_QUEUE_CHANGED, { detail: { count, owner } }));
}
