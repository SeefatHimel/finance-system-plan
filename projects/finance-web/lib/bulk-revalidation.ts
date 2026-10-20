export type RevalidationSelection = Record<string, string[]>;
export type RevalidationItem = { transaction: string; token: string; selected: string[] };
type Entry = { preview: { transaction: string; token: string; suggestions: { key: string }[] } };

/** Only current, offered fields enter a request; original source values never do. */
export function selectedCorrections(entries: Entry[], selection: RevalidationSelection, applied: ReadonlySet<string>): RevalidationItem[] {
  return entries.flatMap(({ preview }) => {
    if (applied.has(preview.transaction)) return [];
    const allowed = new Set(preview.suggestions.map(item => item.key));
    const selected = [...new Set(selection[preview.transaction] ?? [])].filter(key => allowed.has(key));
    return selected.length ? [{ transaction: preview.transaction, token: preview.token, selected }] : [];
  });
}

export function correctionGroups(items: RevalidationItem[], size = 25): RevalidationItem[][] {
  if (!Number.isInteger(size) || size < 1 || size > 25) throw new Error("Correction groups must contain 1–25 transactions.");
  return Array.from({ length: Math.ceil(items.length / size) }, (_, index) => items.slice(index * size, (index + 1) * size));
}
