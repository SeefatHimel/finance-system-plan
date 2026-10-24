const textFields = new Set([
  "date", "time", "counterparty_text", "reference", "note",
  "sender_account_identifier", "sender_card_identifier",
  "receiver_account_identifier", "receiver_card_identifier"
]);

/** Page-local drafts only; never write SMS or edited fields to browser storage. */
export function createReviewDrafts() {
  const drafts = new Map<string, Record<string, string | boolean>>();
  return {
    capture(candidate: string, field: string, value: string | boolean) {
      if (!(textFields.has(field) && typeof value === "string")) return;
      drafts.set(candidate, { ...drafts.get(candidate), [field]: value });
    },
    text(candidate: string, field: string, fallback: string) {
      const value = drafts.get(candidate)?.[field];
      return typeof value === "string" ? value : fallback;
    },
    reset(candidate?: string) {
      if (candidate) drafts.delete(candidate);
      else drafts.clear();
    }
  };
}
