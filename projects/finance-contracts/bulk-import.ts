/** Bulk import review DTOs. Source evidence never substitutes for a ledger entry. */
export type BulkRowDecision = {
  action?: "new" | "skip" | "link";
  date?: string;
  time?: string;
  amount?: string;
  type?: string;
  direction?: "debit" | "credit";
  category?: string | null;
  description?: string;
  notes?: string;
  other_account?: string | null;
  transaction?: string | null;
  reviewed?: boolean;
  review_fingerprint?: string;
};
export type BulkCheckpointInput = {
  date: string;
  time?: string | null;
  balance: string;
  end_of_day: boolean;
  unknown_position: "unresolved" | "before" | "after";
  exceptions: Record<string, "before" | "after">;
  note: string;
};
export type BulkConfiguration = {
  mapping: Record<string, string>;
  date_order: "ISO" | "DMY" | "MDY";
  positive_direction: "debit" | "credit";
  category_map: Record<string, string | null>;
  decisions: Record<string, BulkRowDecision>;
  checkpoints: BulkCheckpointInput[];
};
