import { z } from "zod";
import {
  authenticatedFetch,
  pendingSourceSchema,
  transactionActionSchema,
} from "./api";
import type { BulkPairSelection } from "../../finance-contracts/unified-bulk";

const named = z.object({ id: z.string(), name: z.string() });
const previewSchema = z.object({
  token: z.string().nullable(),
  expires_at: z.string(),
  ready_count: z.number(),
  needs_review: z.number(),
  totals: z.record(
    z.string(),
    z.object({ debit: z.string(), credit: z.string(), transfer: z.string() }),
  ),
  items: z.array(
    z.object({
      id: z.string(),
      statement: pendingSourceSchema,
      sms: pendingSourceSchema,
      category: named.nullable(),
      other_account: named.nullable(),
      ready: z.boolean(),
      blockers: z.array(z.string()),
      statement_text: z.string(),
      sms_text: z.string(),
      balance_source: z.enum(["sms", "statement"]),
    }),
  ),
});
const resultSchema = z.object({
  batch: z.string(),
  approved: z.array(
    z.object({
      statement: z.string(),
      sms: z.string(),
      transaction: z.string(),
    }),
  ),
  needs_review: z.number(),
  undo_action: transactionActionSchema.nullable(),
  replayed: z.boolean(),
});
export type BulkApprovalPreview = z.infer<typeof previewSchema>;
export type BulkApprovalResult = z.infer<typeof resultSchema>;
export async function previewBulkApproval(
  token: string,
  pairs: BulkPairSelection[],
  signal?: AbortSignal,
) {
  return previewSchema.parse(
    await (
      await authenticatedFetch("/api/review/bulk/preview/", token, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pairs }),
        signal,
      })
    ).json(),
  );
}
export async function approveBulkPairs(
  token: string,
  previewToken: string,
  requestId: string,
) {
  return resultSchema.parse(
    await (
      await authenticatedFetch("/api/review/bulk/approve/", token, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token: previewToken,
          request_id: requestId,
          confirmed: true,
        }),
      })
    ).json(),
  );
}
