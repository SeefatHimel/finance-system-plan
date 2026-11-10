import { z } from "zod";
import { authenticatedFetch } from "./api";
import type { BulkConfiguration } from "../../finance-contracts/bulk-import";

const receipt = z
  .object({
    new: z.number(),
    linked: z.number(),
    skipped: z.number(),
    checkpoints: z.number(),
    snapshot_ids: z.array(z.string()).optional(),
    recorded_at: z.string().optional(),
  })
  .partial();
const match = z.object({
  id: z.string(),
  date: z.string(),
  time: z.string().nullable(),
  amount: z.string(),
  type: z.string(),
  direction: z.string(),
  source: z.string(),
  source_labels: z.array(z.string()).default([]),
  description: z.string(),
  note: z.string(),
  balance_after: z.string().nullable(),
});
const values = z.object({
  date: z.string().nullable(),
  time: z.string().nullable(),
  category: z.string().nullable(),
  description: z.string(),
  notes: z.string(),
  amount: z.string().nullable(),
  balance_after: z.string().nullable(),
  type: z.string(),
  direction: z.enum(["debit", "credit"]),
  other_account: z.string().nullable(),
});
const row = z.object({
  number: z.number(),
  original: z.record(z.string(), z.string()),
  source_category: z.string().default(""),
  category_suggestion: z
    .object({
      category: z.string().nullable(),
      label: z.string(),
      method: z.enum(["exact", "alias", "ambiguous", "unmapped", "empty"]),
    })
    .optional(),
  values: values.optional(),
  action: z.enum(["new", "skip", "link"]).default("new"),
  transaction: z.string().nullable().optional(),
  reviewed: z.boolean().default(false),
  review_fingerprint: z.string().default(""),
  warnings: z.array(z.string()).default([]),
  errors: z.array(z.string()).default([]),
  matches: z.array(match).default([]),
});
const checkpoint = z.object({
  number: z.number(),
  errors: z.array(z.string()),
  unknown: z.array(
    z.object({
      key: z.string(),
      description: z.string(),
      amount: z.string(),
      position: z.string().optional(),
    }),
  ),
  expected_balance: z.string().nullable(),
  difference: z.string().nullable(),
  balance: z.string().optional(),
  precision: z.string().optional(),
  checked_at: z.string().optional(),
});
const configuration = z.object({
  mapping: z.record(z.string(), z.string()).default({}),
  date_order: z.enum(["ISO", "DMY", "MDY"]).default("ISO"),
  positive_direction: z.enum(["debit", "credit"]).default("debit"),
  category_map: z.record(z.string(), z.string().nullable()).default({}),
  decisions: z
    .record(
      z.string(),
      z.object({
        action: z.enum(["new", "skip", "link"]).optional(),
        date: z.string().optional(),
        time: z.string().optional(),
        amount: z.string().optional(),
        type: z.string().optional(),
        direction: z.enum(["debit", "credit"]).optional(),
        category: z.string().nullable().optional(),
        description: z.string().optional(),
        notes: z.string().max(4000).optional(),
        other_account: z.string().nullable().optional(),
        transaction: z.string().nullable().optional(),
        reviewed: z.boolean().optional(),
        review_fingerprint: z.string().optional(),
      }),
    )
    .default({}),
  checkpoints: z
    .array(
      z.object({
        date: z.string(),
        time: z.string().nullable().optional(),
        balance: z.string(),
        end_of_day: z.boolean(),
        unknown_position: z
          .enum(["unresolved", "before", "after"])
          .default("unresolved"),
        exceptions: z
          .record(z.string(), z.enum(["before", "after"]))
          .default({}),
        note: z.string().default(""),
      }),
    )
    .default([]),
});
export const bulkPreviewSchema = z.object({
  id: z.string(),
  account: z.string(),
  filename: z.string(),
  state: z.enum(["draft", "committed", "undone"]),
  version: z.number(),
  headers: z.array(z.string()),
  configuration,
  rows: z.array(row),
  checkpoints: z.array(checkpoint),
  errors: z.array(z.string()),
  summary: z.record(z.string(), z.number()),
  review_token: z.string(),
  timezone: z.string(),
  receipt,
});
export type BulkPreview = z.infer<typeof bulkPreviewSchema>;
export type BulkRow = BulkPreview["rows"][number];
export const bulkReceiptSchema = z.object({
  id: z.string(),
  state: z.string(),
  receipt,
});
export type BulkReceipt = z.infer<typeof bulkReceiptSchema>;
export const bulkSourceSchema = z.object({
  batch: z.string(),
  filename: z.string(),
  number: z.number(),
  original: z.record(z.string(), z.string()),
  normalized: values,
  notes_edited: z.boolean().default(false),
});
export type BulkSource = z.infer<typeof bulkSourceSchema>;
const historySchema = z.array(
  z.object({
    id: z.string(),
    account: z.string(),
    filename: z.string(),
    state: z.string(),
    created_at: z.string(),
    receipt,
  }),
);

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
export async function createBulkImport(
  token: string,
  account: string,
  text: string,
  filename: string,
) {
  return bulkPreviewSchema.parse(
    await json(token, "/api/bulk-imports/", "POST", {
      account,
      text,
      filename,
    }),
  );
}
export async function getBulkImport(
  token: string,
  id: string,
  signal?: AbortSignal,
) {
  return bulkPreviewSchema.parse(
    await json(token, `/api/bulk-imports/${id}/`, "GET", undefined, signal),
  );
}
export async function reviewBulkImport(
  token: string,
  id: string,
  version: number,
  config: BulkConfiguration,
) {
  return bulkPreviewSchema.parse(
    await json(token, `/api/bulk-imports/${id}/`, "PATCH", {
      version,
      ...config,
    }),
  );
}
export async function commitBulkImport(token: string, preview: BulkPreview) {
  return bulkReceiptSchema.parse(
    await json(token, `/api/bulk-imports/${preview.id}/commit/`, "POST", {
      version: preview.version,
      review_token: preview.review_token,
    }),
  );
}
export async function undoBulkImport(token: string, id: string) {
  return bulkReceiptSchema.parse(
    await json(token, `/api/bulk-imports/${id}/undo/`, "POST", {}),
  );
}
export async function listBulkImports(token: string, signal?: AbortSignal) {
  return historySchema.parse(
    await json(token, "/api/bulk-imports/", "GET", undefined, signal),
  );
}
export async function listBulkSources(
  token: string,
  id: string,
  signal?: AbortSignal,
) {
  return z
    .array(bulkSourceSchema)
    .parse(
      await json(
        token,
        `/api/transactions/${id}/bulk-sources/`,
        "GET",
        undefined,
        signal,
      ),
    );
}

export async function reopenBulkImport(
  token: string,
  id: string,
  version: number,
) {
  return bulkPreviewSchema.parse(
    await json(token, `/api/bulk-imports/${id}/reopen/`, "POST", { version }),
  );
}
