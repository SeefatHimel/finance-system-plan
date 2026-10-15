import type { SavedStatementRow } from "@/lib/api";

/** Prefer a verified code label only while the statement merchant is still raw extraction. */
export function initialUnifiedMerchant(row: SavedStatementRow, smsMerchant: string): string {
  const savedMerchant = row.counterparty_text.trim();
  const sourceDescription = row.extracted.description.trim();
  const mappedMerchant = row.review.suggestion?.counterparty_text?.trim();

  if (mappedMerchant && (!savedMerchant || savedMerchant === sourceDescription)) {
    return mappedMerchant;
  }
  return row.counterparty_text || smsMerchant;
}

/** Offer a readable merchant as the final note, never a masked bank reference. */
export function merchantNoteSuggestion(merchant: string, note: string): string | null {
  const value = merchant.trim();
  if (!value || value === note.trim() || /^CT-FT-/i.test(value) || /[*•…]{2,}/.test(value) || /^\d{6,}$/.test(value)) return null;
  return value;
}
