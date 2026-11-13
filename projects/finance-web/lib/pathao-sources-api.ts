import { z } from "zod";
import {
  authenticatedFetch,
  transactionActionSchema,
  senderRuleSchema,
} from "./api";
const previewSchema = z.object({
  available: z.boolean(),
  reference: z.string(),
  keep: z.string().nullable(),
  preview_token: z.string(),
  can_resolve: z.boolean(),
  blockers: z.array(z.string()),
  sources: z.array(
    z.object({
      id: z.string(),
      sender: z.string(),
      text: z.string(),
      received_at: z.string(),
      status: z.string(),
      transaction: z.string().nullable(),
      amount: z.string().nullable(),
      direction: z.string(),
      balance_after: z.string().nullable(),
      fee_amount: z.string().nullable(),
    }),
  ),
  transactions: z.array(
    z.object({
      id: z.string(),
      account_name: z.string(),
      date: z.string(),
      amount: z.string(),
      direction: z.string(),
      balance_after: z.string().nullable(),
      description: z.string(),
      note: z.string(),
      type: z.string(),
    }),
  ),
});
export async function getPathaoSources(
  token: string,
  id: string,
  signal?: AbortSignal,
  keep?: string,
) {
  return previewSchema.parse(
    await (
      await authenticatedFetch(
        `/api/messages/review/${id}/pathao-sources/${keep ? `?keep=${encodeURIComponent(keep)}` : ""}`,
        token,
        { signal },
      )
    ).json(),
  );
}
export async function resolvePathaoSources(
  token: string,
  id: string,
  preview_token: string,
  request_id: string,
) {
  return z
    .object({
      transaction: z.string(),
      source_count: z.number(),
      merged_count: z.number(),
      undo_action: transactionActionSchema.nullable(),
    })
    .parse(
      await (
        await authenticatedFetch(
          `/api/messages/review/${id}/pathao-sources/`,
          token,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              preview_token,
              request_id,
              confirmed: true,
            }),
          },
        )
      ).json(),
    );
}
export async function setupPathaoGroup(token: string, account: string) {
  const response = await authenticatedFetch(
    "/api/messages/sender-groups/pathao-pay/",
    token,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ account }),
    },
  );
  return z.array(senderRuleSchema).parse(await response.json());
}
