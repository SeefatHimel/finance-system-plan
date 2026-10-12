import {
  validDay,
  type QuickEntryInput,
} from "../../finance-contracts/quick-add";
export type PendingQuickEntry = {
  input: QuickEntryInput;
  attempts: number;
  retryAt: number;
  error: string;
  blocked: boolean;
  status?: number;
};
export function readPendingEntries(text: string | null): PendingQuickEntry[] {
  if (!text) return [];
  const items: unknown = JSON.parse(text);
  if (!Array.isArray(items) || items.length > 100)
    throw new Error(
      "Pending entries are invalid; local data has not been overwritten.",
    );
  const ids = new Set<string>();
  for (const item of items) {
    const entry = item as PendingQuickEntry;
    const input = entry?.input;
    if (
      !input ||
      typeof input.client_request_id !== "string" ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        input.client_request_id,
      ) ||
      ids.has(input.client_request_id) ||
      typeof input.account !== "string" ||
      !input.account ||
      !["expense", "income"].includes(input.type) ||
      input.source !== "mobile" ||
      typeof input.amount !== "string" ||
      !/^\d{1,12}(?:\.\d{1,2})?$/.test(input.amount) ||
      Number(input.amount) <= 0 ||
      typeof input.date !== "string" ||
      !validDay(input.date) ||
      (input.time !== null &&
        (typeof input.time !== "string" ||
          !/^([01]\d|2[0-3]):[0-5]\d$/.test(input.time))) ||
      (input.category !== null && typeof input.category !== "string") ||
      typeof input.note !== "string" ||
      typeof input.counterparty_text !== "string" ||
      !Number.isInteger(entry.attempts) ||
      entry.attempts < 0 ||
      !Number.isFinite(entry.retryAt) ||
      typeof entry.error !== "string" ||
      typeof entry.blocked !== "boolean"
    )
      throw new Error(
        "Pending entries are invalid; local data has not been overwritten.",
      );
    ids.add(input.client_request_id);
  }
  return items as PendingQuickEntry[];
}
export function quickRetryAt(attempts: number, now = Date.now()) {
  return now + Math.min(900000, 15000 * 2 ** Math.min(attempts, 6));
}
