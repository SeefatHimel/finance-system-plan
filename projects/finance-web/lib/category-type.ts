import type { TransactionType, TransactionDirection } from "../../finance-contracts/generated/types";

export const transactionTypes: TransactionType[] = ["expense", "income", "transfer", "adjustment", "fee", "refund", "lend", "borrow", "repayment_received", "repayment_paid"];

export type CategoryTypeProposal = {
  categoryId: string;
  categoryName: string;
  currentType: TransactionType;
  options: TransactionType[];
};

export function categoryTypeProposal(category: { id: string; name: string; kind: string } | undefined, type: TransactionType): CategoryTypeProposal | null {
  if (!category) return null;
  const compatible: Record<string, TransactionType[]> = {
    expense: ["expense", "fee"], income: ["income", "refund"], transfer: ["transfer"],
    debt: ["lend", "borrow", "repayment_received", "repayment_paid"]
  };
  const types = compatible[category.kind];
  // System categories and uncategorized entries do not prescribe a money movement.
  if (!types || types.includes(type)) return null;
  return {
    categoryId: category.id, categoryName: category.name, currentType: type,
    options: category.kind === "debt" ? types : [types[0]]
  };
}

export function directionForType(type: TransactionType): TransactionDirection {
  return ["income", "refund", "borrow", "repayment_received"].includes(type) ? "credit" : "debit";
}

export function typeImpact(type: TransactionType) {
  return type === "transfer" ? "Moves money between two accounts; excluded from income and spending."
    : type === "adjustment" ? "Corrects an account balance using the selected debit or credit direction."
    : directionForType(type) === "credit" ? "Adds money to the selected account." : "Subtracts money from the selected account.";
}
