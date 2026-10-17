import { categoryTypeProposal } from "./category-type";
import type { Category, TransactionType } from "./api";

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
