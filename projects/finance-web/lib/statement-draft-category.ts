import { categoryTypeProposal } from "./category-type";
import type { Category, SavedStatementRow, StatementRowEdit, TransactionType } from "./api";

/** Keep compatible choices on type changes; infer only an unambiguous transfer category. */
export function statementDraftCategory(type: TransactionType, current: string | null, categories: Category[]): string | null {
  if (current) {
    const category = categories.find(item => item.id === current);
    if (!category || !categoryTypeProposal(category, type)) return current;
  }
  if (type !== "transfer") return null;
  const matches = categories.filter(item => item.is_active && item.kind === "transfer");
  return matches.length === 1 ? matches[0].id : null;
}

/** A suggestion is already applied when every value its button would change matches the draft. */
export function statementSuggestionAlreadyApplied(
  draft: Pick<StatementRowEdit, "type" | "category" | "other_account" | "counterparty_text">,
  suggestion: NonNullable<SavedStatementRow["review"]["suggestion"]>,
  categories: Category[],
): boolean {
  return draft.type === suggestion.type
    && draft.category === statementDraftCategory(suggestion.type, suggestion.category, categories)
    && draft.other_account === suggestion.other_account
    && (suggestion.counterparty_text === undefined || draft.counterparty_text === suggestion.counterparty_text);
}
