/** Approval is deliberately bounded; larger reviews use independent undoable batches. */
export const BULK_APPROVAL_LIMIT = 25;
export type BulkPairSelection = { statement: string; sms: string };
export type BulkPairEdits = {
  category: string | null;
  description: string;
  note: string;
};
export type BulkPairInput = BulkPairSelection & { edits?: BulkPairEdits };
export const pairSelectionKey = (pair: BulkPairSelection) =>
  `${pair.statement}:${pair.sms}`;

export function selectPagePairs(
  current: BulkPairSelection[],
  page: BulkPairSelection[],
) {
  const selected = new Map(
    current.map((pair) => [pairSelectionKey(pair), pair]),
  );
  for (const pair of page) {
    if (selected.size >= BULK_APPROVAL_LIMIT) break;
    selected.set(pairSelectionKey(pair), pair);
  }
  return [...selected.values()];
}
