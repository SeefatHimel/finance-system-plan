import type { CreateTransactionInput } from "./api";

/** A persisted queue identity survives response loss, restarts and old queue migration. */
export function queuedEntryInput(id: string, input: CreateTransactionInput): CreateTransactionInput {
  return { ...input, external_key: input.external_key || `${input.type === "transfer" ? "queued-transfer" : "queued-entry"}:${id}` };
}
