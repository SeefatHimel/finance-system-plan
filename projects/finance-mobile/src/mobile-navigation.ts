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
export const mainTabs = ["home", "activity", "capture", "review", "more"] as const;
export type MainTab = (typeof mainTabs)[number];
export const workspaceRoutes = [...mainTabs, "accounts", "profile", "entry", "debts", "credit-cards", "recurring-bills", "reconciliation"] as const;
export type WorkspaceRoute = (typeof workspaceRoutes)[number];
export type WorkspaceParams = { [Route in WorkspaceRoute]: undefined };
export function isMainTab(route: WorkspaceRoute): route is MainTab {
  return (mainTabs as readonly string[]).includes(route);
}

/** Refresh the loaded review window atomically, rather than truncating to page one. */
export async function refreshReviewWindow<T extends { id: string }>(
  readPage: (offset: number) => Promise<{ count: number; results: T[] }>,
  loadedCount: number,
) {
  const rows = new Map<string, T>();
  let offset = 0, count = 0;
  do {
    const page = await readPage(offset);
    count = page.count;
    page.results.forEach(row => rows.set(row.id, row));
    offset += page.results.length;
    if (!page.results.length) break;
  } while (rows.size < Math.min(loadedCount, count) && offset < count);
  return { count, results: [...rows.values()] };
}
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
