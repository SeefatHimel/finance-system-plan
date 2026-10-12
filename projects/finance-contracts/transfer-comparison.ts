/** Present the reviewed draft in the same money-flow direction as API matches. */
export function transferComparison(draft: {
  account?: string | null;
  transfer_account?: string | null;
  direction?: string;
  amount?: string;
  date?: string;
  time?: string | null;
  reference?: string;
  counterparty_text?: string;
  note?: string;
}, accountName: (id: string) => string | undefined) {
  const incoming = draft.direction === "credit";
  const sender = incoming ? draft.transfer_account : draft.account;
  const receiver = incoming ? draft.account : draft.transfer_account;
  return {
    account_name: sender ? accountName(sender) ?? "Unknown sender" : "Unknown sender",
    transfer_account_name: receiver ? accountName(receiver) ?? "Unknown destination" : "Unknown destination",
    amount: draft.amount ?? "",
    date: draft.date ?? "",
    time: draft.time ?? null,
    reference: draft.reference ?? "",
    counterparty_text: draft.counterparty_text ?? "",
    note: draft.note ?? "",
  };
}
