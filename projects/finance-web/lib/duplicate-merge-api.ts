import { z } from "zod";
import { authenticatedFetch, transactionActionSchema } from "./api";

const source = z.object({
  kind: z.string(),
  id: z.string(),
  account: z.string().nullable(),
  text: z.string(),
  transaction_id: z.string(),
  message_reference: z.string(),
  saved_reference: z.string(),
});
const entry = z.object({
  id: z.string(),
  account: z.string(),
  account_name: z.string(),
  currency: z.string(),
  transfer_account_name: z.string().nullable(),
  date: z.string(),
  time: z.string().nullable(),
  type: z.string(),
  direction: z.string(),
  amount: z.string(),
  balance_after: z.string().nullable(),
  reference: z.string(),
  description: z.string(),
  note: z.string(),
  source: z.string(),
  sources: z.array(source).optional(),
});
const candidateList = z.object({ entry, candidates: z.array(entry) });
const preview = z.object({
  entries: z.array(entry),
  keep: z.string(),
  statement: source.nullable(),
  blockers: z.array(z.string()),
  removed_count: z.number(),
  retained_fields: z.string(),
  preview_token: z.string(),
});
export type MergeEntry = z.infer<typeof entry>;
export type MergePreview = z.infer<typeof preview>;
export type MergeSelection = {
  transactions: string[];
  keep: string;
  statement_row?: string;
};
export async function duplicateCandidates(
  token: string,
  id: string,
  signal?: AbortSignal,
) {
  return candidateList.parse(
    await (
      await authenticatedFetch(
        `/api/transactions/${id}/duplicate-candidates/`,
        token,
        { signal },
      )
    ).json(),
  );
}
export async function previewDuplicateMerge(
  token: string,
  data: MergeSelection,
  signal?: AbortSignal,
) {
  return preview.parse(
    await (
      await authenticatedFetch("/api/transactions/merge-preview/", token, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
        signal,
      })
    ).json(),
  );
}
export async function mergeDuplicates(
  token: string,
  data: MergeSelection & {
    preview_token: string;
    request_id: string;
    confirmed: boolean;
  },
) {
  const result = z.object({
    transaction: z.string(),
    removed: z.array(z.string()),
    statement_row: z.string().nullable(),
    undo_action: transactionActionSchema,
  });
  return result.parse(
    await (
      await authenticatedFetch("/api/transactions/merge-duplicates/", token, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      })
    ).json(),
  );
}
export async function mergedSources(
  token: string,
  id: string,
  signal?: AbortSignal,
) {
  return z
    .array(
      z.object({
        original_id: z.string(),
        snapshot: z.record(z.string(), z.unknown()),
      }),
    )
    .parse(
      await (
        await authenticatedFetch(
          `/api/transactions/${id}/merged-sources/`,
          token,
          { signal },
        )
      ).json(),
    );
}
