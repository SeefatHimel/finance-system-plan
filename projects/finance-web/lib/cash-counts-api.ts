import { z } from "zod";
import { authenticatedFetch } from "./api";
import type { CashCountDraft } from "../../finance-contracts/cash-counts";
const count = z.object({
  id: z.string(),
  account: z.string(),
  date: z.string(),
  time: z.string().nullable(),
  precision: z.string(),
  balance: z.string(),
  expected_balance: z.string(),
  difference: z.string(),
  note: z.string(),
  updated_at: z.string(),
});
const previewRow = z.object({
  number: z.number(),
  original: z.record(z.string(), z.unknown()),
  action: z.enum(["add", "skip", "replace"]),
  account: z.string().nullable(),
  account_name: z.string(),
  currency: z.string(),
  date: z.string(),
  time: z.string().nullable(),
  balance: z.string(),
  note: z.string(),
  source_expected: z.string(),
  expected_balance: z.string().nullable(),
  difference: z.string().nullable(),
  errors: z.array(z.string()),
  unknown: z.array(
    z.object({
      id: z.string(),
      description: z.string(),
      amount: z.string(),
      position: z.string(),
    }),
  ),
  duplicate: z
    .object({ id: z.string(), balance: z.string(), updated_at: z.string() })
    .nullable(),
  previous: z
    .object({
      id: z.string().nullable(),
      date: z.string(),
      balance: z.string(),
      difference: z.string().nullable(),
      errors: z.array(z.string()),
    })
    .nullable(),
  difference_change: z.string().nullable(),
});
export const cashPreviewSchema = z.object({
  rows: z.array(previewRow),
  headers: z.array(z.string()),
  mapping: z.record(z.string(), z.string()),
  timezone: z.string(),
  ready: z.boolean(),
  review_token: z.string(),
});
export type CashPreview = z.infer<typeof cashPreviewSchema>;
export const cashHistorySchema = z.object({
  results: z.array(
    count.extend({
      account_name: z.string(),
      currency: z.string(),
      previous_difference: z.string().nullable(),
      same_recorded_difference: z.boolean(),
    }),
  ),
  count: z.number(),
  next_offset: z.number().nullable(),
});
export type CashHistory = z.infer<typeof cashHistorySchema>;
export const cashComparisonSchema = z.object({
  revision: z.string(),
  count: count.extend({
    current_expected: z.string().nullable(),
    current_difference: z.string().nullable(),
    ledger_changed: z.boolean(),
  }),
  previous: count
    .extend({ current_difference: z.string().nullable() })
    .nullable(),
  difference_change: z.string().nullable(),
  errors: z.array(z.string()),
  movements: z.array(
    z.object({
      id: z.string(),
      date: z.string(),
      time: z.string().nullable(),
      description: z.string(),
      amount: z.string(),
      direction: z.enum(["debit", "credit"]),
    }),
  ),
  movement_count: z.number(),
  next_offset: z.number().nullable(),
});
export type CashComparison = z.infer<typeof cashComparisonSchema>;
const receiptSchema = z.object({
  id: z.string(),
  saved: z.number(),
  counts: z.array(
    z.object({
      id: z.string(),
      number: z.number(),
      account: z.string(),
      difference: z.string(),
    }),
  ),
});
async function json(
  token: string,
  path: string,
  method = "GET",
  body?: unknown,
  signal?: AbortSignal,
) {
  const response = await authenticatedFetch(path, token, {
    method,
    signal,
    headers: { "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return response.json();
}
export async function previewCashCounts(token: string, draft: CashCountDraft) {
  return cashPreviewSchema.parse(
    await json(token, "/api/cash-counts/preview/", "POST", draft),
  );
}
export async function saveCashCounts(
  token: string,
  draft: CashCountDraft,
  review_token: string,
  idempotency_key: string,
) {
  return receiptSchema.parse(
    await json(token, "/api/cash-counts/", "POST", {
      ...draft,
      review_token,
      idempotency_key,
    }),
  );
}
export async function cashCountHistory(
  token: string,
  account: string,
  offset = 0,
  signal?: AbortSignal,
) {
  const query = new URLSearchParams({ offset: String(offset) });
  if (account) query.set("account", account);
  return cashHistorySchema.parse(
    await json(token, `/api/cash-counts/?${query}`, "GET", undefined, signal),
  );
}
export async function compareCashCount(
  token: string,
  id: string,
  offset = 0,
  signal?: AbortSignal,
) {
  return cashComparisonSchema.parse(
    await json(
      token,
      `/api/cash-counts/${id}/?offset=${offset}`,
      "GET",
      undefined,
      signal,
    ),
  );
}
