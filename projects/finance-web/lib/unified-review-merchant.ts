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
