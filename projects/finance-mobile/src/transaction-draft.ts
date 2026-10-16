import type { Transaction, UpdateTransactionInput } from "./api";
import {
  formatCalendarDate,
  formatClockTime,
} from "../../finance-contracts/presentation";
export const transactionTypes = [
  "expense",
  "income",
  "transfer",
  "adjustment",
  "fee",
  "refund",
  "lend",
  "borrow",
  "repayment_received",
  "repayment_paid",
];
export const directionForType = (type: string) =>
  ["income", "refund", "borrow", "repayment_received"].includes(type)
    ? "credit"
    : "debit";
export function categoryTypes(kind?: string): string[] | null {
  return (
    (
      {
        expense: ["expense", "fee"],
        income: ["income", "refund"],
        transfer: ["transfer"],
        debt: ["lend", "borrow", "repayment_received", "repayment_paid"],
      } as Record<string, string[]>
    )[kind ?? ""] ?? null
  );
}
export type TransactionDraft = {
  type: string;
  direction: string;
  account: string;
  transfer_account: string;
  category: string;
  amount: string;
  date: string;
  time: string;
  reference: string;
  counterparty_text: string;
  note: string;
  payment_method: string;
  needs_review: boolean;
  balances: Record<string, string>;
  reportingAccount: string;
};
export function transactionDraft(row: Transaction): TransactionDraft {
  const primary =
    row.balance_reporting_account ||
    row.transfer_evidence.find((item) => item.is_primary)?.account ||
    row.account;
  const balances = Object.fromEntries(
    row.transfer_evidence.map((item) => [
      item.account,
      item.balance_after ?? "",
    ]),
  );
  for (const item of row.reported_balances ?? [])
    balances[item.account] = item.balance_after ?? "";
  if (row.type !== "transfer") balances[primary] = row.balance_after ?? "";
  else if (!(primary in balances)) balances[primary] = row.balance_after ?? "";
  return {
    type: row.type,
    direction: row.direction,
    account: row.account,
    transfer_account: row.transfer_account ?? "",
    category: row.category ?? "",
    amount: row.amount,
    date: row.date,
    time: row.time ?? "",
    reference: row.reference,
    counterparty_text: row.counterparty_text,
    note: row.note,
    payment_method: row.payment_method ?? "",
    needs_review: row.needs_review,
    balances,
    reportingAccount: primary,
  };
}
export function draftPatch(
  row: Transaction,
  draft: TransactionDraft,
  allowLinked: boolean,
): UpdateTransactionInput {
  if (!transactionTypes.includes(draft.type))
    throw new Error("Choose a transaction type.");
  if (!["debit", "credit"].includes(draft.direction))
    throw new Error("Choose debit or credit.");
  if (!draft.account) throw new Error("Choose an account.");
  const amount = draft.amount.trim().replaceAll(",", "");
  if (!/^\d{1,12}(?:\.\d{1,2})?$/.test(amount) || !/[1-9]/.test(amount))
    throw new Error(
      "Enter a positive amount with at most 12 whole digits and two decimal places.",
    );
  if (formatCalendarDate(draft.date) === "Unknown date")
    throw new Error("Choose a valid date.");
  if (draft.time && formatClockTime(draft.time) === "Not reported")
    throw new Error("Enter a valid time, or leave it blank if unknown.");
  if (
    draft.type === "transfer" &&
    (!draft.transfer_account || draft.transfer_account === draft.account)
  )
    throw new Error("Choose two different transfer accounts.");
  const accountIds =
    draft.type === "transfer"
      ? [draft.account, draft.transfer_account]
      : [draft.account];
  const balances = accountIds.map((account) => {
    const value = (draft.balances[account] ?? "").trim().replaceAll(",", "");
    if (value && !/^-?\d{1,12}(?:\.\d{1,2})?$/.test(value))
      throw new Error(
        "Reported balances need at most 12 whole digits and two decimal places.",
      );
    return { account, balance_after: value || null };
  });
  const next: UpdateTransactionInput = {
    type: draft.type,
    direction:
      draft.type === "transfer"
        ? row.type === "transfer" &&
          row.account === draft.account &&
          row.transfer_account === draft.transfer_account
          ? row.direction
          : "debit"
        : draft.direction,
    account: draft.account,
    transfer_account: draft.type === "transfer" ? draft.transfer_account : null,
    category: draft.category || null,
    amount,
    date: draft.date,
    time: draft.time || null,
    reference: draft.reference,
    counterparty_text: draft.counterparty_text,
    note: draft.note,
    payment_method: draft.payment_method || null,
    needs_review: draft.needs_review,
  };
  const patch: UpdateTransactionInput = {};
  for (const [key, value] of Object.entries(next))
    if (JSON.stringify(value) !== JSON.stringify(row[key as keyof Transaction]))
      (patch as Record<string, unknown>)[key] = value;
  const before = transactionDraft(row);
  const balanceChanged = balances.some(
    (item) => (before.balances[item.account] || null) !== item.balance_after,
  );
  if (draft.type === "transfer") {
    if (
      balanceChanged ||
      draft.account !== row.account ||
      draft.transfer_account !== row.transfer_account ||
      row.type !== "transfer"
    )
      patch.reported_balances = balances;
  } else if (
    balanceChanged ||
    draft.account !== row.account ||
    row.type === "transfer"
  )
    patch.balance_after = balances[0].balance_after;
  if (allowLinked && Object.keys(patch).length)
    patch.allow_linked_correction = true;
  return patch;
}
export function needsLinkedAcknowledgement(
  row: Transaction,
  draft: TransactionDraft,
) {
  const core =
    row.type !== draft.type ||
    row.account !== draft.account ||
    (row.transfer_account ?? "") !==
      (draft.type === "transfer" ? draft.transfer_account : "") ||
    Number(row.amount) !== Number(draft.amount.replaceAll(",", ""));
  return (
    ((row.statement_evidence_count ?? 0) > 0 &&
      (core ||
        row.direction !==
          (draft.type === "transfer"
            ? row.type === "transfer" &&
              row.account === draft.account &&
              row.transfer_account === draft.transfer_account
              ? row.direction
              : "debit"
            : draft.direction))) ||
    ((row.type === "transfer" || draft.type === "transfer") &&
      row.transfer_evidence.length > 1 &&
      core)
  );
}
