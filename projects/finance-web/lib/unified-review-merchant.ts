import type { SavedStatementRow } from "@/lib/api";

/** Prefer a verified code label only while the statement merchant is still raw extraction. */
export function initialUnifiedMerchant(row: SavedStatementRow, smsMerchant: string): string {
  const savedMerchant = row.counterparty_text.trim();
  const sourceDescription = row.extracted.description.trim();
  const mappedMerchant = row.review.suggestion?.counterparty_text?.trim();
  const sourceParty = sourceDescription.split(/\btrx\s*id\s*:/i, 1)[0].trim().replace(/[\s:/,-]+$/g, "");

  if (mappedMerchant && (!savedMerchant || savedMerchant === sourceDescription || savedMerchant === sourceParty)) {
    return mappedMerchant;
  }
  return row.counterparty_text || smsMerchant;
}

/** A verified note may replace untouched source text in the combined draft. */
export function initialUnifiedNote(row: SavedStatementRow, smsMerchant: string): string {
  const savedNote = row.note.trim();
  const mappedNote = row.review.suggestion?.note?.trim();
  if (mappedNote && (!savedNote || savedNote === row.extracted.description.trim())) return mappedNote;
  return row.note || smsMerchant;
}

/** Offer a readable merchant as the final note, never a masked bank reference. */
export function merchantNoteSuggestion(merchant: string, note: string): string | null {
  const value = merchant.trim();
  if (!value || value === note.trim() || /^CT-FT-/i.test(value) || /[*•…]{2,}/.test(value) || /^\d{6,}$/.test(value)) return null;
  return value;
}
