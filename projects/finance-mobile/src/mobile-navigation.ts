export const mobileDestinations = [
  {
    id: "accounts",
    icon: "credit-card-outline",
    label: "Accounts",
    section: "Accounts",
  },
  {
    id: "debts",
    icon: "handshake-outline",
    label: "Debts & lending",
    section: "Debts & lending",
  },
  {
    id: "credit-cards",
    icon: "credit-card-clock-outline",
    label: "Credit card bills",
    section: "Credit card bills",
  },
  {
    id: "recurring-bills",
    icon: "calendar-sync-outline",
    label: "Recurring bills",
    section: "Recurring bills",
  },
  {
    id: "reconciliation",
    icon: "scale-balance",
    label: "Reconciliation",
    section: "Balance reconciliation",
  },
  {
    id: "capture",
    icon: "message-processing-outline",
    label: "SMS capture settings",
    section: "SMS automation",
  },
] as const;
export type MobileDestination = (typeof mobileDestinations)[number]["id"];
export type AdvancedTool =
  | Exclude<MobileDestination, "accounts" | "capture">
  | "entry";
export function reviewIndex(candidates: Array<{ id: string }>, id: string) {
  return candidates.findIndex((candidate) => candidate.id === id);
}

export function reviewSelection(
  candidates: Array<{ id: string }>,
  selected: string | null,
  fallback: number,
) {
  const index = selected ? reviewIndex(candidates, selected) : -1;
  return index >= 0
    ? index
    : Math.max(0, Math.min(fallback, candidates.length - 1));
}
