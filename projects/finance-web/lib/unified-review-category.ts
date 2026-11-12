import { categoryTypeProposal } from "./category-type";
import type { Category, ParsedMessageCandidate, SavedStatementRow, TransactionType } from "./api";

type Row = Pick<SavedStatementRow, "type" | "category" | "review">;
type Sms = Pick<ParsedMessageCandidate, "transaction_type" | "category" | "suggested_category">;

export function suggestedSmsCategory(sms: Pick<Sms, "category" | "suggested_category">): string | null {
  return sms.suggested_category === undefined ? sms.category : sms.suggested_category;
}

export function compatiblePairCategory(id: string | null, type: TransactionType, categories: Category[]): string | null {
  const category = categories.find(item => item.id === id && item.is_active);
  return category && !categoryTypeProposal(category, type) ? category.id : null;
}

export function mappedPairCategory(row: Row, type: TransactionType, categories: Category[]): string | null {
  const suggestion = row.review.suggestion;
  return suggestion?.type === type ? compatiblePairCategory(suggestion.category, type, categories) : null;
}

export function initialPairCategory(row: Row, sms: Sms, categories: Category[]): string | null {
  return compatiblePairCategory(row.category, row.type, categories)
    ?? mappedPairCategory(row, row.type, categories)
    ?? (row.type === sms.transaction_type ? compatiblePairCategory(suggestedSmsCategory(sms), row.type, categories) : null);
}

export function categoryAfterPairTypeChoice(row: Row, sms: Sms, current: string | null, type: TransactionType, choice: "statement" | "sms" | "custom", categories: Category[]): string | null {
  const first = choice === "statement" ? row.category : choice === "sms" ? suggestedSmsCategory(sms) : current;
  return compatiblePairCategory(first, type, categories)
    ?? mappedPairCategory(row, type, categories)
    ?? (choice === "statement" && row.type === sms.transaction_type ? compatiblePairCategory(suggestedSmsCategory(sms), type, categories) : null);
}
