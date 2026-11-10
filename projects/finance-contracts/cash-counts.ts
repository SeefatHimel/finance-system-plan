/** Physical observations only; saving a count never creates a ledger adjustment. */
export type CashCountRowInput = {
  account?: string;
  date?: string;
  time?: string;
  balance?: string;
  note?: string;
  action?: "add" | "skip" | "replace";
  replace_id?: string;
  unknown_position?: "unresolved" | "before" | "after";
  timing_order?: Record<string, "before" | "after">;
};
export type CashCountDraft = {
  text?: string;
  rows?: CashCountRowInput[];
  filename: string;
  mapping: Record<string, string>;
  account_map: Record<string, string | null>;
  decisions: Record<string, CashCountRowInput>;
  date_order: "ISO" | "DMY" | "MDY";
  end_of_day: boolean;
};
